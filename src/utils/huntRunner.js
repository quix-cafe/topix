import { uid } from "./ollama";

/**
 * Shared batch hunt loop used by both huntTouchstones and huntTranscript.
 *
 * @param {Object} options
 * @param {Array} options.batches - [{ source: bit, candidates: bit[] }]
 * @param {Function} options.callOllama - LLM caller
 * @param {string} options.systemPrompt - the SYSTEM_HUNT_BATCH prompt
 * @param {Function} options.getSelectedModel - () => string (reads current model)
 * @param {AbortSignal} options.abortSignal
 * @param {Function} options.shouldStopFn - () => boolean
 * @param {Function} options.onProgress - ({ current, total, found, status, lastPrompt, lastResponse, recentMatches }) => void
 * @param {Function} options.onBatchMatches - (newMatches[]) => void — called per batch with new matches to persist
 * @param {Function} [options.debugLogger] - optional addDebugEntry
 *
 * @returns {Promise<{ allMatches: Array, completed: boolean }>}
 */
export async function runHuntBatches({
  batches,
  callOllama,
  systemPrompt,
  getSelectedModel,
  abortSignal,
  shouldStopFn,
  onProgress,
  onBatchMatches,
  debugLogger,
}) {
  const allNewMatches = [];

  for (let idx = 0; idx < batches.length; idx++) {
    if (shouldStopFn() || abortSignal.aborted) {
      onProgress({ status: 'Stopped.' });
      break;
    }

    const { source, candidates } = batches[idx];
    onProgress({
      current: idx + 1,
      total: batches.length,
      found: allNewMatches.length,
      status: `"${source.title}" vs ${candidates.length} candidates`,
    });

    try {
      // Only send title + fullText — tags/keywords/summary bias toward topic-matching
      const candidateList = candidates.map((c, i) =>
        `CANDIDATE ${i + 1}:\nTitle: ${c.title}\nFull text: ${c.fullText}`
      ).join('\n\n');

      const userMsg = `SOURCE BIT:\nTitle: ${source.title}\nFull text: ${source.fullText}\n\n${candidateList}`;

      // Store prompt for verbose display
      onProgress({ lastPrompt: userMsg, lastResponse: null });

      const result = await callOllama(
        systemPrompt,
        userMsg,
        () => {},
        getSelectedModel(),
        debugLogger || null,
        abortSignal,
      );

      const hits = Array.isArray(result) ? result : [result];

      // Store raw response for verbose display
      onProgress({ lastResponse: JSON.stringify(hits, null, 2) });

      const batchMatches = [];
      for (const hit of hits) {
        if (!hit || typeof hit.match_percentage !== 'number' || typeof hit.candidate !== 'number') continue;
        const candIdx = hit.candidate - 1; // 1-indexed in prompt
        if (candIdx < 0 || candIdx >= candidates.length) continue;
        const mp = Math.round(hit.match_percentage);
        const rel = hit.relationship || 'none';
        // Only store same_bit and evolved — related/callback don't form touchstones
        // 85% threshold: must be clearly the same joke, not just same topic
        if (mp < 85 || (rel !== 'same_bit' && rel !== 'evolved')) continue;

        const matchDetail = {
          sourceTitle: source.title,
          candidateTitle: candidates[candIdx].title,
          percentage: mp,
          relationship: rel,
          reason: hit.reason || '',
        };
        batchMatches.push({
          id: uid(),
          sourceId: source.id,
          targetId: candidates[candIdx].id,
          confidence: mp / 100,
          matchPercentage: mp,
          relationship: rel,
          reason: hit.reason || '',
          timestamp: Date.now(),
        });
        console.log(`[Hunt] "${source.title}" vs "${candidates[candIdx].title}": ${mp}% (${hit.relationship})`);

        // Show match in progress
        onProgress({
          found: allNewMatches.length + batchMatches.length,
          recentMatches: matchDetail,
        });
      }

      // Log full LLM response as debug entry
      if (debugLogger) {
        debugLogger({
          type: 'hunt-batch',
          label: `Hunt: "${source.title}" vs ${candidates.length} candidates`,
          prompt: `[${candidates.map(c => c.title).join(', ')}]`,
          response: JSON.stringify(hits, null, 2),
          matches: batchMatches.length,
        });
      }

      // Save immediately after each LLM call
      if (batchMatches.length > 0) {
        allNewMatches.push(...batchMatches);
        onBatchMatches(batchMatches);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log(`[Hunt] Aborted during "${source.title}"`);
        break;
      }
      console.error(`[Hunt] Error batch-comparing "${source.title}":`, err.message);
    }
  }

  return {
    allMatches: allNewMatches,
    completed: !abortSignal.aborted && !shouldStopFn(),
  };
}
