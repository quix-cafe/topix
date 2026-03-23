/**
 * Touchstone Detector - Find recurring jokes/bits across transcripts
 * A touchstone is a joke that appears multiple times with variations.
 *
 * Detection: LLM match edges only (same_bit, evolved, related, callback).
 * Same-transcript duplicates are handled by autoDedup before reaching here.
 * All detected touchstones start as "possible" — the user manually confirms or rejects them.
 */

import {
  stringSimilarity,
  extractCommonWords,
} from "./textSimilarity.js";

// ─── Union-Find ────────────────────────────────────────────────────
class UnionFind {
  constructor(ids) {
    this.parent = new Map();
    this.rank = new Map();
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id) {
    while (this.parent.get(id) !== id) {
      this.parent.set(id, this.parent.get(this.parent.get(id))); // path compression
      id = this.parent.get(id);
    }
    return id;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra);
    const rankB = this.rank.get(rb);
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  clusters() {
    const groups = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(id);
    }
    return [...groups.values()].filter((g) => g.length >= 2);
  }
}

// Edge quality score — only same_bit and evolved form touchstone links.
// Related/callback are informational but do NOT create cluster edges.
function edgeScore(m) {
  const pct = m.matchPercentage || (m.confidence || 0) * 100;
  const relWeight = { same_bit: 1.0, evolved: 0.8 }[m.relationship] || 0;
  return pct * relWeight;
}

// Minimum edge score to form a cluster link (same_bit@70% = 70, evolved@70% = 56)
const MIN_EDGE_SCORE = 50;

/**
 * Detect touchstones in a collection of bits
 * Uses only LLM match edges — same-transcript duplicates are handled by autoDedup.
 * Strict rules:
 *   - Only one bit per transcript per touchstone (highest-scoring wins)
 *   - Weak edges (low match% or loose relationship) don't form clusters
 *   - Larger clusters require stronger edges to grow (diminishing returns)
 *   - Near-duplicate touchstones are merged
 * @param {array} bits - Array of bit objects
 * @param {array} matches - LLM-detected match relationships
 * @param {number} minFrequency - Minimum occurrences to be a touchstone (default 2)
 * @returns {object} { confirmed: [], possible: Touchstone[], rejected: [] }
 */
export function detectTouchstones(
  bits,
  matches = [],
  minFrequency = 2,
) {
  if (!bits || bits.length < minFrequency) {
    return { confirmed: [], possible: [], rejected: [] };
  }

  const bitById = new Map(bits.map((b) => [b.id, b]));

  // ── Filter and score edges ─────────────────────────────────────
  // Only cross-transcript, sufficiently strong edges form clusters
  const strongEdges = [];
  for (const m of matches) {
    if (!m.relationship) continue;
    if (!bitById.has(m.sourceId) || !bitById.has(m.targetId)) continue;
    const srcBit = bitById.get(m.sourceId);
    const tgtBit = bitById.get(m.targetId);
    if (srcBit.sourceFile === tgtBit.sourceFile) continue; // cross-transcript only

    const score = edgeScore(m);
    if (score >= MIN_EDGE_SCORE) {
      strongEdges.push({ ...m, _score: score });
    }
  }

  // Sort edges strongest-first so union-find builds tight clusters
  strongEdges.sort((a, b) => b._score - a._score);

  console.log(
    `[Touchstones] ${bits.length} bits → ${strongEdges.length} strong edges (of ${matches.length} total)`
  );

  // ── Build clusters with constraints ────────────────────────────
  const uf = new UnionFind(bits.map((b) => b.id));

  // Track which transcripts are in each cluster root
  // clusterTranscripts: rootId -> Set<sourceFile>
  // clusterSize: rootId -> number
  const clusterTranscripts = new Map();
  const clusterSize = new Map();
  for (const b of bits) {
    clusterTranscripts.set(b.id, new Set([b.sourceFile]));
    clusterSize.set(b.id, 1);
  }

  // Track edge scores per cluster root for median-based threshold
  const clusterEdgeScores = new Map(); // rootId -> [scores]

  let usedEdges = 0;
  for (const edge of strongEdges) {
    const srcRoot = uf.find(edge.sourceId);
    const tgtRoot = uf.find(edge.targetId);
    if (srcRoot === tgtRoot) {
      // Same cluster — record edge score for threshold calculation
      const scores = clusterEdgeScores.get(srcRoot) || [];
      scores.push(edge._score);
      clusterEdgeScores.set(srcRoot, scores);
      continue;
    }

    const srcBit = bitById.get(edge.sourceId);
    const tgtBit = bitById.get(edge.targetId);

    // Would merging create duplicate transcripts in the cluster?
    const srcFiles = clusterTranscripts.get(srcRoot);
    const tgtFiles = clusterTranscripts.get(tgtRoot);
    let hasOverlap = false;
    for (const f of tgtFiles) {
      if (srcFiles.has(f)) { hasOverlap = true; break; }
    }
    if (hasOverlap) continue; // skip — would put 2 bits from same transcript

    // Growth threshold: new members need to be at least 80% of the cluster's
    // median edge score. This allows legitimate large touchstones (a bit she
    // does at every show) while still blocking weak associations.
    const mergedSize = (clusterSize.get(srcRoot) || 1) + (clusterSize.get(tgtRoot) || 1);
    const existingScores = clusterEdgeScores.get(srcRoot) || clusterEdgeScores.get(tgtRoot) || [];
    let growthThreshold = MIN_EDGE_SCORE;
    if (existingScores.length > 0 && mergedSize > 3) {
      const sorted = [...existingScores].sort((a, b) => a - b);
      const medianScore = sorted[Math.floor(sorted.length / 2)];
      growthThreshold = Math.max(MIN_EDGE_SCORE, medianScore * 0.8);
    }
    if (edge._score < growthThreshold) continue;

    // Merge
    uf.union(edge.sourceId, edge.targetId);
    const newRoot = uf.find(edge.sourceId);
    const mergedFiles = new Set([...srcFiles, ...tgtFiles]);
    clusterTranscripts.set(newRoot, mergedFiles);
    clusterSize.set(newRoot, mergedSize);
    // Merge edge score histories
    const mergedScores = [...(clusterEdgeScores.get(srcRoot) || []), ...(clusterEdgeScores.get(tgtRoot) || []), edge._score];
    clusterEdgeScores.set(newRoot, mergedScores);
    usedEdges++;
  }

  console.log(`[Touchstones] ${usedEdges} edges used for clustering`);

  // ── Build touchstone objects from clusters ──────────────────────
  const clusterIds = uf.clusters();
  let allTouchstones = clusterIds
    .map((ids) => {
      const cluster = ids.map((id) => bitById.get(id)).filter(Boolean);
      if (cluster.length < minFrequency) return null;
      return createTouchstone(cluster, matches);
    })
    .filter(Boolean);

  // ── Merge near-duplicate touchstones ───────────────────────────
  allTouchstones = mergeOverlappingTouchstones(allTouchstones, matches, bitById);

  // Sort: most instances first
  allTouchstones.sort((a, b) => b.frequency - a.frequency);

  // All detected touchstones start as "possible" — user manually confirms or rejects
  const possible = allTouchstones.map(t => ({ ...t, category: "possible" }));

  console.log(
    `[Touchstones] Found ${possible.length} possible from ${clusterIds.length} cluster(s)`
  );

  return { confirmed: [], possible, rejected: [] };
}

/**
 * Merge touchstones that share bits or are strongly connected via match edges.
 * Two touchstones merge if they share any bit OR if a strong edge connects
 * a bit from each. After merge, re-enforce one-bit-per-transcript.
 */
function mergeOverlappingTouchstones(touchstones, matches, bitById) {
  if (touchstones.length <= 1) return touchstones;

  // Build a quick lookup: bitId -> touchstone index
  const bitToTs = new Map();
  touchstones.forEach((ts, idx) => {
    for (const id of ts.bitIds) bitToTs.set(id, idx);
  });

  // Find touchstone pairs that should merge
  const tsUf = new UnionFind(touchstones.map((_, i) => i));

  // 1. Shared bits
  // (shouldn't happen normally but handles edge cases)

  // 2. Strong cross-touchstone edges
  for (const m of matches) {
    const tsA = bitToTs.get(m.sourceId);
    const tsB = bitToTs.get(m.targetId);
    if (tsA == null || tsB == null || tsA === tsB) continue;
    const score = edgeScore(m);
    // Only merge touchstones on very strong same_bit edges —
    // touchstones commonly follow one another in a flow, so being
    // connected by a moderate edge does NOT mean they're the same joke
    if (score >= 85) {
      tsUf.union(tsA, tsB);
    }
  }

  const tsClusters = tsUf.clusters();
  if (tsClusters.length === 0) return touchstones;

  // Merge clustered touchstones
  const merged = new Set();
  const result = [];

  for (const group of tsClusters) {
    // Combine all bits, then enforce one-per-transcript (keep strongest-connected)
    const allBitIds = new Set();
    for (const idx of group) {
      for (const id of touchstones[idx].bitIds) allBitIds.add(id);
      merged.add(idx);
    }

    const allBits = [...allBitIds].map(id => bitById.get(id)).filter(Boolean);
    const pruned = enforceOnePerTranscript(allBits, matches);
    if (pruned.length >= 2) {
      result.push(createTouchstone(pruned, matches));
    }
  }

  // Add unmerged touchstones
  touchstones.forEach((ts, idx) => {
    if (!merged.has(idx)) result.push(ts);
  });

  return result;
}

/**
 * Given a set of bits, keep at most one per transcript.
 * For each transcript with multiple bits, keep the one with the strongest
 * match edges to bits in other transcripts.
 */
function enforceOnePerTranscript(bits, matches) {
  const byFile = new Map();
  for (const b of bits) {
    if (!byFile.has(b.sourceFile)) byFile.set(b.sourceFile, []);
    byFile.get(b.sourceFile).push(b);
  }

  const bitIdSet = new Set(bits.map(b => b.id));
  const result = [];

  for (const [, fileBits] of byFile) {
    if (fileBits.length === 1) {
      result.push(fileBits[0]);
      continue;
    }
    // Score each bit by its strongest cross-transcript match edge within this cluster
    let bestBit = fileBits[0];
    let bestScore = -1;
    for (const bit of fileBits) {
      let score = 0;
      for (const m of matches) {
        if (m.sourceId === bit.id && bitIdSet.has(m.targetId)) {
          const other = bits.find(b => b.id === m.targetId);
          if (other && other.sourceFile !== bit.sourceFile) score += edgeScore(m);
        } else if (m.targetId === bit.id && bitIdSet.has(m.sourceId)) {
          const other = bits.find(b => b.id === m.sourceId);
          if (other && other.sourceFile !== bit.sourceFile) score += edgeScore(m);
        }
      }
      if (score > bestScore) { bestScore = score; bestBit = bit; }
    }
    result.push(bestBit);
  }

  return result;
}

/**
 * Identify the "core" bits of a touchstone cluster.
 * Core = bits connected by same_bit or evolved edges (the actual repeated joke).
 * Falls back to the highest-confidence edges if no same_bit/evolved exist.
 * Returns sorted array of bit IDs representing the tightest cluster.
 */
function identifyCoreBits(cluster, relevantMatches) {
  if (cluster.length <= 2) return cluster.map((b) => b.id);

  // Score each bit by how many strong (same_bit/evolved) edges it has
  const CORE_RELS = new Set(["same_bit", "evolved"]);
  const bitScores = new Map(cluster.map((b) => [b.id, 0]));

  for (const m of relevantMatches) {
    if (CORE_RELS.has(m.relationship)) {
      const weight = (m.matchPercentage || (m.confidence || 0) * 100);
      bitScores.set(m.sourceId, (bitScores.get(m.sourceId) || 0) + weight);
      bitScores.set(m.targetId, (bitScores.get(m.targetId) || 0) + weight);
    }
  }

  // Bits with any same_bit/evolved connection are core
  const coreIds = [...bitScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  if (coreIds.length >= 2) return coreIds;

  // Fallback: pick the top bits by highest overall match confidence
  const allScores = new Map(cluster.map((b) => [b.id, 0]));
  for (const m of relevantMatches) {
    const weight = (m.matchPercentage || (m.confidence || 0) * 100);
    allScores.set(m.sourceId, (allScores.get(m.sourceId) || 0) + weight);
    allScores.set(m.targetId, (allScores.get(m.targetId) || 0) + weight);
  }

  return [...allScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(3, cluster.length))
    .map(([id]) => id);
}

/**
 * Create a touchstone object from a cluster of similar bits
 */
function createTouchstone(cluster, matches = []) {
  const sortedByDate = [...cluster].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );

  const firstAppearance = sortedByDate[0];
  const commonWords = extractCommonWords(cluster);
  const touchstoneName = generateTouchstoneName(cluster, commonWords);

  // Separate cross-transcript vs same-transcript instances
  const sourceFiles = [...new Set(cluster.map((b) => b.sourceFile))];
  const crossTranscript = sourceFiles.length > 1;

  // Find which match relationships connect these bits
  const clusterIds = new Set(cluster.map((b) => b.id));
  const relevantMatches = matches.filter(
    (m) => clusterIds.has(m.sourceId) && clusterIds.has(m.targetId)
  );

  // Identify "core" bits — connected by same_bit or evolved edges with highest confidence.
  // These represent the actual repeated joke; loosely-connected related/callback bits are periphery.
  const coreBitIds = identifyCoreBits(cluster, relevantMatches);

  return {
    id: `touchstone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: touchstoneName,
    summary: generateTouchstoneSummary(cluster, relevantMatches),
    bitIds: cluster.map((b) => b.id),
    coreBitIds,
    instances: cluster.map((b, idx) => ({
      bitId: b.id,
      sourceFile: b.sourceFile,
      title: b.title,
      instanceNumber: idx + 1,
      confidence: calculateInstanceConfidence(b, cluster, relevantMatches),
      relationship: getInstanceRelationship(b, cluster, relevantMatches),
    })),
    firstAppearance: {
      transcriptId: firstAppearance.transcriptId,
      bitId: firstAppearance.id,
      sourceFile: firstAppearance.sourceFile,
    },
    frequency: cluster.length,
    crossTranscript,
    sourceCount: sourceFiles.length,
    tags: [...new Set(cluster.flatMap((b) => b.tags || []))],
    commonWords,
    matchInfo: {
      totalMatches: relevantMatches.length,
      sameBitCount: relevantMatches.filter((m) => m.relationship === "same_bit").length,
      evolvedCount: relevantMatches.filter((m) => m.relationship === "evolved").length,
      relatedCount: relevantMatches.filter((m) => m.relationship === "related").length,
      callbackCount: relevantMatches.filter((m) => m.relationship === "callback").length,
      avgConfidence:
        relevantMatches.length > 0
          ? relevantMatches.reduce((s, m) => s + (m.confidence || 0), 0) / relevantMatches.length
          : 0,
      avgMatchPercentage:
        relevantMatches.length > 0
          ? Math.round(relevantMatches.reduce((s, m) => s + (m.matchPercentage || (m.confidence || 0) * 100), 0) / relevantMatches.length)
          : 0,
      reasons: relevantMatches
        .filter((m) => m.reason)
        .map((m) => m.reason),
    },
  };
}

/**
 * Determine how a bit relates to the cluster (for display)
 */
function getInstanceRelationship(bit, cluster, matches) {
  // Check if there's a match connecting this bit to others in the cluster
  for (const m of matches) {
    if (m.sourceId === bit.id || m.targetId === bit.id) {
      return m.relationship; // "same_bit", "evolved", etc.
    }
  }

  // Check if same-transcript duplicate
  const sameFileBits = cluster.filter(
    (b) => b.id !== bit.id && b.sourceFile === bit.sourceFile
  );
  if (sameFileBits.length > 0) return "same_transcript_duplicate";

  return "text_similarity";
}

/**
 * Generate a touchstone name based on common words
 */
function generateTouchstoneName(cluster, commonWords) {
  if (commonWords.length > 0) {
    const name = commonWords.slice(0, 3).join(" ");
    return `"${name}"`;
  }
  return `"${cluster[0]?.title || "Unknown Touchstone"}"`;
}

/**
 * Generate a summary for the touchstone
 */
function generateTouchstoneSummary(cluster, matches) {
  // Use the top match reason as the summary if available
  const reasons = matches
    .map((m) => m.reason)
    .filter(Boolean);
  if (reasons.length > 0) return reasons[0];
  return "";
}

/**
 * Calculate how confident this is an instance of the touchstone
 * Uses match data when available, falls back to title similarity
 */
function calculateInstanceConfidence(bit, cluster, matches) {
  if (cluster.length <= 1) return 1;
  const firstBit = cluster[0];
  if (bit.id === firstBit.id) return 1;

  // Check for a direct match edge with this bit
  for (const m of matches) {
    if ((m.sourceId === bit.id || m.targetId === bit.id) &&
        (m.sourceId === firstBit.id || m.targetId === firstBit.id)) {
      return m.confidence || 0;
    }
  }

  // Fallback: title similarity
  return stringSimilarity(bit.title || "", firstBit.title || "");
}

/**
 * Enforce exclusive bit ownership across all touchstone categories.
 * Each bit belongs to at most one touchstone. Priority:
 *   1. confirmed > possible (confirmed always wins)
 *   2. Within same category: highest match score wins
 *
 * @param {object} touchstones - { confirmed: [], possible: [], rejected: [] }
 * @param {array} matches - All match edges
 * @returns {object} Deduplicated { confirmed, possible, rejected }
 */
export function deduplicateBitOwnership(touchstones, matches) {
  const claimed = new Map(); // bitId -> { category, tsId, score }

  // Score a bit's membership in a touchstone by its strongest match edge
  // to any other bit in that touchstone
  const scoreBitInTouchstone = (bitId, ts) => {
    let best = 0;
    for (const m of matches) {
      const otherId = m.sourceId === bitId ? m.targetId : m.targetId === bitId ? m.sourceId : null;
      if (!otherId || !ts.bitIds.includes(otherId)) continue;
      const score = edgeScore(m);
      if (score > best) best = score;
    }
    return best;
  };

  const categoryPriority = { confirmed: 3, possible: 2, rejected: 1 };
  const getPriority = (ts) => (ts.manual ? 10 : 0) + (categoryPriority[ts._cat] || 0);

  // Process all touchstones, claiming bits for the best owner
  const allTouchstones = [
    ...(touchstones.confirmed || []).map(ts => ({ ...ts, _cat: 'confirmed' })),
    ...(touchstones.possible || []).map(ts => ({ ...ts, _cat: 'possible' })),
  ];

  for (const ts of allTouchstones) {
    const removedSet = new Set(ts.removedBitIds || []);
    for (const bitId of ts.bitIds) {
      if (removedSet.has(bitId)) continue; // user explicitly removed — never re-assign
      const score = scoreBitInTouchstone(bitId, ts);
      const existing = claimed.get(bitId);
      if (!existing) {
        claimed.set(bitId, { category: ts._cat, tsId: ts.id, score, manual: ts.manual });
        continue;
      }
      // Higher category priority (and manual flag) wins; within same priority, higher score wins
      const existingPri = (existing.manual ? 10 : 0) + (categoryPriority[existing.category] || 0);
      const newPri = getPriority(ts);
      if (newPri > existingPri || (newPri === existingPri && score > existing.score)) {
        claimed.set(bitId, { category: ts._cat, tsId: ts.id, score, manual: ts.manual });
      }
    }
  }

  // Remove stolen bits from touchstones
  const pruneTouchstone = (ts, cat) => {
    const kept = ts.bitIds.filter(id => {
      const owner = claimed.get(id);
      return owner && owner.tsId === ts.id;
    });
    if (kept.length < 2 && !ts.manual) return null; // touchstone dissolved
    if (kept.length === ts.bitIds.length) return ts; // unchanged
    return {
      ...ts,
      bitIds: kept,
      instances: ts.instances.filter(i => kept.includes(i.bitId)),
      frequency: kept.length,
    };
  };

  const confirmed = (touchstones.confirmed || []).map(ts => pruneTouchstone(ts, 'confirmed')).filter(Boolean);
  const possible = (touchstones.possible || []).map(ts => pruneTouchstone(ts, 'possible')).filter(Boolean);

  return { confirmed, possible, rejected: touchstones.rejected || [] };
}

/**
 * Update bits with touchstone information
 */
export function annotateBitsWithTouchstones(bits, touchstones) {
  return bits.map((bit) => {
    for (const touchstone of touchstones) {
      if (touchstone.bitIds.includes(bit.id)) {
        const instanceNumber =
          touchstone.instances.find((i) => i.bitId === bit.id)?.instanceNumber || 0;
        return {
          ...bit,
          touchstoneId: touchstone.id,
          instanceNumber,
          isTouchstoneInstance: true,
        };
      }
    }
    return bit;
  });
}

/**
 * Find all instances of a touchstone
 */
export function getTouchstoneInstances(touchstoneId, bits) {
  return bits.filter((b) => b.touchstoneId === touchstoneId);
}

/**
 * Get touchstones for a specific bit
 */
export function getBitTouchstones(bitId, touchstones) {
  return touchstones.filter((t) => t.bitIds.includes(bitId));
}
