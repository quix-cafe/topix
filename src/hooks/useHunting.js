import { useCallback } from "react";
import { callOllama, uid } from "../utils/ollama";
import { SYSTEM_MATCH_PAIR, SYSTEM_HUNT_BATCH } from "../utils/prompts";
import { saveVaultState } from "../utils/database";
import { findSimilarBits } from "../utils/similaritySearch";
import { embedText } from "../utils/embeddings";
import { runHuntBatches } from "../utils/huntRunner";

export function useHunting(ctx) {
  const { dispatch, stateRef, addDebugEntry, embeddingStore, huntControllerRef } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

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
        const neighbors = embeddingStore.findNearest(bit.id, 8, excludeIds);
        candidates = neighbors
          .filter(n => n.score >= 0.65 && crossIds.has(n.bitId))
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
      onBatchMatches: (batchMatches) => {
        update('matches', (prev) => [...prev, ...batchMatches]);
        const s2 = stateRef.current;
        saveVaultState({ topics: s2.topics, matches: [...s2.matches, ...batchMatches], transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
      },
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done. Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, []);

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
          .filter(n => n.score >= 0.65)
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
      onBatchMatches: (batchMatches) => {
        update('matches', (prev) => [...prev, ...batchMatches]);
        const s2 = stateRef.current;
        saveVaultState({ topics: s2.topics, matches: [...s2.matches, ...batchMatches], transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
      },
      debugLogger: addDebugEntry,
    });

    huntControllerRef.current = null;
    set('processing', false);
    update('huntProgress', (prev) => ({ ...prev, current: batches.length, total: batches.length, found: allMatches.length, status: `Done "${transcript.name}". Found ${allMatches.length} new match${allMatches.length !== 1 ? 'es' : ''}.` }));
  }, []);

  const matchBitLive = useCallback(async (newBit, existingTopics, signal) => {
    try {
      if (signal?.aborted) return;
      const crossTranscript = existingTopics.filter((b) => b.sourceFile !== newBit.sourceFile);
      if (crossTranscript.length === 0) return;

      const newBitWords = (newBit.fullText || "").split(/\s+/).length;

      let candidates;
      try {
        const embModel = stateRef.current.embeddingModel;
        const embedStr = `Title: ${newBit.title || ""}\nSummary: ${newBit.summary || ""}\nText: ${(newBit.fullText || "").slice(0, 1600)}`;
        const vec = await embedText(embedStr, embModel);
        const sameFileIds = new Set(existingTopics.filter(b => b.sourceFile === newBit.sourceFile).map(b => b.id));
        sameFileIds.add(newBit.id);
        const neighbors = embeddingStore.findNearestByVector(vec, 10, sameFileIds);
        candidates = neighbors.filter(n => n.score >= 0.65).map(n => existingTopics.find(b => b.id === n.bitId)).filter(Boolean);
      } catch {
        const preFilterThreshold = newBitWords < 40 ? 0.3 : 0.15;
        candidates = findSimilarBits(newBit, crossTranscript, preFilterThreshold).slice(0, 10).map((r) => r.bit);
      }

      if (candidates.length === 0) return;
      if (newBitWords < 15) return;

      const selectedModel = stateRef.current.selectedModel;
      const debugMode = stateRef.current.debugMode;

      for (const candidate of candidates) {
        if (signal?.aborted) return;
        const candidateWords = (candidate.fullText || "").split(/\s+/).length;
        if (candidateWords < 15) continue;

        try {
          const userMsg = `BIT A:\nTitle: ${newBit.title}\nFull text: ${newBit.fullText}\n\nBIT B:\nTitle: ${candidate.title}\nFull text: ${candidate.fullText}`;
          const result = await callOllama(SYSTEM_MATCH_PAIR, userMsg, () => {}, selectedModel, debugMode ? addDebugEntry : null, signal);
          const matchData = Array.isArray(result) ? result[0] : result;

          if (matchData && typeof matchData.match_percentage === "number") {
            const mp = Math.round(matchData.match_percentage);
            const rel = matchData.relationship || "none";
            if (mp < 35 || (rel !== "same_bit" && rel !== "evolved")) continue;

            const newMatch = {
              id: uid(),
              sourceId: newBit.id,
              targetId: candidate.id,
              confidence: mp / 100,
              matchPercentage: mp,
              relationship: rel,
              reason: matchData.reason || "",
              timestamp: Date.now(),
            };
            update('matches', (prev) => [...prev, newMatch]);
            const s = stateRef.current;
            saveVaultState({ topics: s.topics, matches: [...s.matches, newMatch], transcripts: s.transcripts, touchstones: s.touchstones }).catch(console.error);
          }
        } catch (pairErr) {
          if (pairErr.name === "AbortError") return;
          console.error(`[MatchPair] Error comparing with "${candidate.title}":`, pairErr.message);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Error matching bit live:", err);
    }
  }, [addDebugEntry]);

  return { huntTouchstones, huntTranscript, matchBitLive };
}
