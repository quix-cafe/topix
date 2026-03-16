/**
 * Shared text similarity utilities
 * Single source of truth for string/bit similarity calculations
 */

/**
 * Convert text to a bag of lowercase words (min 2 chars)
 */
export function toWordBag(text) {
  return text.toLowerCase().match(/\b\w{2,}\b/g) || [];
}

/**
 * Calculate word-overlap score between two word arrays (0-1)
 */
export function wordOverlapScore(words1, words2) {
  const bag1 = new Map();
  for (const w of words1) bag1.set(w, (bag1.get(w) || 0) + 1);
  const bag2 = new Map();
  for (const w of words2) bag2.set(w, (bag2.get(w) || 0) + 1);

  let overlap = 0;
  for (const [word, count] of bag1) {
    overlap += Math.min(count, bag2.get(word) || 0);
  }

  return overlap / Math.max(words1.length, words2.length);
}

/**
 * Calculate string similarity using word overlap (0-1)
 * Words shorter than minWordLen are ignored.
 * @param {string} str1
 * @param {string} str2
 * @param {number} minWordLen - Minimum word length to consider (default 3)
 */
export function stringSimilarity(str1, str2, minWordLen = 3) {
  if (!str1 || !str2) return 0;

  const words1 = new Set(str1.toLowerCase().split(/\W+/).filter((w) => w.length >= minWordLen));
  const words2 = new Set(str2.toLowerCase().split(/\W+/).filter((w) => w.length >= minWordLen));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  return overlap / Math.max(words1.size, words2.size);
}

/**
 * Calculate similarity between two bit objects (0-1)
 * Weights title, summary, and keyword overlap.
 * Bits from the same source file return 0 (not cross-transcript).
 */
export function calculateBitSimilarity(bit1, bit2) {
  if (bit1.sourceFile === bit2.sourceFile) return 0;

  const titleSim = stringSimilarity(bit1.title, bit2.title) * 0.4;
  const summarySim = stringSimilarity(bit1.summary, bit2.summary) * 0.3;

  const keywords1 = new Set(bit1.keywords || []);
  const keywords2 = new Set(bit2.keywords || []);
  let keywordOverlap = 0;
  for (const kw of keywords1) {
    if (keywords2.has(kw)) keywordOverlap++;
  }
  const keywordSim = keywords1.size > 0 ? keywordOverlap / Math.max(keywords1.size, keywords2.size) : 0;

  return titleSim + summarySim + keywordSim * 0.3;
}

/**
 * Calculate similarity between two bits from the SAME transcript (0-1).
 * Uses fullText word overlap, text position overlap, and title similarity.
 * Detects: duplicate selections, accidentally split bits, accidentally combined bits.
 */
export function sameTranscriptSimilarity(bit1, bit2) {
  if (bit1.sourceFile !== bit2.sourceFile) return 0;

  let score = 0;

  // 1. Text position overlap (strongest signal — same text region selected twice)
  const pos1 = bit1.textPosition;
  const pos2 = bit2.textPosition;
  if (pos1 && pos2) {
    const overlapStart = Math.max(pos1.startChar, pos2.startChar);
    const overlapEnd = Math.min(pos1.endChar, pos2.endChar);
    if (overlapEnd > overlapStart) {
      const overlapLen = overlapEnd - overlapStart;
      const span1 = pos1.endChar - pos1.startChar;
      const span2 = pos2.endChar - pos2.startChar;
      const overlapRatio = overlapLen / Math.min(span1, span2);
      if (overlapRatio > 0.3) return Math.min(1, overlapRatio); // strong overlap = same bit
    }
  }

  // 2. FullText word overlap (catches reworded duplicates / split+combined)
  const text1 = (bit1.fullText || "").toLowerCase();
  const text2 = (bit2.fullText || "").toLowerCase();
  if (text1.length > 20 && text2.length > 20) {
    const words1 = toWordBag(text1);
    const words2 = toWordBag(text2);
    if (words1.length > 0 && words2.length > 0) {
      score = wordOverlapScore(words1, words2) * 0.7;
    }
  }

  // 3. Title similarity boost
  const titleSim = stringSimilarity(bit1.title || "", bit2.title || "");
  score += titleSim * 0.3;

  return score;
}

/**
 * Extract common words from an array of bits' titles
 * Returns words appearing in at least 50% of titles
 * @param {array} bits - Array of bit objects with .title
 * @returns {array} Sorted array of common words
 */
export function extractCommonWords(bits) {
  const allWords = bits.flatMap((b) =>
    (b.title || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  );

  const wordCount = {};
  allWords.forEach((word) => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });

  const threshold = Math.ceil(bits.length * 0.5);
  return Object.entries(wordCount)
    .filter(([, count]) => count >= threshold)
    .map(([word]) => word)
    .sort();
}
