import { requestOllamaRestart } from "./ollama";

// Merge overlapping ranges into a sorted non-overlapping list
export function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startChar - b.startChar);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].startChar <= last.endChar) {
      last.endChar = Math.max(last.endChar, sorted[i].endChar);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

// Build remaining text from uncovered ranges, returning both text and a segment map.
// The segment map allows translating positions in the remaining text back to the original.
export function buildRemainingWithMap(originalText, coveredRanges) {
  const merged = mergeRanges(coveredRanges);
  const segments = [];
  let cursor = 0;
  for (let ri = 0; ri < merged.length; ri++) {
    const range = merged[ri];
    if (range.startChar > cursor) {
      segments.push({ origStart: cursor, origEnd: range.startChar, remStart: 0, remEnd: 0 });
    }
    cursor = Math.max(cursor, range.endChar);
  }
  if (cursor < originalText.length) {
    segments.push({ origStart: cursor, origEnd: originalText.length, remStart: 0, remEnd: 0 });
  }

  // Compute remStart/remEnd with joining spaces only between segments
  let totalRem = 0;
  for (let si = 0; si < segments.length; si++) {
    const segLen = segments[si].origEnd - segments[si].origStart;
    segments[si].remStart = totalRem;
    segments[si].remEnd = totalRem + segLen;
    totalRem += segLen + (si < segments.length - 1 ? 1 : 0);
  }

  let remaining = segments.map(s => originalText.substring(s.origStart, s.origEnd)).join(" ");
  remaining = remaining.replace(/\s{2,}/g, " ").trim();

  return { text: remaining, segments };
}

// Smart chunking: find a sentence boundary near the target length
export function findChunkBoundary(text, targetLen = 8000) {
  if (text.length <= targetLen) return text.length;
  // Look for sentence end (period + space/newline) near target
  for (let i = targetLen; i > targetLen - 500 && i > 0; i--) {
    if (text[i] === '.' && /\s/.test(text[i + 1] || '')) return i + 1;
  }
  // Fallback: find last space before target
  const lastSpace = text.lastIndexOf(' ', targetLen);
  return lastSpace > targetLen - 200 ? lastSpace : targetLen;
}

/**
 * Shared multi-pass parse loop used by both parseAll and reParseTranscript.
 *
 * @param {Object} options
 * @param {Object} options.transcript - { name, text, id }
 * @param {string} options.originalText - tr.text.replace(/\n/g, " ")
 * @param {Array} options.coveredRanges - pre-seeded array, mutated in place
 * @param {Function} options.processRemainingText - the existing callback (unchanged)
 * @param {AbortController} options.controller
 * @param {Function} options.shouldStopFn - () => boolean
 * @param {Function} options.onStatus - (msg) => void
 * @param {Function} options.findTextPosition - from textMatcher.js
 * @param {number} [options.maxPasses=20]
 * @param {number} [options.maxConsecutiveFreezes=3]
 * @param {boolean} [options.trackFailedBits=true]
 * @param {boolean} [options.trackSeenHashes=true]
 * @param {Function} [options.onFreezeRollback] - (lastBit, bitsToKeep) => void
 * @param {string} [options.selectedModel] - model name for status messages
 * @param {string} [options.logPrefix="Parse"] - prefix for console logs
 *
 * @returns {Promise<{ foundBitTexts: string[], coveragePercent: number, passes: number, frozeOut: boolean }>}
 */
export async function runParseLoop({
  transcript,
  originalText,
  coveredRanges,
  processRemainingText,
  controller,
  shouldStopFn,
  onStatus,
  findTextPosition,
  maxPasses = 20,
  maxConsecutiveFreezes = 3,
  trackFailedBits = true,
  trackSeenHashes = true,
  onFreezeRollback,
  selectedModel = "",
  logPrefix = "Parse",
}) {
  const foundBitTexts = [];
  let pass = 1;
  let consecutiveFreezes = 0;

  // Track bits whose fullText couldn't be located — retry after each pass
  const failedBits = []; // {fullText, pass}

  // Seen text hashes to prevent re-sending identical text to LLM
  const seenTextHashes = new Set();
  const hashWindow = (text, start, len) => text.substring(start, start + len).replace(/\s+/g, " ").trim().substring(0, 30) + "|" + len;

  const getRemainingText = () => buildRemainingWithMap(originalText, coveredRanges).text;

  while (pass <= maxPasses) {
    if (shouldStopFn()) {
      onStatus("Processing stopped by user.");
      break;
    }

    // Before each pass, retry locating previously failed bits with the improved matcher
    if (trackFailedBits && failedBits.length > 0) {
      const stillFailed = [];
      for (const fb of failedBits) {
        const pos = findTextPosition(originalText, fb.fullText);
        if (pos) {
          coveredRanges.push({ startChar: pos.startChar, endChar: pos.endChar });
          console.log(`[${logPrefix} ${pass}] Recovered failed bit from pass ${fb.pass}: ${pos.startChar}-${pos.endChar} (${pos.strategy})`);
        } else {
          stillFailed.push(fb);
        }
      }
      failedBits.length = 0;
      failedBits.push(...stillFailed);
    }

    // Build remaining text by subtracting all previously found bit texts
    const { text: remainingText, segments } = buildRemainingWithMap(originalText, coveredRanges);

    // Skip if remaining text is too short to contain a meaningful bit
    if (remainingText.length < 50) {
      console.log(`[${logPrefix} ${pass}] Remaining text too short (${remainingText.length} chars) — done.`);
      break;
    }

    // Check if >50% of 200-char windows in this text were already seen (re-send prevention)
    if (trackSeenHashes) {
      const WINDOW_SIZE = 200;
      const WINDOW_STEP = 100;
      let seenCount = 0;
      let totalWindows = 0;
      for (let wi = 0; wi + WINDOW_SIZE <= remainingText.length; wi += WINDOW_STEP) {
        totalWindows++;
        const h = hashWindow(remainingText, wi, WINDOW_SIZE);
        if (seenTextHashes.has(h)) seenCount++;
      }
      if (totalWindows > 0 && seenCount / totalWindows > 0.5) {
        console.log(`[${logPrefix} ${pass}] >50% of text windows already seen (${seenCount}/${totalWindows}) — skipping to avoid re-processing.`);
        break;
      }
      // Record windows from current remaining text
      for (let wi = 0; wi + WINDOW_SIZE <= remainingText.length; wi += WINDOW_STEP) {
        seenTextHashes.add(hashWindow(remainingText, wi, WINDOW_SIZE));
      }
    }

    // Chunk large texts using sentence-boundary-aware splitting
    const MAX_CHUNK_CHARS = 8000;
    const chunkEnd = findChunkBoundary(remainingText, MAX_CHUNK_CHARS);
    const textToProcess = remainingText.substring(0, chunkEnd);

    if (remainingText.length > MAX_CHUNK_CHARS) {
      console.log(`[${logPrefix} ${pass}] Chunking: sending first ${MAX_CHUNK_CHARS} of ${remainingText.length} chars`);
    }

    const textToProcessLength = Math.round(textToProcess.length / 100) / 10;

    console.log(`\n=== ${logPrefix.toUpperCase()} PASS ${pass} (freeze streak: ${consecutiveFreezes}/${maxConsecutiveFreezes}) ===`);
    console.log(`[${logPrefix} ${pass}] Processing ${textToProcess.length} chars (${textToProcessLength}KB), ${coveredRanges.length} ranges covered`);
    onStatus(`Pass ${pass}: Processing ${textToProcessLength}KB with ${selectedModel}...`);

    const result = await processRemainingText(transcript, textToProcess, pass, controller, segments);

    // --- Handle freeze ---
    if (result.froze) {
      let bitsToKeep = [...result.foundBits];
      if (bitsToKeep.length > 0) {
        const lastBit = bitsToKeep.pop();
        console.log(`[${logPrefix} ${pass}] Stream FROZE — keeping ${bitsToKeep.length} complete bit(s), rolling back last bit "${lastBit.title}".`);
        if (onFreezeRollback) {
          onFreezeRollback(lastBit, bitsToKeep);
        }
      } else {
        console.log(`[${logPrefix} ${pass}] Stream FROZE with no bits found.`);
      }

      // Add salvaged bit texts so they're subtracted from the next pass
      for (const bit of bitsToKeep) {
        if (bit.fullText?.trim()) {
          foundBitTexts.push(bit.fullText);
        }
      }
      // Also track mapped positions from the salvaged bits
      if (result.mappedPositions) {
        for (const pos of result.mappedPositions) {
          coveredRanges.push(pos);
        }
      }

      // Did we make progress despite the freeze?
      if (bitsToKeep.length > 0) {
        consecutiveFreezes = 0;
      } else {
        consecutiveFreezes++;
      }

      // Bail if we keep freezing on the same text with no progress
      if (consecutiveFreezes >= maxConsecutiveFreezes) {
        console.error(`[${logPrefix} ${pass}] ${maxConsecutiveFreezes} consecutive freezes with no progress — skipping remaining text.`);
        onStatus(`Ollama froze ${maxConsecutiveFreezes}x — moving on.`);
        break;
      }

      // Restart Ollama and retry
      console.log(`[${logPrefix} ${pass}] Restarting Ollama after freeze (streak ${consecutiveFreezes})...`);
      onStatus(`Restarting Ollama after freeze (attempt ${consecutiveFreezes + 1}/${maxConsecutiveFreezes})...`);
      await requestOllamaRestart();
      pass++;
      continue;
    }

    // --- Handle error (non-freeze) ---
    if (result.error) {
      console.error(`[${logPrefix} ${pass}] Error:`, result.error.message);
      onStatus(`Restarting Ollama after error...`);
      await requestOllamaRestart();
      consecutiveFreezes++;
      if (consecutiveFreezes >= maxConsecutiveFreezes) {
        console.error(`[${logPrefix} ${pass}] Too many consecutive errors — skipping.`);
        onStatus(`Too many errors — moving on.`);
        break;
      }
      pass++;
      continue;
    }

    // --- Handle success ---
    consecutiveFreezes = 0;

    // No bits found and no freeze = LLM says remaining text is non-comedic
    if (result.foundBits.length === 0) {
      console.log(`[${logPrefix} ${pass}] Evaluated remaining ${textToProcess.length} chars as non-comedic. Parsing complete.`);
      break;
    }

    // Add found bit texts and mapped positions for subtraction on next pass
    let bitsSubtracted = 0;
    for (const bit of result.foundBits) {
      if (bit.fullText?.trim()) {
        foundBitTexts.push(bit.fullText);
        bitsSubtracted++;
      }
    }
    // Use mapped positions (resolved against original text) for reliable subtraction
    if (result.mappedPositions) {
      for (const pos of result.mappedPositions) {
        coveredRanges.push(pos);
      }
    }

    // Fallback: if positions didn't map but we have fullText, try to locate each
    // bit's text in the original using the multi-strategy matcher.
    if (result.foundBits.length > 0) {
      const prevRangeCount = coveredRanges.length;
      for (const bit of result.foundBits) {
        if (!bit.fullText?.trim()) continue;
        // Check if this bit already produced a mapped position
        const alreadyMapped = result.mappedPositions?.some(
          pos => pos.endChar - pos.startChar > 0 &&
            Math.abs((pos.endChar - pos.startChar) - bit.fullText.length) < 50
        );
        if (alreadyMapped) continue;

        // Use multi-strategy matcher
        const pos = findTextPosition(originalText, bit.fullText);
        if (pos) {
          coveredRanges.push({ startChar: pos.startChar, endChar: pos.endChar });
          console.log(`[${logPrefix} ${pass}] Fallback position for "${bit.title}": ${pos.startChar}-${pos.endChar} (${pos.strategy})`);
        } else if (trackFailedBits) {
          // Track as failed for retry next pass
          failedBits.push({ fullText: bit.fullText, pass });
          console.warn(`[${logPrefix} ${pass}] Could not locate "${bit.title}" — queued for retry`);
        } else {
          console.warn(`[${logPrefix} ${pass}] Could not locate "${bit.title}" in original text`);
        }
      }
      if (coveredRanges.length > prevRangeCount) {
        console.log(`[${logPrefix} ${pass}] Fallback added ${coveredRanges.length - prevRangeCount} range(s)`);
      }
    }

    console.log(`[${logPrefix} ${pass}] Subtracted ${bitsSubtracted} bit texts (${coveredRanges.length} position ranges). Total subtracted: ${foundBitTexts.length}`);

    // Check if the remaining text actually shrunk — if not, we're stuck
    const nextRemaining = getRemainingText();
    if (nextRemaining.length >= remainingText.length - 10) {
      console.warn(`[${logPrefix} ${pass}] Text didn't shrink after subtraction (${remainingText.length} → ${nextRemaining.length}). Stopping to avoid infinite loop.`);
      break;
    }

    pass++;
  }

  // Calculate coverage
  const remainingAfter = getRemainingText();
  const subtractedChars = originalText.length - remainingAfter.length;
  const coveragePercent = Math.round((subtractedChars / originalText.length) * 100);

  return {
    foundBitTexts,
    coveragePercent,
    passes: pass,
    frozeOut: consecutiveFreezes >= maxConsecutiveFreezes,
  };
}
