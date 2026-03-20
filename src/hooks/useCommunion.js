import { useCallback } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_MATCH_PAIR, SYSTEM_TOUCHSTONE_COMMUNE, SYSTEM_SYNTHESIZE_TOUCHSTONE } from "../utils/prompts";
import { saveVaultState } from "../utils/database";

export function useCommunion(ctx) {
  const { dispatch, stateRef, addDebugEntry, setShouldStop } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

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
      if (!other) { toRemove.add(match.id); continue; }

      set('status', `Communing "${bit.title}": ${i + 1}/${affectedMatches.length} — vs "${other.title}"...`);

      try {
        const userMsg = `BIT A:\nTitle: ${bit.title}\nFull text: ${bit.fullText}\n\nBIT B:\nTitle: ${other.title}\nFull text: ${other.fullText}`;
        const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const matchData = Array.isArray(result) ? result[0] : result;

        if (!matchData || typeof matchData.match_percentage !== "number") {
          toRemove.add(match.id); continue;
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
      set('status', `All ${affectedMatches.length} connection(s) for "${bit.title}" verified — all legit.`);
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
    await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);

    const msg = [];
    if (toRemove.size > 0) msg.push(`removed ${toRemove.size} false`);
    if (toUpdate.length > 0) msg.push(`updated ${toUpdate.length}`);
    set('status', `Communed "${bit.title}": ${msg.join(", ")} match(es).`);
    return { removed: toRemove.size, updated: toUpdate.length };
  }, []);

  const handleMassCommunion = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    const bitIdsWithMatches = new Set();
    for (const m of s.matches) { bitIdsWithMatches.add(m.sourceId); bitIdsWithMatches.add(m.targetId); }
    const matchCountMap = new Map();
    for (const m of s.matches) {
      matchCountMap.set(m.sourceId, (matchCountMap.get(m.sourceId) || 0) + 1);
      matchCountMap.set(m.targetId, (matchCountMap.get(m.targetId) || 0) + 1);
    }
    const bitsToCommune = s.topics
      .filter((t) => bitIdsWithMatches.has(t.id) && t.fullText?.trim())
      .sort((a, b) => (matchCountMap.get(b.id) || 0) - (matchCountMap.get(a.id) || 0));
    if (bitsToCommune.length === 0) { set('status', 'No bits with connections to commune.'); return; }

    set('processing', true);
    setShouldStop(false);
    console.log(`[MassCommunion] Starting: ${bitsToCommune.length} bits with connections, ${s.matches.length} total matches`);
    set('status', `Mass communion: ${bitsToCommune.length} bits to verify...`);

    const verifiedMatchIds = new Set();
    let totalRemoved = 0, totalUpdated = 0, totalVerified = 0;

    for (let bi = 0; bi < bitsToCommune.length; bi++) {
      if (stateRef.current.shouldStop) {
        set('status', `Mass communion stopped. Verified ${bi}/${bitsToCommune.length} bits. Removed ${totalRemoved}, updated ${totalUpdated}.`);
        break;
      }

      const bit = bitsToCommune[bi];
      const currentMatches = stateRef.current.matches;
      const bitMatches = currentMatches.filter(
        (m) => (m.sourceId === bit.id || m.targetId === bit.id) && !verifiedMatchIds.has(m.id)
      );
      if (bitMatches.length === 0) continue;
      for (const m of bitMatches) verifiedMatchIds.add(m.id);

      set('status', `Mass communion: ${bi + 1}/${bitsToCommune.length} — "${bit.title}" (${bitMatches.length} connections)...`);

      const bitsById = new Map(stateRef.current.topics.map((t) => [t.id, t]));
      const model = stateRef.current.selectedModel;
      let dirtyThisBit = false;

      for (let i = 0; i < bitMatches.length; i++) {
        if (stateRef.current.shouldStop) break;
        const match = bitMatches[i];
        const otherId = match.sourceId === bit.id ? match.targetId : match.sourceId;
        const other = bitsById.get(otherId);
        if (!other) { update('matches', (prev) => prev.filter((m) => m.id !== match.id)); totalRemoved++; dirtyThisBit = true; totalVerified++; continue; }

        try {
          const userMsg = `BIT A:\nTitle: ${bit.title}\nFull text: ${bit.fullText}\n\nBIT B:\nTitle: ${other.title}\nFull text: ${other.fullText}`;
          const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
          const matchData = Array.isArray(result) ? result[0] : result;

          if (!matchData || typeof matchData.match_percentage !== "number") {
            update('matches', (prev) => prev.filter((m) => m.id !== match.id)); totalRemoved++; dirtyThisBit = true;
          } else {
            const mp = Math.round(matchData.match_percentage);
            const rel = matchData.relationship || "none";
            if (mp < 70 || (rel !== "same_bit" && rel !== "evolved")) {
              update('matches', (prev) => prev.filter((m) => m.id !== match.id)); totalRemoved++; dirtyThisBit = true;
            } else if (mp !== match.matchPercentage || rel !== match.relationship) {
              update('matches', (prev) => prev.map((m) =>
                m.id === match.id ? { ...m, matchPercentage: mp, confidence: mp / 100, relationship: rel, reason: matchData.reason || match.reason } : m
              )); totalUpdated++; dirtyThisBit = true;
            }
          }
        } catch (err) {
          if (err.name === "AbortError") break;
          console.warn(`[MassCommunion] LLM error for "${other.title}":`, err.message);
        }
        totalVerified++;
      }

      if (dirtyThisBit) {
        const s2 = stateRef.current;
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
      }
    }

    set('processing', false);
    setShouldStop(false);
    set('status', `Mass communion complete: ${totalVerified} matches verified, ${totalRemoved} removed, ${totalUpdated} updated.`);
  }, []);

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

    set('status', `Communing "${ts.name}": evaluating ${instances.length} instance(s)...`);

    let totalBlessed = 0, totalDamned = 0, totalRemoved = 0, totalSainted = 0;

    for (let i = 0; i < instances.length; i++) {
      if (stateRef.current.shouldStop) break;

      const instance = instances[i];
      if (instance.communionStatus === 'sainted') { totalSainted++; continue; }
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

        const raw = await callOllama(SYSTEM_TOUCHSTONE_COMMUNE, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const result = Array.isArray(raw) ? raw[0] : raw;
        if (!result || typeof result !== 'object') continue;

        const userScore = typeof result.user_criteria_score === 'number' ? result.user_criteria_score : null;
        const genScore = typeof result.generated_criteria_score === 'number' ? result.generated_criteria_score : 50;

        let finalScore;
        if (hasUserCriteria && userScore !== null) {
          finalScore = Math.round(userScore * 0.51 + genScore * 0.49);
        } else {
          finalScore = genScore;
        }

        const status = finalScore >= 70 ? 'blessed' : finalScore >= 40 ? 'damned' : 'removed';
        res = { bitId: instance.bitId, score: finalScore, reasoning: result.reasoning || '', userScore, generatedScore: genScore, status };
      } catch (err) {
        const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
        set('status', `Communing "${ts.name}": ${isTimeout ? 'timeout' : 'error'} on "${bit.title}", skipping...`);
        continue;
      }

      if (res.status === 'blessed') totalBlessed++;
      else if (res.status === 'damned') totalDamned++;
      else if (res.status === 'removed') totalRemoved++;

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
            inst.bitId === res.bitId ? { ...inst, communionScore: res.score, communionReasoning: res.reasoning, communionStatus: res.status } : inst
          );
          newBitIds = t.bitIds;
          newCoreBitIds = t.coreBitIds;
          newRemovedBitIds = t.removedBitIds;
        }
        if (newInstances.length === 0 && !t.manual) return null;
        return { ...t, instances: newInstances, bitIds: newBitIds, coreBitIds: newCoreBitIds, frequency: newInstances.length, sourceCount: new Set(newInstances.map((inst) => inst.sourceFile)).size, removedBitIds: newRemovedBitIds };
      }).filter(Boolean);
      const updatedTouchstones = {
        confirmed: applySingle(curTouchstones.confirmed || []),
        possible: applySingle(curTouchstones.possible || []),
        rejected: applySingle(curTouchstones.rejected || []),
      };

      set('touchstones', updatedTouchstones);
      const s2 = stateRef.current;
      await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);
    }

    set('status', `Communed "${ts.name}": ${totalBlessed} blessed, ${totalDamned} damned, ${totalRemoved} removed, ${totalSainted} sainted (skipped)`);
    return { blessed: totalBlessed, damned: totalDamned, removed: totalRemoved, sainted: totalSainted };
  }, []);

  const handleSynthesizeTouchstone = useCallback(async (touchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const ts = allTs.find((t) => t.id === touchstoneId);
    if (!ts || (ts.instances || []).length === 0) return;

    const model = stateRef.current.selectedModel;
    const trustedInstances = (ts.instances || []).filter((i) => i.communionStatus === 'sainted' || i.communionStatus === 'blessed');
    const instancesToUse = trustedInstances.length >= 1 ? trustedInstances : ts.instances;
    const instanceBits = instancesToUse.map((i) => s.topics.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return;

    const corrections = ts.corrections || [];
    const applyCorrections = (text) => {
      if (!text || corrections.length === 0) return text;
      let result = text;
      for (const c of corrections) { result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to); }
      return result;
    };

    const instanceTexts = instanceBits.map((b, idx) =>
      `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${applyCorrections(b.fullText || b.summary)}`
    ).join('\n\n---\n\n');

    const userMsg = `TOUCHSTONE: "${ts.name}"\n\n${instanceBits.length} performance${instanceBits.length > 1 ? 's' : ''} of the same bit:\n\n${instanceTexts}`;

    try {
      set('processing', true);
      set('status', `Synthesizing ideal text for "${ts.name}"...`);
      const raw = await callOllama(SYSTEM_SYNTHESIZE_TOUCHSTONE, userMsg, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
      const result = Array.isArray(raw) ? raw[0] : raw;
      if (!result || typeof result !== 'object' || !result.idealText) {
        set('status', `Failed to synthesize ideal text for "${ts.name}" — invalid response.`);
        set('processing', false);
        return;
      }

      update('touchstones', (prev) => {
        const updateIn = (list) => list.map((t) => {
          if (t.id !== touchstoneId) return t;
          if (t.manualIdealText) return t;
          return { ...t, idealText: result.idealText, idealTextNotes: result.notes || '' };
        });
        return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
      });

      const s2 = stateRef.current;
      await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
      set('status', `Synthesized ideal text for "${ts.name}".`);
      set('processing', false);
    } catch (err) {
      set('status', `Synthesis failed: ${err.message}`);
      set('processing', false);
    }
  }, []);

  const handleMassTouchstoneCommunion = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const eligible = allTs.filter((t) =>
      (t.instances || []).length > 0 &&
      ((t.userReasons || []).length > 0 || (t.matchInfo?.reasons || []).length > 0)
    );
    if (eligible.length === 0) { set('status', 'No touchstones with criteria to commune.'); return; }

    set('processing', true);
    setShouldStop(false);
    set('status', `Mass touchstone communion: ${eligible.length} touchstones to evaluate...`);

    let totalBlessed = 0, totalDamned = 0, totalRemoved = 0;

    for (let i = 0; i < eligible.length; i++) {
      if (stateRef.current.shouldStop) {
        set('status', `Mass touchstone communion stopped at ${i}/${eligible.length}.`);
        break;
      }
      set('status', `Mass touchstone communion: ${i + 1}/${eligible.length} — "${eligible[i].name}"...`);
      try {
        const result = await handleCommuneTouchstone(eligible[i].id);
        if (result) { totalBlessed += result.blessed; totalDamned += result.damned; totalRemoved += result.removed; }
      } catch (err) { console.warn(`[MassTouchstoneCommunion] Error on "${eligible[i].name}":`, err.message); }
    }

    set('processing', false);
    setShouldStop(false);
    set('status', `Mass touchstone communion complete: ${eligible.length} touchstones, ${totalBlessed} blessed, ${totalDamned} damned, ${totalRemoved} removed.`);
  }, [handleCommuneTouchstone]);

  return { handleCommuneBit, handleMassCommunion, handleCommuneTouchstone, handleSynthesizeTouchstone, handleMassTouchstoneCommunion };
}
