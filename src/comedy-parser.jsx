import { useReducer, useRef, useCallback, useEffect, useMemo, useState } from "react";
import { callOllama, callOllamaStream, calculateCharPosition, uid, getAvailableModels, requestOllamaRestart, normalizeBit } from "./utils/ollama";
import { findTextPosition } from "./utils/textMatcher";
import { validateAllBits } from "./utils/textContinuityValidator";
import { TouchstonePanel } from "./components/TouchstonePanel";
import { detectTouchstones, annotateBitsWithTouchstones } from "./utils/touchstoneDetector";
import { createRootBit } from "./utils/bitMerger";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import {
  getDB,
  saveVaultState,
  loadVaultState,
  getVaultMetadata,
  getDatabaseStats,
  exportDatabaseAsJSON,
  importDatabaseFromJSON,
  saveSingleTopic,
} from "./utils/database";
import { findSimilarBits, findDuplicateBit, advancedSearch } from "./utils/similaritySearch";
import { EmbeddingStore, embedText } from "./utils/embeddings";
import { SYSTEM_PARSE, SYSTEM_PARSE_V2, SYSTEM_MATCH, SYSTEM_MATCH_PAIR, SYSTEM_HUNT_BATCH, SYSTEM_TOUCHSTONE_VERIFY, SYSTEM_TOUCHSTONE_COMMUNE, SYSTEM_SYNTHESIZE_TOUCHSTONE } from "./utils/prompts";
import { absorbOrMerge } from "./utils/autoDedup";
import { OpQueue } from "./utils/opQueue";
import { prepareSplitUpdate, prepareJoinUpdate, applyBoundaryChange, applyTakeOverlap, applyScrollBoundary, updateTouchstoneBitIds } from "./utils/bitOperations";
import { runParseLoop } from "./utils/parseLoop";
import { runHuntBatches } from "./utils/huntRunner";
import { assembleAndMergeTouchstones } from "./utils/touchstoneAssembler";
import { generateObsidianVault } from "./utils/obsidianExport";
import { NetworkGraph } from "./components/NetworkGraph";
import { DebugPanel } from "./components/DebugPanel";
import { StreamingProgressPanel } from "./components/StreamingProgressPanel";
import { UploadTab } from "./components/UploadTab";
import { DatabaseTab } from "./components/DatabaseTab";
import { TranscriptTab } from "./components/TranscriptTab";
import { ExportTab } from "./components/ExportTab";
import { ValidationTab } from "./components/ValidationTab";
import { DetailPanel } from "./components/DetailPanel";
import { MixPanel } from "./components/MixPanel";

const initialState = {
  transcripts: [],
  topics: [],
  matches: [],
  status: "",
  processing: false,
  activeTab: "upload",
  selectedTopic: null,
  filterTag: null,
  streamingProgress: null,
  foundBits: [],
  selectedTranscript: null,
  adjustingBit: null,
  validationResult: null,
  editingMode: null,
  touchstones: { confirmed: [], possible: [] },
  rootBits: [],
  dbStats: null,
  lastSave: null,
  selectedModel: "qwen3.5:9b",
  availableModels: [],
  shouldStop: false,
  debugMode: false,
  debugLog: [],
  huntProgress: null, // { current, total, found, status }
  embeddingModel: "mxbai-embed-large",
  embeddingStatus: { cached: 0, total: 0 },
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'UPDATE':
      return { ...state, [action.field]: action.fn(state[action.field]) };
    case 'MERGE':
      return { ...state, ...action.payload };
    case 'CLEAR_ALL':
      return {
        ...initialState,
        availableModels: state.availableModels,
        selectedModel: state.selectedModel,
        embeddingModel: state.embeddingModel,
      };
    default:
      return state;
  }
}

export default function ComedyParser() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const opQueue = useRef(new OpQueue()).current;

  const {
    transcripts, topics, matches, status, processing,
    activeTab, selectedTopic, filterTag, streamingProgress,
    foundBits, selectedTranscript, adjustingBit, validationResult,
    editingMode, touchstones, rootBits, dbStats, lastSave,
    selectedModel, availableModels, shouldStop, debugMode,
    debugLog, huntProgress, embeddingModel, embeddingStatus,
  } = state;

  // Dispatch helpers
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  // Named setters for child component props (stable references)
  const setActiveTab = useCallback((v) => dispatch({ type: 'SET', field: 'activeTab', value: v }), []);
  const setSelectedTopic = useCallback((v) => dispatch({ type: 'SET', field: 'selectedTopic', value: v }), []);
  const setFilterTag = useCallback((v) => dispatch({ type: 'SET', field: 'filterTag', value: v }), []);
  const setSelectedTranscript = useCallback((v) => dispatch({ type: 'SET', field: 'selectedTranscript', value: v }), []);
  const setAdjustingBit = useCallback((v) => dispatch({ type: 'SET', field: 'adjustingBit', value: v }), []);
  const setEditingMode = useCallback((v) => dispatch({ type: 'SET', field: 'editingMode', value: v }), []);
  const setShouldStop = useCallback((v) => dispatch({ type: 'SET', field: 'shouldStop', value: v }), []);

  const fileInput = useRef(null);
  const restoreFileInput = useRef(null);
  const abortControllerRef = useRef(null);
  const huntControllerRef = useRef(null);
  const matchBitLiveRef = useRef(null);
  const revalidateMatchesRef = useRef(null);
  const revalidateTimerRef = useRef(null);
  const revalidatePendingBitsRef = useRef(new Set());
  const embeddingStore = useRef(new EmbeddingStore()).current;
  const [mixTranscriptInit, setMixTranscriptInit] = useState(null);
  const [mixBitInit, setMixBitInit] = useState(null);
  const [mixGapInit, setMixGapInit] = useState(null);
  const [touchstoneInit, setTouchstoneInit] = useState(null);
  const [approvedGaps, setApprovedGaps] = useState(() => {
    try { return JSON.parse(localStorage.getItem("topix-approved-gaps") || "[]"); } catch { return []; }
  });
  const handleApproveGap = useCallback((gapKey) => {
    setApprovedGaps((prev) => {
      const next = [...prev, gapKey];
      try { localStorage.setItem("topix-approved-gaps", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const addDebugEntry = useCallback((entry) => {
    update('debugLog', (prev) => [...prev.slice(-19), { ...entry, id: uid(), timestamp: Date.now() }]);
  }, []);

  // Warn before closing tab
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Initialize database and load models on mount
  useEffect(() => {
    getDB().catch((err) => console.error("DB init error:", err));
    loadSavedData();

    // Load available models from Ollama
    getAvailableModels().then((models) => {
      set('availableModels', models);
      // Set default model from available models
      if (models.length > 0 && !models.includes("qwen3.5:9b")) {
        set('selectedModel', models[0]);
      }
    }).catch((err) => console.error("Error loading models:", err));

    // Load cached embeddings from IndexedDB
    embeddingStore.loadFromDB().then(() => {
      set('embeddingStatus', { cached: embeddingStore.size, total: 0 });
    }).catch((err) => console.warn("Embedding load error:", err));

    // Detect interrupted parse from previous session
    try {
      const interrupted = sessionStorage.getItem("topix-parsing");
      if (interrupted) {
        const info = JSON.parse(interrupted);
        sessionStorage.removeItem("topix-parsing");
        set('status', `⚠️ Parsing "${info.transcript}" was interrupted. Found bits were saved. You can re-parse to continue.`);
      }
    } catch {}
  }, []);

  // Load saved data from database
  const loadSavedData = useCallback(async () => {
    try {
      const saved = await loadVaultState();
      if (saved.topics && saved.topics.length > 0) {
        dispatch({ type: 'MERGE', payload: {
          topics: saved.topics,
          transcripts: saved.transcripts || [],
          matches: saved.matches || [],
          touchstones: saved.touchstones || { confirmed: [], possible: [] },
          rootBits: saved.rootBits || [],
        }});
      }
    } catch (err) {
      console.error("Error loading saved data:", err);
    }
  }, []);

  // Auto-save vault state (debounced to every 5 seconds after changes)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveVaultState({ topics, matches, transcripts, touchstones, rootBits })
        .then(() => {
          set('lastSave', new Date());
          getDatabaseStats().then(stats => set('dbStats', stats)).catch(console.error);
        })
        .catch((err) => console.error("Auto-save error:", err));
    }, 5000);

    return () => clearTimeout(timer);
  }, [topics, matches, transcripts, touchstones, rootBits]);

  // Run validation whenever topics change
  useEffect(() => {
    if (topics.length > 0) {
      const result = validateAllBits(topics, transcripts);
      set('validationResult', result);
    }
  }, [topics, transcripts]);

  // Persistent map: sorted bitIds key → LLM-generated name (survives re-detections)
  const touchstoneNameCache = useRef(new Map());
  const touchstoneNamingController = useRef(null);

  // ── Touchstone name cache helpers ──────────────────────────────
  // Cache uses sorted bitIds as key, but clusters can shift slightly between
  // detections (a bit added/removed). Fuzzy lookup finds the best cached name
  // if ≥50% of bits overlap with a cached key.
  const findCachedName = useCallback((bitIds) => {
    const idSet = new Set(bitIds);
    const exactKey = [...bitIds].sort().join(",");
    if (touchstoneNameCache.current.has(exactKey)) {
      return touchstoneNameCache.current.get(exactKey);
    }
    // Fuzzy: find a cached key with high overlap
    let bestName = null, bestOverlap = 0;
    for (const [key, name] of touchstoneNameCache.current.entries()) {
      const cachedIds = key.split(",");
      const overlap = cachedIds.filter(id => idSet.has(id)).length;
      const overlapRatio = overlap / Math.max(idSet.size, cachedIds.length);
      if (overlapRatio >= 0.5 && overlap > bestOverlap) {
        bestOverlap = overlap;
        bestName = name;
      }
    }
    return bestName;
  }, []);

  const setCachedName = useCallback((bitIds, name) => {
    const key = [...bitIds].sort().join(",");
    touchstoneNameCache.current.set(key, name);
  }, []);

  // Track which touchstones are currently being named to avoid re-triggering
  const namingInFlight = useRef(new Set());

  // Detect touchstones whenever topics or matches change
  // Skip during active parsing to avoid O(n^2) on every new bit — debounce 2s
  useEffect(() => {
    if (processing) return; // Don't cluster while parsing/matching
    const debounceTimer = setTimeout(() => {
    if (topics.length >= 2) {
      const detected = detectTouchstones(topics, matches, 2);
      const prev = stateRef.current.touchstones || {};
      const keyOf = (ts) => [...ts.bitIds].sort().join(",");

      const named = assembleAndMergeTouchstones({
        detected,
        previousTouchstones: prev,
        topics,
        matches,
        findCachedName,
      });
      set('touchstones', named);

      // Find touchstones that still need LLM naming (not cached, not already in-flight)
      // Skip confirmed touchstones (only rename on manual refresh) and manually-named ones
      // Skip touchstones that were already auto-named (persisted across reloads)
      const toName = named.possible.filter(ts => {
        if (ts.manualName) return false;
        if (ts.autoNamed) return false;
        const cached = findCachedName(ts.bitIds);
        if (cached) return false;
        const key = keyOf(ts);
        if (namingInFlight.current.has(key)) return false;
        return true;
      });

      if (toName.length > 0) {
        // Don't abort previous naming — let it finish. Just add new ones.
        const controller = touchstoneNamingController.current || new AbortController();
        if (!touchstoneNamingController.current) {
          touchstoneNamingController.current = controller;
        }

        (async () => {
          const model = stateRef.current.selectedModel;
          for (const ts of toName) {
            if (controller.signal.aborted) break;
            const tsKey = keyOf(ts);

            // Double-check: might have been named by a concurrent run
            if (findCachedName(ts.bitIds) || namingInFlight.current.has(tsKey)) continue;
            namingInFlight.current.add(tsKey);

            try {
              const coreIds = ts.coreBitIds || ts.bitIds;
              const coreBits = coreIds
                .map(id => topics.find(t => t.id === id))
                .filter(Boolean);
              if (coreBits.length === 0) { namingInFlight.current.delete(tsKey); continue; }

              const coreTexts = coreBits
                .map(b => (b.fullText || "").substring(0, 600))
                .join("\n---\n");
              if (!coreTexts.trim()) { namingInFlight.current.delete(tsKey); continue; }

              set('status', `Naming touchstone: "${ts.name}"...`);

              const res = await fetch("http://localhost:11434/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: "Name this recurring comedy bit based on these performances of the SAME joke. Use the format: '[3-5 word title] or, [5-8 word title]' — the first title is a punchy shorthand, the second is more descriptive. Include the literal text 'or,' between them. Focus on the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'DMV Nightmare or, The Witness Protection Line at the DMV'" },
                    { role: "user", content: `${coreBits.length} performances of the same bit:\n\n${coreTexts}` },
                  ],
                  stream: false,
                  think: false,
                  options: { num_predict: 64, num_ctx: 4096 },
                }),
                signal: controller.signal,
              });
              if (!res.ok) { namingInFlight.current.delete(tsKey); continue; }
              const data = await res.json();
              let name = (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
              if (!name || controller.signal.aborted) { namingInFlight.current.delete(tsKey); continue; }

              // Cache under exact key AND apply to current state
              setCachedName(ts.bitIds, name);

              update('touchstones', (prev) => {
                const rename = (list) => list.map(t => {
                  // Never overwrite manually-set names or confirmed touchstones
                  if (t.manualName || t.category === "confirmed") return t;
                  // Match by exact key or by high bitId overlap
                  const tKey = keyOf(t);
                  if (tKey === tsKey) return { ...t, name, autoNamed: true };
                  // Also check overlap in case cluster shifted
                  const tSet = new Set(t.bitIds);
                  const overlap = ts.bitIds.filter(id => tSet.has(id)).length;
                  if (overlap >= Math.ceil(ts.bitIds.length * 0.5) && !findCachedName(t.bitIds)) {
                    return { ...t, name, autoNamed: true };
                  }
                  return t;
                });
                return { confirmed: prev.confirmed || [], possible: rename(prev.possible || []), rejected: rename(prev.rejected || []) };
              });
              console.log(`[Touchstone] Auto-named "${ts.name}" → "${name}" (core: ${coreIds.length}/${ts.bitIds.length} bits)`);
            } catch (err) {
              if (err.name === "AbortError") break;
              console.warn(`[Touchstone] Auto-name failed:`, err.message);
            } finally {
              namingInFlight.current.delete(tsKey);
            }
          }
          set('status', null);
        })();
      }
    } else {
      set('touchstones', { confirmed: [], possible: [], rejected: [] });
    }
    }, 2000); // 2s debounce
    return () => clearTimeout(debounceTimer);
  }, [topics, matches, processing]);

  // Re-validate all matches for changed bits via LLM. Removes stale matches, updates scores.
  // changedBitIds: array of bit IDs whose fullText changed
  // currentTopics/currentMatches: state at time of call (post-boundary-change)
  const revalidateMatchesForBits = useCallback(async (changedBitIds, currentTopics, currentMatches) => {
    const changedSet = new Set(changedBitIds);
    const affectedMatches = currentMatches.filter(
      (m) => changedSet.has(m.sourceId) || changedSet.has(m.targetId)
    );
    if (affectedMatches.length === 0) return;

    const bitsById = new Map(currentTopics.map((t) => [t.id, t]));
    const model = stateRef.current.selectedModel;

    console.log(`[Revalidate] Re-checking ${affectedMatches.length} matches for ${changedBitIds.length} changed bit(s)`);
    set('status', `Re-validating ${affectedMatches.length} match(es) after boundary change...`);

    const toRemove = new Set();
    const toUpdate = []; // {matchId, newPercentage, newRelationship, newReason}

    for (const match of affectedMatches) {
      const bitA = bitsById.get(match.sourceId);
      const bitB = bitsById.get(match.targetId);
      if (!bitA || !bitB) {
        toRemove.add(match.id);
        continue;
      }

      // Skip if either bit is now too short
      const wordsA = (bitA.fullText || "").split(/\s+/).length;
      const wordsB = (bitB.fullText || "").split(/\s+/).length;
      if (wordsA < 15 || wordsB < 15) {
        console.log(`[Revalidate] Removing match "${bitA.title}" ↔ "${bitB.title}" — bit too short (${Math.min(wordsA, wordsB)}w)`);
        toRemove.add(match.id);
        continue;
      }

      try {
        const userMsg = `BIT A:\nTitle: ${bitA.title}\nFull text: ${bitA.fullText}\n\nBIT B:\nTitle: ${bitB.title}\nFull text: ${bitB.fullText}`;
        const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const matchData = Array.isArray(result) ? result[0] : result;

        if (!matchData || typeof matchData.match_percentage !== "number") {
          toRemove.add(match.id);
          continue;
        }

        const mp = Math.round(matchData.match_percentage);
        const rel = matchData.relationship || "none";

        if (mp < 70 || (rel !== "same_bit" && rel !== "evolved")) {
          console.log(`[Revalidate] Removing match "${bitA.title}" ↔ "${bitB.title}": ${mp}% ${rel}`);
          toRemove.add(match.id);
        } else if (mp !== match.matchPercentage || rel !== match.relationship) {
          console.log(`[Revalidate] Updated match "${bitA.title}" ↔ "${bitB.title}": ${match.matchPercentage}%→${mp}% ${match.relationship}→${rel}`);
          toUpdate.push({ matchId: match.id, newPercentage: mp, newRelationship: rel, newReason: matchData.reason || match.reason });
        }
      } catch (err) {
        console.warn(`[Revalidate] LLM error for "${bitA.title}" ↔ "${bitB.title}":`, err.message);
        // Don't remove on error — keep existing match
      }
    }

    if (toRemove.size === 0 && toUpdate.length === 0) {
      console.log("[Revalidate] All matches still valid");
      set('status', `✅ All ${affectedMatches.length} match(es) still valid after boundary change`);
      return;
    }

    update('matches', (prev) => {
      let updated = prev.filter((m) => !toRemove.has(m.id));
      for (const u of toUpdate) {
        updated = updated.map((m) =>
          m.id === u.matchId
            ? { ...m, matchPercentage: u.newPercentage, confidence: u.newPercentage / 100, relationship: u.newRelationship, reason: u.newReason }
            : m
        );
      }
      return updated;
    });

    // Persist
    const s = stateRef.current;
    await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits }).catch(console.error);

    const msg = [];
    if (toRemove.size > 0) msg.push(`removed ${toRemove.size} stale`);
    if (toUpdate.length > 0) msg.push(`updated ${toUpdate.length}`);
    console.log(`[Revalidate] Done: ${msg.join(", ")}`);
    set('status', `✅ Match revalidation: ${msg.join(", ")}`);
  }, []);
  revalidateMatchesRef.current = revalidateMatchesForBits;

  // Debounced revalidation — collects changed bit IDs and fires 30s after last change
  // Skips if processing is active (e.g. embedding, hunting) to avoid Ollama contention
  const debouncedRevalidate = useCallback((bitIds) => {
    for (const id of bitIds) revalidatePendingBitsRef.current.add(id);
    if (revalidateTimerRef.current) clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = setTimeout(() => {
      const pending = [...revalidatePendingBitsRef.current];
      revalidatePendingBitsRef.current.clear();
      revalidateTimerRef.current = null;
      if (pending.length === 0) return;
      const s = stateRef.current;
      if (s.processing) {
        console.log("[Revalidate] Skipping — processing is active, will retry in 30s");
        debouncedRevalidate(pending);
        return;
      }
      revalidateMatchesRef.current?.(pending, s.topics, s.matches);
    }, 30000);
  }, []);

  // Handle split bit operation
  const handleSplitBit = useCallback(async (bitId, newBits) => {
    const s = stateRef.current;
    const { updatedTopics, updatedMatches, updatedTouchstones, bitsWithIds } = prepareSplitUpdate(bitId, newBits, s.topics, s.matches, s.touchstones);

    // Invalidate old bit's embedding (new bits will be embedded lazily)
    embeddingStore.invalidate(bitId);

    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones, rootBits: s.rootBits });
      if (updatedMatches.length < s.matches.length) {
        console.log(`[Split] Removed ${s.matches.length - updatedMatches.length} stale matches for split bit`);
      }
    } catch (err) {
      console.error("Error saving split bits:", err);
    }

    // Auto-baptize each split segment via LLM (title, summary, tags, keywords)
    const model = stateRef.current.selectedModel;
    for (const bit of bitsWithIds) {
      if (!bit.fullText?.trim()) continue;
      callOllama(
        SYSTEM_PARSE_V2,
        `Parse this comedy transcript excerpt:\n\n${bit.fullText}`,
        () => {},
        model,
        stateRef.current.debugMode ? addDebugEntry : null,
      ).then((result) => {
        const parsed = Array.isArray(result) ? result[0] : result;
        if (!parsed) return;
        const updated = {
          ...bit,
          title: parsed.title || bit.title,
          summary: parsed.summary || bit.summary,
          tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : bit.tags,
          keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : bit.keywords,
          editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "split_baptize", details: { from: bit.title, to: parsed.title } }],
        };
        update('topics', (prev) => prev.map((t) => t.id === bit.id ? updated : t));
        const s2 = stateRef.current;
        saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }).catch(console.error);
      }).catch((err) => console.warn("[Split baptize] Failed:", err.message));
    }

    // Re-run matches for each new split bit against cross-transcript bits
    for (const bit of bitsWithIds) {
      if (!bit.fullText?.trim()) continue;
      const crossTranscript = updatedTopics.filter((b) => b.sourceFile !== bit.sourceFile && b.id !== bit.id);
      if (crossTranscript.length === 0) continue;
      matchBitLiveRef.current?.(bit, crossTranscript).catch((err) => { if (err.name !== "AbortError") console.error("[Split rematch] Error:", err); });
    }
  }, []);

  // Handle join bits operation
  const handleJoinBits = useCallback(async (bitsToJoin, joinedBit) => {
    const s = stateRef.current;
    const { updatedTopics, updatedMatches, updatedTouchstones, completeBit } = prepareJoinUpdate(bitsToJoin, joinedBit, s.topics, s.matches, s.touchstones, s.selectedModel);

    // Invalidate joined bits' embeddings (the new combined bit will be embedded lazily)
    for (const b of bitsToJoin) embeddingStore.invalidate(b.id);

    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones, rootBits: s.rootBits });
      console.log(`[Join] Joined ${bitsToJoin.length} bits into "${completeBit.title}", removed ${s.matches.length - updatedMatches.length} stale matches`);
    } catch (err) {
      console.error("Error saving joined bits:", err);
    }

    // Re-run matches for the new joined bit against cross-transcript bits
    if (completeBit.fullText?.trim()) {
      const crossTranscript = updatedTopics.filter((b) => b.sourceFile !== completeBit.sourceFile && b.id !== completeBit.id);
      if (crossTranscript.length > 0) {
        matchBitLiveRef.current?.(completeBit, crossTranscript).catch((err) => { if (err.name !== "AbortError") console.error("[Join rematch] Error:", err); });
      }
    }
  }, []);

  // Handle boundary adjustment
  const handleBoundaryChange = useCallback(async (bitId, newPosition) => {
    const s = stateRef.current;
    const { updatedTopics } = applyBoundaryChange(bitId, newPosition, s.topics, s.transcripts);

    // Invalidate embedding (fullText changed)
    embeddingStore.invalidate(bitId);

    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, adjustingBit: null } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
    } catch (err) {
      console.error("Error saving boundary change:", err);
    }

    // Re-validate all matches involving this bit (debounced)
    debouncedRevalidate([bitId]);
  }, [debouncedRevalidate]);

  // Handle "take" overlap — one bit claims the overlapping text, shrinking conflicting bits
  const handleTakeOverlap = useCallback(async (takerId, conflictingUpdates) => {
    const s = stateRef.current;
    const { updatedTopics, shrunkIds } = applyTakeOverlap(takerId, conflictingUpdates, s.topics, s.transcripts);

    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
    } catch (err) {
      console.error("Error saving take overlap:", err);
    }

    debouncedRevalidate(shrunkIds);
  }, [debouncedRevalidate]);

  const handleScrollBoundary = useCallback(async (bitId, nextBitId, direction) => {
    const s = stateRef.current;
    const result = applyScrollBoundary(bitId, nextBitId, direction, s.topics, s.transcripts);
    if (!result) return;

    const { updatedTopics, changedBitIds } = result;

    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
    } catch (err) {
      console.error("Error saving boundary scroll:", err);
    }

    debouncedRevalidate(changedBitIds);
  }, [debouncedRevalidate]);

  const handleGenerateTitle = useCallback(async (fullText) => {
    const model = stateRef.current.selectedModel;
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a comedy writing assistant for a comedian named Kai (she/her). Given a comedy bit transcript (which may include multiple versions of the same joke from different performances), generate a short, punchy title (3-6 words max). Focus on the TOPIC or PUNCHLINE rather than the setup — what is the joke fundamentally about? What makes it land? Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping." },
          { role: "user", content: fullText },
        ],
        stream: false,
        think: false,
        options: { num_predict: 64, num_ctx: 4096 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();
    let title = (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
    return title;
  }, []);

  const handleConfirmRename = useCallback(async (bitId, newTitle) => {
    const s = stateRef.current;
    const updatedTopics = s.topics.map((t) =>
      t.id === bitId
        ? { ...t, title: newTitle, editHistory: [...(t.editHistory || []), { timestamp: Date.now(), action: "autorename", details: { from: t.title, to: newTitle } }] }
        : t
    );
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
    await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
  }, []);

  // "Baptize" a bit — run full LLM analysis (title, summary, tags, keywords) + cross-transcript matching
  const handleBaptizeBit = useCallback(async (bitId) => {
    const s = stateRef.current;
    const bit = s.topics.find((t) => t.id === bitId);
    if (!bit || !bit.fullText?.trim()) return;

    set('status', `Baptizing "${bit.title}"...`);
    try {
      const result = await callOllama(
        SYSTEM_PARSE_V2,
        `Parse this comedy transcript excerpt:\n\n${bit.fullText}`,
        () => {},
        s.selectedModel,
        s.debugMode ? addDebugEntry : null,
      );
      const parsed = Array.isArray(result) ? result[0] : result;
      if (parsed) {
        const updatedBit = {
          ...bit,
          title: parsed.title || bit.title,
          summary: parsed.summary || bit.summary,
          tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : bit.tags,
          keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : bit.keywords,
          editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "baptize", details: { from: bit.title, to: parsed.title } }],
        };
        update('topics', (prev) => prev.map((t) => t.id === bitId ? updatedBit : t));
        set('selectedTopic', updatedBit);

        // Cross-transcript matching will be done via matchBitLiveRef
        matchBitLiveRef.current?.(updatedBit, stateRef.current.topics.map((t) => t.id === bitId ? updatedBit : t));

        const s2 = stateRef.current;
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits });
        set('status', `Baptized "${updatedBit.title}"`);
      }
    } catch (err) {
      console.error("[Baptize] Error:", err);
      set('status', `Baptize failed: ${err.message}`);
    }
  }, []);

  // Commune: re-verify all matches for a bit by sending full texts to the LLM
  // Removes false positives that were matched via tags/keywords but aren't the same joke
  const handleCommuneBit = useCallback(async (bitId) => {
    const s = stateRef.current;
    const bit = s.topics.find((t) => t.id === bitId);
    if (!bit) return;

    const affectedMatches = s.matches.filter(
      (m) => m.sourceId === bitId || m.targetId === bitId
    );
    if (affectedMatches.length === 0) {
      set('status', `No connections to verify for "${bit.title}".`);
      return;
    }

    const bitsById = new Map(s.topics.map((t) => [t.id, t]));
    const model = stateRef.current.selectedModel;

    console.log(`[Commune] Verifying ${affectedMatches.length} match(es) for "${bit.title}"`);
    set('status', `Communing "${bit.title}": verifying ${affectedMatches.length} connection(s)...`);

    const toRemove = new Set();
    const toUpdate = [];

    for (let i = 0; i < affectedMatches.length; i++) {
      const match = affectedMatches[i];
      const otherId = match.sourceId === bitId ? match.targetId : match.sourceId;
      const other = bitsById.get(otherId);
      if (!other) {
        toRemove.add(match.id);
        continue;
      }

      set('status', `Communing "${bit.title}": ${i + 1}/${affectedMatches.length} — vs "${other.title}"...`);

      try {
        const userMsg = `BIT A:\nTitle: ${bit.title}\nFull text: ${bit.fullText}\n\nBIT B:\nTitle: ${other.title}\nFull text: ${other.fullText}`;
        const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const matchData = Array.isArray(result) ? result[0] : result;

        if (!matchData || typeof matchData.match_percentage !== "number") {
          toRemove.add(match.id);
          continue;
        }

        const mp = Math.round(matchData.match_percentage);
        const rel = matchData.relationship || "none";

        if (mp < 70 || (rel !== "same_bit" && rel !== "evolved")) {
          console.log(`[Commune] Removing "${bit.title}" ↔ "${other.title}": ${mp}% ${rel} (was ${match.matchPercentage}% ${match.relationship})`);
          toRemove.add(match.id);
        } else if (mp !== match.matchPercentage || rel !== match.relationship) {
          console.log(`[Commune] Updated "${bit.title}" ↔ "${other.title}": ${match.matchPercentage}%→${mp}% ${match.relationship}→${rel}`);
          toUpdate.push({ matchId: match.id, newPercentage: mp, newRelationship: rel, newReason: matchData.reason || match.reason });
        }
      } catch (err) {
        console.warn(`[Commune] LLM error for "${other.title}":`, err.message);
      }
    }

    if (toRemove.size === 0 && toUpdate.length === 0) {
      console.log("[Commune] All connections verified");
      set('status', `✅ All ${affectedMatches.length} connection(s) for "${bit.title}" verified — all legit.`);
      return;
    }

    update('matches', (prev) => {
      let updated = prev.filter((m) => !toRemove.has(m.id));
      for (const u of toUpdate) {
        updated = updated.map((m) =>
          m.id === u.matchId
            ? { ...m, matchPercentage: u.newPercentage, confidence: u.newPercentage / 100, relationship: u.newRelationship, reason: u.newReason }
            : m
        );
      }
      return updated;
    });

    const s2 = stateRef.current;
    await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }).catch(console.error);

    const msg = [];
    if (toRemove.size > 0) msg.push(`removed ${toRemove.size} false`);
    if (toUpdate.length > 0) msg.push(`updated ${toUpdate.length}`);
    console.log(`[Commune] Done: ${msg.join(", ")}`);
    set('status', `✅ Communed "${bit.title}": ${msg.join(", ")} match(es).`);
    return { removed: toRemove.size, updated: toUpdate.length };
  }, []);

  // Mass communion: commune every bit that has connections
  const handleMassCommunion = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    // Find all unique bit IDs that appear in any match
    const bitIdsWithMatches = new Set();
    for (const m of s.matches) {
      bitIdsWithMatches.add(m.sourceId);
      bitIdsWithMatches.add(m.targetId);
    }
    // Only include bits that still exist
    const bitsToCommune = s.topics.filter((t) => bitIdsWithMatches.has(t.id) && t.fullText?.trim());
    if (bitsToCommune.length === 0) {
      set('status', 'No bits with connections to commune.');
      return;
    }

    set('processing', true);
    setShouldStop(false);
    console.log(`[MassCommunion] Starting: ${bitsToCommune.length} bits with connections, ${s.matches.length} total matches`);
    set('status', `Mass communion: ${bitsToCommune.length} bits to verify...`);

    // Track which match IDs we've already verified so we don't re-verify
    // the same pair from both sides
    const verifiedMatchIds = new Set();
    let totalRemoved = 0;
    let totalUpdated = 0;
    let totalVerified = 0;

    for (let bi = 0; bi < bitsToCommune.length; bi++) {
      if (stateRef.current.shouldStop) {
        set('status', `Mass communion stopped. Verified ${bi}/${bitsToCommune.length} bits. Removed ${totalRemoved}, updated ${totalUpdated}.`);
        break;
      }

      const bit = bitsToCommune[bi];
      // Get current matches (state may have changed from previous communions)
      const currentMatches = stateRef.current.matches;
      const bitMatches = currentMatches.filter(
        (m) => (m.sourceId === bit.id || m.targetId === bit.id) && !verifiedMatchIds.has(m.id)
      );

      if (bitMatches.length === 0) continue;

      // Mark these as verified so the other side doesn't re-check
      for (const m of bitMatches) verifiedMatchIds.add(m.id);

      set('status', `Mass communion: ${bi + 1}/${bitsToCommune.length} — "${bit.title}" (${bitMatches.length} connections)...`);

      const bitsById = new Map(stateRef.current.topics.map((t) => [t.id, t]));
      const model = stateRef.current.selectedModel;

      const toRemove = new Set();
      const toUpdate = [];

      for (let i = 0; i < bitMatches.length; i++) {
        if (stateRef.current.shouldStop) break;

        const match = bitMatches[i];
        const otherId = match.sourceId === bit.id ? match.targetId : match.sourceId;
        const other = bitsById.get(otherId);
        if (!other) {
          toRemove.add(match.id);
          continue;
        }

        try {
          const userMsg = `BIT A:\nTitle: ${bit.title}\nFull text: ${bit.fullText}\n\nBIT B:\nTitle: ${other.title}\nFull text: ${other.fullText}`;
          const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
          const matchData = Array.isArray(result) ? result[0] : result;

          if (!matchData || typeof matchData.match_percentage !== "number") {
            toRemove.add(match.id);
            continue;
          }

          const mp = Math.round(matchData.match_percentage);
          const rel = matchData.relationship || "none";

          if (mp < 70 || (rel !== "same_bit" && rel !== "evolved")) {
            console.log(`[MassCommunion] Removing "${bit.title}" ↔ "${other.title}": ${mp}% ${rel} (was ${match.matchPercentage}% ${match.relationship})`);
            toRemove.add(match.id);
          } else if (mp !== match.matchPercentage || rel !== match.relationship) {
            console.log(`[MassCommunion] Updated "${bit.title}" ↔ "${other.title}": ${match.matchPercentage}%→${mp}% ${match.relationship}→${rel}`);
            toUpdate.push({ matchId: match.id, newPercentage: mp, newRelationship: rel, newReason: matchData.reason || match.reason });
          }
        } catch (err) {
          if (err.name === "AbortError") break;
          console.warn(`[MassCommunion] LLM error for "${other.title}":`, err.message);
        }
      }

      totalVerified += bitMatches.length;

      if (toRemove.size > 0 || toUpdate.length > 0) {
        totalRemoved += toRemove.size;
        totalUpdated += toUpdate.length;

        update('matches', (prev) => {
          let updated = prev.filter((m) => !toRemove.has(m.id));
          for (const u of toUpdate) {
            updated = updated.map((m) =>
              m.id === u.matchId
                ? { ...m, matchPercentage: u.newPercentage, confidence: u.newPercentage / 100, relationship: u.newRelationship, reason: u.newReason }
                : m
            );
          }
          return updated;
        });

        // Persist after each bit
        const s2 = stateRef.current;
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }).catch(console.error);
      }
    }

    set('processing', false);
    setShouldStop(false);
    console.log(`[MassCommunion] Done: verified ${totalVerified} matches, removed ${totalRemoved}, updated ${totalUpdated}`);
    set('status', `✅ Mass communion complete: ${totalVerified} matches verified, ${totalRemoved} removed, ${totalUpdated} updated.`);
  }, []);

  // Touchstone Communion: evaluate each bit against the touchstone's criteria
  const handleCommuneTouchstone = useCallback(async (touchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const ts = allTs.find((t) => t.id === touchstoneId);
    if (!ts) return;

    const userCriteria = ts.userReasons || [];
    const generatedCriteria = ts.matchInfo?.reasons || [];
    if (userCriteria.length === 0 && generatedCriteria.length === 0) {
      set('status', `No criteria to commune against for "${ts.name}". Add reasons first.`);
      return;
    }

    const model = stateRef.current.selectedModel;
    const instances = ts.instances || [];
    if (instances.length === 0) return;

    console.log(`[CommuneTouchstone] Evaluating ${instances.length} instance(s) for "${ts.name}"`);
    set('status', `Communing "${ts.name}": evaluating ${instances.length} instance(s)...`);

    let totalBlessed = 0, totalDamned = 0, totalRemoved = 0, totalSainted = 0;

    for (let i = 0; i < instances.length; i++) {
      if (stateRef.current.shouldStop) break;

      const instance = instances[i];
      // Skip sainted instances — user explicitly confirmed, immune from communion
      if (instance.communionStatus === 'sainted') {
        totalSainted++;
        continue;
      }
      const bit = s.topics.find((b) => b.id === instance.bitId);
      if (!bit) continue;

      set('status', `Communing "${ts.name}": ${i + 1}/${instances.length} — "${bit.title}"...`);

      let res;
      try {
        const hasUserCriteria = userCriteria.length > 0;
        const criteriaBlock = hasUserCriteria
          ? `USER CRITERIA (high-confidence signals from the comedian):\n${userCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}\n\nGENERATED CRITERIA (auto-generated):\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`
          : `GENERATED CRITERIA:\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`;

        const userMsg = `TOUCHSTONE: "${ts.name}"\n\n${criteriaBlock}\n\nBIT TO EVALUATE:\nTitle: ${bit.title}\nSource: ${bit.sourceFile}\nFull text: ${bit.fullText || bit.summary}`;

        const raw = await callOllama(
          SYSTEM_TOUCHSTONE_COMMUNE,
          userMsg,
          () => {},
          model,
          stateRef.current.debugMode ? addDebugEntry : null,
        );
        // callOllama may return array-wrapped result from extractRawJsonObjects
        const result = Array.isArray(raw) ? raw[0] : raw;
        if (!result || typeof result !== 'object') {
          console.warn(`[CommuneTouchstone] Invalid LLM response for "${bit.title}", skipping`);
          continue;
        }

        const userScore = typeof result.user_criteria_score === 'number' ? result.user_criteria_score : null;
        const genScore = typeof result.generated_criteria_score === 'number' ? result.generated_criteria_score : 50;
        const reasoning = result.reasoning || '';

        let finalScore;
        if (hasUserCriteria && userScore !== null) {
          finalScore = Math.round(userScore * 0.51 + genScore * 0.49);
        } else {
          finalScore = genScore;
        }

        const status = finalScore >= 70 ? 'blessed' : finalScore >= 40 ? 'damned' : 'removed';
        res = { bitId: instance.bitId, score: finalScore, reasoning, userScore, generatedScore: genScore, status };
        console.log(`[CommuneTouchstone] "${bit.title}": ${finalScore}% → ${status} (user=${userScore}, gen=${genScore})`);
      } catch (err) {
        const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
        console.warn(`[CommuneTouchstone] ${isTimeout ? 'Timeout' : 'LLM error'} for "${bit.title}":`, err.message);
        set('status', `Communing "${ts.name}": ${isTimeout ? 'timeout' : 'error'} on "${bit.title}", skipping...`);
        continue;
      }

      // Increment totals
      if (res.status === 'blessed') totalBlessed++;
      else if (res.status === 'damned') totalDamned++;
      else if (res.status === 'removed') totalRemoved++;

      // Apply this single result to state immediately
      const curTouchstones = stateRef.current.touchstones;
      const applySingle = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        let newInstances, newBitIds, newCoreBitIds, newRemovedBitIds;
        if (res.status === 'removed') {
          newInstances = t.instances.filter((inst) => inst.bitId !== res.bitId);
          newBitIds = t.bitIds.filter((id) => id !== res.bitId);
          newCoreBitIds = (t.coreBitIds || []).filter((id) => id !== res.bitId);
          newRemovedBitIds = [...new Set([...(t.removedBitIds || []), res.bitId])];
        } else {
          newInstances = t.instances.map((inst) =>
            inst.bitId === res.bitId
              ? { ...inst, communionScore: res.score, communionReasoning: res.reasoning, communionStatus: res.status }
              : inst
          );
          newBitIds = t.bitIds;
          newCoreBitIds = t.coreBitIds;
          newRemovedBitIds = t.removedBitIds;
        }
        if (newInstances.length === 0) return null; // dissolve if empty
        return {
          ...t,
          instances: newInstances,
          bitIds: newBitIds,
          coreBitIds: newCoreBitIds,
          frequency: newInstances.length,
          sourceCount: new Set(newInstances.map((inst) => inst.sourceFile)).size,
          removedBitIds: newRemovedBitIds,
        };
      }).filter(Boolean);
      const updatedTouchstones = {
        confirmed: applySingle(curTouchstones.confirmed || []),
        possible: applySingle(curTouchstones.possible || []),
        rejected: applySingle(curTouchstones.rejected || []),
      };

      set('touchstones', updatedTouchstones);
      const s2 = stateRef.current;
      await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: updatedTouchstones, rootBits: s2.rootBits }).catch(
        (err) => console.error("Error saving after communion iteration:", err)
      );
    }

    const msg = `Communed "${ts.name}": ${totalBlessed} blessed, ${totalDamned} damned, ${totalRemoved} removed, ${totalSainted} sainted (skipped)`;
    console.log(`[CommuneTouchstone] ${msg}`);
    set('status', `✅ ${msg}`);
    return { blessed: totalBlessed, damned: totalDamned, removed: totalRemoved, sainted: totalSainted };
  }, []);

  // Synthesize ideal text for a touchstone from all its instances
  const handleSynthesizeTouchstone = useCallback(async (touchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const ts = allTs.find((t) => t.id === touchstoneId);
    if (!ts || (ts.instances || []).length === 0) return;

    const model = stateRef.current.selectedModel;

    // Prefer sainted/blessed instances; fall back to all
    const trustedInstances = (ts.instances || []).filter((i) => i.communionStatus === 'sainted' || i.communionStatus === 'blessed');
    const instancesToUse = trustedInstances.length >= 1 ? trustedInstances : ts.instances;

    const instanceBits = instancesToUse.map((i) => s.topics.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return;

    // Apply word corrections
    const corrections = ts.corrections || [];
    const applyCorrections = (text) => {
      if (!text || corrections.length === 0) return text;
      let result = text;
      for (const c of corrections) {
        result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to);
      }
      return result;
    };

    const instanceTexts = instanceBits.map((b, idx) =>
      `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${applyCorrections(b.fullText || b.summary)}`
    ).join('\n\n---\n\n');

    const userMsg = `TOUCHSTONE: "${ts.name}"\n\n${instanceBits.length} performance${instanceBits.length > 1 ? 's' : ''} of the same bit:\n\n${instanceTexts}`;

    try {
      set('processing', true);
      set('status', `Synthesizing ideal text for "${ts.name}"...`);

      const raw = await callOllama(
        SYSTEM_SYNTHESIZE_TOUCHSTONE,
        userMsg,
        () => {},
        model,
        stateRef.current.debugMode ? addDebugEntry : null,
      );
      const result = Array.isArray(raw) ? raw[0] : raw;
      if (!result || typeof result !== 'object' || !result.idealText) {
        set('status', `Failed to synthesize ideal text for "${ts.name}" — invalid response.`);
        set('processing', false);
        return;
      }

      update('touchstones', (prev) => {
        const updateIn = (list) => list.map((t) => {
          if (t.id !== touchstoneId) return t;
          if (t.manualIdealText) return t; // Don't overwrite manually edited ideal text
          return { ...t, idealText: result.idealText, idealTextNotes: result.notes || '' };
        });
        return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
      });

      // Save immediately
      const s2 = stateRef.current;
      await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }).catch(
        (err) => console.error("Error saving after synthesis:", err)
      );

      set('status', `✅ Synthesized ideal text for "${ts.name}".`);
      set('processing', false);
    } catch (err) {
      console.error('[Synthesize] Error:', err);
      set('status', `Synthesis failed: ${err.message}`);
      set('processing', false);
    }
  }, []);

  // Mass Touchstone Communion: commune all touchstones across all categories
  const handleMassTouchstoneCommunion = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const eligible = allTs.filter((t) =>
      (t.instances || []).length > 0 &&
      ((t.userReasons || []).length > 0 || (t.matchInfo?.reasons || []).length > 0)
    );

    if (eligible.length === 0) {
      set('status', 'No touchstones with criteria to commune.');
      return;
    }

    set('processing', true);
    setShouldStop(false);
    console.log(`[MassTouchstoneCommunion] Starting: ${eligible.length} touchstones`);
    set('status', `Mass touchstone communion: ${eligible.length} touchstones to evaluate...`);

    let totalBlessed = 0, totalDamned = 0, totalRemoved = 0;

    for (let i = 0; i < eligible.length; i++) {
      if (stateRef.current.shouldStop) {
        set('status', `Mass touchstone communion stopped at ${i}/${eligible.length}. ${totalBlessed} blessed, ${totalDamned} damned, ${totalRemoved} removed.`);
        break;
      }

      set('status', `Mass touchstone communion: ${i + 1}/${eligible.length} — "${eligible[i].name}"...`);

      try {
        const result = await handleCommuneTouchstone(eligible[i].id);
        if (result) {
          totalBlessed += result.blessed;
          totalDamned += result.damned;
          totalRemoved += result.removed;
        }
      } catch (err) {
        console.warn(`[MassTouchstoneCommunion] Error on "${eligible[i].name}":`, err.message);
      }
    }

    set('processing', false);
    setShouldStop(false);
    const msg = `Mass touchstone communion complete: ${eligible.length} touchstones, ${totalBlessed} blessed, ${totalDamned} damned, ${totalRemoved} removed.`;
    console.log(`[MassTouchstoneCommunion] ${msg}`);
    set('status', `✅ ${msg}`);
  }, [handleCommuneTouchstone]);

  const handleDeleteBit = useCallback(async (bitId) => {
    const s = stateRef.current;
    const updatedTopics = s.topics.filter((t) => t.id !== bitId);
    const updatedMatches = s.matches.filter((m) => m.sourceId !== bitId && m.targetId !== bitId);
    console.log(`[Mix] Deleted empty bit ${bitId}`);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
    } catch (err) {
      console.error("Error saving after delete:", err);
    }
  }, []);

  const handleAddPhantomBit = useCallback(async (fullText, startChar, endChar, sourceFile, transcriptId) => {
    const s = stateRef.current;
    const newBit = {
      id: uid(),
      title: "Untitled bit",
      summary: "",
      fullText,
      tags: [],
      keywords: [],
      textPosition: { startChar, endChar },
      sourceFile,
      transcriptId,
      editHistory: [{ timestamp: Date.now(), action: "phantom_add", details: { startChar, endChar } }],
    };
    const updatedTopics = [...s.topics, newBit];
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });

    // Auto-generate metadata via LLM in background
    try {
      const result = await callOllama(
        SYSTEM_PARSE_V2,
        `Parse this comedy transcript excerpt:\n\n${fullText}`,
        () => {},
        s.selectedModel,
        s.debugMode ? addDebugEntry : null,
      );
      const parsed = Array.isArray(result) ? result[0] : result;
      if (parsed) {
        const final = {
          ...newBit,
          title: parsed.title || newBit.title,
          summary: parsed.summary || "",
          tags: parsed.tags || [],
          keywords: parsed.keywords || [],
        };
        const latest = stateRef.current;
        const updated = latest.topics.map((t) => t.id === newBit.id ? final : t);
        dispatch({ type: 'MERGE', payload: { topics: updated } });
        await saveVaultState({ topics: updated, matches: latest.matches, transcripts: latest.transcripts, touchstones: latest.touchstones, rootBits: latest.rootBits });
      }
    } catch (err) {
      console.error("[PhantomBit] LLM metadata failed:", err);
      // Bit is still saved with placeholder title — user can rename manually
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
    }
  }, []);

  // Re-parse a gap: stream gap text to LLM, get multiple bits back incrementally
  const handleReParseGap = useCallback(async (fullText, startChar, endChar, sourceFile, transcriptId) => {
    const s = stateRef.current;
    const gapSize = endChar - startChar;
    set('status', `Re-parsing gap (${gapSize} chars)...`);
    set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "" });
    update('foundBits', () => []);

    const foundBits = [];
    let error = null;

    await new Promise((resolve) => {
      callOllamaStream(
        SYSTEM_PARSE_V2,
        `Parse this comedy transcript excerpt:\n\n${fullText}`,
        {
          onChunk: (fullAccumulatedText) => {
            update('streamingProgress', (prev) => ({
              ...prev,
              streamedText: fullAccumulatedText.slice(-1600),
            }));
          },
          onBitFound: (bit, count) => {
            update('streamingProgress', (prev) => ({ ...prev, currentBit: count }));
            // Offset textPosition relative to gap start
            const bitStart = startChar + (bit.textPosition?.startChar || 0);
            const bitEnd = startChar + (bit.textPosition?.endChar || (bit.fullText?.length || 0));
            const newBit = {
              id: uid(),
              title: bit.title || `Untitled bit ${count}`,
              summary: bit.summary || "",
              fullText: bit.fullText,
              tags: bit.tags || [],
              keywords: bit.keywords || [],
              textPosition: { startChar: bitStart, endChar: bitEnd },
              sourceFile,
              transcriptId,
              editHistory: [{ timestamp: Date.now(), action: "reparse_gap", details: { startChar: bitStart, endChar: bitEnd } }],
            };
            foundBits.push(newBit);
            update('foundBits', (prev) => [...prev, newBit]);
            console.log(`[ReParseGap] Found bit #${count}: "${newBit.title}"`);

            // Add to state immediately
            const latest = stateRef.current;
            const updatedTopics = [...latest.topics, newBit];
            dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
            saveVaultState({ topics: updatedTopics, matches: latest.matches, transcripts: latest.transcripts, touchstones: latest.touchstones, rootBits: latest.rootBits }).catch(console.error);
          },
          onFrozen: () => {
            console.log("[ReParseGap] Streaming froze");
            resolve();
          },
          onError: (err) => {
            error = err;
            console.error("[ReParseGap] Streaming error:", err.message);
            resolve();
          },
          onDebug: s.debugMode ? addDebugEntry : null,
        },
        s.selectedModel,
        null, // no abort controller
        30000,
      ).then(() => resolve()).catch((err) => { error = err; resolve(); });
    });

    set('streamingProgress', null);

    if (error) {
      set('status', `Re-parse failed: ${error.message}`);
    } else if (foundBits.length === 0) {
      set('status', 'Re-parse returned no bits.');
    } else {
      set('status', `Re-parsed gap into ${foundBits.length} bit${foundBits.length !== 1 ? 's' : ''}.`);
    }
  }, []);

  // Rectify overlapping possible touchstones: merge into existing confirmed/possible
  const rectifyOverlaps = useCallback(async () => {
    const s = stateRef.current;
    const ts = s.touchstones || {};
    const possibles = ts.possible || [];
    const confirmed = ts.confirmed || [];
    if (possibles.length === 0) return;

    let mergedCount = 0;
    let removedIds = new Set();

    // Helper: find best overlapping touchstone from a list
    const findOverlap = (source, targets) => {
      const srcSet = new Set(source.bitIds);
      let best = null, bestOverlap = 0;
      for (const target of targets) {
        if (target.id === source.id) continue;
        if (removedIds.has(target.id)) continue;
        const overlap = target.bitIds.filter(id => srcSet.has(id)).length;
        const ratio = overlap / Math.max(1, Math.min(srcSet.size, target.bitIds.length));
        if (ratio >= 0.4 && overlap > bestOverlap) {
          bestOverlap = overlap;
          best = target;
        }
      }
      return best;
    };

    // Process each possible — check against confirmed first, then other possibles
    const absorbedPossibles = new Set();
    const updatedConfirmed = [...confirmed];
    const updatedPossibles = [...possibles];

    for (const possible of possibles) {
      if (absorbedPossibles.has(possible.id)) continue;

      // Check against confirmed
      let target = findOverlap(possible, updatedConfirmed);
      let targetList = "confirmed";
      if (!target) {
        // Check against other possibles (prefer older/larger ones)
        const otherPossibles = updatedPossibles.filter(p =>
          p.id !== possible.id && !absorbedPossibles.has(p.id) &&
          (p.instances.length > possible.instances.length ||
            (p.instances.length === possible.instances.length && p.id < possible.id))
        );
        target = findOverlap(possible, otherPossibles);
        targetList = "possible";
      }
      if (!target) continue;

      // Absorb: add bits from possible into target that aren't already there
      const targetBitSet = new Set(target.bitIds);
      const newBitIds = possible.bitIds.filter(id => !targetBitSet.has(id));

      if (newBitIds.length > 0) {
        const newInstances = newBitIds.map(id => {
          const bit = s.topics.find(t => t.id === id);
          return bit ? {
            bitId: id, sourceFile: bit.sourceFile, title: bit.title,
            instanceNumber: target.instances.length + 1,
            confidence: 0.8, relationship: "evolved",
          } : null;
        }).filter(Boolean);

        target.bitIds = [...target.bitIds, ...newBitIds];
        target.instances = [...target.instances, ...newInstances];
        target.frequency = target.instances.length;
        if (!target.manualName) target.autoNamed = false; // trigger re-name
      }

      absorbedPossibles.add(possible.id);
      removedIds.add(possible.id);
      mergedCount++;
      console.log(`[Rectify] Merged possible "${possible.name}" into ${targetList} "${target.name}" (+${newBitIds.length} bits)`);
    }

    if (mergedCount === 0) {
      set('status', 'No overlapping touchstones found to rectify.');
      return;
    }

    // Apply changes
    update('touchstones', (prev) => ({
      confirmed: updatedConfirmed,
      possible: updatedPossibles.filter(p => !absorbedPossibles.has(p.id)),
      rejected: prev.rejected || [],
    }));

    set('status', `Rectified ${mergedCount} overlapping touchstone${mergedCount !== 1 ? 's' : ''}.`);

    // Persist
    setTimeout(async () => {
      const s2 = stateRef.current;
      try {
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits });
      } catch (err) { console.error("Error saving after rectify:", err); }
    }, 100);
  }, []);

  // Batch cross-transcript hunt: one LLM call per source bit with all its candidates
  const huntTouchstones = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    const transcriptFiles = new Set(s.topics.map((t) => t.sourceFile));
    if (transcriptFiles.size < 2) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: 'Need bits from at least 2 transcripts.' });
      return;
    }

    // Build batches: for each bit, find cross-transcript candidates via embeddings (or text fallback)
    const existingPairs = new Set(
      s.matches.map((m) => [m.sourceId, m.targetId].sort().join(':'))
    );

    // Try to use embedding-based search
    let useEmbeddings = false;
    const embModel = stateRef.current.embeddingModel;
    try {
      set('status', `Embedding ${s.topics.length} bits...`);
      await embeddingStore.ensureEmbeddings(s.topics, embModel, ({ done, total, status }) => {
        set('status', status);
        set('embeddingStatus', { cached: done, total });
      });
      useEmbeddings = true;
      console.log("[Hunt] Using embedding-based candidate search");
    } catch (err) {
      console.warn("[Hunt] Embedding failed, falling back to text search:", err.message);
      set('status', "Embeddings unavailable, using text-based search...");
    }

    const bitsById = new Map(s.topics.map(b => [b.id, b]));
    const batches = [];
    for (const bit of s.topics) {
      const crossTranscript = s.topics.filter((b) => b.sourceFile !== bit.sourceFile);
      if (crossTranscript.length === 0) continue;

      let candidates;
      if (useEmbeddings) {
        const crossIds = new Set(crossTranscript.map(b => b.id));
        const excludeIds = new Set(s.topics.filter(b => b.sourceFile === bit.sourceFile).map(b => b.id));
        const neighbors = embeddingStore.findNearest(bit.id, 8, excludeIds);
        candidates = neighbors
          .filter(n => n.score >= 0.65)
          .filter(n => crossIds.has(n.bitId))
          .filter(n => !existingPairs.has([bit.id, n.bitId].sort().join(':')))
          .slice(0, 5)
          .map(n => bitsById.get(n.bitId))
          .filter(Boolean);
      } else {
        candidates = findSimilarBits(bit, crossTranscript, 0.05)
          .filter((r) => {
            const key = [bit.id, r.bit.id].sort().join(':');
            return !existingPairs.has(key);
          })
          .slice(0, 5)
          .map(r => r.bit);
      }

      if (candidates.length > 0) {
        batches.push({ source: bit, candidates });
        for (const c of candidates) {
          existingPairs.add([bit.id, c.id].sort().join(':'));
        }
      }
    }

    if (batches.length === 0) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: 'All cross-transcript pairs already compared.' });
      return;
    }

    set('processing', true);
    const huntController = new AbortController();
    huntControllerRef.current = huntController;
    const totalCandidates = batches.reduce((sum, b) => sum + b.candidates.length, 0);
    set('huntProgress', { current: 0, total: batches.length, found: 0, recentMatches: [], lastPrompt: null, lastResponse: null, status: `${batches.length} batches, ${totalCandidates} candidate pairs` });

    const { allMatches } = await runHuntBatches({
      batches,
      callOllama,
      systemPrompt: SYSTEM_HUNT_BATCH,
      getSelectedModel: () => stateRef.current.selectedModel,
      abortSignal: huntController.signal,
      shouldStopFn: () => stateRef.current.shouldStop,
      onProgress: (p) => {
        update('huntProgress', (prev) => ({
          ...prev,
          ...(p.current !== undefined ? { current: p.current } : {}),
          ...(p.total !== undefined ? { total: p.total } : {}),
          ...(p.found !== undefined ? { found: p.found } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...(p.lastPrompt !== undefined ? { lastPrompt: p.lastPrompt } : {}),
          ...(p.lastResponse !== undefined ? { lastResponse: p.lastResponse } : {}),
          ...(p.recentMatches ? { recentMatches: [...(prev.recentMatches || []), p.recentMatches].slice(-20) } : {}),
        }));
      },
      onBatchMatches: (batchMatches) => {
        update('matches', (prev) => [...prev, ...batchMatches]);
        const s2 = stateRef.current;
        saveVaultState({
          topics: s2.topics,
          matches: [...s2.matches, ...batchMatches],
          transcripts: s2.transcripts,
          touchstones: s2.touchstones,
          rootBits: s2.rootBits,
        }).catch((err) => console.error('[Hunt] Error saving matches:', err));
      },
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done. Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, [debugMode]);

  // Hunt touchstones scoped to a single transcript's bits vs all other transcripts
  const huntTranscript = useCallback(async (transcript) => {
    const s = stateRef.current;
    if (s.processing) return;

    const trBits = s.topics.filter((t) => t.sourceFile === transcript.name || t.transcriptId === transcript.id);
    if (trBits.length === 0) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: `No bits found for "${transcript.name}".` });
      return;
    }
    const otherBits = s.topics.filter((t) => t.sourceFile !== transcript.name && t.transcriptId !== transcript.id);
    if (otherBits.length === 0) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: 'Need bits from at least 1 other transcript.' });
      return;
    }

    const existingPairs = new Set(
      s.matches.map((m) => [m.sourceId, m.targetId].sort().join(':'))
    );

    // Try embedding-based search
    let useEmbeddings = false;
    const embModel = stateRef.current.embeddingModel;
    try {
      const allBits = [...trBits, ...otherBits];
      set('status', `Embedding ${allBits.length} bits...`);
      await embeddingStore.ensureEmbeddings(allBits, embModel, ({ done, total, status }) => {
        set('status', status);
        set('embeddingStatus', { cached: done, total });
      });
      useEmbeddings = true;
    } catch (err) {
      console.warn("[HuntTranscript] Embedding failed, falling back to text search:", err.message);
    }

    const bitsById = new Map(s.topics.map(b => [b.id, b]));
    const batches = [];
    for (const bit of trBits) {
      let candidates;
      if (useEmbeddings) {
        const sameFileIds = new Set(trBits.map(b => b.id));
        const neighbors = embeddingStore.findNearest(bit.id, 8, sameFileIds);
        candidates = neighbors
          .filter(n => n.score >= 0.65)
          .filter(n => !existingPairs.has([bit.id, n.bitId].sort().join(':')))
          .slice(0, 5)
          .map(n => bitsById.get(n.bitId))
          .filter(Boolean);
      } else {
        candidates = findSimilarBits(bit, otherBits, 0.05)
          .filter((r) => {
            const key = [bit.id, r.bit.id].sort().join(':');
            return !existingPairs.has(key);
          })
          .slice(0, 5)
          .map(r => r.bit);
      }

      if (candidates.length > 0) {
        batches.push({ source: bit, candidates });
        for (const c of candidates) {
          existingPairs.add([bit.id, c.id].sort().join(':'));
        }
      }
    }

    if (batches.length === 0) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: `All pairs for "${transcript.name}" already compared.` });
      return;
    }

    set('processing', true);
    const huntController = new AbortController();
    huntControllerRef.current = huntController;
    const totalCandidates = batches.reduce((sum, b) => sum + b.candidates.length, 0);
    set('huntProgress', { current: 0, total: batches.length, found: 0, recentMatches: [], lastPrompt: null, lastResponse: null, status: `"${transcript.name}": ${batches.length} batches, ${totalCandidates} candidate pairs` });

    const { allMatches } = await runHuntBatches({
      batches,
      callOllama,
      systemPrompt: SYSTEM_HUNT_BATCH,
      getSelectedModel: () => stateRef.current.selectedModel,
      abortSignal: huntController.signal,
      shouldStopFn: () => stateRef.current.shouldStop,
      onProgress: (p) => {
        update('huntProgress', (prev) => ({
          ...prev,
          ...(p.current !== undefined ? { current: p.current } : {}),
          ...(p.total !== undefined ? { total: p.total } : {}),
          ...(p.found !== undefined ? { found: p.found } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...(p.lastPrompt !== undefined ? { lastPrompt: p.lastPrompt } : {}),
          ...(p.lastResponse !== undefined ? { lastResponse: p.lastResponse } : {}),
          ...(p.recentMatches ? { recentMatches: [...(prev.recentMatches || []), p.recentMatches].slice(-20) } : {}),
        }));
      },
      onBatchMatches: (batchMatches) => {
        update('matches', (prev) => [...prev, ...batchMatches]);
        const s2 = stateRef.current;
        saveVaultState({
          topics: s2.topics,
          matches: [...s2.matches, ...batchMatches],
          transcripts: s2.transcripts,
          touchstones: s2.touchstones,
          rootBits: s2.rootBits,
        }).catch((err) => console.error('[Hunt] Error saving matches:', err));
      },
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done "${transcript.name}". Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, [debugMode]);

  // Handle root bit creation
  const handleCreateRoot = useCallback((bitIds) => {
    const s = stateRef.current;
    const newRoot = createRootBit(bitIds, s.topics, s.matches);
    if (newRoot) {
      dispatch({ type: 'MERGE', payload: { rootBits: [...s.rootBits, newRoot], editingMode: null } });
    }
  }, []);

  const handleFiles = useCallback(async (files) => {
    const s = stateRef.current;
    const existingNames = new Set(s.transcripts.map((tr) => tr.name));
    const newTranscripts = [];
    const skipped = [];
    for (const file of files) {
      if (existingNames.has(file.name)) {
        skipped.push(file.name);
        continue;
      }
      const text = await file.text();
      newTranscripts.push({ name: file.name, text, id: uid() });
      existingNames.add(file.name);
    }
    if (skipped.length > 0) {
      set('status', `Skipped ${skipped.length} duplicate${skipped.length > 1 ? 's' : ''}: ${skipped.join(', ')}`);
    }
    if (newTranscripts.length > 0) {
      update('transcripts', (prev) => [...prev, ...newTranscripts]);
    }
    setActiveTab("upload");
  }, []);

  // Helper function to match a newly found bit against existing topics (pairwise)
  const matchBitLive = useCallback(async (newBit, existingTopics, signal) => {
    try {
      // Bail immediately if already aborted
      if (signal?.aborted) return;

      // Only match cross-transcript — same-transcript is handled by autoDedup
      const crossTranscript = existingTopics.filter(
        (b) => b.sourceFile !== newBit.sourceFile
      );
      if (crossTranscript.length === 0) return;

      // Skip matching for very short bits — they lack enough joke structure to match reliably
      const newBitWords = (newBit.fullText || "").split(/\s+/).length;

      // Pre-filter: try embedding-based search first, fall back to text similarity
      let candidates;
      try {
        const embModel = stateRef.current.embeddingModel;
        const vec = await embedText(
          `Title: ${newBit.title || ""}\nSummary: ${newBit.summary || ""}\nText: ${newBit.fullText || ""}`,
          embModel
        );
        const sameFileIds = new Set(existingTopics.filter(b => b.sourceFile === newBit.sourceFile).map(b => b.id));
        sameFileIds.add(newBit.id);
        const neighbors = embeddingStore.findNearestByVector(vec, 10, sameFileIds);
        candidates = neighbors
          .filter(n => n.score >= 0.65)
          .map(n => existingTopics.find(b => b.id === n.bitId))
          .filter(Boolean);
      } catch {
        // Embedding unavailable — fall back to text similarity
        const preFilterThreshold = newBitWords < 40 ? 0.3 : 0.15;
        candidates = findSimilarBits(newBit, crossTranscript, preFilterThreshold)
          .slice(0, 10)
          .map((r) => r.bit);
      }

      if (candidates.length === 0) return;
      if (newBitWords < 15) {
        console.log(`[MatchPair] Skipping "${newBit.title}" — too short (${newBitWords} words) for reliable matching`);
        return;
      }

      console.log(`[MatchPair] Comparing "${newBit.title}" (${newBitWords}w) against ${candidates.length} candidates`);

      for (const candidate of candidates) {
        // Check abort before each LLM call
        if (signal?.aborted) {
          console.log(`[MatchPair] Aborted — skipping remaining candidates for "${newBit.title}"`);
          return;
        }

        // Skip short candidates too
        const candidateWords = (candidate.fullText || "").split(/\s+/).length;
        if (candidateWords < 15) continue;

        try {
          // Only send title + fullText — tags/keywords/summary bias the LLM toward topic-matching
          const userMsg = `BIT A:\nTitle: ${newBit.title}\nFull text: ${newBit.fullText}\n\nBIT B:\nTitle: ${candidate.title}\nFull text: ${candidate.fullText}`;

          const result = await callOllama(
            SYSTEM_MATCH_PAIR,
            userMsg,
            () => {},
            selectedModel,
            debugMode ? addDebugEntry : null,
            signal
          );

          // Handle both object and array responses
          const matchData = Array.isArray(result) ? result[0] : result;
          if (matchData && typeof matchData.match_percentage === "number") {
            const mp = Math.round(matchData.match_percentage);
            const newMatch = {
              id: uid(),
              sourceId: newBit.id,
              targetId: candidate.id,
              confidence: mp / 100,
              matchPercentage: mp,
              relationship: matchData.relationship || "none",
              reason: matchData.reason || "",
              timestamp: Date.now(),
            };
            update('matches', (prev) => [...prev, newMatch]);
            const s = stateRef.current;
            saveVaultState({
              topics: s.topics,
              matches: [...s.matches, newMatch],
              transcripts: s.transcripts,
              touchstones: s.touchstones,
              rootBits: s.rootBits,
            }).catch((err) => console.error("Error saving match:", err));
            console.log(`[MatchPair] "${newBit.title}" vs "${candidate.title}": ${mp}% (${matchData.relationship})`);
          }
        } catch (pairErr) {
          // Silently stop on abort — not an error
          if (pairErr.name === "AbortError") return;
          console.error(`[MatchPair] Error comparing with "${candidate.title}":`, pairErr.message);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Error matching bit live:", err);
    }
  }, [addDebugEntry]);
  matchBitLiveRef.current = matchBitLive;

  // Process text chunk - identify bits from the LLM
  // Returns identified bits with their positions RELATIVE to the input text
  // The main loop handles mapping back to original positions
  const processRemainingText = useCallback(async (tr, textToProcess, pass = 1, controller = null, segmentMap = null) => {
    console.log(`[Pass ${pass}] Processing ${textToProcess.length} characters from unidentified ranges`);

    if (textToProcess.trim().length === 0) {
      console.log(`[Pass ${pass}] No text to process`);
      return { foundBits: [], mappedPositions: [], froze: false, error: null };
    }

    // Compute originalText for position mapping - bits should have positions relative to the ORIGINAL transcript
    const originalText = tr.text.replace(/\n/g, " ");

    // Helper: translate a position in textToProcess back to original text using segment map
    const mapToOriginal = (posInRemaining) => {
      if (!segmentMap || segmentMap.length === 0) return null;
      for (const seg of segmentMap) {
        if (posInRemaining >= seg.remStart && posInRemaining < seg.remEnd) {
          const offset = posInRemaining - seg.remStart;
          return seg.origStart + offset;
        }
      }
      return null;
    };

    let foundBits = [];
    let mappedPositions = []; // Track positions mapped to original text
    let froze = false;
    let error = null;

    const sessionController = controller || new AbortController();
    const parsePromise = new Promise((resolve, reject) => {
      callOllamaStream(
        SYSTEM_PARSE_V2,
        `Parse this comedy transcript:\n\n${textToProcess}`,
        {
          onChunk: (fullAccumulatedText) => {
            // onChunk receives the full accumulated response text (not incremental)
            update('streamingProgress', (prev) => ({
              ...prev,
              streamedText: fullAccumulatedText.slice(-1600),
            }));
          },
          onBitFound: (bit, count) => {
            update('streamingProgress', (prev) => ({
              ...prev,
              currentBit: count,
            }));
            console.log(`[Pass ${pass}] Found bit #${count}: "${bit.title}"`);
            foundBits.push(bit);
            update('foundBits', (prev) => [...prev, bit]);

            // Find exact position in the remaining text and validate
            let textPosition = bit.textPosition;
            let actualFullText = bit.fullText;

            // Find position in the ORIGINAL transcript text using multi-strategy matcher
            if (actualFullText && actualFullText.trim()) {
              const posResult = findTextPosition(originalText, actualFullText);

              if (posResult) {
                const extractedText = originalText.substring(posResult.startChar, posResult.endChar);
                // Use high-confidence positions for the bit's display position
                if (posResult.confidence >= 0.8) {
                  const normalize = (t) => t.trim().replace(/\s+/g, " ");
                  if (normalize(extractedText) === normalize(actualFullText)) {
                    textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                  } else {
                    textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                    actualFullText = extractedText;
                  }
                } else {
                  // Low confidence — don't update the bit's display position
                  textPosition = null;
                }
                // ALWAYS claim the region for subtraction, even low confidence
                mappedPositions.push({ startChar: posResult.startChar, endChar: posResult.endChar });
                console.log(`[Pass ${pass}] Bit "${bit.title}" position: ${posResult.startChar}-${posResult.endChar} (${posResult.strategy}, conf: ${posResult.confidence})`);
              } else {
                // Fallback: find in textToProcess then map back via segment map
                const posInRemaining = calculateCharPosition(textToProcess, actualFullText);
                if (posInRemaining && segmentMap) {
                  const origStart = mapToOriginal(posInRemaining.startChar);
                  const origEnd = mapToOriginal(posInRemaining.endChar - 1);
                  if (origStart != null && origEnd != null) {
                    textPosition = { startChar: origStart, endChar: origEnd + 1 };
                    actualFullText = originalText.substring(textPosition.startChar, textPosition.endChar);
                    mappedPositions.push({ startChar: textPosition.startChar, endChar: textPosition.endChar });
                    console.log(`[Pass ${pass}] Bit "${bit.title}" mapped via segments: ${textPosition.startChar}-${textPosition.endChar}`);
                  } else {
                    console.warn(`[Pass ${pass}] Bit "${bit.title}" segment map translation failed`);
                    textPosition = null;
                  }
                } else {
                  console.warn(`[Pass ${pass}] Bit "${bit.title}" could not be located — will retry next pass`);
                  textPosition = null;
                }
              }
            }

            const isIncomplete = bit._incomplete === true;
            const enhancedBit = {
              ...bit,
              id: uid(),
              sourceFile: tr.name,
              transcriptId: tr.id,
              fullText: actualFullText,
              textPosition: textPosition || { startChar: 0, endChar: 0 },
              editHistory: [],
              parsedWithModel: selectedModel,
              timestamp: Date.now(),
            };
            delete enhancedBit._incomplete;

            // Persist to DB immediately — dedup may update/remove later
            saveSingleTopic(enhancedBit).catch((err) => console.error("[DB] Immediate save failed:", err));

            // If bit came from repaired/truncated JSON, re-enrich missing fields via LLM
            if (isIncomplete && enhancedBit.fullText) {
              callOllama(
                SYSTEM_PARSE_V2,
                `Parse this comedy transcript excerpt:\n\n${enhancedBit.fullText}`,
                () => {},
                selectedModel,
                debugMode ? addDebugEntry : null,
              ).then((result) => {
                const parsed = Array.isArray(result) ? result[0] : result;
                if (parsed) {
                  update('topics', (prev) => prev.map((t) =>
                    t.id === enhancedBit.id ? {
                      ...t,
                      title: parsed.title || t.title,
                      summary: parsed.summary || t.summary,
                      tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : t.tags,
                      keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : t.keywords,
                    } : t
                  ));
                  console.log(`[Pass ${pass}] Re-enriched incomplete bit "${enhancedBit.title}" → "${parsed.title}"`);
                }
              }).catch((err) => console.warn("[Re-enrich] Failed:", err.message));
            }

            // Auto-dedup: check for same-transcript overlaps before adding
            // Enqueue through OpQueue to prevent race conditions between concurrent bits
            opQueue.enqueue(async () => {
              const s = stateRef.current;
              try {
                const dedupResult = await absorbOrMerge(enhancedBit, s.topics, callOllama, selectedModel);
                if (dedupResult.action === "absorbed") {
                  console.log(`[Pass ${pass}] [AutoDedup] Skipped "${enhancedBit.title}" (absorbed into "${dedupResult.keptBit.title}")`);
                  return;
                }
                if (dedupResult.action === "absorbed_existing") {
                  console.log(`[Pass ${pass}] [AutoDedup] Replacing "${dedupResult.removedId}" with "${enhancedBit.title}"`);
                  update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), enhancedBit]);
                } else if (dedupResult.action === "merged") {
                  console.log(`[Pass ${pass}] [AutoDedup] Merged into "${dedupResult.keptBit.title}", removing ${dedupResult.removedId}`);
                  update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), dedupResult.keptBit]);
                } else {
                  // action === "none" — add normally
                  console.log(`[Pass ${pass}] + New bit "${enhancedBit.title}"`);
                  update('topics', (prev) => [...prev, enhancedBit]);
                }
                // Cross-transcript matching (after state has settled from the update above)
                if (dedupResult.action === "none" && stateRef.current.topics.length > 0) {
                  matchBitLive(enhancedBit, stateRef.current.topics, sessionController.signal).catch((err) => { if (err.name !== "AbortError") console.error("Live match error:", err); });
                }
              } catch (err) {
                // Dedup failed — add bit normally and continue
                console.error("[AutoDedup] Error, adding bit normally:", err.message);
                update('topics', (prev) => [...prev, enhancedBit]);
                matchBitLive(enhancedBit, stateRef.current.topics, sessionController.signal).catch((e) => { if (e.name !== "AbortError") console.error("Live match error:", e); });
              }
            }).catch((err) => console.error("[OpQueue] Bit processing error:", err));
          },
          onComplete: (bits) => {
            // Add any bits not already captured by onBitFound
            if (bits && Array.isArray(bits)) {
              console.log(`[Pass ${pass}] onComplete received ${bits.length} bits from final parse`);
              for (const bit of bits) {
                const norm = t => t.replace(/\s+/g, ' ').trim().toLowerCase();
                const isDuplicate = foundBits.some(fb => {
                  if (fb.fullText === bit.fullText) return true;
                  if (norm(fb.fullText) === norm(bit.fullText)) return true;
                  // Word overlap — catches LLM paraphrasing the same bit
                  const words1 = new Set(norm(fb.fullText).split(' '));
                  const words2 = new Set(norm(bit.fullText).split(' '));
                  const intersection = [...words1].filter(w => words2.has(w)).length;
                  const union = new Set([...words1, ...words2]).size;
                  return union > 0 && intersection / union > 0.85;
                });
                if (!isDuplicate) {
                  console.log(`[Pass ${pass}] Adding bit from final parse: "${bit.title}"`);
                  foundBits.push(bit);

                  // On pass 2+, skip topic creation — onBitFound handles merging
                  if (pass > 1) continue;

                  let textPosition = bit.textPosition;
                  let actualFullText = bit.fullText;

                  if (actualFullText && actualFullText.trim()) {
                    const posResult = findTextPosition(originalText, actualFullText);
                    if (posResult) {
                      if (posResult.confidence >= 0.8) {
                        textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                      }
                      // Always claim for subtraction
                      mappedPositions.push({ startChar: posResult.startChar, endChar: posResult.endChar });
                    }
                  }

                  const enhancedBit = {
                    ...bit,
                    id: uid(),
                    sourceFile: tr.name,
                    transcriptId: tr.id,
                    fullText: actualFullText,
                    textPosition: textPosition || { startChar: 0, endChar: 0 },
                    editHistory: [],
                    parsedWithModel: selectedModel,
                    timestamp: Date.now(),
                  };

                  // Persist to DB immediately — dedup may update/remove later
                  saveSingleTopic(enhancedBit).catch((err) => console.error("[DB] Immediate save failed:", err));

                  // Auto-dedup then add
                  absorbOrMerge(enhancedBit, stateRef.current.topics, callOllama, selectedModel).then((dedupResult) => {
                    if (dedupResult.action === "absorbed") {
                      console.log(`[Pass ${pass}] [AutoDedup/onComplete] Skipped "${enhancedBit.title}"`);
                      return;
                    }
                    if (dedupResult.action === "absorbed_existing") {
                      update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), enhancedBit]);
                    } else if (dedupResult.action === "merged") {
                      update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), dedupResult.keptBit]);
                    } else {
                      update('topics', (prev) => [...prev, enhancedBit]);
                    }
                    const s2 = stateRef.current;
                    saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }).catch((err) => console.error("Error saving bit:", err));
                    if (dedupResult.action === "none" && s2.topics.length > 0) {
                      matchBitLive(enhancedBit, s2.topics, sessionController.signal).catch((err) => { if (err.name !== "AbortError") console.error("Live match error:", err); });
                    }
                  }).catch((err) => {
                    console.error("[AutoDedup/onComplete] Error, adding bit normally:", err.message);
                    update('topics', (prev) => [...prev, enhancedBit]);
                  });
                }
              }
            }
            console.log(`[Pass ${pass}] Streaming completed. Total bits found: ${foundBits.length}`);
            resolve({ success: true });
          },
          onFrozen: (info) => {
            froze = true;
            console.log(`[Pass ${pass}] Streaming FROZE`);
            resolve({ success: true });
          },
          onError: (err) => {
            error = err;
            console.log(`[Pass ${pass}] Streaming ERROR: ${err.message}`);
            resolve({ success: false });
          },
          onDebug: debugMode ? addDebugEntry : null,
        },
        selectedModel,
        sessionController,
        30000 // 30s inactivity timeout — only triggers if no chunks received at all
      ).catch((err) => {
        // Catch the callOllamaStream promise rejection to prevent unhandled rejection.
        // The callbacks (onComplete/onFrozen/onError) already resolved our wrapper promise.
        console.warn(`[Pass ${pass}] callOllamaStream rejected (handled via callbacks):`, err.message);
      });
    });

    try {
      await parsePromise;
      console.log(`[Pass ${pass}] Found ${foundBits.length} bits total`);

      return {
        foundBits,
        mappedPositions,
        froze,
        error
      };
    } catch (err) {
      console.error(`[Pass ${pass}] Unexpected error:`, err);
      throw err;
    }
  }, [topics, matches, transcripts, touchstones, rootBits, selectedModel, matchBitLive, debugMode, addDebugEntry]);


  const parseAll = useCallback(async (transcriptSubset) => {
    const toProcess = transcriptSubset || transcripts;
    if (toProcess.length === 0) {
      set('status', "No transcripts to parse.");
      return;
    }

    set('processing', true);
    setShouldStop(false);
    set('foundBits', []);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    for (const tr of toProcess) {
      if (shouldStop) {
        set('status', "Processing stopped by user.");
        break;
      }

      try {
        try { sessionStorage.setItem("topix-parsing", JSON.stringify({ transcript: tr.name, startedAt: Date.now() })); } catch {}

        set('status', `Parsing "${tr.name}" with ${selectedModel}...`);
        set('huntProgress', null);
        set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "" });

        const originalText = tr.text.replace(/\n/g, " ");
        const coveredRanges = [];

        // Pre-seed with positions of already-identified bits from this transcript
        for (const bit of stateRef.current.topics) {
          if (bit.sourceFile === tr.name && bit.textPosition && bit.textPosition.endChar > bit.textPosition.startChar) {
            coveredRanges.push({ startChar: bit.textPosition.startChar, endChar: bit.textPosition.endChar });
          }
        }
        if (coveredRanges.length > 0) {
          console.log(`[Parse] Pre-seeded ${coveredRanges.length} covered ranges from existing bits for "${tr.name}"`);
        }

        const { foundBitTexts, coveragePercent, passes, frozeOut } = await runParseLoop({
          transcript: tr,
          originalText,
          coveredRanges,
          processRemainingText,
          controller,
          shouldStopFn: () => shouldStop,
          onStatus: (msg) => set('status', `"${tr.name}" ${msg}`),
          findTextPosition,
          onFreezeRollback: (lastBit) => {
            const lastBitText = lastBit.fullText;
            update('topics', prev => prev.filter(t => t.fullText !== lastBitText));
            const s = stateRef.current;
            saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits }).catch(console.error);
          },
          selectedModel,
          logPrefix: "Parse",
        });

        if (frozeOut) {
          set('status', `⚠️ "${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage (stopped: Ollama kept freezing)`);
        } else if (passes > 20) {
          set('status', `⚠️ "${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage (max passes reached)`);
        } else {
          set('status', `✅ "${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage`);
        }

        console.log(`\n[SUMMARY] "${tr.name}": ${coveragePercent}% coverage in ${passes} pass${passes > 1 ? 'es' : ''}`);
      } catch (err) {
        set('status', `Error parsing "${tr.name}": ${err.message}`);
        console.error("Parse error:", err);
      }
    }

    try { sessionStorage.removeItem("topix-parsing"); } catch {}

    if (!shouldStop) {
      set('status', "✅ Done! Bits parsed and matched in real-time. Check the Database and Graph tabs.");
    }
    set('streamingProgress', null);
    set('processing', false);
    setShouldStop(false);
    abortControllerRef.current = null;
  }, [transcripts, topics, shouldStop, selectedModel, matchBitLive, processRemainingText]);

  const parseUnparsed = useCallback(() => {
    const unparsed = transcripts.filter((tr) => !topics.some((t) => t.transcriptId === tr.id));
    if (unparsed.length === 0) {
      set('status', "All transcripts already parsed.");
      return;
    }
    return parseAll(unparsed);
  }, [transcripts, topics, parseAll]);

  // Helper function to purge all data for a transcript
  const purgeTranscriptData = useCallback(async (tr) => {
    if (!window.confirm(`Delete all parsed data for "${tr.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      set('status', `Purging data for "${tr.name}"...`);

      // Get bits to remove
      const bitsToRemoveIds = new Set(topics.filter((t) => t.transcriptId === tr.id).map((t) => t.id));

      // Calculate updated state
      const updatedTopics = topics.filter((t) => t.transcriptId !== tr.id);
      const updatedMatches = matches.filter((m) => !bitsToRemoveIds.has(m.sourceId) && !bitsToRemoveIds.has(m.targetId));

      // Update state
      dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches } });

      // Persist to database
      await saveVaultState({
        topics: updatedTopics,
        matches: updatedMatches,
        transcripts,
        touchstones,
        rootBits
      });

      set('status', `✅ Purged all data for "${tr.name}"`);
      if (selectedTranscript?.id === tr.id) {
        setSelectedTranscript(null);
      }
    } catch (err) {
      console.error("Error purging data:", err);
      set('status', `Error purging data: ${err.message}`);
    }
  }, [topics, matches, transcripts, touchstones, rootBits, selectedTranscript]);

  // Remove a transcript AND all its parsed data
  const removeTranscript = useCallback(async (tr) => {
    if (!window.confirm(`Remove "${tr.name}" and all its parsed bits? This cannot be undone.`)) {
      return;
    }

    try {
      set('status', `Removing "${tr.name}"...`);

      const bitsToRemoveIds = new Set(topics.filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id).map((t) => t.id));
      const updatedTopics = topics.filter((t) => !bitsToRemoveIds.has(t.id));
      const updatedMatches = matches.filter((m) => !bitsToRemoveIds.has(m.sourceId) && !bitsToRemoveIds.has(m.targetId));
      const updatedTranscripts = transcripts.filter((t) => t.id !== tr.id);

      dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, transcripts: updatedTranscripts } });

      await saveVaultState({
        topics: updatedTopics,
        matches: updatedMatches,
        transcripts: updatedTranscripts,
        touchstones,
        rootBits
      });

      set('status', `✅ Removed "${tr.name}" and ${bitsToRemoveIds.size} bits`);
      if (selectedTranscript?.id === tr.id) {
        setSelectedTranscript(null);
      }
    } catch (err) {
      console.error("Error removing transcript:", err);
      set('status', `Error removing transcript: ${err.message}`);
    }
  }, [topics, matches, transcripts, touchstones, rootBits, selectedTranscript]);

  // Clear processed data but keep transcript list
  const clearProcessedData = useCallback(async () => {
    if (!window.confirm("Clear all bits, matches, and touchstones? Transcripts will be kept but reset to unparsed.")) {
      return;
    }
    try {
      set('status', "Clearing processed data...");
      dispatch({ type: 'MERGE', payload: {
        topics: [],
        matches: [],
        touchstones: { confirmed: [], possible: [] },
        rootBits: [],
        selectedTopic: null,
        editingMode: null,
      }});
      // Save the cleared state (transcripts preserved via auto-save)
      const s = stateRef.current;
      await saveVaultState({ topics: [], matches: [], transcripts: s.transcripts, touchstones: { confirmed: [], possible: [] }, rootBits: [] });
      set('status', "✅ Processed data cleared. Transcripts kept.");
      getDatabaseStats().then(stats => set('dbStats', stats)).catch(console.error);
    } catch (err) {
      console.error("Error clearing processed data:", err);
      set('status', `Error: ${err.message}`);
    }
  }, []);

  // Clear entire database and start fresh
  const clearAllData = useCallback(async () => {
    if (!window.confirm("⚠️ DELETE EVERYTHING? This will clear all transcripts, bits, matches, and settings. This cannot be undone.")) {
      return;
    }

    if (!window.confirm("Are you absolutely sure? Click OK to permanently delete all data.")) {
      return;
    }

    try {
      set('status', "Clearing database...");

      // Reset all state
      dispatch({ type: 'CLEAR_ALL' });
      embeddingStore.clear();
      set('embeddingStatus', { cached: 0, total: 0 });

      // Then clear IndexedDB (must use correct DB name)
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("comedy-parser-vault");
        request.onsuccess = () => {
          console.log("[DB] Database deleted successfully");
          resolve();
        };
        request.onerror = () => {
          console.error("[DB] Error deleting database:", request.error);
          reject(request.error);
        };
      });

      set('status', "✅ Database cleared. Start fresh!");
      set('dbStats', null);
      set('lastSave', null);
    } catch (err) {
      console.error("Error clearing database:", err);
      set('status', `Error clearing database: ${err.message}`);
    }
  }, []);

  // Hard stop: abort all active LLM calls and restart Ollama
  const handleHardStop = useCallback(async () => {
    console.log("[HardStop] Aborting all active LLM calls...");
    setShouldStop(true);

    // Clear queued operations (dedup, matching) so they don't run after abort
    const cleared = opQueue.clear();
    if (cleared > 0) console.log(`[HardStop] Cleared ${cleared} queued operations`);

    // Abort all active controllers
    for (const ref of [abortControllerRef, huntControllerRef, touchstoneNamingController]) {
      if (ref.current) {
        ref.current.abort();
        ref.current = null;
      }
    }

    set('processing', false);
    set('streamingProgress', null);
    set('huntProgress', null);
    set('status', "Stopping... restarting Ollama...");

    try {
      await requestOllamaRestart();
      set('status', "✅ Hard stop complete. Ollama restarted.");
    } catch (err) {
      set('status', `Stopped. Ollama restart failed: ${err.message}`);
    }

    setShouldStop(false);
  }, []);

  // Backup: export full database as downloadable JSON
  const handleBackup = useCallback(async () => {
    try {
      set('status', "Exporting backup...");
      const json = await exportDatabaseAsJSON();
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `topix-backup-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set('status', "✅ Backup downloaded.");
    } catch (err) {
      console.error("Backup error:", err);
      set('status', `Backup failed: ${err.message}`);
    }
  }, []);

  // Restore: trigger hidden file input
  const handleRestore = useCallback(() => {
    restoreFileInput.current?.click();
  }, []);

  // Restore: process selected file
  const handleRestoreFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      set('status', "Restoring from backup...");
      const text = await file.text();
      const json = JSON.parse(text);
      await importDatabaseFromJSON(json);
      embeddingStore.clear();
      set('embeddingStatus', { cached: 0, total: 0 });
      await loadSavedData();
      set('status', "✅ Restored from backup.");
    } catch (err) {
      console.error("Restore error:", err);
      set('status', `Restore failed: ${err.message}`);
    }
    // Reset the input so the same file can be selected again
    e.target.value = "";
  }, [loadSavedData]);

  // Helper function to re-parse a specific transcript
  const reParseTranscript = useCallback(async (tr) => {
    setShouldStop(false);
    set('processing', true);
    set('huntProgress', null);
    set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "" });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      set('status', `Re-parsing "${tr.name}" with ${selectedModel}...`);
      const originalText = tr.text.replace(/\n/g, " ");
      const coveredRanges = [];

      // Pre-seed with positions of already-identified bits from this transcript
      for (const bit of stateRef.current.topics) {
        if (bit.sourceFile === tr.name && bit.textPosition && bit.textPosition.endChar > bit.textPosition.startChar) {
          coveredRanges.push({ startChar: bit.textPosition.startChar, endChar: bit.textPosition.endChar });
        }
      }
      if (coveredRanges.length > 0) {
        console.log(`[Re-parse] Pre-seeded ${coveredRanges.length} covered ranges from existing bits`);
      }

      const { foundBitTexts, coveragePercent, passes } = await runParseLoop({
        transcript: tr,
        originalText,
        coveredRanges,
        processRemainingText,
        controller,
        shouldStopFn: () => shouldStop,
        onStatus: (msg) => set('status', msg),
        findTextPosition,
        trackFailedBits: false,
        trackSeenHashes: false,
        onFreezeRollback: (lastBit) => {
          update('topics', prev => prev.filter(t => t.fullText !== lastBit.fullText));
          const s = stateRef.current;
          saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits }).catch(console.error);
        },
        selectedModel,
        logPrefix: "Re-parse",
      });

      set('status', `✅ Re-parsed "${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage in ${passes} pass${passes > 1 ? 'es' : ''}`);
    } catch (err) {
      if (err.name !== "AbortError") {
        set('status', `Error re-parsing "${tr.name}": ${err.message}`);
        console.error("Re-parse error:", err);
      }
    } finally {
      set('processing', false);
      set('streamingProgress', null);
      abortControllerRef.current = null;
    }
  }, [topics, matches, transcripts, touchstones, rootBits, selectedModel, matchBitLive, processRemainingText, shouldStop]);

  const exportVault = useCallback(() => {
    const files = generateObsidianVault(topics, matches, transcripts, [...(touchstones.confirmed || []), ...(touchstones.possible || [])], rootBits);
    // Create a zip-like download: one combined markdown or individual files
    // For simplicity, we'll create a single zip via blob
    // But since we can't use JSZip easily, we'll export as a single combined file
    // Actually let's do individual file downloads bundled as a JSON manifest
    const manifest = {
      vaultName: "Comedy Bit Vault",
      exportDate: new Date().toISOString(),
      stats: {
        totalBits: topics.length,
        rootBits: rootBits.length,
        touchstones: (touchstones.confirmed || []).length + (touchstones.possible || []).length,
        connections: matches.length,
        transcripts: transcripts.length,
      },
      files,
      instructions:
        "Create a folder called 'Comedy Bit Vault' in your Obsidian vault. Create subfolders: 'bits', 'tags', '_root-bits', '_touchstones'. Place each file according to its folder. The MOC file goes in the root.",
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comedy-vault-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [topics, matches, transcripts, touchstones, rootBits]);

  const exportMarkdownZip = useCallback(() => {
    // Export as individual .md files in a downloadable format
    // We'll create a simple combined markdown for immediate use
    const files = generateObsidianVault(topics, matches, transcripts, [...(touchstones.confirmed || []), ...(touchstones.possible || [])], rootBits);
    files.forEach((f) => {
      const blob = new Blob([f.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [topics, matches, transcripts, touchstones, rootBits]);

  const exportSingleMd = useCallback(() => {
    const files = generateObsidianVault(topics, matches, transcripts, [...(touchstones.confirmed || []), ...(touchstones.possible || [])], rootBits);
    const combined = files.map((f) => `<!-- FILE: ${f.name} -->\n${f.content}`).join("\n\n---\n\n");
    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comedy-vault-combined.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [topics, matches, transcripts, touchstones, rootBits]);

  const allTags = useMemo(() => {
    const counts = {};
    topics.forEach((t) => (t.tags || []).forEach((tag) => {
      const normalized = tag.trim().replace(/\s+/g, "-").toLowerCase();
      if (normalized) counts[normalized] = (counts[normalized] || 0) + 1;
    }));
    return Object.entries(counts)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [topics]);
  const filteredTopics = useMemo(() => {
    const filtered = filterTag
      ? topics.filter((t) => (t.tags || []).some((tag) => tag.trim().replace(/\s+/g, "-").toLowerCase() === filterTag))
      : topics;
    // Sort by source file then by position in transcript
    return [...filtered].sort((a, b) => {
      if (a.sourceFile !== b.sourceFile) return (a.sourceFile || "").localeCompare(b.sourceFile || "");
      return (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0);
    });
  }, [topics, filterTag]);

  const getMatchesForTopic = (topicId) =>
    matches
      .filter((m) => m.sourceId === topicId || m.targetId === topicId)
      .filter((m) => (m.matchPercentage || (m.confidence || 0) * 100) >= 50)
      .map((m) => {
        const otherId = m.sourceId === topicId ? m.targetId : m.sourceId;
        const other = topics.find((t) => t.id === otherId);
        return { ...m, other };
      })
      .filter((m) => m.other)
      .sort((a, b) => (b.matchPercentage || b.confidence * 100) - (a.matchPercentage || a.confidence * 100));

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a14",
      color: "#d4d4e0",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    }}>

      {/* Header */}
      <div style={{
        padding: "16px 32px 0",
        borderBottom: "1px solid #1a1a2a",
      }}>
        {/* Row 1: Title + stats left, model + debug right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 28,
              fontWeight: 900,
              background: "linear-gradient(135deg, #ff6b6b, #ffa94d)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "-0.5px",
              margin: 0,
            }}>
              Bit Parser
            </h1>
            <span style={{ color: "#555", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
              {topics.length} bits · {(touchstones?.confirmed?.length || 0) + (touchstones?.possible?.length || 0)} touchstones · {matches.length} connections · {transcripts.length} files
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {processing && (
              <button
                onClick={handleHardStop}
                title="Abort all active LLM calls and restart Ollama"
                style={{
                  padding: "5px 14px",
                  background: "#ff6b6b",
                  border: "1px solid #ff6b6b",
                  color: "#fff",
                  borderRadius: "6px",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  cursor: "pointer",
                  animation: "pulse 1.5s infinite",
                }}
              >
                STOP
              </button>
            )}
            <button
              onClick={() => update('debugMode', (v) => !v)}
              title="Toggle debug mode: shows prompts and raw responses"
              style={{
                padding: "5px 10px",
                background: debugMode ? "#1a2a1a" : "#1a1a2a",
                border: `1px solid ${debugMode ? "#51cf66" : "#2a2a40"}`,
                color: debugMode ? "#51cf66" : "#555",
                borderRadius: "6px",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {debugMode ? "DEBUG ON" : "DEBUG"}
            </button>
          </div>
        </div>

        {/* Row 2: Info left, action buttons right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono', monospace" }}>
            {lastSave && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#51cf66" }} />
                Saved {lastSave.toLocaleTimeString()}
              </span>
            )}
            {dbStats && (
              <span title={`DB: ${JSON.stringify(dbStats)}`}>
                {Object.values(dbStats).reduce((a, b) => a + b, 0)} items in DB
              </span>
            )}
            {embeddingStatus.cached > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#8bc98b" }} />
                Embeddings: {embeddingStatus.cached}{embeddingStatus.total > 0 ? `/${embeddingStatus.total}` : ""} cached
              </span>
            )}
            {topics.length > 0 && !processing && (
              <button
                onClick={async () => {
                  try {
                    set('status', `Embedding ${topics.length} bits...`);
                    await embeddingStore.ensureEmbeddings(topics, embeddingModel, ({ done, total, status }) => {
                      set('embeddingStatus', { cached: done, total });
                      set('status', status);
                    });
                    set('embeddingStatus', { cached: embeddingStore.size, total: topics.length });
                    set('status', `Embedded ${topics.length} bits.`);
                  } catch (err) {
                    set('status', `Embedding failed: ${err.message}`);
                  }
                }}
                title="Pre-compute embeddings for all bits"
                style={{
                  background: "none",
                  border: "1px solid #2a3a2a",
                  color: "#8bc98b",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                }}
              >
                Embed All
              </button>
            )}
          </div>
          <input
            ref={restoreFileInput}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleRestoreFile}
          />
        </div>

        {/* Row 3: Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {["upload", "bits", "touchstones", "transcripts", "validation", "analytics", "graph", "settings"].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{
          padding: "8px 32px",
          background: "#12121f",
          borderBottom: "1px solid #1a1a2a",
          fontSize: 12,
          color: processing ? "#ffa94d" : "#4ecdc4",
          fontFamily: "'JetBrains Mono', monospace",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          {processing && (
            <span style={{
              display: "inline-block",
              width: 8, height: 8,
              borderRadius: "50%",
              background: "#ffa94d",
              animation: "pulse 1s infinite",
            }} />
          )}
          {status}
        </div>
      )}

      <div style={{ padding: "24px 32px", paddingBottom: (streamingProgress || processing || huntProgress) ? 370 : debugMode ? "calc(40vh + 24px)" : 24 }}>
        {/* UPLOAD TAB */}
        {activeTab === "upload" && (
          <UploadTab
            transcripts={transcripts}
            topics={topics}
            processing={processing}
            selectedModel={selectedModel}
            fileInput={fileInput}
            handleFiles={handleFiles}
            parseAll={parseAll}
            parseUnparsed={parseUnparsed}
            setShouldStop={setShouldStop}
            abortControllerRef={abortControllerRef}
            onGoToMix={(tr) => { setMixTranscriptInit(tr); setSelectedTranscript(tr); setActiveTab("transcripts"); }}
          />
        )}

        {/* BITS TAB */}
        {activeTab === "bits" && (
          <DatabaseTab
            allTags={allTags}
            filteredTopics={filteredTopics}
            filterTag={filterTag}
            topics={topics}
            setFilterTag={setFilterTag}
            setSelectedTopic={setSelectedTopic}
            getMatchesForTopic={getMatchesForTopic}
            touchstones={touchstones}
          />
        )}

        {/* ANALYTICS TAB */}
        {activeTab === "analytics" && (
          <div>
            {topics.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
                Parse some transcripts to see analytics.
              </div>
            ) : (
              <AnalyticsDashboard
                topics={topics}
                matches={matches}
                touchstones={touchstones}
                rootBits={rootBits}
                transcripts={transcripts}
              />
            )}
          </div>
        )}

        {/* GRAPH TAB */}
        {activeTab === "graph" && (
          <div>
            {topics.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🕸️</div>
                Parse some transcripts to see the connection graph.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <p style={{ fontSize: 12, color: "#555", margin: 0 }}>
                      Drag nodes to rearrange. Scroll to zoom. Colors = source files. Lines = matched bits.
                    </p>
                    {embeddingStatus.cached > 0 && (
                      <span style={{ fontSize: 10, color: "#8bc98b", fontFamily: "'JetBrains Mono', monospace" }}>
                        {embeddingStatus.cached} embeddings
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {matches.length > 0 && (
                      <button
                        onClick={handleMassCommunion}
                        disabled={processing}
                        style={{
                          padding: "6px 14px",
                          background: processing ? "#33333380" : "#74c0fc18",
                          color: processing ? "#888" : "#74c0fc",
                          border: `1px solid ${processing ? "#33333380" : "#74c0fc44"}`,
                          borderRadius: "6px",
                          fontWeight: 600,
                          fontSize: "11px",
                          fontFamily: "'JetBrains Mono', monospace",
                          cursor: processing ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {processing ? "Communing..." : `Mass Communion (${matches.length} connections)`}
                      </button>
                    )}
                  </div>
                </div>
                <NetworkGraph topics={topics} matches={matches} />
              </>
            )}
          </div>
        )}

        {/* TOUCHSTONES TAB */}
        {activeTab === "touchstones" && (
          <div>
            <TouchstonePanel
              touchstones={touchstones}
              bits={topics}
              matches={matches}
              onSelectBit={(bit) => {
                setSelectedTopic(bit);
                setActiveTab("bits");
              }}
              onHunt={huntTouchstones}
              onRectifyOverlaps={rectifyOverlaps}
              huntProgress={huntProgress}
              processing={processing}
              onGenerateTitle={handleGenerateTitle}
              initialTouchstoneId={touchstoneInit}
              onConsumeInitialTouchstone={() => setTouchstoneInit(null)}
              onRenameTouchstone={(touchstoneId, newName) => {
                update('touchstones', (prev) => {
                  const rename = (list) => list.map((t) => {
                    if (t.id !== touchstoneId) return t;
                    // Write through to name cache so re-detection preserves the rename
                    const key = [...t.bitIds].sort().join(",");
                    touchstoneNameCache.current.set(key, newName);
                    return { ...t, name: newName, manualName: true };
                  });
                  return { confirmed: rename(prev.confirmed || []), possible: rename(prev.possible || []), rejected: rename(prev.rejected || []) };
                });
              }}
              onRemoveTouchstone={(touchstoneId) => {
                update('touchstones', (prev) => {
                  const all = [...(prev.confirmed || []), ...(prev.possible || [])];
                  const rejected = all.find((t) => t.id === touchstoneId);
                  if (!rejected) return prev;
                  return {
                    confirmed: (prev.confirmed || []).filter((t) => t.id !== touchstoneId),
                    possible: (prev.possible || []).filter((t) => t.id !== touchstoneId),
                    rejected: [...(prev.rejected || []), { ...rejected, category: "rejected" }],
                  };
                });
              }}
              onConfirmTouchstone={(touchstoneId) => {
                update('touchstones', (prev) => {
                  const fromPossible = (prev.possible || []).find((t) => t.id === touchstoneId);
                  if (!fromPossible) return prev;
                  return {
                    confirmed: [...(prev.confirmed || []), { ...fromPossible, category: "confirmed" }],
                    possible: (prev.possible || []).filter((t) => t.id !== touchstoneId),
                    rejected: prev.rejected || [],
                  };
                });
              }}
              onRestoreTouchstone={(touchstoneId) => {
                update('touchstones', (prev) => {
                  const fromRejected = (prev.rejected || []).find((t) => t.id === touchstoneId);
                  if (!fromRejected) return prev;
                  return {
                    confirmed: prev.confirmed || [],
                    possible: [...(prev.possible || []), { ...fromRejected, category: "possible" }],
                    rejected: (prev.rejected || []).filter((t) => t.id !== touchstoneId),
                  };
                });
              }}
              onRemoveInstance={(touchstoneId, bitId) => {
                update('touchstones', (prev) => {
                  const removeFrom = (list) => list.map((t) => {
                    if (t.id !== touchstoneId) return t;
                    const newInstances = t.instances.filter((i) => i.bitId !== bitId);
                    const newBitIds = t.bitIds.filter((id) => id !== bitId);
                    if (newInstances.length === 0) return null; // Remove touchstone if no instances left
                    return { ...t, instances: newInstances, bitIds: newBitIds, frequency: newInstances.length };
                  }).filter(Boolean);
                  return { confirmed: removeFrom(prev.confirmed || []), possible: removeFrom(prev.possible || []), rejected: removeFrom(prev.rejected || []) };
                });
              }}
              onCreateTouchstone={(name, bitId) => {
                const bit = topics.find((t) => t.id === bitId);
                if (!bit) return;
                const newTouchstone = {
                  id: `touchstone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  name,
                  summary: `1 instance — in "${bit.sourceFile}"`,
                  bitIds: [bitId],
                  instances: [{
                    bitId,
                    sourceFile: bit.sourceFile,
                    title: bit.title,
                    instanceNumber: 1,
                    confidence: 1,
                    relationship: "same_bit",
                  }],
                  firstAppearance: { transcriptId: bit.transcriptId, bitId, sourceFile: bit.sourceFile },
                  frequency: 1,
                  crossTranscript: false,
                  sourceCount: 1,
                  tags: bit.tags || [],
                  commonWords: [],
                  matchInfo: { totalMatches: 0, sameBitCount: 0, evolvedCount: 0, relatedCount: 0, callbackCount: 0, avgConfidence: 0, avgMatchPercentage: 0, reasons: [] },
                  category: "confirmed",
                };
                update('touchstones', (prev) => ({
                  confirmed: [...(prev.confirmed || []), newTouchstone],
                  possible: prev.possible || [],
                  rejected: prev.rejected || [],
                }));
              }}
              onUpdateInstanceRelationship={(touchstoneId, bitId, newRelationship) => {
                update('touchstones', (prev) => {
                  const updateIn = (list) => list.map((t) => {
                    if (t.id !== touchstoneId) return t;
                    return {
                      ...t,
                      instances: t.instances.map((i) =>
                        i.bitId === bitId ? { ...i, relationship: newRelationship } : i
                      ),
                    };
                  });
                  return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
                });
              }}
              onMergeTouchstone={async (sourceTouchstoneId, targetTouchstoneId) => {
                // Merge a possible touchstone's instances into an existing touchstone,
                // using LLM to verify each candidate bit belongs
                const s = stateRef.current;
                const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
                const source = allTs.find((t) => t.id === sourceTouchstoneId);
                const target = allTs.find((t) => t.id === targetTouchstoneId);
                if (!source || !target) { console.warn("[Merge] source or target not found"); return { accepted: 0, rejected: 0 }; }

                // Gather existing group bits
                const groupBits = target.instances.map((i) => topics.find((b) => b.id === i.bitId)).filter(Boolean);
                // Gather candidate bits (from source, excluding any already in target)
                const targetBitIds = new Set(target.instances.map((i) => i.bitId));
                const candidateBits = source.instances
                  .filter((i) => !targetBitIds.has(i.bitId))
                  .map((i) => ({ instance: i, bit: topics.find((b) => b.id === i.bitId) }))
                  .filter((c) => c.bit);

                if (candidateBits.length === 0) {
                  // All bits already in target — just remove the source touchstone
                  console.log("[Merge] All source bits already in target, removing source touchstone");
                  update('touchstones', (prev) => {
                    const removeSource = (list) => list.filter((t) => t.id !== sourceTouchstoneId);
                    return {
                      confirmed: removeSource(prev.confirmed || []),
                      possible: removeSource(prev.possible || []),
                      rejected: removeSource(prev.rejected || []),
                    };
                  });
                  set('status', `Merged "${source.name}" into "${target.name}" (all bits already present).`);
                  // Persist
                  setTimeout(async () => {
                    const s2 = stateRef.current;
                    try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones, rootBits: s2.rootBits }); }
                    catch (err) { console.error("Error saving after merge:", err); }
                  }, 100);
                  return { accepted: source.instances.length, rejected: 0, alreadyMerged: true };
                }

                // Apply target's word corrections to text before sending to LLM
                const applyCorr = (text) => {
                  if (!target.corrections || target.corrections.length === 0) return text;
                  let r = text;
                  for (const c of target.corrections) {
                    r = r.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to);
                  }
                  return r;
                };

                // Build LLM prompt
                const groupText = groupBits.map((b, i) =>
                  `EXISTING ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorr(b.title)}\n${applyCorr(b.fullText || b.summary)}`
                ).join('\n\n');
                const candText = candidateBits.map((c, i) =>
                  `CANDIDATE ${i + 1} (from "${c.bit.sourceFile}"):\nTitle: ${applyCorr(c.bit.title)}\n${applyCorr(c.bit.fullText || c.bit.summary)}`
                ).join('\n\n');

                // Include rejected reasons so LLM avoids them
                const rejBlock = (target.rejectedReasons || []).length > 0
                  ? `\n\n--- REJECTED REASONING (these indicate the previous grouping was too broad/loose — do not match based solely on these broad themes) ---\n${target.rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
                  : '';

                const userMsg = `TOUCHSTONE: "${target.name}"\n\n--- EXISTING GROUP (${groupBits.length} instances) ---\n${groupText}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) ---\n${candText}${rejBlock}`;

                try {
                  set('processing', true);
                  set('status', `Verifying merge: "${source.name}" → "${target.name}"...`);

                  const result = await callOllama(
                    SYSTEM_TOUCHSTONE_VERIFY,
                    userMsg,
                    () => {},
                    stateRef.current.selectedModel,
                    debugMode ? addDebugEntry : null,
                  );

                  const accepted = [];
                  // Filter LLM reasons against rejected, prepend user reasons
                  const rejSet = new Set((target.rejectedReasons || []).map((r) => r.toLowerCase().trim()));
                  const llmReasons = (result.group_reasoning || [])
                    .filter((r) => !rejSet.has(r.toLowerCase().trim()));
                  const newReasons = [...(target.userReasons || []), ...llmReasons].slice(0, 5);
                  if (result.candidates && Array.isArray(result.candidates)) {
                    for (const c of result.candidates) {
                      const idx = (c.candidate || 0) - 1;
                      if (idx < 0 || idx >= candidateBits.length) continue;
                      if (c.accepted) {
                        accepted.push({
                          ...candidateBits[idx].instance,
                          relationship: c.relationship || "same_bit",
                          confidence: c.confidence || 0.8,
                        });
                      }
                    }
                  }

                  // Apply merge
                  update('touchstones', (prev) => {
                    const updateTarget = (list) => list.map((t) => {
                      if (t.id !== targetTouchstoneId) return t;
                      const nextInstances = [...t.instances];
                      const nextBitIds = [...t.bitIds];
                      for (const inst of accepted) {
                        if (!nextBitIds.includes(inst.bitId)) {
                          nextInstances.push({ ...inst, instanceNumber: nextInstances.length + 1 });
                          nextBitIds.push(inst.bitId);
                        }
                      }
                      return {
                        ...t,
                        instances: nextInstances,
                        bitIds: nextBitIds,
                        frequency: nextInstances.length,
                        sourceCount: new Set(nextInstances.map((i) => i.sourceFile)).size,
                        matchInfo: {
                          ...t.matchInfo,
                          reasons: newReasons.slice(0, 5),
                          sameBitCount: nextInstances.filter((i) => i.relationship === "same_bit").length,
                          evolvedCount: nextInstances.filter((i) => i.relationship === "evolved").length,
                        },
                      };
                    });
                    // Remove source touchstone (all its useful bits are now in target)
                    const removeSource = (list) => list.filter((t) => t.id !== sourceTouchstoneId);
                    return {
                      confirmed: updateTarget(removeSource(prev.confirmed || [])),
                      possible: removeSource(prev.possible || []),
                      rejected: removeSource(prev.rejected || []),
                    };
                  });

                  set('status', `Merged ${accepted.length}/${candidateBits.length} bits from "${source.name}" into "${target.name}".`);
                  set('processing', false);
                  return { accepted: accepted.length, rejected: candidateBits.length - accepted.length };
                } catch (err) {
                  console.error('[Merge Touchstone] Error:', err);
                  set('status', `Merge failed: ${err.message}`);
                  set('processing', false);
                  return { accepted: 0, rejected: candidateBits.length };
                }
              }}
              onRefreshReasons={async (touchstoneId) => {
                // Re-evaluate "why matched" for a touchstone group
                const s = stateRef.current;
                const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
                const ts = allTs.find((t) => t.id === touchstoneId);
                if (!ts || ts.instances.length < 2) return;

                // Apply word corrections to text before sending to LLM
                const applyCorrections = (text) => {
                  if (!ts.corrections || ts.corrections.length === 0) return text;
                  let result = text;
                  for (const c of ts.corrections) {
                    result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to);
                  }
                  return result;
                };

                // Only use sainted+blessed bits for reasoning; fall back to all if none communed yet
                const trustedInstances = ts.instances.filter((i) => i.communionStatus === 'sainted' || i.communionStatus === 'blessed');
                const instancesToUse = trustedInstances.length >= 2 ? trustedInstances : ts.instances;
                const groupBits = instancesToUse.map((i) => topics.find((b) => b.id === i.bitId)).filter(Boolean);
                if (groupBits.length < 2) return;

                // Use the first bit as the anchor, send the rest as candidates for re-scoring
                const anchorBit = groupBits[0];
                const candidateBits = groupBits.slice(1);

                const anchorText = `EXISTING 1 (from "${anchorBit.sourceFile}"):\nTitle: ${applyCorrections(anchorBit.title)}\n${applyCorrections(anchorBit.fullText || anchorBit.summary)}`;

                const candidateText = candidateBits.map((b, i) =>
                  `CANDIDATE ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorrections(b.title)}\n${applyCorrections(b.fullText || b.summary)}`
                ).join('\n\n');

                // Include user-entered reasons as high-weight context for the LLM
                const userReasonsBlock = (ts.userReasons || []).length > 0
                  ? `\n\n--- USER-CONFIRMED REASONING (these are highly important — the comedian herself identified these as key reasons the bits match. Your refreshed reasoning MUST incorporate and reflect these points) ---\n${ts.userReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
                  : '';

                // Include rejected reasons so LLM avoids regenerating them
                const rejectedBlock = (ts.rejectedReasons || []).length > 0
                  ? `\n\n--- REJECTED REASONING (these indicate the previous grouping was too broad/loose — do not match based solely on these broad themes) ---\n${ts.rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
                  : '';

                const userMsg = `TOUCHSTONE: "${ts.name}"\n\n--- GROUP (1 anchor instance) ---\n${anchorText}${userReasonsBlock}${rejectedBlock}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) — re-score each against the anchor and provide updated match percentages ---\n${candidateText}`;

                try {
                  set('processing', true);
                  set('status', `Refreshing reasoning for "${ts.name}"...`);

                  const result = await callOllama(
                    SYSTEM_TOUCHSTONE_VERIFY,
                    userMsg,
                    () => {},
                    stateRef.current.selectedModel,
                    debugMode ? addDebugEntry : null,
                  );

                  // Filter out any LLM reasons that match rejected reasons, then prepend user reasons
                  const rejected = new Set((ts.rejectedReasons || []).map((r) => r.toLowerCase().trim()));
                  const llmReasons = (result.group_reasoning || [])
                    .filter((r) => !rejected.has(r.toLowerCase().trim()))
                    .slice(0, 5);
                  const userReasons = ts.userReasons || [];
                  const finalReasons = [...userReasons, ...llmReasons].slice(0, 5);

                  // Build updated per-instance confidence from LLM candidate scores
                  const candidateScores = new Map();
                  for (const c of (result.candidates || [])) {
                    if (typeof c.candidate === 'number' && typeof c.confidence === 'number') {
                      const idx = c.candidate - 1; // 1-indexed
                      if (idx >= 0 && idx < candidateBits.length) {
                        candidateScores.set(candidateBits[idx].id, {
                          confidence: c.confidence,
                          relationship: c.relationship || 'same_bit',
                        });
                      }
                    }
                  }

                  update('touchstones', (prev) => {
                    const updateIn = (list) => list.map((t) => {
                      if (t.id !== touchstoneId) return t;
                      // Update instance confidences from LLM re-scoring
                      const updatedInstances = (t.instances || []).map((inst) => {
                        // Anchor keeps confidence 1.0
                        if (inst.bitId === anchorBit.id) return { ...inst, confidence: 1, relationship: 'same_bit' };
                        const score = candidateScores.get(inst.bitId);
                        if (!score) return inst;
                        return { ...inst, confidence: score.confidence, relationship: score.relationship };
                      });
                      const avgConf = updatedInstances.length > 0
                        ? updatedInstances.reduce((s, i) => s + (i.confidence || 0), 0) / updatedInstances.length
                        : 0;
                      return {
                        ...t,
                        instances: updatedInstances,
                        matchInfo: {
                          ...t.matchInfo,
                          reasons: finalReasons.length > 0 ? finalReasons : t.matchInfo?.reasons || [],
                          totalMatches: updatedInstances.length,
                          sameBitCount: updatedInstances.filter((i) => i.relationship === "same_bit").length,
                          evolvedCount: updatedInstances.filter((i) => i.relationship === "evolved").length,
                          avgConfidence: avgConf,
                          avgMatchPercentage: Math.round(avgConf * 100),
                        },
                      };
                    });
                    return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
                  });

                  set('status', `Refreshed reasoning for "${ts.name}".`);
                  set('processing', false);
                } catch (err) {
                  console.error('[Refresh Reasons] Error:', err);
                  set('status', `Refresh failed: ${err.message}`);
                  set('processing', false);
                }
              }}
              onUpdateTouchstoneEdits={(touchstoneId, edits) => {
                // Persist user corrections, userReasons, rejectedReasons on a touchstone
                update('touchstones', (prev) => {
                  const updateIn = (list) => list.map((t) => {
                    if (t.id !== touchstoneId) return t;
                    const updated = { ...t };
                    if (edits.corrections !== undefined) updated.corrections = edits.corrections;
                    if (edits.userReasons !== undefined) updated.userReasons = edits.userReasons;
                    if (edits.rejectedReasons !== undefined) updated.rejectedReasons = edits.rejectedReasons;
                    if (edits.reasons !== undefined) updated.matchInfo = { ...updated.matchInfo, reasons: edits.reasons };
                    if (edits.idealText !== undefined) updated.idealText = edits.idealText;
                    if (edits.manualIdealText !== undefined) updated.manualIdealText = edits.manualIdealText;
                    if (edits.idealTextNotes !== undefined) updated.idealTextNotes = edits.idealTextNotes;
                    if (edits.name !== undefined) {
                      updated.name = edits.name;
                      const key = [...updated.bitIds].sort().join(",");
                      touchstoneNameCache.current.set(key, edits.name);
                    }
                    if (edits.manualName !== undefined) updated.manualName = edits.manualName;
                    return updated;
                  });
                  return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
                });
              }}
              onGoToMix={(bit) => {
                const tr = transcripts.find((t) => t.id === bit.transcriptId);
                if (tr) {
                  setMixTranscriptInit(tr);
                  setMixBitInit(bit.id);
                  setSelectedTranscript(tr);
                  setActiveTab("transcripts");
                }
              }}
              onCommuneTouchstone={handleCommuneTouchstone}
              onSynthesizeTouchstone={handleSynthesizeTouchstone}
              onMassTouchstoneCommunion={handleMassTouchstoneCommunion}
              onSaintInstance={(touchstoneId, bitId, newStatus) => {
                const prev = stateRef.current.touchstones;
                const updateIn = (list) => list.map((t) => {
                  if (t.id !== touchstoneId) return t;
                  return {
                    ...t,
                    instances: t.instances.map((inst) =>
                      inst.bitId === bitId ? { ...inst, communionStatus: newStatus } : inst
                    ),
                  };
                });
                const updatedTouchstones = { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
                set('touchstones', updatedTouchstones);
                const s2 = stateRef.current;
                saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: updatedTouchstones, rootBits: s2.rootBits }).catch(
                  (err) => console.error("Error saving after saint status change:", err)
                );
              }}
            />
          </div>
        )}

        {/* TRANSCRIPTS TAB */}
        {activeTab === "transcripts" && (
          <TranscriptTab
            transcripts={transcripts}
            topics={topics}
            touchstones={touchstones}
            selectedTranscript={selectedTranscript}
            selectedTopic={selectedTopic}
            processing={processing}
            setSelectedTranscript={setSelectedTranscript}
            setSelectedTopic={setSelectedTopic}
            reParseTranscript={reParseTranscript}
            purgeTranscriptData={purgeTranscriptData}
            removeTranscript={removeTranscript}
            onHuntTranscript={huntTranscript}
            onJoinBits={handleJoinBits}
            onSplitBit={handleSplitBit}
            onTakeOverlap={handleTakeOverlap}
            onDeleteBit={handleDeleteBit}
            onScrollBoundary={handleScrollBoundary}
            onGenerateTitle={handleGenerateTitle}
            onConfirmRename={handleConfirmRename}
            onAddPhantomBit={handleAddPhantomBit}
            onReParseGap={handleReParseGap}
            onViewBitDetail={setSelectedTopic}
            mixTranscriptInit={mixTranscriptInit}
            mixBitInit={mixBitInit}
            mixGapInit={mixGapInit}
            onConsumeMixInit={() => { setMixTranscriptInit(null); setMixBitInit(null); setMixGapInit(null); }}
            approvedGaps={approvedGaps}
            onApproveGap={handleApproveGap}
          />
        )}

        {/* VALIDATION TAB */}
        {activeTab === "validation" && (
          <ValidationTab
            topics={topics}
            transcripts={transcripts}
            onUpdateBitPosition={handleBoundaryChange}
            onGoToMix={(tr, bitId, gapInfo) => { setMixTranscriptInit(tr); setMixBitInit(bitId || null); setMixGapInit(gapInfo || null); setSelectedTranscript(tr); setActiveTab("transcripts"); }}
            onSelectBit={setSelectedTopic}
            approvedGaps={approvedGaps}
            onApproveGap={handleApproveGap}
          />
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div style={{ maxWidth: 700 }}>
            {/* Model Selection */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, color: "#eee" }}>Models</h2>
            <div className="card" style={{ cursor: "default", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              {availableModels.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>LLM Model</div>
                  <select
                    value={selectedModel}
                    onChange={(e) => set('selectedModel', e.target.value)}
                    style={{ background: "#1a1a2a", border: "1px solid #2a2a40", color: "#ccc", padding: "8px 12px", borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", minWidth: 200 }}
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
              {availableModels.filter(m => m.toLowerCase().includes("embed")).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Embedding Model</div>
                  <select
                    value={embeddingModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      if (newModel !== stateRef.current.embeddingModel) {
                        embeddingStore.clear();
                        set('embeddingStatus', { cached: 0, total: 0 });
                      }
                      set('embeddingModel', newModel);
                    }}
                    title="Embedding model for semantic search"
                    style={{ background: "#1a1a2a", border: "1px solid #2a3a2a", color: "#8bc98b", padding: "8px 12px", borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", minWidth: 200 }}
                  >
                    {availableModels.filter(m => m.toLowerCase().includes("embed")).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Data Management */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, marginTop: 32, color: "#eee" }}>Data Management</h2>
            <div className="card" style={{ cursor: "default" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "Backup", icon: "📥", onClick: handleBackup, title: "Download a full database backup as JSON", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
                  { label: "Restore", icon: "📤", onClick: handleRestore, title: "Restore database from a backup JSON file", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
                  { label: "Reset Touchstones", icon: "🔄", onClick: async () => {
                    if (!window.confirm("Clear all touchstone data and matches? Bits and transcripts will be kept. Touchstones will be re-detected from scratch.")) return;
                    dispatch({ type: 'MERGE', payload: { touchstones: { confirmed: [], possible: [], rejected: [] }, matches: [] } });
                    touchstoneNameCache.current.clear();
                    try {
                      const s = stateRef.current;
                      await saveVaultState({ topics: s.topics, matches: [], transcripts: s.transcripts, touchstones: { confirmed: [], possible: [], rejected: [] }, rootBits: s.rootBits });
                      set('status', 'Cleared all touchstone data and matches.');
                    } catch (err) { console.error("Error clearing touchstones:", err); }
                  }, title: "Clear all touchstones and matches for re-detection", bg: "#1a1a2a", border: "#2a2a40", color: "#ff6b6b" },
                  { label: "Reset Transcripts", icon: "🔄", onClick: clearProcessedData, title: "Clear bits, matches, touchstones — keep transcripts", bg: "#1a2a3a", border: "#224466", color: "#74c0fc" },
                  { label: "Fresh DB", icon: "⚠️", onClick: clearAllData, title: "Delete all data and start over", bg: "#3a1a1a", border: "#662222", color: "#ff6b6b" },
                ].map(({ label, icon, onClick, title, bg, border, color }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    title={title}
                    style={{
                      padding: "8px 14px", background: bg, border: `1px solid ${border}`, color,
                      borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { e.target.style.borderColor = color; e.target.style.filter = "brightness(1.3)"; }}
                    onMouseLeave={(e) => { e.target.style.borderColor = border; e.target.style.filter = "none"; }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export */}
            <div style={{ marginTop: 32 }} />
            <ExportTab
              topics={topics}
              exportVault={exportVault}
              exportMarkdownZip={exportMarkdownZip}
              exportSingleMd={exportSingleMd}
            />
          </div>
        )}
      </div>

      {/* Streaming Progress Panel — always show during hunts, otherwise only when debug is off */}
      {(!debugMode || huntProgress) && <StreamingProgressPanel progress={!debugMode ? streamingProgress : null} foundBits={!debugMode ? foundBits : null} processing={processing} status={status} huntProgress={huntProgress} onDismiss={() => { set('huntProgress', null); set('streamingProgress', null); set('status', ''); }} />}

      {/* Debug Panel */}
      {debugMode && <DebugPanel log={debugLog} onClear={() => { set('debugLog', []); set('debugMode', false); }} />}

      {/* Detail Panel */}
      <DetailPanel
        selectedTopic={selectedTopic}
        selectedTranscript={selectedTranscript}
        transcripts={transcripts}
        adjustingBit={adjustingBit}
        editingMode={editingMode}
        touchstones={touchstones}
        topics={topics}
        setSelectedTopic={setSelectedTopic}
        setAdjustingBit={setAdjustingBit}
        setEditingMode={setEditingMode}
        setActiveTab={setActiveTab}
        onGoToMix={(tr, bitId) => { setMixTranscriptInit(tr); setMixBitInit(bitId || null); setSelectedTranscript(tr); setActiveTab("transcripts"); setSelectedTopic(null); }}
        onGoToTouchstone={(touchstoneId) => { setTouchstoneInit(touchstoneId); setActiveTab("touchstones"); setSelectedTopic(null); }}
        handleBoundaryChange={handleBoundaryChange}
        handleSplitBit={handleSplitBit}
        handleJoinBits={handleJoinBits}
        getMatchesForTopic={getMatchesForTopic}
        onBaptize={handleBaptizeBit}
        onCommuneBit={handleCommuneBit}
        onRemoveFromTouchstone={async (bitId, touchstoneId) => {
          console.log("[RemoveFromTouchstone] Removing bit", bitId, "from touchstone", touchstoneId);
          update('touchstones', (prev) => {
            const removeFrom = (list) => list.map((t) => {
              if (t.id !== touchstoneId) return t;
              const kept = t.bitIds.filter((id) => id !== bitId);
              if (kept.length < 2) return null; // dissolve if < 2 bits remain
              return {
                ...t,
                bitIds: kept,
                instances: t.instances.filter((i) => i.bitId !== bitId),
                frequency: kept.length,
                sourceCount: new Set(t.instances.filter((i) => i.bitId !== bitId).map((i) => i.sourceFile)).size,
                // Track removed bits so they're never auto-re-added
                removedBitIds: [...new Set([...(t.removedBitIds || []), bitId])],
              };
            }).filter(Boolean);
            return { confirmed: removeFrom(prev.confirmed || []), possible: removeFrom(prev.possible || []), rejected: removeFrom(prev.rejected || []) };
          });
          setTimeout(async () => {
            const s = stateRef.current;
            try {
              await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
            } catch (err) { console.error("Error saving after remove-from-touchstone:", err); }
          }, 100);
        }}
        onAddToTouchstone={async (bitId, touchstoneId) => {
          const bit = topics.find((t) => t.id === bitId);
          if (!bit) { console.warn("[AddToTouchstone] bit not found:", bitId); return; }
          console.log("[AddToTouchstone] Adding bit", bitId, "to touchstone", touchstoneId);
          update('touchstones', (prev) => {
            const addTo = (list) => list.map((t) => {
              if (t.id !== touchstoneId) return t;
              if (t.bitIds.includes(bitId)) return t;
              return {
                ...t,
                instances: [...t.instances, { bitId, sourceFile: bit.sourceFile, title: bit.title, instanceNumber: t.instances.length + 1, confidence: 1, relationship: "same_bit" }],
                bitIds: [...t.bitIds, bitId],
                frequency: t.instances.length + 1,
                sourceCount: new Set([...t.instances.map((i) => i.sourceFile), bit.sourceFile]).size,
                autoNamed: t.category === "confirmed" ? t.autoNamed : false, // re-name possible touchstones on new bit
              };
            });
            return { confirmed: addTo(prev.confirmed || []), possible: addTo(prev.possible || []), rejected: addTo(prev.rejected || []) };
          });
          // Persist after next render
          setTimeout(async () => {
            const s = stateRef.current;
            try {
              await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones, rootBits: s.rootBits });
            } catch (err) { console.error("Error saving after add-to-touchstone:", err); }
          }, 100);
        }}
      />
    </div>
  );
}
