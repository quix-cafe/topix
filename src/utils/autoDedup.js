/**
 * Auto-Dedup — Silent same-transcript duplicate removal
 * Runs on each new bit during parsing to absorb or merge overlapping content.
 */

import { toWordBag, wordOverlapScore } from "./textSimilarity.js";
import { SYSTEM_MERGE_BITS } from "./prompts.js";

/**
 * Normalize whitespace for substring containment checks
 */
function normalizeWhitespace(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Calculate position overlap ratio between two bits using textPosition
 * Returns the overlap as a fraction of the shorter span
 */
function positionOverlapRatio(pos1, pos2) {
  if (!pos1 || !pos2) return 0;
  const s1 = pos1.startChar, e1 = pos1.endChar;
  const s2 = pos2.startChar, e2 = pos2.endChar;
  if (e1 <= s1 || e2 <= s2) return 0;

  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);
  if (overlapEnd <= overlapStart) return 0;

  const overlapLen = overlapEnd - overlapStart;
  const span1 = e1 - s1;
  const span2 = e2 - s2;
  return overlapLen / Math.min(span1, span2);
}

/**
 * Merge metadata from two bits using LLM
 * @returns {object} Merged {title, summary, tags, keywords}
 */
async function llmMergeMetadata(bitA, bitB, callOllamaFn, model) {
  try {
    const userMsg = `BIT A:\nTitle: ${bitA.title}\nSummary: ${bitA.summary}\nTags: ${(bitA.tags || []).join(", ")}\nKeywords: ${(bitA.keywords || []).join(", ")}\n\nBIT B:\nTitle: ${bitB.title}\nSummary: ${bitB.summary}\nTags: ${(bitB.tags || []).join(", ")}\nKeywords: ${(bitB.keywords || []).join(", ")}`;

    const result = await callOllamaFn(SYSTEM_MERGE_BITS, userMsg, () => {}, model);

    if (result && typeof result === "object" && !Array.isArray(result)) {
      return {
        title: result.title || bitA.title,
        summary: result.summary || bitA.summary,
        tags: Array.isArray(result.tags) ? result.tags : bitA.tags || [],
        keywords: Array.isArray(result.keywords) ? result.keywords : bitA.keywords || [],
      };
    }
    // If result is an array (some models wrap in array), take first element
    if (Array.isArray(result) && result.length > 0) {
      const r = result[0];
      return {
        title: r.title || bitA.title,
        summary: r.summary || bitA.summary,
        tags: Array.isArray(r.tags) ? r.tags : bitA.tags || [],
        keywords: Array.isArray(r.keywords) ? r.keywords : bitA.keywords || [],
      };
    }
  } catch (err) {
    console.error("[AutoDedup] LLM merge failed, using longer bit metadata:", err.message);
  }
  // Fallback: just use the longer bit's metadata
  return null;
}

/**
 * Check if a new bit should be absorbed into or merged with an existing same-transcript bit.
 *
 * @param {object} newBit - The newly parsed bit (must have sourceFile, transcriptId, fullText, textPosition)
 * @param {array} existingBits - All existing bits in topics
 * @param {function} callOllamaFn - The callOllama function for LLM calls
 * @param {string} model - Model name for LLM calls
 * @returns {Promise<object>} One of:
 *   {action: "absorbed", keptBit}          — newBit is a subset, discard it
 *   {action: "absorbed_existing", removedId, keptBit} — existing is a subset, replace it with newBit
 *   {action: "merged", removedId, keptBit} — overlapping, kept longer with merged metadata
 *   {action: "none"}                       — no same-transcript overlap
 */
export async function absorbOrMerge(newBit, existingBits, callOllamaFn, model) {
  // Only compare against bits from the same source file AND same transcript
  const sameTranscript = existingBits.filter(
    (b) => b.sourceFile === newBit.sourceFile && b.transcriptId === newBit.transcriptId
  );

  if (sameTranscript.length === 0) return { action: "none" };

  const newNorm = normalizeWhitespace(newBit.fullText);
  if (!newNorm) return { action: "none" };

  for (const existing of sameTranscript) {
    const existNorm = normalizeWhitespace(existing.fullText);
    if (!existNorm) continue;

    // Check 1 — newBit is a substring of existing (discard newBit)
    if (existNorm.includes(newNorm)) {
      console.log(`[AutoDedup] Absorbed "${newBit.title}" into "${existing.title}" (subset)`);
      return { action: "absorbed", keptBit: existing };
    }

    // Check 2 — existing is a substring of newBit (replace existing with newBit)
    if (newNorm.includes(existNorm)) {
      console.log(`[AutoDedup] Absorbed existing "${existing.title}" into new "${newBit.title}" (reverse subset)`);
      return { action: "absorbed_existing", removedId: existing.id, keptBit: newBit };
    }

    // Check 3 — Position overlap > 50%
    const posOverlap = positionOverlapRatio(newBit.textPosition, existing.textPosition);
    if (posOverlap > 0.5) {
      const keepNew = (newBit.fullText || "").length >= (existing.fullText || "").length;
      const kept = keepNew ? newBit : existing;
      const removed = keepNew ? existing : newBit;

      const merged = await llmMergeMetadata(kept, removed, callOllamaFn, model);
      const keptBit = merged
        ? { ...kept, title: merged.title, summary: merged.summary, tags: merged.tags, keywords: merged.keywords }
        : kept;

      console.log(`[AutoDedup] Merged "${removed.title}" into "${keptBit.title}" (position overlap ${Math.round(posOverlap * 100)}%)`);

      if (keepNew) {
        return { action: "merged", removedId: existing.id, keptBit };
      } else {
        // Existing is longer — absorb newBit into existing
        return { action: "absorbed", keptBit };
      }
    }

    // Check 4 — Word overlap > 0.55 (comedy rewrites change 30-40% of words)
    const newWords = toWordBag(newBit.fullText);
    const existWords = toWordBag(existing.fullText);
    if (newWords.length >= 3 && existWords.length >= 3) {
      const overlap = wordOverlapScore(newWords, existWords);
      if (overlap > 0.55) {
        const keepNew = (newBit.fullText || "").length >= (existing.fullText || "").length;
        const kept = keepNew ? newBit : existing;
        const removed = keepNew ? existing : newBit;

        const merged = await llmMergeMetadata(kept, removed, callOllamaFn, model);
        const keptBit = merged
          ? { ...kept, title: merged.title, summary: merged.summary, tags: merged.tags, keywords: merged.keywords }
          : kept;

        console.log(`[AutoDedup] Merged "${removed.title}" into "${keptBit.title}" (word overlap ${Math.round(overlap * 100)}%)`);

        if (keepNew) {
          return { action: "merged", removedId: existing.id, keptBit };
        } else {
          return { action: "absorbed", keptBit };
        }
      }
    }
  }

  return { action: "none" };
}
