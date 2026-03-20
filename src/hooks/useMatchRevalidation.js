import { useCallback, useRef } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_MATCH_PAIR } from "../utils/prompts";
import { saveVaultState } from "../utils/database";

export function useMatchRevalidation(ctx) {
  const { dispatch, stateRef, addDebugEntry } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const revalidateMatchesRef = useRef(null);
  const revalidateTimerRef = useRef(null);
  const revalidatePendingBitsRef = useRef(new Set());

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
    const toUpdate = [];

    for (const match of affectedMatches) {
      const bitA = bitsById.get(match.sourceId);
      const bitB = bitsById.get(match.targetId);
      if (!bitA || !bitB) {
        toRemove.add(match.id);
        continue;
      }

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
      }
    }

    if (toRemove.size === 0 && toUpdate.length === 0) {
      console.log("[Revalidate] All matches still valid");
      set('status', `All ${affectedMatches.length} match(es) still valid after boundary change`);
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

    const s = stateRef.current;
    await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }).catch(console.error);

    const msg = [];
    if (toRemove.size > 0) msg.push(`removed ${toRemove.size} stale`);
    if (toUpdate.length > 0) msg.push(`updated ${toUpdate.length}`);
    console.log(`[Revalidate] Done: ${msg.join(", ")}`);
    set('status', `Match revalidation: ${msg.join(", ")}`);
  }, []);
  revalidateMatchesRef.current = revalidateMatchesForBits;

  const debouncedRevalidate = useCallback((bitIds) => {
    for (const id of bitIds) revalidatePendingBitsRef.current.add(id);
    if (revalidateTimerRef.current) clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = setTimeout(() => {
      const pending = [...revalidatePendingBitsRef.current];
      revalidatePendingBitsRef.current.clear();
      revalidateTimerRef.current = null;
      if (pending.length === 0) return;
      const s = stateRef.current;
      revalidateMatchesRef.current?.(pending, s.topics, s.matches);
    }, 30000);
  }, []);

  return { revalidateMatchesForBits, debouncedRevalidate, revalidateMatchesRef };
}
