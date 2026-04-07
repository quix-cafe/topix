import { useCallback } from "react";
import { callOllama, uid } from "../utils/ollama";
import { SYSTEM_HUNT_BATCH } from "../utils/prompts";

import { findSimilarBits } from "../utils/similaritySearch";
import { embedText } from "../utils/embeddings";
import { runHuntBatches } from "../utils/huntRunner";
import { recalcMatchScores } from "../utils/touchstoneDetector";

export function useHunting(ctx) {
  const { dispatch, stateRef, addDebugEntry, embeddingStore, huntControllerRef } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  /**
   * Immediately absorb a bit into any touchstone that contains a strong match target.
   * For confirmed touchstones, target must be core, sainted, or blessed.
   * For possible touchstones, any member qualifies.
   */
  const absorbIntoTouchstones = useCallback((bit, strongMatchTargets) => {
    if (strongMatchTargets.length === 0) return;
    const ts = stateRef.current.touchstones || {};
    const allTouchstones = [...(ts.confirmed || []), ...(ts.possible || [])];
    const absorbed = new Set();
    for (const { targetId, mp, rel } of strongMatchTargets) {
      for (const touchstone of allTouchstones) {
        if (absorbed.has(touchstone.id)) continue;
        if (!touchstone.bitIds.includes(targetId)) continue;
        if (touchstone.bitIds.includes(bit.id)) continue;
        const removedSet = new Set(touchstone.removedBitIds || []);
        if (removedSet.has(bit.id)) continue;

        // For confirmed touchstones, only absorb if target is core, sainted, or blessed
        if (touchstone.category === 'confirmed') {
          const coreSet = new Set(touchstone.coreBitIds || []);
          const saintedIds = new Set((touchstone.instances || []).filter(i => i.communionStatus === 'sainted').map(i => i.bitId));
          const blessedIds = new Set((touchstone.instances || []).filter(i => i.communionStatus === 'blessed').map(i => i.bitId));
          if (!coreSet.has(targetId) && !saintedIds.has(targetId) && !blessedIds.has(targetId)) continue;
        }

        absorbed.add(touchstone.id);
        const category = touchstone.category || 'possible';
        const newInstance = {
          bitId: bit.id, sourceFile: bit.sourceFile, title: bit.title,
          instanceNumber: touchstone.instances.length + 1,
          confidence: mp / 100, relationship: rel,
        };
        update('touchstones', (prev) => {
          const list = prev[category] || [];
          // Re-check in the updater since state may have changed between dispatch calls
          const existing = list.find(t => t.id === touchstone.id);
          if (!existing || existing.bitIds.includes(bit.id)) return prev;
          return {
            ...prev,
            [category]: list.map(t => t.id !== touchstone.id ? t : {
              ...t,
              bitIds: [...t.bitIds, bit.id],
              instances: [...t.instances, newInstance],
              frequency: t.instances.length + 1,
            }),
          };
        });
        console.log(`[Absorb] "${bit.title}" into ${category} "${touchstone.name}" (${mp}% ${rel})`);
      }
    }
  }, []);

  /**
   * Restricted absorption: only into confirmed touchstones during mass-hunt.
   * Possible touchstones are left for post-hunt detection to handle properly.
   */
  const absorbIntoConfirmed = useCallback((bit, strongMatchTargets) => {
    if (strongMatchTargets.length === 0) return;
    const ts = stateRef.current.touchstones || {};
    const confirmed = ts.confirmed || [];
    for (const { targetId, mp, rel } of strongMatchTargets) {
      for (const touchstone of confirmed) {
        if (!touchstone.bitIds.includes(targetId)) continue;
        if (touchstone.bitIds.includes(bit.id)) continue;
        const removedSet = new Set(touchstone.removedBitIds || []);
        if (removedSet.has(bit.id)) continue;
        const coreSet = new Set(touchstone.coreBitIds || []);
        const saintedIds = new Set((touchstone.instances || []).filter(i => i.communionStatus === 'sainted').map(i => i.bitId));
        const blessedIds = new Set((touchstone.instances || []).filter(i => i.communionStatus === 'blessed').map(i => i.bitId));
        if (!coreSet.has(targetId) && !saintedIds.has(targetId) && !blessedIds.has(targetId)) continue;

        const newInstance = {
          bitId: bit.id, sourceFile: bit.sourceFile, title: bit.title,
          instanceNumber: touchstone.instances.length + 1,
          confidence: mp / 100, relationship: rel,
        };
        update('touchstones', (prev) => {
          const list = prev.confirmed || [];
          const existing = list.find(t => t.id === touchstone.id);
          if (!existing || existing.bitIds.includes(bit.id)) return prev;
          return {
            ...prev,
            confirmed: list.map(t => t.id !== touchstone.id ? t : {
              ...t,
              bitIds: [...t.bitIds, bit.id],
              instances: [...t.instances, newInstance],
              frequency: t.instances.length + 1,
            }),
          };
        });
        console.log(`[Absorb] "${bit.title}" into confirmed "${touchstone.name}" (${mp}% ${rel})`);
      }
    }
  }, []);

  /**
   * Process hunt batch matches: save matches and immediately absorb into touchstones.
   * Shared by huntTouchstones and huntTranscript.
   */
  const handleBatchMatches = useCallback((batchMatches, bitsById) => {
    // Validate LLM scores against actual text overlap before storing
    const bits = [...bitsById.values()];
    const { updated: validated, stats } = recalcMatchScores(batchMatches, bits);
    if (stats.capped > 0 || stats.removed > 0) {
      console.log(`[Hunt] Score validation: ${stats.capped} capped, ${stats.removed} removed, ${stats.unchanged} unchanged`);
    }

    update('matches', (prev) => [...prev, ...validated]);

    // During mass-hunt, skip immediate absorption — let post-hunt detection
    // build proper clusters instead of greedily inflating existing touchstones.
    // Only absorb into CONFIRMED touchstones (user-validated, won't run away).
    for (const m of validated) {
      if (m.matchPercentage < 90) continue;
      const rel = m.relationship;
      if (rel !== 'same_bit') continue;

      const srcBit = bitsById.get(m.sourceId);
      const tgtBit = bitsById.get(m.targetId);
      if (srcBit) absorbIntoConfirmed(srcBit, [{ targetId: m.targetId, mp: m.matchPercentage, rel }]);
      if (tgtBit) absorbIntoConfirmed(tgtBit, [{ targetId: m.sourceId, mp: m.matchPercentage, rel }]);
    }
  }, [absorbIntoTouchstones]);

  const huntTouchstones = useCallback(async () => {
    const s = stateRef.current;
    if (s.processing) return;

    const transcriptFiles = new Set(s.topics.map((t) => t.sourceFile));
    if (transcriptFiles.size < 2) {
      set('huntProgress', { current: 0, total: 0, found: 0, status: 'Need bits from at least 2 transcripts.' });
      return;
    }

    const existingPairs = new Set(s.matches.map((m) => [m.sourceId, m.targetId].sort().join(':')));

    let useEmbeddings = false;
    const embModel = stateRef.current.embeddingModel;
    try {
      set('status', `Embedding ${s.topics.length} bits...`);
      await embeddingStore.ensureEmbeddings(s.topics, embModel, ({ done, total, status }) => {
        set('status', status);
        set('embeddingStatus', { cached: done, total });
      });
      useEmbeddings = true;
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
        const excludeIds = new Set(s.topics.filter(b => b.sourceFile === bit.sourceFile).map(b => b.id));
        const crossIds = new Set(crossTranscript.map(b => b.id));
        const neighbors = embeddingStore.findNearest(bit.id, 16, excludeIds);
        candidates = neighbors
          .filter(n => n.score >= 0.6 && crossIds.has(n.bitId))
          .filter(n => !existingPairs.has([bit.id, n.bitId].sort().join(':')))
          .map(n => bitsById.get(n.bitId)).filter(Boolean);
      } else {
        candidates = findSimilarBits(bit, crossTranscript, 0.05)
          .filter((r) => !existingPairs.has([bit.id, r.bit.id].sort().join(':')))
          .map(r => r.bit);
      }

      for (let i = 0; i < candidates.length; i += 5) {
        const chunk = candidates.slice(i, i + 5);
        batches.push({ source: bit, candidates: chunk });
        for (const c of chunk) existingPairs.add([bit.id, c.id].sort().join(':'));
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
      batches, callOllama, systemPrompt: SYSTEM_HUNT_BATCH,
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
      onBatchMatches: (batchMatches) => handleBatchMatches(batchMatches, bitsById),
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done. Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, [handleBatchMatches]);

  const huntTranscript = useCallback(async (transcript) => {
    const s = stateRef.current;
    if (s.processing) return;

    const trBits = s.topics.filter((t) => t.sourceFile === transcript.name || t.transcriptId === transcript.id);
    if (trBits.length === 0) { set('huntProgress', { current: 0, total: 0, found: 0, status: `No bits found for "${transcript.name}".` }); return; }
    const otherBits = s.topics.filter((t) => t.sourceFile !== transcript.name && t.transcriptId !== transcript.id);
    if (otherBits.length === 0) { set('huntProgress', { current: 0, total: 0, found: 0, status: 'Need bits from at least 1 other transcript.' }); return; }

    const existingPairs = new Set(s.matches.map((m) => [m.sourceId, m.targetId].sort().join(':')));

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
    } catch (err) { console.warn("[HuntTranscript] Embedding failed, falling back to text search:", err.message); }

    const bitsById = new Map(s.topics.map(b => [b.id, b]));
    const batches = [];
    for (const bit of trBits) {
      let candidates;
      if (useEmbeddings) {
        const sameFileIds = new Set(trBits.map(b => b.id));
        const neighbors = embeddingStore.findNearest(bit.id, 8, sameFileIds);
        candidates = neighbors
          .filter(n => n.score >= 0.55)
          .filter(n => !existingPairs.has([bit.id, n.bitId].sort().join(':')))
          .map(n => bitsById.get(n.bitId)).filter(Boolean);
      } else {
        candidates = findSimilarBits(bit, otherBits, 0.05)
          .filter((r) => !existingPairs.has([bit.id, r.bit.id].sort().join(':')))
          .map(r => r.bit);
      }

      for (let i = 0; i < candidates.length; i += 5) {
        const chunk = candidates.slice(i, i + 5);
        batches.push({ source: bit, candidates: chunk });
        for (const c of chunk) existingPairs.add([bit.id, c.id].sort().join(':'));
      }
    }

    if (batches.length === 0) { set('huntProgress', { current: 0, total: 0, found: 0, status: `All pairs for "${transcript.name}" already compared.` }); return; }

    set('processing', true);
    const huntController = new AbortController();
    huntControllerRef.current = huntController;
    const totalCandidates = batches.reduce((sum, b) => sum + b.candidates.length, 0);
    set('huntProgress', { current: 0, total: batches.length, found: 0, recentMatches: [], lastPrompt: null, lastResponse: null, status: `"${transcript.name}": ${batches.length} batches, ${totalCandidates} candidate pairs` });

    const { allMatches } = await runHuntBatches({
      batches, callOllama, systemPrompt: SYSTEM_HUNT_BATCH,
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
      onBatchMatches: (batchMatches) => handleBatchMatches(batchMatches, bitsById),
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done "${transcript.name}". Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, [handleBatchMatches]);

  const matchBitLive = useCallback(async (newBit, existingTopics, signal) => {
    try {
      if (signal?.aborted) return;
      const crossTranscript = existingTopics.filter((b) => b.sourceFile !== newBit.sourceFile);
      if (crossTranscript.length === 0) return;

      const newBitWords = (newBit.fullText || "").split(/\s+/).length;
      if (newBitWords < 15) return;

      let candidates;
      try {
        set('status', `Matching "${newBit.title}" — computing embeddings...`);
        const embModel = stateRef.current.embeddingModel;
        const embedStr = `Title: ${newBit.title || ""}\nSummary: ${newBit.summary || ""}\nText: ${(newBit.fullText || "").slice(0, 1600)}`;
        const vec = await embedText(embedStr, embModel);
        embeddingStore.set(newBit.id, vec, embModel);
        const sameFileIds = new Set(existingTopics.filter(b => b.sourceFile === newBit.sourceFile).map(b => b.id));
        sameFileIds.add(newBit.id);
        const neighbors = embeddingStore.findNearestByVector(vec, 10, sameFileIds);
        candidates = neighbors.filter(n => n.score >= 0.65).map(n => existingTopics.find(b => b.id === n.bitId)).filter(Boolean);
        set('status', `Matching "${newBit.title}" — ${candidates.length} embedding candidates found`);
      } catch {
        const preFilterThreshold = newBitWords < 40 ? 0.3 : 0.15;
        candidates = findSimilarBits(newBit, crossTranscript, preFilterThreshold).slice(0, 10).map((r) => r.bit);
        set('status', `Matching "${newBit.title}" — ${candidates.length} text-similarity candidates`);
      }

      // Filter out very short candidates
      candidates = candidates.filter(c => (c.fullText || "").split(/\s+/).length >= 15);
      if (candidates.length === 0) return;

      // Batch match: single LLM call for all candidates (same approach as Hunt)
      const selectedModel = stateRef.current.selectedModel;
      const debugMode = stateRef.current.debugMode;

      set('status', `Matching "${newBit.title}" — batch comparing ${candidates.length} candidates...`);

      try {
        const candidateList = candidates.map((c, i) =>
          `CANDIDATE ${i + 1}:\nTitle: ${c.title}\nFull text: ${c.fullText}`
        ).join('\n\n');

        const userMsg = `SOURCE BIT:\nTitle: ${newBit.title}\nFull text: ${newBit.fullText}\n\n${candidateList}`;

        const result = await callOllama(SYSTEM_HUNT_BATCH, userMsg, () => {}, selectedModel, debugMode ? addDebugEntry : null, signal);
        const hits = Array.isArray(result) ? result : [result];

        const rawMatches = [];
        for (const hit of hits) {
          if (!hit || typeof hit.match_percentage !== 'number' || typeof hit.candidate !== 'number') continue;
          const candIdx = hit.candidate - 1;
          if (candIdx < 0 || candIdx >= candidates.length) continue;
          const mp = Math.round(hit.match_percentage);
          const rel = hit.relationship || 'none';
          if (mp < 75 || (rel !== 'same_bit' && rel !== 'evolved')) continue;

          rawMatches.push({
            id: uid(),
            sourceId: newBit.id,
            targetId: candidates[candIdx].id,
            confidence: mp / 100,
            matchPercentage: mp,
            relationship: rel,
            reason: hit.reason || '',
            timestamp: Date.now(),
          });
        }

        // Validate LLM scores against actual text overlap before storing
        const allBits = [newBit, ...candidates];
        const { updated: validated, stats } = recalcMatchScores(rawMatches, allBits);
        if (stats.capped > 0 || stats.removed > 0) {
          console.log(`[MatchLive] Score validation: ${stats.capped} capped, ${stats.removed} removed, ${stats.unchanged} unchanged`);
        }

        const strongMatchTargets = [];
        for (const m of validated) {
          update('matches', (prev) => [...prev, m]);
          if (m.matchPercentage >= 85) strongMatchTargets.push({ targetId: m.targetId, mp: m.matchPercentage, rel: m.relationship });
          console.log(`[MatchLive] "${newBit.title}" vs "${candidates.find(c => c.id === m.targetId)?.title}": ${m.matchPercentage}% (${m.relationship})${m._priorMatchPercentage ? ` [LLM: ${m._priorMatchPercentage}%]` : ''}`);
        }

        // Immediate touchstone absorption (using validated scores)
        absorbIntoTouchstones(newBit, strongMatchTargets);

        set('status', `Matched "${newBit.title}" — ${validated.length} match(es) from ${candidates.length} candidates`);
      } catch (err) {
        if (err.name === "AbortError") return;
        console.error(`[MatchLive] Batch error for "${newBit.title}":`, err.message);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Error matching bit live:", err);
    }
  }, [addDebugEntry, absorbIntoTouchstones]);

  /**
   * Scan all matches for bits that are bit-matched (85%+ same_bit/evolved)
   * to a touchstone member but not yet in that touchstone. Absorb them.
   */
  const absorbAllUnmatched = useCallback(() => {
    const s = stateRef.current;
    const ts = s.touchstones || {};
    const allTouchstones = [...(ts.confirmed || []), ...(ts.possible || [])];
    const touchstoneBitIds = new Set(allTouchstones.flatMap(t => t.bitIds));
    const bitsById = new Map(s.topics.map(b => [b.id, b]));
    let totalAbsorbed = 0;

    for (const m of (s.matches || [])) {
      const mp = m.matchPercentage || (m.confidence || 0) * 100;
      if (mp < 85) continue;
      const rel = m.relationship;
      if (rel !== 'same_bit' && rel !== 'evolved') continue;

      // Check both directions: if one end is in a touchstone and the other isn't
      const srcInTs = touchstoneBitIds.has(m.sourceId);
      const tgtInTs = touchstoneBitIds.has(m.targetId);

      if (srcInTs && !tgtInTs) {
        const bit = bitsById.get(m.targetId);
        if (bit) {
          absorbIntoTouchstones(bit, [{ targetId: m.sourceId, mp: Math.round(mp), rel }]);
          touchstoneBitIds.add(m.targetId); // track so we don't double-absorb
          totalAbsorbed++;
        }
      } else if (tgtInTs && !srcInTs) {
        const bit = bitsById.get(m.sourceId);
        if (bit) {
          absorbIntoTouchstones(bit, [{ targetId: m.targetId, mp: Math.round(mp), rel }]);
          touchstoneBitIds.add(m.sourceId);
          totalAbsorbed++;
        }
      }
    }

    set('status', totalAbsorbed > 0
      ? `Absorbed ${totalAbsorbed} bit(s) into touchstones`
      : 'No unmatched bits to absorb — all strong matches already in touchstones');
    return totalAbsorbed;
  }, [absorbIntoTouchstones]);

  return { huntTouchstones, huntTranscript, matchBitLive, absorbAllUnmatched };
}
