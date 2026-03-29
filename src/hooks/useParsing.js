import { useCallback } from "react";
import { callOllama, callOllamaStream, calculateCharPosition, uid } from "../utils/ollama";
import { findTextPosition } from "../utils/textMatcher";
import { SYSTEM_PARSE_V3 } from "../utils/prompts";
import { saveSingleTopic } from "../utils/database";
import { absorbOrMerge } from "../utils/autoDedup";
import { runParseLoop } from "../utils/parseLoop";

export function useParsing(ctx, matchBitLiveRef) {
  const { dispatch, stateRef, addDebugEntry, setShouldStop, opQueue, abortControllerRef } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const processRemainingText = useCallback(async (tr, textToProcess, pass = 1, controller = null, segmentMap = null) => {
    console.log(`[Pass ${pass}] Processing ${textToProcess.length} characters from unidentified ranges`);

    if (textToProcess.trim().length === 0) {
      return { foundBits: [], mappedPositions: [], froze: false, error: null };
    }

    const originalText = tr.text.replace(/\n/g, " ");
    const selectedModel = stateRef.current.selectedModel;
    const debugMode = stateRef.current.debugMode;
    const matchBitLive = matchBitLiveRef.current;

    const mapToOriginal = (posInRemaining) => {
      if (!segmentMap || segmentMap.length === 0) return null;
      for (const seg of segmentMap) {
        if (posInRemaining >= seg.remStart && posInRemaining < seg.remEnd) {
          return seg.origStart + (posInRemaining - seg.remStart);
        }
      }
      return null;
    };

    let foundBits = [];
    let mappedPositions = [];
    let froze = false;
    let error = null;

    const sessionController = controller || new AbortController();
    const parsePromise = new Promise((resolve) => {
      callOllamaStream(
        SYSTEM_PARSE_V3,
        `Parse this comedy transcript:\n\n${textToProcess}`,
        {
          onChunk: (fullAccumulatedText) => {
            update('streamingProgress', (prev) => ({ ...prev, streamedText: fullAccumulatedText.slice(-1600) }));
          },
          onBitFound: (bit, count) => {
            update('streamingProgress', (prev) => ({ ...prev, currentBit: count }));
            foundBits.push(bit);
            update('foundBits', (prev) => [...prev, bit]);

            let textPosition = bit.textPosition;
            let actualFullText = bit.fullText;

            if (actualFullText && actualFullText.trim()) {
              const posResult = findTextPosition(originalText, actualFullText);
              if (posResult) {
                const extractedText = originalText.substring(posResult.startChar, posResult.endChar);
                if (posResult.confidence >= 0.8) {
                  const normalize = (t) => t.trim().replace(/\s+/g, " ");
                  if (normalize(extractedText) === normalize(actualFullText)) {
                    textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                  } else {
                    textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                    actualFullText = extractedText;
                  }
                } else {
                  textPosition = null;
                }
                mappedPositions.push({ startChar: posResult.startChar, endChar: posResult.endChar });
              } else {
                const posInRemaining = calculateCharPosition(textToProcess, actualFullText);
                if (posInRemaining && segmentMap) {
                  const origStart = mapToOriginal(posInRemaining.startChar);
                  const origEnd = mapToOriginal(posInRemaining.endChar - 1);
                  if (origStart != null && origEnd != null) {
                    textPosition = { startChar: origStart, endChar: origEnd + 1 };
                    actualFullText = originalText.substring(textPosition.startChar, textPosition.endChar);
                    mappedPositions.push({ startChar: textPosition.startChar, endChar: textPosition.endChar });
                  } else { textPosition = null; }
                } else { textPosition = null; }
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

            saveSingleTopic(enhancedBit).catch((err) => console.error("[DB] Immediate save failed:", err));

            if (isIncomplete && enhancedBit.fullText) {
              callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${enhancedBit.fullText}`, () => {}, selectedModel, debugMode ? addDebugEntry : null)
                .then((result) => {
                  const parsed = Array.isArray(result) ? result[0] : result;
                  if (parsed) {
                    update('topics', (prev) => prev.map((t) =>
                      t.id === enhancedBit.id ? { ...t, title: parsed.title || t.title, summary: parsed.summary || t.summary, tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : t.tags, keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : t.keywords } : t
                    ));
                  }
                }).catch((err) => console.warn("[Re-enrich] Failed:", err.message));
            }

            opQueue.enqueue(async () => {
              const s = stateRef.current;
              try {
                const dedupResult = await absorbOrMerge(enhancedBit, s.topics, callOllama, selectedModel);
                if (dedupResult.action === "absorbed") return;
                if (dedupResult.action === "absorbed_existing") {
                  update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), enhancedBit]);
                } else if (dedupResult.action === "merged") {
                  update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), dedupResult.keptBit]);
                } else {
                  update('topics', (prev) => [...prev, enhancedBit]);
                }
                if (dedupResult.action === "none" && stateRef.current.topics.length > 0) {
                  matchBitLive?.(enhancedBit, stateRef.current.topics, sessionController.signal).catch((err) => { if (err.name !== "AbortError") console.error("Live match error:", err); });
                }
              } catch (err) {
                update('topics', (prev) => [...prev, enhancedBit]);
                matchBitLive?.(enhancedBit, stateRef.current.topics, sessionController.signal).catch((e) => { if (e.name !== "AbortError") console.error("Live match error:", e); });
              }
            }).catch((err) => console.error("[OpQueue] Bit processing error:", err));
          },
          onComplete: (bits) => {
            if (bits && Array.isArray(bits)) {
              for (const bit of bits) {
                const norm = t => t.replace(/\s+/g, ' ').trim().toLowerCase();
                const isDuplicate = foundBits.some(fb => {
                  if (fb.fullText === bit.fullText) return true;
                  if (norm(fb.fullText) === norm(bit.fullText)) return true;
                  const words1 = new Set(norm(fb.fullText).split(' '));
                  const words2 = new Set(norm(bit.fullText).split(' '));
                  const intersection = [...words1].filter(w => words2.has(w)).length;
                  const union = new Set([...words1, ...words2]).size;
                  return union > 0 && intersection / union > 0.85;
                });
                if (!isDuplicate) {
                  foundBits.push(bit);
                  if (pass > 1) continue;

                  let textPosition = bit.textPosition;
                  let actualFullText = bit.fullText;
                  if (actualFullText && actualFullText.trim()) {
                    const posResult = findTextPosition(originalText, actualFullText);
                    if (posResult) {
                      if (posResult.confidence >= 0.8) textPosition = { startChar: posResult.startChar, endChar: posResult.endChar };
                      mappedPositions.push({ startChar: posResult.startChar, endChar: posResult.endChar });
                    }
                  }

                  const enhancedBit = {
                    ...bit, id: uid(), sourceFile: tr.name, transcriptId: tr.id,
                    fullText: actualFullText, textPosition: textPosition || { startChar: 0, endChar: 0 },
                    editHistory: [], parsedWithModel: selectedModel, timestamp: Date.now(),
                  };

                  saveSingleTopic(enhancedBit).catch((err) => console.error("[DB] Immediate save failed:", err));

                  absorbOrMerge(enhancedBit, stateRef.current.topics, callOllama, selectedModel).then((dedupResult) => {
                    if (dedupResult.action === "absorbed") return;
                    if (dedupResult.action === "absorbed_existing") {
                      update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), enhancedBit]);
                    } else if (dedupResult.action === "merged") {
                      update('topics', (prev) => [...prev.filter((t) => t.id !== dedupResult.removedId), dedupResult.keptBit]);
                    } else {
                      update('topics', (prev) => [...prev, enhancedBit]);
                    }
                    if (dedupResult.action === "none" && stateRef.current.topics.length > 0) {
                      matchBitLive?.(enhancedBit, s2.topics, sessionController.signal).catch((err) => { if (err.name !== "AbortError") console.error("Live match error:", err); });
                    }
                  }).catch((err) => {
                    update('topics', (prev) => [...prev, enhancedBit]);
                  });
                }
              }
            }
            resolve({ success: true });
          },
          onFrozen: () => { froze = true; resolve({ success: true }); },
          onError: (err) => { error = err; resolve({ success: false }); },
          onDebug: debugMode ? addDebugEntry : null,
        },
        selectedModel,
        sessionController,
        30000,
      ).catch((err) => {
        console.warn(`[Pass ${pass}] callOllamaStream rejected (handled via callbacks):`, err.message);
      });
    });

    try {
      await parsePromise;
      return { foundBits, mappedPositions, froze, error };
    } catch (err) {
      console.error(`[Pass ${pass}] Unexpected error:`, err);
      throw err;
    }
  }, [addDebugEntry]);

  const parseAll = useCallback(async (transcriptSubset) => {
    const toProcess = transcriptSubset || stateRef.current.transcripts;
    if (toProcess.length === 0) { set('status', "No transcripts to parse."); return; }

    set('processing', true);
    setShouldStop(false);
    set('foundBits', []);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const selectedModel = stateRef.current.selectedModel;

    for (const tr of toProcess) {
      if (stateRef.current.shouldStop) { set('status', "Processing stopped by user."); break; }

      try {
        try { sessionStorage.setItem("topix-parsing", JSON.stringify({ transcript: tr.name, startedAt: Date.now() })); } catch {}
        set('status', `Parsing "${tr.name}" with ${selectedModel}...`);
        set('huntProgress', null);
        set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "" });

        const originalText = tr.text.replace(/\n/g, " ");
        const coveredRanges = [];
        for (const bit of stateRef.current.topics) {
          if (bit.sourceFile === tr.name && bit.textPosition && bit.textPosition.endChar > bit.textPosition.startChar) {
            coveredRanges.push({ startChar: bit.textPosition.startChar, endChar: bit.textPosition.endChar });
          }
        }

        const { foundBitTexts, coveragePercent, passes, frozeOut } = await runParseLoop({
          transcript: tr, originalText, coveredRanges, processRemainingText, controller,
          shouldStopFn: () => stateRef.current.shouldStop,
          onStatus: (msg) => set('status', `"${tr.name}" ${msg}`),
          findTextPosition,
          onFreezeRollback: (lastBit) => {
            update('topics', prev => prev.filter(t => t.fullText !== lastBit.fullText));
          },
          selectedModel,
          logPrefix: "Parse",
        });

        if (frozeOut) set('status', `"${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage (stopped: Ollama kept freezing)`);
        else if (passes > 20) set('status', `"${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage (max passes reached)`);
        else set('status', `"${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage`);
      } catch (err) {
        set('status', `Error parsing "${tr.name}": ${err.message}`);
      }
    }

    try { sessionStorage.removeItem("topix-parsing"); } catch {}
    if (!stateRef.current.shouldStop) set('status', "Done! Bits parsed and matched in real-time. Check the Database and Graph tabs.");
    set('streamingProgress', null);
    set('processing', false);
    setShouldStop(false);
    abortControllerRef.current = null;
  }, [processRemainingText]);

  const parseUnparsed = useCallback(() => {
    const s = stateRef.current;
    const unparsed = s.transcripts.filter((tr) => !s.topics.some((t) => t.sourceFile === tr.name || t.transcriptId === tr.id));
    if (unparsed.length === 0) { set('status', "All transcripts already parsed."); return; }
    return parseAll(unparsed);
  }, [parseAll]);

  const reParseTranscript = useCallback(async (tr) => {
    setShouldStop(false);
    set('processing', true);
    set('huntProgress', null);
    set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "" });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const selectedModel = stateRef.current.selectedModel;

    try {
      // Clear existing bits, their matches, and stale references from touchstones
      const existingBitIds = new Set(stateRef.current.topics.filter(t => t.sourceFile === tr.name || t.transcriptId === tr.id).map(t => t.id));
      if (existingBitIds.size > 0) {
        update('topics', prev => prev.filter(t => !existingBitIds.has(t.id)));
        update('matches', prev => prev.filter(m => !existingBitIds.has(m.sourceId) && !existingBitIds.has(m.targetId)));
        // Remove stale bit IDs from touchstones so absorption/overlap detection works with new bits
        update('touchstones', prev => {
          const clean = list => (list || []).map(ts => {
            const staleBits = ts.bitIds.filter(id => existingBitIds.has(id));
            if (staleBits.length === 0) return ts;
            return {
              ...ts,
              bitIds: ts.bitIds.filter(id => !existingBitIds.has(id)),
              instances: ts.instances.filter(i => !existingBitIds.has(i.bitId)),
              frequency: ts.instances.filter(i => !existingBitIds.has(i.bitId)).length,
            };
          });
          return { confirmed: clean(prev.confirmed), possible: clean(prev.possible), rejected: prev.rejected || [] };
        });
      }

      set('status', `Re-parsing "${tr.name}" with ${selectedModel}...`);
      const originalText = tr.text.replace(/\n/g, " ");
      const coveredRanges = [];

      const { foundBitTexts, coveragePercent, passes } = await runParseLoop({
        transcript: tr, originalText, coveredRanges, processRemainingText, controller,
        shouldStopFn: () => stateRef.current.shouldStop,
        onStatus: (msg) => set('status', msg),
        findTextPosition,
        trackFailedBits: false, trackSeenHashes: false,
        onFreezeRollback: (lastBit) => {
          update('topics', prev => prev.filter(t => t.fullText !== lastBit.fullText));
        },
        selectedModel,
        logPrefix: "Re-parse",
      });

      set('status', `Re-parsed "${tr.name}": ${foundBitTexts.length} bits, ${coveragePercent}% coverage in ${passes} pass${passes > 1 ? 'es' : ''}`);
    } catch (err) {
      if (err.name !== "AbortError") set('status', `Error re-parsing "${tr.name}": ${err.message}`);
    } finally {
      set('processing', false);
      set('streamingProgress', null);
      abortControllerRef.current = null;
    }
  }, [processRemainingText]);

  return { processRemainingText, parseAll, parseUnparsed, reParseTranscript };
}
