/**
 * Similarity Search - Find similar bits across the vault
 * Uses multiple scoring metrics for comprehensive matching
 */

import { stringSimilarity, toWordBag, wordOverlapScore } from "./textSimilarity.js";

/**
 * Check if a new bit is a duplicate of any existing bit.
 * Uses fullText overlap as the primary signal — if the texts share most of their
 * words in roughly the same order, they're the same joke regardless of minor
 * wording/position differences.
 * @param {object} newBit - The candidate bit
 * @param {array} existingBits - Already-archived bits to check against
 * @param {number} threshold - Word-overlap ratio above which we call it a duplicate (0-1, default 0.7)
 * @returns {object|null} The matching existing bit, or null if not a duplicate
 */
export function findDuplicateBit(newBit, existingBits, threshold = 0.7) {
  if (!newBit?.fullText || existingBits.length === 0) return null;

  const newWords = toWordBag(newBit.fullText);
  if (newWords.length < 3) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const existing of existingBits) {
    if (!existing.fullText) continue;

    const existingWords = toWordBag(existing.fullText);
    if (existingWords.length < 3) continue;

    // Quick length filter — if one text is 3x+ longer, they aren't duplicates
    const lenRatio = Math.min(newWords.length, existingWords.length) / Math.max(newWords.length, existingWords.length);
    if (lenRatio < 0.3) continue;

    const score = wordOverlapScore(newWords, existingWords);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = existing;
    }
  }

  return bestScore >= threshold ? bestMatch : null;
}


/**
 * Build an inverted index from keywords/tags to bit IDs for fast candidate lookup.
 * Returns a function that finds candidate bits sharing 2+ keywords/tags with a query bit.
 */
export function buildKeywordIndex(allBits) {
  const index = new Map(); // keyword → Set<bitId>
  const bitsById = new Map();
  for (const bit of allBits) {
    bitsById.set(bit.id, bit);
    const terms = [...(bit.keywords || []), ...(bit.tags || [])];
    for (const term of terms) {
      const normalized = term.toLowerCase().trim();
      if (!normalized) continue;
      if (!index.has(normalized)) index.set(normalized, new Set());
      index.get(normalized).add(bit.id);
    }
  }
  return { index, bitsById };
}

/**
 * Search for similar bits using keyword index for fast candidate narrowing.
 * Falls back to full scan if keyword index produces too few candidates.
 * @param {object} queryBit - The bit to search for
 * @param {array} allBits - All bits to search against
 * @param {number} threshold - Minimum similarity score (0-1)
 * @returns {array} Array of {bit, score, reasons} sorted by score
 */
export function findSimilarBits(queryBit, allBits, threshold = 0.5) {
  // For small collections, just do a full scan
  if (allBits.length <= 100) {
    return allBits
      .filter((b) => b.id !== queryBit.id)
      .map((bit) => ({
        bit,
        score: calculateSimilarity(queryBit, bit),
        reasons: explainSimilarity(queryBit, bit, 0),
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  // Use keyword index to narrow candidates
  const { index, bitsById } = buildKeywordIndex(allBits);
  const queryTerms = [...(queryBit.keywords || []), ...(queryBit.tags || [])];
  const candidateCounts = new Map(); // bitId → number of shared terms

  for (const term of queryTerms) {
    const normalized = term.toLowerCase().trim();
    const bitIds = index.get(normalized);
    if (!bitIds) continue;
    for (const id of bitIds) {
      if (id === queryBit.id) continue;
      candidateCounts.set(id, (candidateCounts.get(id) || 0) + 1);
    }
  }

  // Only full-score bits with 2+ shared terms (much smaller set)
  let candidates = [...candidateCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([id]) => bitsById.get(id))
    .filter(Boolean);

  // If too few candidates from index, fall back to full scan
  if (candidates.length < 5) {
    candidates = allBits.filter((b) => b.id !== queryBit.id);
  }

  return candidates
    .map((bit) => ({
      bit,
      score: calculateSimilarity(queryBit, bit),
      reasons: explainSimilarity(queryBit, bit, 0),
    }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Calculate overall similarity score between two bits
 */
function calculateSimilarity(bit1, bit2) {
  // Weights heavily favor fullText — tags/keywords can be stale after
  // split/join/boundary ops, so they get minimal weight
  const titleSim = stringSimilarity(bit1.title, bit2.title) * 0.1;
  const summarySim = stringSimilarity(bit1.summary, bit2.summary) * 0.15;
  const keywordSim = calculateKeywordSimilarity(bit1.keywords, bit2.keywords) * 0.05;
  const tagSim = calculateTagSimilarity(bit1.tags, bit2.tags) * 0.05;
  // fullText word overlap is ground truth — strongest signal
  const fullTextSim = (bit1.fullText && bit2.fullText)
    ? wordOverlapScore(toWordBag(bit1.fullText), toWordBag(bit2.fullText)) * 0.65
    : 0;

  return titleSim + summarySim + keywordSim + tagSim + fullTextSim;
}


/**
 * Calculate keyword similarity
 */
function calculateKeywordSimilarity(keywords1 = [], keywords2 = []) {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);

  let overlap = 0;
  for (const kw of set1) {
    if (set2.has(kw)) overlap++;
  }

  return overlap / Math.max(set1.size, set2.size);
}

/**
 * Calculate tag similarity
 */
function calculateTagSimilarity(tags1 = [], tags2 = []) {
  if (tags1.length === 0 || tags2.length === 0) return 0;

  const set1 = new Set(tags1);
  const set2 = new Set(tags2);

  let overlap = 0;
  for (const tag of set1) {
    if (set2.has(tag)) overlap++;
  }

  return overlap / Math.max(set1.size, set2.size);
}

/**
 * Explain why bits are similar
 */
function explainSimilarity(bit1, bit2, score) {
  const reasons = [];

  // Title similarity
  const titleSim = stringSimilarity(bit1.title, bit2.title);
  if (titleSim > 0.5) {
    reasons.push(`Similar titles (${Math.round(titleSim * 100)}%)`);
  }

  // Summary similarity
  const summarySim = stringSimilarity(bit1.summary, bit2.summary);
  if (summarySim > 0.5) {
    reasons.push(`Similar premises (${Math.round(summarySim * 100)}%)`);
  }

  // Shared keywords
  const sharedKeywords = (bit1.keywords || []).filter((k) =>
    (bit2.keywords || []).includes(k)
  );
  if (sharedKeywords.length > 0) {
    reasons.push(`Shared keywords: ${sharedKeywords.slice(0, 2).join(", ")}`);
  }

  // Shared tags
  const sharedTags = (bit1.tags || []).filter((t) => (bit2.tags || []).includes(t));
  if (sharedTags.length > 0) {
    reasons.push(`Same categories: ${sharedTags.slice(0, 2).join(", ")}`);
  }

  return reasons;
}

/**
 * Get statistics about bit similarity
 */
export function getSimilarityStats(bits) {
  const stats = {
    totalBits: bits.length,
    avgSimilarityPerBit: 0,
    mostSimilarPair: null,
    similarityDistribution: {
      veryHigh: 0, // > 0.8
      high: 0, // 0.6-0.8
      medium: 0, // 0.4-0.6
      low: 0, // 0.2-0.4
    },
  };

  if (bits.length < 2) return stats;

  // Cap to avoid O(n²) browser freeze — sample if too many bits
  const MAX_BITS = 80;
  const sample = bits.length > MAX_BITS
    ? bits.slice().sort(() => Math.random() - 0.5).slice(0, MAX_BITS)
    : bits;

  let totalSimilarities = 0;
  let pairCount = 0;
  let maxSimilarity = 0;
  let mostSimilarPair = null;

  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const similarity = calculateSimilarity(sample[i], sample[j]);
      totalSimilarities += similarity;
      pairCount++;

      // Track distribution
      if (similarity > 0.8) stats.similarityDistribution.veryHigh++;
      else if (similarity > 0.6) stats.similarityDistribution.high++;
      else if (similarity > 0.4) stats.similarityDistribution.medium++;
      else if (similarity > 0.2) stats.similarityDistribution.low++;

      // Track most similar
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarPair = {
          bit1: sample[i],
          bit2: sample[j],
          similarity,
        };
      }
    }
  }

  stats.avgSimilarityPerBit = pairCount > 0 ? totalSimilarities / pairCount : 0;
  stats.mostSimilarPair = mostSimilarPair;

  return stats;
}
