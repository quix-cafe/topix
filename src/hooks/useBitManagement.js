import { useCallback } from "react";
import { callOllama, callOllamaStream, uid } from "../utils/ollama";
import { SYSTEM_PARSE_V2 } from "../utils/prompts";
import { saveVaultState } from "../utils/database";

export function useBitManagement(ctx, matchBitLiveRef, setApprovedGaps, embeddingStore) {
  const { dispatch, stateRef, addDebugEntry } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const handleDeleteBit = useCallback(async (bitId) => {
    const s = stateRef.current;
    const updatedTopics = s.topics.filter((t) => t.id !== bitId);
    const updatedMatches = s.matches.filter((m) => m.sourceId !== bitId && m.targetId !== bitId);
    console.log(`[Mix] Deleted bit ${bitId}`);
    embeddingStore?.invalidate(bitId);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving after delete:", err); }
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

    try {
      const result = await callOllama(SYSTEM_PARSE_V2, `Parse this comedy transcript excerpt:\n\n${fullText}`, () => {}, s.selectedModel, s.debugMode ? addDebugEntry : null);
      const parsed = Array.isArray(result) ? result[0] : result;
      if (parsed) {
        const final = { ...newBit, title: parsed.title || newBit.title, summary: parsed.summary || "", tags: parsed.tags || [], keywords: parsed.keywords || [] };
        const latest = stateRef.current;
        const updated = latest.topics.map((t) => t.id === newBit.id ? final : t);
        dispatch({ type: 'MERGE', payload: { topics: updated } });
        await saveVaultState({ topics: updated, matches: latest.matches, transcripts: latest.transcripts, touchstones: latest.touchstones });
      }
    } catch (err) {
      console.error("[PhantomBit] LLM metadata failed:", err);
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    }
  }, []);

  const handleReParseGap = useCallback(async (fullText, startChar, endChar, sourceFile, transcriptId) => {
    const s = stateRef.current;
    const gapSize = endChar - startChar;
    set('status', `Re-parsing gap (${gapSize} chars) in "${sourceFile}"...`);
    set('streamingProgress', { status: "parsing", currentBit: 0, totalBits: 0, streamedText: "", transcriptName: sourceFile });
    update('foundBits', () => []);

    // Get the full transcript text for position reconciliation
    const transcript = s.transcripts.find((tr) => tr.name === sourceFile || tr.id === transcriptId);
    const cleanTranscript = transcript ? transcript.text.replace(/\n/g, " ") : "";

    const allFoundBits = [];
    let error = null;
    let totalBitCount = 0;

    // Parse in a loop: after each LLM call, check for remaining uncovered gap text
    // and re-parse until the entire gap is covered (or no progress is made)
    let remainingStart = startChar;
    const MAX_PASSES = 5;
    const MIN_REMAINING_CHARS = 40; // Don't re-parse tiny leftover fragments

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      if (remainingStart >= endChar - MIN_REMAINING_CHARS) break;

      const currentGapText = cleanTranscript
        ? cleanTranscript.substring(remainingStart, endChar)
        : (pass === 0 ? fullText : fullText.substring(remainingStart - startChar));

      if (currentGapText.trim().length < MIN_REMAINING_CHARS) break;

      const passLabel = pass > 0 ? ` (pass ${pass + 1}, remaining ${endChar - remainingStart} chars)` : "";
      set('status', `Re-parsing gap (${gapSize} chars) in "${sourceFile}"${passLabel}...`);

      const passBits = [];

      await new Promise((resolve) => {
        callOllamaStream(
          SYSTEM_PARSE_V2,
          `Parse this comedy transcript excerpt:\n\n${currentGapText}`,
          {
            onChunk: (fullAccumulatedText) => {
              update('streamingProgress', (prev) => ({ ...prev, streamedText: fullAccumulatedText.slice(-1600) }));
            },
            onBitFound: (bit, count) => {
              totalBitCount++;
              update('streamingProgress', (prev) => ({ ...prev, currentBit: totalBitCount }));
              const llmStart = remainingStart + (bit.textPosition?.startChar || 0);
              const llmEnd = remainingStart + (bit.textPosition?.endChar || (bit.fullText?.length || 0));
              const llmText = (bit.fullText || "").trim();

              // Reconcile: LLM's fullText and position are both approximate.
              let finalStart = llmStart, finalEnd = llmEnd, finalText = bit.fullText;

              if (cleanTranscript && llmText) {
                // Try exact match within the current gap region first (most constrained)
                const gapExact = currentGapText.indexOf(llmText);
                if (gapExact !== -1) {
                  finalStart = remainingStart + gapExact;
                  finalEnd = finalStart + llmText.length;
                  finalText = llmText;
                } else {
                  // Try exact match anywhere in transcript
                  const exactPos = cleanTranscript.indexOf(llmText);
                  if (exactPos !== -1 && exactPos >= remainingStart && exactPos < endChar) {
                    finalStart = exactPos;
                    finalEnd = exactPos + llmText.length;
                    finalText = llmText;
                  } else {
                    // LLM text doesn't match transcript exactly — use transcript text at LLM's position
                    // Clamp to gap bounds
                    finalStart = Math.max(remainingStart, Math.min(llmStart, endChar));
                    finalEnd = Math.max(finalStart, Math.min(llmEnd, endChar));
                    if (finalEnd > finalStart) {
                      finalText = cleanTranscript.substring(finalStart, finalEnd);
                    }
                  }
                }
              }

              const newBit = {
                id: uid(),
                title: bit.title || `Untitled bit ${totalBitCount}`,
                summary: bit.summary || "",
                fullText: finalText,
                tags: bit.tags || [],
                keywords: bit.keywords || [],
                textPosition: { startChar: finalStart, endChar: finalEnd },
                sourceFile,
                transcriptId,
                editHistory: [{ timestamp: Date.now(), action: "reparse_gap", details: { startChar: finalStart, endChar: finalEnd } }],
              };
              passBits.push(newBit);
              allFoundBits.push(newBit);
              update('foundBits', (prev) => [...prev, newBit]);

              const latest = stateRef.current;
              const updatedTopics = [...latest.topics, newBit];
              dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
              saveVaultState({ topics: updatedTopics, matches: latest.matches, transcripts: latest.transcripts, touchstones: latest.touchstones }).catch(console.error);
            },
            onFrozen: () => resolve(),
            onError: (err) => { error = err; resolve(); },
            onDebug: s.debugMode ? addDebugEntry : null,
          },
          s.selectedModel,
          null,
          30000,
        ).then(() => resolve()).catch((err) => { error = err; resolve(); });
      });

      if (error) break;
      if (passBits.length === 0) break; // LLM found nothing — stop

      // Advance remainingStart past all bits found in this pass
      const maxEndFound = Math.max(...passBits.map(b => b.textPosition.endChar));
      if (maxEndFound <= remainingStart) break; // No progress — stop
      remainingStart = maxEndFound;

      console.log(`[ReParseGap] Pass ${pass + 1}: found ${passBits.length} bit(s), covered up to ${remainingStart}/${endChar}`);
    }

    set('streamingProgress', null);

    if (error) {
      set('status', `Re-parse failed: ${error.message}`);
    } else if (allFoundBits.length === 0) {
      set('status', 'Re-parse returned no bits.');
    } else {
      const remaining = endChar - remainingStart;
      const suffix = remaining > MIN_REMAINING_CHARS ? ` (${remaining} chars uncovered)` : "";
      set('status', `Re-parsed gap into ${allFoundBits.length} bit${allFoundBits.length !== 1 ? 's' : ''}${suffix}.`);
      setApprovedGaps((prev) => {
        const prefix = `${sourceFile}:`;
        const next = prev.filter(key => {
          if (!key.startsWith(prefix)) return true;
          const [s, e] = key.slice(prefix.length).split("-").map(Number);
          if (isNaN(s) || isNaN(e)) return true;
          return e <= startChar || s >= endChar;
        });
        if (next.length !== prev.length) {
          try { localStorage.setItem("topix-approved-gaps", JSON.stringify(next)); } catch {}
        }
        return next;
      });
    }
  }, []);

  return { handleDeleteBit, handleAddPhantomBit, handleReParseGap };
}
