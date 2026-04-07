import { useCallback } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_MATCH_PAIR, SYSTEM_TOUCHSTONE_COMMUNE, SYSTEM_SYNTHESIZE_TOUCHSTONE } from "../utils/prompts";
import { saveVaultState } from "../utils/database";
import { pruneWeakBits, recalcMatchScores, rebuildMatchInfo } from "../utils/touchstoneDetector";

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
    let generatedCriteria = ts.matchInfo?.reasons || [];

    // If reasons are bloated (raw pairwise match reasons, not consolidated),
    // deduplicate and cap to prevent sending 100+ criteria to the LLM.
    if (generatedCriteria.length > 8) {
      // Deduplicate by lowercase content
      const seen = new Set();
      const deduped = [];
      for (const r of generatedCriteria) {
        const key = r.toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); deduped.push(r); }
      }
      // Take most distinct reasons (first N after dedup — earlier reasons tend to be from stronger matches)
      generatedCriteria = deduped.slice(0, 6);
      console.log(`[Commune] Capped ${ts.matchInfo.reasons.length} raw reasons → ${generatedCriteria.length} for "${ts.name}". Run "Why Matched" to consolidate.`);
    }

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
          // Add synthesis result as a version
          const versions = [...(t.idealTextVersions || [])];
          versions.push({
            idealText: result.idealText,
            notes: result.notes || '',
            model,
            source: 'synthesis',
            date: new Date().toISOString(),
          });
          if (t.manualIdealText) return { ...t, idealTextVersions: versions };
          return { ...t, idealText: result.idealText, idealTextNotes: result.notes || '', idealTextVersions: versions };
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

  const handlePruneTouchstone = useCallback((touchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const ts = allTs.find(t => t.id === touchstoneId);
    if (!ts) return;

    // Step 1: Recalc match scores for this touchstone's bits (caps inflated LLM scores)
    const bitIdSet = new Set(ts.bitIds);
    const touchstoneMatches = s.matches.filter(m => bitIdSet.has(m.sourceId) && bitIdSet.has(m.targetId));
    const otherMatches = s.matches.filter(m => !(bitIdSet.has(m.sourceId) && bitIdSet.has(m.targetId)));
    const { updated: recalcedMatches, stats: recalcStats } = recalcMatchScores(touchstoneMatches, s.topics);
    const updatedMatches = [...otherMatches, ...recalcedMatches];

    // Step 2: Rebuild touchstone matchInfo from recalced matches
    const rebuiltTs = rebuildMatchInfo(ts, recalcedMatches);

    // Step 3: Prune weak bits using corrected match data
    const { pruned, removed, details } = pruneWeakBits(rebuiltTs, updatedMatches, s.topics);

    for (const d of details) {
      console.log(`[Prune] Removed "${d.title}": anchorSim=${(d.anchorSim * 100).toFixed(0)}%, avgSim=${(d.avgSim * 100).toFixed(0)}%, neighbors=${d.neighbors}, threshold=${(d.threshold * 100).toFixed(0)}%`);
    }

    // Step 4: Rebuild matchInfo again on the pruned result
    const remainingBitIds = new Set(pruned.bitIds);
    const finalTsMatches = updatedMatches.filter(m => remainingBitIds.has(m.sourceId) && remainingBitIds.has(m.targetId));
    const finalTs = rebuildMatchInfo(pruned, finalTsMatches);

    const curTouchstones = stateRef.current.touchstones;
    const applyUpdate = (list) => list.map(t => t.id === touchstoneId ? finalTs : t).filter(Boolean);
    const updatedTouchstones = {
      confirmed: applyUpdate(curTouchstones.confirmed || []),
      possible: applyUpdate(curTouchstones.possible || []),
      rejected: applyUpdate(curTouchstones.rejected || []),
    };

    dispatch({ type: 'MERGE', payload: { touchstones: updatedTouchstones, matches: updatedMatches } });

    const s2 = stateRef.current;
    saveVaultState({ topics: s2.topics, matches: updatedMatches, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);

    const scoreParts = [];
    if (recalcStats.capped > 0) scoreParts.push(`${recalcStats.capped} scores capped`);
    if (recalcStats.downgraded > 0) scoreParts.push(`${recalcStats.downgraded} downgraded`);
    if (recalcStats.removed > 0) scoreParts.push(`${recalcStats.removed} matches removed`);
    const prunePart = removed.length > 0 ? `removed ${removed.length} bit(s)` : 'no bits pruned';
    set('status', `"${ts.name}": ${prunePart}${scoreParts.length ? `, ${scoreParts.join(', ')}` : ''}.`);
    return { removed: removed.length };
  }, []);

  const handleMassPrune = useCallback(() => {
    const s = stateRef.current;
    const categories = ['confirmed', 'possible', 'rejected'];
    let totalRemoved = 0, totalPruned = 0, totalCapped = 0;

    let currentMatches = [...s.matches];
    const updatedTouchstones = { ...s.touchstones };

    for (const cat of categories) {
      updatedTouchstones[cat] = (s.touchstones[cat] || []).map(ts => {
        const bitIdSet = new Set(ts.bitIds);
        const tsMatches = currentMatches.filter(m => bitIdSet.has(m.sourceId) && bitIdSet.has(m.targetId));
        const otherMatches = currentMatches.filter(m => !(bitIdSet.has(m.sourceId) && bitIdSet.has(m.targetId)));
        const { updated: recalced, stats } = recalcMatchScores(tsMatches, s.topics);
        currentMatches = [...otherMatches, ...recalced];
        totalCapped += stats.capped;

        const rebuilt = rebuildMatchInfo(ts, recalced);
        const { pruned, removed, details } = pruneWeakBits(rebuilt, currentMatches, s.topics);
        if (removed.length > 0) {
          totalRemoved += removed.length;
          totalPruned++;
          for (const d of details) {
            console.log(`[MassPrune] "${ts.name}" → removed "${d.title}": anchorSim=${(d.anchorSim * 100).toFixed(0)}%, avgSim=${(d.avgSim * 100).toFixed(0)}%`);
          }
        }
        const remainingIds = new Set(pruned.bitIds);
        const finalMatches = currentMatches.filter(m => remainingIds.has(m.sourceId) && remainingIds.has(m.targetId));
        return rebuildMatchInfo(pruned, finalMatches);
      }).filter(Boolean);
    }

    if (totalRemoved === 0 && totalCapped === 0) {
      set('status', 'All touchstones well-connected — nothing to prune or recalc.');
      return;
    }

    dispatch({ type: 'MERGE', payload: { touchstones: updatedTouchstones, matches: currentMatches } });
    const s2 = stateRef.current;
    saveVaultState({ topics: s2.topics, matches: currentMatches, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);
    set('status', `Mass prune: ${totalPruned} touchstone(s) pruned (${totalRemoved} bits removed), ${totalCapped} match scores recalculated.`);
  }, []);

  const handleRecalcScores = useCallback(async () => {
    const s = stateRef.current;
    if (s.matches.length === 0) {
      set('status', 'No matches to recalculate.');
      return;
    }

    set('status', `Recalculating ${s.matches.length} match scores using text similarity...`);
    const { updated, stats } = recalcMatchScores(s.matches, s.topics);

    console.log(`[Recalc] ${stats.capped} capped, ${stats.downgraded} downgraded, ${stats.removed} removed, ${stats.unchanged} unchanged`);

    // Also rebuild matchInfo on all touchstones
    const rebuildAll = (list) => list.map(ts => rebuildMatchInfo(ts, updated));
    const updatedTouchstones = {
      confirmed: rebuildAll(s.touchstones.confirmed || []),
      possible: rebuildAll(s.touchstones.possible || []),
      rejected: rebuildAll(s.touchstones.rejected || []),
    };

    dispatch({ type: 'MERGE', payload: { matches: updated, touchstones: updatedTouchstones } });
    const s2 = stateRef.current;
    await saveVaultState({ topics: s2.topics, matches: updated, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);

    const parts = [];
    if (stats.capped > 0) parts.push(`${stats.capped} capped`);
    if (stats.downgraded > 0) parts.push(`${stats.downgraded} downgraded`);
    if (stats.removed > 0) parts.push(`${stats.removed} removed`);
    if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`);
    set('status', `Recalculated match scores: ${parts.join(', ')}.`);
  }, []);

  const handleRecalcBitConnections = useCallback(async (bitId) => {
    const s = stateRef.current;
    const bitMatches = s.matches.filter(m => m.sourceId === bitId || m.targetId === bitId);
    const otherMatches = s.matches.filter(m => m.sourceId !== bitId && m.targetId !== bitId);
    if (bitMatches.length === 0) {
      set('status', 'No connections to recalculate.');
      return;
    }

    const { updated, stats } = recalcMatchScores(bitMatches, s.topics);
    const newMatches = [...otherMatches, ...updated];

    // Rebuild matchInfo on touchstones that contain this bit
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const affectedTsIds = new Set(allTs.filter(ts => ts.bitIds.includes(bitId)).map(ts => ts.id));
    const rebuildIfAffected = (list) => list.map(ts => affectedTsIds.has(ts.id) ? rebuildMatchInfo(ts, newMatches) : ts);
    const updatedTouchstones = {
      confirmed: rebuildIfAffected(s.touchstones.confirmed || []),
      possible: rebuildIfAffected(s.touchstones.possible || []),
      rejected: rebuildIfAffected(s.touchstones.rejected || []),
    };

    dispatch({ type: 'MERGE', payload: { matches: newMatches, touchstones: updatedTouchstones } });
    const s2 = stateRef.current;
    await saveVaultState({ topics: s2.topics, matches: newMatches, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);

    const parts = [];
    if (stats.capped > 0) parts.push(`${stats.capped} capped`);
    if (stats.downgraded > 0) parts.push(`${stats.downgraded} downgraded`);
    if (stats.removed > 0) parts.push(`${stats.removed} removed`);
    if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`);
    set('status', `Recalculated ${bitMatches.length} connections: ${parts.join(', ')}.`);
  }, []);

  return { handleCommuneBit, handleMassCommunion, handleCommuneTouchstone, handleSynthesizeTouchstone, handleMassTouchstoneCommunion, handlePruneTouchstone, handleMassPrune, handleRecalcScores, handleRecalcBitConnections };
}
