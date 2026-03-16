/**
 * Pre-Clustering for Touchstone Hunt
 *
 * Groups bits into candidate clusters BEFORE making LLM calls,
 * using match-graph neighborhoods and text similarity.
 * Dramatically reduces LLM calls by skipping bits with no plausible matches.
 */

import { toWordBag, wordOverlapScore } from "./textSimilarity.js";
import { buildKeywordIndex } from "./similaritySearch.js";

const MIN_WORD_OVERLAP = 0.15; // ~1 in 7 words shared
const MERGE_THRESHOLD = 0.20; // overlap to merge text cluster into graph neighborhood
const MAX_CANDIDATES_PER_BATCH = 5;
const MAX_ANCHORS = 3;
const LARGE_CLUSTER_SIZE = 6;

/**
 * Union-Find for clustering
 */
class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  find(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    const rankX = this.rank.get(rx);
    const rankY = this.rank.get(ry);
    if (rankX < rankY) this.parent.set(rx, ry);
    else if (rankX > rankY) this.parent.set(ry, rx);
    else { this.parent.set(ry, rx); this.rank.set(rx, rankX + 1); }
  }

  components() {
    const groups = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(id);
    }
    return [...groups.values()];
  }
}

/**
 * Build candidate clusters from bits using match-graph neighborhoods
 * and text similarity.
 *
 * @param {array} bits - Cross-transcript bits to cluster
 * @param {array} existingMatches - All existing match edges (including related/callback)
 * @returns {array} Array of clusters, each an array of bit IDs
 */
export function buildHuntClusters(bits, existingMatches) {
  const bitIds = new Set(bits.map(b => b.id));
  const bitsById = new Map(bits.map(b => [b.id, b]));
  const uf = new UnionFind();

  // Initialize all bits in union-find
  for (const id of bitIds) uf.find(id);

  // --- Layer 1: Match-graph neighborhoods ---
  // Only same_bit/evolved edges form transitive clusters (union-find).
  // related/callback edges just mark both bits as "has neighbors" so they
  // become candidates in Layer 3 merging — but they do NOT union, preventing
  // catch-all mega-clusters from topic-level associations.
  const graphBits = new Set();
  const neighborBits = new Set(); // bits with related/callback edges (candidates only)
  for (const m of existingMatches) {
    if (!bitIds.has(m.sourceId) || !bitIds.has(m.targetId)) continue;
    const rel = m.relationship;
    if (rel === 'same_bit' || rel === 'evolved') {
      uf.union(m.sourceId, m.targetId);
      graphBits.add(m.sourceId);
      graphBits.add(m.targetId);
    } else {
      // related/callback: mark as having neighbors but don't union
      neighborBits.add(m.sourceId);
      neighborBits.add(m.targetId);
    }
  }
  // --- Layer 2: Text similarity for bits not in same_bit/evolved clusters ---
  // neighborBits (related/callback only) are included here — they have graph
  // edges but aren't union'd, so they still need text-similarity clustering
  const unmatchedBits = bits.filter(b => !graphBits.has(b.id));

  // Pre-compute word bags
  const wordBags = new Map();
  const getWordBag = (bit) => {
    if (!wordBags.has(bit.id)) {
      const text = [bit.title || "", bit.summary || "", bit.fullText || ""].join(" ");
      wordBags.set(bit.id, toWordBag(text));
    }
    return wordBags.get(bit.id);
  };

  // Build keyword index for unmatched bits to find pairs sharing 2+ keywords/tags
  if (unmatchedBits.length > 1) {
    const { index } = buildKeywordIndex(unmatchedBits);

    // Find pairs sharing 2+ terms
    const pairCounts = new Map();
    for (const [, bitIdSet] of index) {
      const ids = [...bitIdSet];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join(":");
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    // For pairs with 2+ shared terms, check word overlap
    for (const [key, count] of pairCounts) {
      if (count < 2) continue;
      const [idA, idB] = key.split(":");
      const bitA = bitsById.get(idA);
      const bitB = bitsById.get(idB);
      if (!bitA || !bitB) continue;
      // Skip same-transcript pairs
      if (bitA.sourceFile === bitB.sourceFile) continue;

      const score = wordOverlapScore(getWordBag(bitA), getWordBag(bitB));
      if (score >= MIN_WORD_OVERLAP) {
        uf.union(idA, idB);
      }
    }
  }

  // --- Layer 3: Merge text clusters into graph neighborhoods ---
  // If any Layer 2 member overlaps enough with a Layer 1 member, merge them
  if (graphBits.size > 0 && unmatchedBits.length > 0) {
    for (const uBit of unmatchedBits) {
      for (const gId of graphBits) {
        const gBit = bitsById.get(gId);
        if (!gBit || uBit.sourceFile === gBit.sourceFile) continue;
        const score = wordOverlapScore(getWordBag(uBit), getWordBag(gBit));
        if (score >= MERGE_THRESHOLD) {
          uf.union(uBit.id, gId);
          break; // One merge is enough to link into the neighborhood
        }
      }
    }
  }

  // Extract clusters with 2+ bits from different transcripts
  const clusters = uf.components().filter(cluster => {
    if (cluster.length < 2) return false;
    const files = new Set(cluster.map(id => bitsById.get(id)?.sourceFile));
    return files.size >= 2;
  });

  console.log(`[PreCluster] ${clusters.length} clusters from ${bits.length} bits (${graphBits.size} in graph neighborhoods)`);
  return clusters;
}

/**
 * Convert clusters into LLM batch format: {source, candidates[]}
 *
 * @param {array} clusters - Array of bit ID arrays from buildHuntClusters
 * @param {array} bits - All cross-transcript bits
 * @param {array} existingMatches - Existing match edges (to skip already-compared pairs)
 * @returns {array} Array of {source: bit, candidates: bit[]}
 */
export function buildLLMBatches(clusters, bits, existingMatches) {
  const bitsById = new Map(bits.map(b => [b.id, b]));

  // Set of already-matched pairs to skip
  const existingPairs = new Set(
    existingMatches.map(m => [m.sourceId, m.targetId].sort().join(":"))
  );

  const batches = [];
  const scheduledPairs = new Set();

  for (const cluster of clusters) {
    const clusterBits = cluster.map(id => bitsById.get(id)).filter(Boolean);

    // Generate pairs to compare
    let pairs;
    if (clusterBits.length <= LARGE_CLUSTER_SIZE) {
      // Small cluster: all cross-transcript pairs
      pairs = allCrossTranscriptPairs(clusterBits);
    } else {
      // Large cluster: anchor strategy
      pairs = anchorPairs(clusterBits);
    }

    // Filter out already-compared and already-scheduled pairs
    pairs = pairs.filter(([a, b]) => {
      const key = [a.id, b.id].sort().join(":");
      if (existingPairs.has(key) || scheduledPairs.has(key)) return false;
      scheduledPairs.add(key);
      return true;
    });

    if (pairs.length === 0) continue;

    // Group pairs by source bit for batching
    const bySource = new Map();
    for (const [source, candidate] of pairs) {
      if (!bySource.has(source.id)) bySource.set(source.id, { source, candidates: [] });
      bySource.get(source.id).candidates.push(candidate);
    }

    for (const { source, candidates } of bySource.values()) {
      // Split into batches of MAX_CANDIDATES_PER_BATCH
      for (let i = 0; i < candidates.length; i += MAX_CANDIDATES_PER_BATCH) {
        batches.push({
          source,
          candidates: candidates.slice(i, i + MAX_CANDIDATES_PER_BATCH),
        });
      }
    }
  }

  const totalPairs = batches.reduce((sum, b) => sum + b.candidates.length, 0);
  console.log(`[PreCluster] ${batches.length} LLM batches, ${totalPairs} candidate pairs`);
  return batches;
}

/**
 * Generate all cross-transcript pairs from a small cluster
 */
function allCrossTranscriptPairs(clusterBits) {
  const pairs = [];
  for (let i = 0; i < clusterBits.length; i++) {
    for (let j = i + 1; j < clusterBits.length; j++) {
      if (clusterBits[i].sourceFile !== clusterBits[j].sourceFile) {
        pairs.push([clusterBits[i], clusterBits[j]]);
      }
    }
  }
  return pairs;
}

/**
 * Anchor strategy for large clusters:
 * Pick 2-3 bits closest to cluster centroid, compare non-anchors only against anchors.
 */
function anchorPairs(clusterBits) {
  // Compute word bags
  const bags = new Map();
  for (const bit of clusterBits) {
    const text = [bit.title || "", bit.summary || "", bit.fullText || ""].join(" ");
    bags.set(bit.id, toWordBag(text));
  }

  // Score each bit by average overlap with all others (centrality)
  const centrality = clusterBits.map(bit => {
    let totalOverlap = 0;
    let count = 0;
    for (const other of clusterBits) {
      if (other.id === bit.id) continue;
      totalOverlap += wordOverlapScore(bags.get(bit.id), bags.get(other.id));
      count++;
    }
    return { bit, score: count > 0 ? totalOverlap / count : 0 };
  });

  centrality.sort((a, b) => b.score - a.score);
  const anchors = centrality.slice(0, MAX_ANCHORS).map(c => c.bit);
  const anchorIds = new Set(anchors.map(a => a.id));
  const nonAnchors = clusterBits.filter(b => !anchorIds.has(b.id));

  const pairs = [];

  // Anchor-to-anchor pairs (cross-transcript)
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      if (anchors[i].sourceFile !== anchors[j].sourceFile) {
        pairs.push([anchors[i], anchors[j]]);
      }
    }
  }

  // Non-anchor to anchor pairs (cross-transcript)
  for (const bit of nonAnchors) {
    for (const anchor of anchors) {
      if (bit.sourceFile !== anchor.sourceFile) {
        pairs.push([anchor, bit]);
      }
    }
  }

  return pairs;
}
