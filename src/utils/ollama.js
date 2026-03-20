/**
 * Ollama API wrapper with streaming support
 */

import {
  tryParsePartialJSON,
  tryParsePartialBits,
  extractCompleteJsonObjects,
  extractRawJsonObjects,
} from "./jsonParser.js";

// Re-export from extracted modules for backward compatibility
export { tryParsePartialJSON, tryParsePartialBits, extractCompleteJsonObjects, extractRawJsonObjects } from "./jsonParser.js";
export { calculateCharPosition, extractTextByPosition, adjustBoundary, findWordBoundary, getLineColumn, getLineBoundaries } from "./positionTracker.js";

// ─── Global generation queue ─────────────────────────────────────────
// Ollama can only run one generation at a time on a single GPU.
// This queue serializes all LLM calls (chat + stream) to prevent contention.
// Supports priority levels: "high" (user-initiated) runs before "normal" (background).

const _genQueue = [];
let _genRunning = false;
let _genActive = null; // { label, startedAt } for the currently running item
const _genListeners = new Set();

/** Subscribe to queue state changes. Returns unsubscribe function. */
export function onQueueChange(fn) {
  _genListeners.add(fn);
  return () => _genListeners.delete(fn);
}

function _notifyListeners() {
  const snapshot = getQueueSnapshot();
  for (const fn of _genListeners) fn(snapshot);
}

/** Get a snapshot of the current queue state. */
export function getQueueSnapshot() {
  return {
    active: _genActive,
    pending: _genQueue.map(q => ({ label: q.label, priority: q.priority })),
    total: _genQueue.length + (_genActive ? 1 : 0),
  };
}

/** Cancel all pending (not active) queue items. */
export function cancelPendingGenerations() {
  while (_genQueue.length > 0) {
    const item = _genQueue.pop();
    item.reject(new Error("Cancelled"));
  }
  _notifyListeners();
}

function enqueueGeneration(fn, label = "generation", priority = "normal") {
  return new Promise((resolve, reject) => {
    const item = { fn, resolve, reject, label, priority };
    // Insert high-priority items before normal-priority ones
    if (priority === "high") {
      const insertIdx = _genQueue.findIndex(q => q.priority !== "high");
      if (insertIdx === -1) _genQueue.push(item);
      else _genQueue.splice(insertIdx, 0, item);
    } else {
      _genQueue.push(item);
    }
    _notifyListeners();
    _drainGenQueue();
  });
}

async function _drainGenQueue() {
  if (_genRunning || _genQueue.length === 0) return;
  _genRunning = true;
  while (_genQueue.length > 0) {
    const { fn, resolve, reject, label } = _genQueue.shift();
    _genActive = { label, startedAt: Date.now() };
    _notifyListeners();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }
  _genActive = null;
  _genRunning = false;
  _notifyListeners();
}

// ─── JSON repair for truncated responses ────────────────────────────
/**
 * Try to repair a truncated JSON object by closing open strings, arrays, and braces.
 * Handles cases where the LLM ran out of tokens mid-response.
 */
function tryRepairTruncatedObject(text) {
  const cleaned = text.replace(/```json\s?|```/g, "").trim();
  // Must start with { or [ to be JSON
  const objStart = cleaned.search(/[{\[]/);
  if (objStart === -1) return null;

  const attempt = cleaned.substring(objStart);

  // Quick check: if it parses already, no repair needed
  try { const p = JSON.parse(attempt); if (p && typeof p === 'object') return null; } catch {}

  // Strategy: progressively trim from the end and try closing brackets.
  // Find the last position where we can cleanly truncate, then close.
  const closers = [
    // Try closing as-is (just needs brackets)
    (s) => s,
    // Trim truncated string value: cut back to last complete quote
    (s) => {
      const lastQuote = s.lastIndexOf('"');
      return lastQuote > 0 ? s.substring(0, lastQuote + 1) : s;
    },
    // Trim to last complete array element (before trailing comma + partial string)
    (s) => {
      const match = s.match(/^([\s\S]*"[^"]*")\s*[,\]}\s]*$/);
      return match ? match[1] : s;
    },
    // Trim to last complete key-value pair boundary
    (s) => {
      // Find last comma or colon that's outside a string, then trim after prior complete value
      let inStr = false, esc = false, lastComma = -1;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr && c === ',') lastComma = i;
      }
      return lastComma > 0 ? s.substring(0, lastComma) : s;
    },
  ];

  for (const trimmer of closers) {
    const trimmed = trimmer(attempt);
    // Count unclosed structures
    let inString = false, escaped = false, braces = 0, brackets = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }

    // Build closing sequence
    let repaired = trimmed;
    if (inString) repaired += '"';
    for (let i = 0; i < brackets; i++) repaired += ']';
    for (let i = 0; i < braces; i++) repaired += '}';

    try {
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object') {
        console.warn(`[callOllama] Repaired truncated JSON (closed ${braces} braces, ${brackets} brackets, inString=${inString})`);
        // Flag repaired results so callers know fields may be incomplete
        if (Array.isArray(parsed)) {
          parsed.forEach(item => { if (item && typeof item === 'object') item._incomplete = true; });
        } else {
          parsed._incomplete = true;
        }
        return parsed;
      }
    } catch { /* try next strategy */ }
  }

  return null;
}

// ─── Utility helpers ────────────────────────────────────────────────
export const uid = () => crypto.randomUUID().slice(0, 8);

// ─── Model management ────────────────────────────────────────────────
/**
 * Fetch available models from Ollama
 * @returns {Promise<Array>} Array of available model names
 */
export async function getAvailableModels() {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) {
      throw new Error(`Ollama API error ${res.status}`);
    }
    const data = await res.json();
    return data.models ? data.models.map((m) => m.name) : [];
  } catch (error) {
    console.error("[Ollama] Error fetching available models:", error);
    return ["qwen3.5:9b"]; // Fallback to default
  }
}

// ─── Non-streaming call with retry ──────────────────────────────────
async function callOllamaOnce(system, userMsg, onStatus, model, debugCallback, externalSignal) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMsg }
  ];

  debugCallback?.({ type: "prompt", system, userMsg, model });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

  // If an external signal is provided, forward its abort to our controller
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      throw new DOMException("Aborted", "AbortError");
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      messages,
      stream: false,
      think: false,
      options: { num_predict: 8192, num_ctx: 16384 },
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  let text = data.message?.content || "";

  debugCallback?.({ type: "response", rawText: text, model });

  // Strip <think>...</think> blocks (some models ignore think:false)
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Strip markdown fences
  text = text.replace(/```json\s?|```/g, "").trim();

  // Try multiple parsing strategies
  // 1. Strict JSON parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // 2. Try extracting raw JSON objects (works for both bit and non-bit responses)
    const rawObjects = extractRawJsonObjects(text);
    if (rawObjects.length > 0) return rawObjects;

    // 3. Try extracting a JSON array with partial-JSON parser (normalizes as bits)
    const parsed = tryParsePartialJSON(text);
    if (parsed && Array.isArray(parsed) && parsed.length > 0) return parsed;

    // 4. Try to repair truncated JSON objects (e.g. cut off mid-string in group_reasoning)
    const repaired = tryRepairTruncatedObject(text);
    if (repaired) return repaired;

    console.error(`[callOllama] All JSON parse strategies failed. Raw text:`, text.substring(0, 500));
    throw new Error(`Failed to parse JSON response: ${text.substring(0, 200)}`);
  }
}

export async function callOllama(system, userMsg, onStatus, model = "qwen3.5:9b", debugCallback = null, externalSignal = null, { label = "chat", priority = "normal" } = {}) {
  return enqueueGeneration(async () => {
    onStatus?.("Calling " + model + " via Ollama...");

    try {
      return await callOllamaOnce(system, userMsg, onStatus, model, debugCallback, externalSignal);
    } catch (e) {
      // Don't retry user-initiated aborts
      if (e.name === "AbortError") throw e;

      // Retry once on transient errors (connection, 503, parse failures)
      const isTransient = e.message?.includes("fetch") ||
        e.message?.includes("503") ||
        e.message?.includes("Failed to parse") ||
        e.message?.includes("network");
      if (isTransient) {
        console.warn(`[callOllama] Retrying after transient error: ${e.message}`);
        onStatus?.("Retrying " + model + "...");
        await new Promise(r => setTimeout(r, 2000));
        return await callOllamaOnce(system, userMsg, onStatus, model, debugCallback, externalSignal);
      }
      throw e;
    }
  }, label, priority);
}

// ─── Health check and restart helpers ────────────────────────────────
/**
 * Check if Ollama is healthy via backend API
 * @returns {Promise<boolean>} True if Ollama is responding
 */
export async function checkOllamaHealth() {
  const fetchWithTimeout = (url, ms = 5000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return fetch(url, { method: "GET", signal: controller.signal })
      .finally(() => clearTimeout(timeout));
  };
  try {
    const response = await fetchWithTimeout("http://localhost:3001/api/health");
    const data = await response.json();
    return data.healthy === true;
  } catch {
    // If backend is not running, try direct Ollama check
    try {
      const response = await fetchWithTimeout("http://localhost:11434/api/tags");
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Request Ollama restart via backend API
 * @returns {Promise<object>} Result of restart attempt
 */



export async function requestOllamaRestart() {
  try {
    console.log("[Ollama] Requesting process restart...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s max
    const response = await fetch("http://localhost:3001/api/restart-ollama", {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    console.log("[Ollama] Restart result:", data);
    return data;
  } catch (error) {
    console.warn("[Ollama] Restart skipped (backend unavailable):", error.message);
    return { success: false, error: error.message };
  }
}

// ─── Streaming call ────────────────────────────────────────────────
/**
 * Stream-based Ollama call with real-time parsing
 * @param {string} system - System prompt
 * @param {string} userMsg - User message (just the current chunk text, not full document)
 * @param {object} callbacks - {onChunk, onBitFound, onTagProgress, onComplete, onError, onFrozen}
 * @param {string} model - Model name (default: gemma3:12b)
 * @param {AbortController} abortController - Optional abort controller for cancellation
 * @param {number} timeoutMs - Timeout in milliseconds (0 = no timeout, default 45000 = 45s for chunks)
 * @returns {Promise<Array>} Final parsed JSON result
 */
export async function callOllamaStream(system, userMsg, callbacks = {}, model = "qwen3.5:9b", abortController = null, timeoutMs = 30000, { label = "stream", priority = "normal" } = {}) {
  return enqueueGeneration(() => _callOllamaStreamInner(system, userMsg, callbacks, model, abortController, timeoutMs), label, priority);
}

async function _callOllamaStreamInner(system, userMsg, callbacks = {}, model = "qwen3.5:9b", abortController = null, timeoutMs = 30000) {
  const { onChunk, onBitFound, onTagProgress, onComplete, onError, onFrozen, onDebug } = callbacks;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMsg }
  ];

  const finalResult = [];  // Declared outside try so catch can access accumulated bits
  let bitCount = 0;

  onDebug?.({ type: "prompt", system, userMsg, model });

  try {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        messages,
        stream: true,
        think: false,
        options: { num_predict: 16384, num_ctx: 32768 },
      }),
      signal: abortController?.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${err}`);
    }

    let fullText = "";
    let buffer = "";
    let timedOut = false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Inactivity timer: resets on every received chunk, only fires after
    // timeoutMs of complete silence (no data from Ollama at all).
    let inactivityTimer = null;
    let frozenResolve = null;
    const frozenPromise = new Promise((resolve) => { frozenResolve = resolve; });
    const resetInactivityTimer = () => {
      if (timeoutMs > 0) {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => frozenResolve("FROZEN"), timeoutMs);
      }
    };
    const clearInactivityTimer = () => {
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    };

    // Start the inactivity clock
    resetInactivityTimer();

    console.log("[Streaming] Starting stream...");

    while (true) {
      try {
        // Race the read against the inactivity timer.
        // The timer only fires after timeoutMs of ZERO chunks — it resets on every chunk.
        const raceResult = await Promise.race([
          reader.read().then(r => ({ type: "data", ...r })),
          frozenPromise.then(() => ({ type: "frozen" })),
        ]);

        if (raceResult.type === "frozen") {
          console.warn(`[Streaming] No data received for ${timeoutMs / 1000}s — Ollama likely frozen`);
          timedOut = true;

          // Cancel the underlying stream so the reader doesn't leak
          reader.cancel().catch(() => {});

          // Salvage bits from accumulated output
          const completeBits = tryParsePartialJSON(fullText);
          const allBits = completeBits && Array.isArray(completeBits) ? [...completeBits] : [];
          if (allBits.length > 0) {
            console.log("[Streaming] Found", allBits.length, "COMPLETE bits in frozen stream");
          }

          const partialBits = tryParsePartialBits(fullText);
          if (partialBits && Array.isArray(partialBits)) {
            partialBits.forEach(pbit => {
              if (!allBits.some(cbit => cbit.fullText === pbit.fullText)) {
                allBits.push(pbit);
              }
            });
            if (partialBits.length > 0) {
              console.log("[Streaming] Found", partialBits.length, "PARTIAL bits from incomplete JSON");
            }
          }

          if (allBits.length > 0) {
            console.log("[Streaming] Total bits from frozen stream:", allBits.length);
            allBits.forEach((bit, idx) => {
              if (idx >= finalResult.length) {
                bitCount++;
                onBitFound?.(bit, bitCount);
                finalResult[idx] = bit;
                console.log("[Streaming] Frozen stream bit:", bit.title, `(${bit.fullText.length} chars)`);
              }
            });
          }

          onFrozen?.({
            bitsFound: finalResult.length,
            lastBitEndChar: finalResult.length > 0 ? (finalResult[finalResult.length - 1].textPosition?.endChar || 0) : 0,
          });
          break;
        }

        const { done, value } = raceResult;
        if (done) {
          clearInactivityTimer();
          break;
        }

        // Data received — reset the inactivity timer
        resetInactivityTimer();

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete lines (for JSON extraction)
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          try {
            const data = JSON.parse(line);

            // Log received message for debugging
            if (data.message?.content) {
              console.log("[Stream] Received content chunk:", data.message.content.substring(0, 100));
            }

            if (data.message?.content) {
              const content = data.message.content;
              fullText += content;

              // Send accumulated text content to UI (not raw JSON)
              onChunk?.(fullText);

              // Extract complete JSON objects from stream in real-time
              const completeObjects = extractCompleteJsonObjects(fullText);

              // Emit any newly found bits
              if (completeObjects && completeObjects.length > 0) {
                const lastEmittedLength = finalResult.length;
                completeObjects.forEach((bit, idx) => {
                  if (idx >= lastEmittedLength) {
                    bitCount++;
                    onBitFound?.(bit, bitCount);
                    finalResult[idx] = bit;
                    console.log("[Stream] Found bit #" + bitCount + " (real-time):", bit.title);
                  }
                });
              }
            }
          } catch (e) {
            // Skip non-JSON lines - this is normal for streaming
            // Just log occasionally for debugging
            if (Math.random() < 0.05) {
              console.log("[Stream] Skipped non-JSON line:", line.substring(0, 50));
            }
          }
        }
      } catch (readError) {
        clearInactivityTimer();
        console.error("[Streaming] Read error:", readError);
        throw readError;
      }
    }

    clearInactivityTimer();

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.message?.content) {
          fullText += data.message.content;
          onChunk?.(fullText);
        }
      } catch (e) {
        console.log("[Stream] Final buffer not JSON (expected):", buffer.substring(0, 50));
      }
    }

    console.log("[Streaming] Stream " + (timedOut ? "FROZEN (timeout)" : "complete") + ". Total bits found:", bitCount);
    console.log("[Streaming] Full text length:", fullText.length);

    onDebug?.({ type: "response", rawText: fullText, model, timedOut });

    // If timed out, return what we have
    if (timedOut) {
      console.log("[Streaming] Returning partial results from timeout");
      onComplete?.(finalResult.filter(Boolean));
      return finalResult.filter(Boolean);
    }

    // Final parse for complete results
    let result = tryParsePartialJSON(fullText);
    if (!result || !Array.isArray(result)) {
      try {
        result = JSON.parse(fullText.replace(/```json|```/g, "").trim());
      } catch (e) {
        // If strict JSON parsing fails, try to extract what we can
        console.warn("[Streaming] Full JSON parse failed, attempting partial extraction...");

        // Try to find and parse individual objects from the text
        const objectMatches = fullText.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
        if (objectMatches.length > 0) {
          result = [];
          for (const match of objectMatches) {
            try {
              const obj = JSON.parse(match);
              if (obj && typeof obj === 'object') {
                result.push(obj);
              }
            } catch (e) {
              // Skip objects that can't be parsed
            }
          }

          // If no complete objects found, try to parse partial bits from incomplete JSON
          if (result.length === 0) {
            console.warn("[Streaming] No complete JSON objects found, attempting to extract partial bits...");
            const partialBits = tryParsePartialBits(fullText);
            if (partialBits && Array.isArray(partialBits) && partialBits.length > 0) {
              result = partialBits;
              console.log("[Streaming] Extracted", result.length, "partial bits from incomplete JSON");
            } else {
              // No bits found from any parsing method - fall through to use finalResult from real-time extraction
              console.warn("[Streaming] Could not extract any objects or partial bits from final text");
            }
          }
        } else {
          // No complete JSON objects found in remaining text
          // This is expected for incomplete streams - we already have bits from real-time extraction
          console.warn("[Streaming] No complete JSON objects found in remaining text (stream may be incomplete)");
          console.warn("[Streaming] Full text length:", fullText.length);
          if (finalResult.length > 0) {
            console.log("[Streaming] Returning", finalResult.length, "bits found during streaming");
          }
        }
      }
    }

    // If we couldn't parse a complete JSON array, use the bits we found during real-time extraction
    if (!Array.isArray(result)) {
      console.warn("[Streaming] Result is not an array (expected for incomplete streams):", typeof result);
      if (finalResult.length > 0) {
        console.log("[Streaming] Using", finalResult.length, "bits found during real-time extraction");
        result = finalResult;
      } else {
        console.warn("[Streaming] No bits found at all during streaming");
        result = [];
      }
    }

    console.log("[Streaming] Returning result array length:", result.length);
    onComplete?.(result);
    return result || [];
  } catch (error) {
    console.error("[Streaming] Stream error:", error);
    onError?.(error);
    // If we already found bits during streaming, return them instead of crashing
    if (finalResult && finalResult.length > 0) {
      console.log("[Streaming] Returning", finalResult.length, "bits found before error");
      onComplete?.(finalResult.filter(Boolean));
      return finalResult.filter(Boolean);
    }
    throw error;
  }
}

// ─── Bit normalization ────────────────────────────────────────────
/**
 * Normalize a parsed bit object — fill in missing fields with sensible defaults.
 * Accepts any object that has at least `fullText` and turns it into a complete bit.
 */
export function normalizeBit(raw) {
  if (!raw || typeof raw !== "object") return null;

  // Strip leading/trailing quotes from all string fields
  const unquote = (v) => {
    if (typeof v !== "string") return v;
    const trimmed = v.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  // Accept multiple fallback keys for fullText
  let fullText = unquote(raw.fullText) || unquote(raw.full_text) || unquote(raw.text) || unquote(raw.content) || unquote(raw.transcript) || "";
  if (!fullText || typeof fullText !== "string" || fullText.trim().length === 0) {
    // Salvage: if summary exists and is long enough, use it as fullText (LLM sometimes swaps fields)
    const summary = unquote(raw.summary);
    if (summary && typeof summary === "string" && summary.trim().length > 50) {
      fullText = summary.trim();
      console.warn("[normalizeBit] Salvaged fullText from summary field");
    } else {
      return null;
    }
  }

  const clean = (v, fallback) => {
    const uv = unquote(v);
    return uv != null && typeof uv === "string" && uv.trim().length > 0 ? uv.trim() : fallback;
  };

  const cleanArray = (v) => {
    if (Array.isArray(v)) return v.map(unquote).filter((x) => typeof x === "string" && x.trim().length > 0);
    if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  };

  // Generate title from first 5 words if missing (reads better than first 40 chars)
  const generateTitle = (text) => {
    const words = text.trim().split(/\s+/).slice(0, 5).join(" ");
    return words + (text.trim().split(/\s+/).length > 5 ? "..." : "");
  };

  const title = clean(raw.title, generateTitle(fullText));
  const summary = clean(raw.summary, fullText.substring(0, 120).replace(/\s+/g, " ").trim());

  // Accept `tag` (singular) as fallback for `tags`
  const tagsRaw = raw.tags || raw.tag;

  let textPosition = { startChar: 0, endChar: 0 };
  if (raw.textPosition && typeof raw.textPosition === "object") {
    const s = parseInt(raw.textPosition.startChar, 10);
    const e = parseInt(raw.textPosition.endChar, 10);
    if (!isNaN(s) && !isNaN(e) && e > s) {
      textPosition = { startChar: s, endChar: e };
    }
  }

  return {
    title,
    summary,
    fullText: fullText.trim(),
    tags: cleanArray(tagsRaw).map((t) => t.replace(/\s+/g, "-").toLowerCase()),
    keywords: cleanArray(raw.keywords),
    textPosition,
  };
}
