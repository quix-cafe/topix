/**
 * BitMerger - Merge multiple matched bits into root bits
 * Aggregates variations and tracks evolution of jokes across transcripts
 */

import { calculateBitSimilarity } from "./textSimilarity.js";

/**
 * Create a root bit from multiple matched bits
 * @param {array} bitIds - IDs of bits to merge
 * @param {array} allBits - Full bit array for lookup
 * @param {array} matches - Match data between bits (optional)
 * @returns {object} Root bit object
 */
export function createRootBit(bitIds, allBits, matches = []) {
  const bitsToMerge = allBits.filter((b) => bitIds.includes(b.id));

  if (bitsToMerge.length === 0) return null;

  // Sort by date or appearance order
  const sorted = [...bitsToMerge].sort((a, b) => {
    const aDate = new Date(a.createdAt || 0);
    const bDate = new Date(b.createdAt || 0);
    return aDate - bDate;
  });

  const firstBit = sorted[0];
  const mergedTitle = createMergedTitle(bitsToMerge);
  const mergedSummary = mergeSummaries(bitsToMerge);
  const allTags = [...new Set(bitsToMerge.flatMap((b) => b.tags || []))];
  const allKeywords = [...new Set(bitsToMerge.flatMap((b) => b.keywords || []))];

  // Analyze variations
  const variations = analyzeVariations(bitsToMerge);

  // Calculate average confidence from matches
  const avgConfidence = calculateAvgConfidence(matches, bitIds);

  return {
    id: `root-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: mergedTitle,
    summary: mergedSummary,
    tags: allTags,
    keywords: allKeywords,
    isMergedRoot: true,
    mergedFrom: bitIds,
    aggregateData: {
      totalInstances: bitsToMerge.length,
      averageConfidence: avgConfidence,
      variations,
      firstAppearance: {
        bitId: firstBit.id,
        sourceFile: firstBit.sourceFile,
        title: firstBit.title,
      },
      sources: [...new Set(bitsToMerge.map((b) => b.sourceFile))],
    },
    editHistory: [
      {
        timestamp: Date.now(),
        action: "merge",
        details: {
          mergedBitIds: bitIds,
          mergedFrom: bitsToMerge.length,
        },
      },
    ],
  };
}

/**
 * Create a merged title from multiple bits
 * Extracts common words and creates a representative title
 */
function createMergedTitle(bits) {
  if (bits.length === 0) return "Unknown";

  // Use first title as base
  if (bits.length === 1) {
    return bits[0].title;
  }

  // Find common words in titles
  const titles = bits.map((b) => b.title.toLowerCase());
  const commonWords = [];

  const firstWords = titles[0].split(/\s+/);
  for (const word of firstWords) {
    if (word.length > 2 && titles.every((t) => t.includes(word))) {
      commonWords.push(word);
    }
  }

  if (commonWords.length > 0) {
    // Capitalize first letters
    return commonWords
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Fallback: use first title with note
  return `${bits[0].title} (variations)`;
}

/**
 * Merge summaries from multiple bits
 */
function mergeSummaries(bits) {
  if (bits.length === 0) return "";
  if (bits.length === 1) return bits[0].summary;

  // Take longest summary as base
  const baseSummary = bits.reduce((prev, curr) =>
    curr.summary.length > prev.summary.length ? curr : prev
  ).summary;

  const variations = bits.length - 1;
  return `${baseSummary} This joke appears in ${bits.length} variations across different performances.`;
}

/**
 * Analyze variations between bits
 */
function analyzeVariations(bits) {
  if (bits.length < 2) return [];

  const firstBit = bits[0];
  const variations = [];

  bits.slice(1).forEach((bit, idx) => {
    const variation = {
      version: idx + 2,
      sourceFile: bit.sourceFile,
      title: bit.title,
      changes: detectChanges(firstBit, bit),
      lengthDifference: bit.fullText.length - firstBit.fullText.length,
    };
    variations.push(variation);
  });

  return variations;
}

/**
 * Detect what changed between two versions of a bit
 */
function detectChanges(originalBit, newBit) {
  const changes = [];

  // Tag changes
  const originalTags = new Set(originalBit.tags || []);
  const newTags = new Set(newBit.tags || []);
  const addedTags = [...newTags].filter((t) => !originalTags.has(t));
  const removedTags = [...originalTags].filter((t) => !newTags.has(t));

  if (addedTags.length > 0) {
    changes.push(`Added tags: ${addedTags.join(", ")}`);
  }
  if (removedTags.length > 0) {
    changes.push(`Removed tags: ${removedTags.join(", ")}`);
  }

  // Keyword changes
  const originalKeywords = new Set(originalBit.keywords || []);
  const newKeywords = new Set(newBit.keywords || []);
  const addedKeywords = [...newKeywords].filter((k) => !originalKeywords.has(k));
  const removedKeywords = [...originalKeywords].filter((k) => !newKeywords.has(k));

  if (addedKeywords.length > 0) {
    changes.push(`New keywords: ${addedKeywords.slice(0, 2).join(", ")}`);
  }
  if (removedKeywords.length > 0) {
    changes.push(`Dropped keywords: ${removedKeywords.slice(0, 2).join(", ")}`);
  }

  return changes;
}

/**
 * Calculate average confidence score
 */
function calculateAvgConfidence(matches, bitIds) {
  if (matches.length === 0) return 0.8; // Default high confidence for manual merge

  const relevantMatches = matches.filter(
    (m) => bitIds.includes(m.sourceId) || bitIds.includes(m.targetId)
  );

  if (relevantMatches.length === 0) return 0.8;

  const sum = relevantMatches.reduce((acc, m) => acc + (m.confidence || 0), 0);
  return sum / relevantMatches.length;
}

/**
 * Enhance an existing root bit with new data
 */
export function enhanceRootBit(rootBit, newMatches, newBits) {
  if (!rootBit.isMergedRoot) return rootBit;

  const updatedData = { ...rootBit };

  // Update average confidence
  updatedData.aggregateData.averageConfidence = calculateAvgConfidence(newMatches, rootBit.mergedFrom);

  // Check for new bits to merge
  const allMergedBitIds = new Set(rootBit.mergedFrom);
  const newlyMatched = newBits.filter(
    (b) =>
      newMatches.some((m) => rootBit.mergedFrom.includes(m.sourceId) && m.targetId === b.id) &&
      !allMergedBitIds.has(b.id)
  );

  if (newlyMatched.length > 0) {
    const allBits = [...newBits.filter((b) => rootBit.mergedFrom.includes(b.id)), ...newlyMatched];
    updatedData.mergedFrom = [...new Set([...rootBit.mergedFrom, ...newlyMatched.map((b) => b.id)])];
    updatedData.aggregateData.totalInstances = allBits.length;
    updatedData.aggregateData.variations = analyzeVariations(allBits);
    updatedData.aggregateData.sources = [...new Set(allBits.map((b) => b.sourceFile))];
  }

  updatedData.editHistory.push({
    timestamp: Date.now(),
    action: "enhance",
    details: {
      newBitsAdded: newlyMatched.map((b) => b.id),
    },
  });

  return updatedData;
}

/**
 * Find clusters of similar bits that should be merged
 */
export function findMergeClusters(bits, similarityThreshold = 0.7) {
  const clusters = [];
  const processed = new Set();

  for (let i = 0; i < bits.length; i++) {
    if (processed.has(bits[i].id)) continue;

    const cluster = [bits[i]];
    processed.add(bits[i].id);

    // Find similar bits
    for (let j = i + 1; j < bits.length; j++) {
      if (processed.has(bits[j].id)) continue;

      const similarity = calculateBitSimilarity(bits[i], bits[j]);
      if (similarity >= similarityThreshold) {
        cluster.push(bits[j]);
        processed.add(bits[j].id);
      }
    }

    // Only return clusters with 2+ bits
    if (cluster.length >= 2) {
      clusters.push(cluster.map((b) => b.id));
    }
  }

  return clusters;
}

