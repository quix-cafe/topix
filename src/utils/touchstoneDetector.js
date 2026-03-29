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
  // Strong edges form clusters — both cross-transcript and same-transcript
  // (same-transcript handles split/combined jokes)
  const strongEdges = [];
  for (const m of matches) {
    if (!m.relationship) continue;
    if (!bitById.has(m.sourceId) || !bitById.has(m.targetId)) continue;

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
  // clusterTranscripts: rootId -> [sourceFile, ...] (array, not set — allows counting duplicates)
  // clusterSize: rootId -> number
  const clusterTranscripts = new Map();
  const clusterSize = new Map();
  for (const b of bits) {
    clusterTranscripts.set(b.id, [b.sourceFile]);
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

    // Allow same-transcript bits (split/combined jokes) but cap at MAX_PER_TRANSCRIPT
    const MAX_PER_TRANSCRIPT = 3;
    const srcFiles = clusterTranscripts.get(srcRoot);
    const tgtFiles = clusterTranscripts.get(tgtRoot);
    let wouldExceedCap = false;
    // Count per-file bits after merge
    const mergedFileCounts = new Map();
    for (const f of srcFiles) mergedFileCounts.set(f, (mergedFileCounts.get(f) || 0) + 1);
    for (const f of tgtFiles) mergedFileCounts.set(f, (mergedFileCounts.get(f) || 0) + 1);
    for (const count of mergedFileCounts.values()) {
      if (count > MAX_PER_TRANSCRIPT) { wouldExceedCap = true; break; }
    }
    if (wouldExceedCap) continue;

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
    const mergedFiles = [...srcFiles, ...tgtFiles];
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

  // Post-clustering pruning: remove bits that only connect to one other cluster
  // member via a single edge (transitive drift). In clusters of 3+, each bit
  // must have qualifying edges to at least 2 other members.
  const prunedClusterIds = clusterIds.map((ids) => {
    if (ids.length <= 2) return ids; // pairs are already validated by edge threshold
    const idSet = new Set(ids);
    // Build per-bit neighbor count (how many OTHER cluster members this bit has strong edges to)
    const neighborCount = new Map(ids.map(id => [id, 0]));
    for (const edge of strongEdges) {
      if (idSet.has(edge.sourceId) && idSet.has(edge.targetId)) {
        neighborCount.set(edge.sourceId, (neighborCount.get(edge.sourceId) || 0) + 1);
        neighborCount.set(edge.targetId, (neighborCount.get(edge.targetId) || 0) + 1);
      }
    }
    // Keep bits connected to 2+ other cluster members, OR connected to 1 with a same_bit edge
    const kept = ids.filter(id => {
      const count = neighborCount.get(id) || 0;
      if (count >= 2) return true;
      // Allow single-edge bits only if that edge is same_bit (very high confidence)
      if (count === 1) {
        return strongEdges.some(e =>
          (e.sourceId === id || e.targetId === id) &&
          idSet.has(e.sourceId) && idSet.has(e.targetId) &&
          e.relationship === "same_bit"
        );
      }
      return false;
    });
    return kept;
  });

  let allTouchstones = prunedClusterIds
    .map((ids) => {
      const cluster = ids.map((id) => bitById.get(id)).filter(Boolean);
      if (cluster.length < minFrequency) return null;
      // Require at least 2 unique transcripts — same-transcript-only clusters
      // are just split bits, not recurring touchstones
      const uniqueSources = new Set(cluster.map(b => b.sourceFile));
      if (uniqueSources.size < 2) return null;
      return createTouchstone(cluster, matches);
    })
    .filter(Boolean);

  // ── Merge near-duplicate touchstones ───────────────────────────
  allTouchstones = mergeOverlappingTouchstones(allTouchstones, matches, bitById);

  // Sort: most instances first
  allTouchstones.sort((a, b) => b.frequency - a.frequency);

  // ── Detect orphaned pairs — strong edges between unclustered bits ──
  // Bits that have solid matching criteria but didn't cluster (e.g. due to
  // growth threshold or transcript overlap constraints) may still warrant
  // a possible touchstone.
  const clusteredBitIds = new Set(allTouchstones.flatMap(t => t.bitIds));
  const orphanEdges = strongEdges.filter(edge => {
    if (clusteredBitIds.has(edge.sourceId) || clusteredBitIds.has(edge.targetId)) return false;
    const srcBit = bitById.get(edge.sourceId);
    const tgtBit = bitById.get(edge.targetId);
    return srcBit && tgtBit && edge._score >= MIN_EDGE_SCORE;
  });

  // Build orphan clusters from these edges using a fresh union-find
  if (orphanEdges.length > 0) {
    const orphanBitIds = new Set(orphanEdges.flatMap(e => [e.sourceId, e.targetId]));
    const orphanUf = new UnionFind([...orphanBitIds]);
    for (const edge of orphanEdges) {
      orphanUf.union(edge.sourceId, edge.targetId);
    }
    const orphanClusters = orphanUf.clusters();
    for (const ids of orphanClusters) {
      const cluster = ids.map(id => bitById.get(id)).filter(Boolean);
      const pruned = capBitsPerTranscript(cluster, matches);
      const uniqueSources = new Set(pruned.map(b => b.sourceFile));
      if (pruned.length >= minFrequency && uniqueSources.size >= 2) {
        allTouchstones.push(createTouchstone(pruned, matches));
      }
    }
    if (orphanClusters.length > 0) {
      console.log(`[Touchstones] Found ${orphanClusters.length} orphan pair(s) from unclustered bits`);
    }
  }

  // ── Cross-membership: let bits join additional touchstones ────
  // A bit already in one touchstone can also appear in another if it has
  // strong edges to that touchstone's members (e.g. a joke that overlaps
  // two distinct touchstone themes).
  const CROSS_MEMBERSHIP_THRESHOLD = 70;
  let crossAdded = 0;
  for (const ts of allTouchstones) {
    const tsBitSet = new Set(ts.bitIds);
    for (const edge of strongEdges) {
      if (edge._score < CROSS_MEMBERSHIP_THRESHOLD) continue;
      // One end in this touchstone, other end not
      let outsideBitId = null;
      if (tsBitSet.has(edge.sourceId) && !tsBitSet.has(edge.targetId)) outsideBitId = edge.targetId;
      else if (tsBitSet.has(edge.targetId) && !tsBitSet.has(edge.sourceId)) outsideBitId = edge.sourceId;
      if (!outsideBitId) continue;

      const outsideBit = bitById.get(outsideBitId);
      if (!outsideBit) continue;

      // Check per-transcript cap in this touchstone
      const sameFileBits = ts.bitIds.filter(id => bitById.get(id)?.sourceFile === outsideBit.sourceFile);
      if (sameFileBits.length >= MAX_BITS_PER_TRANSCRIPT) continue;

      // Must have edges to at least 2 members of this touchstone (or 1 same_bit)
      let memberEdges = 0;
      let hasSameBit = false;
      for (const e2 of strongEdges) {
        const otherId = e2.sourceId === outsideBitId ? e2.targetId : (e2.targetId === outsideBitId ? e2.sourceId : null);
        if (otherId && tsBitSet.has(otherId)) {
          memberEdges++;
          if (e2.relationship === "same_bit") hasSameBit = true;
        }
      }
      if (memberEdges < 2 && !hasSameBit) continue;

      tsBitSet.add(outsideBitId);
      ts.bitIds.push(outsideBitId);
      ts.instances.push({
        bitId: outsideBitId,
        sourceFile: outsideBit.sourceFile,
        title: outsideBit.title,
        instanceNumber: ts.instances.length + 1,
        confidence: edge._score / 100,
        relationship: edge.relationship || "same_bit",
      });
      ts.frequency = ts.instances.length;
      crossAdded++;
    }
  }
  if (crossAdded > 0) console.log(`[Touchstones] Added ${crossAdded} cross-membership bit(s) to existing touchstones`);

  // All detected touchstones start as "possible" — user manually confirms or rejects
  const possible = allTouchstones.map(t => ({ ...t, category: "possible" }));

  const prunedCount = clusterIds.reduce((n, ids, i) => n + ids.length - prunedClusterIds[i].length, 0);
  if (prunedCount > 0) console.log(`[Touchstones] Pruned ${prunedCount} weakly-connected bit(s) from clusters`);
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
    if (score >= 75) {
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
    const pruned = capBitsPerTranscript(allBits, matches);
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
 * Soft-cap bits per transcript: allow up to MAX_PER_TRANSCRIPT bits from the
 * same transcript (split/combined jokes), keeping the strongest-connected ones.
 */
const MAX_BITS_PER_TRANSCRIPT = 3;
function capBitsPerTranscript(bits, matches) {
  const byFile = new Map();
  for (const b of bits) {
    if (!byFile.has(b.sourceFile)) byFile.set(b.sourceFile, []);
    byFile.get(b.sourceFile).push(b);
  }

  const bitIdSet = new Set(bits.map(b => b.id));
  const result = [];

  for (const [, fileBits] of byFile) {
    if (fileBits.length <= MAX_BITS_PER_TRANSCRIPT) {
      result.push(...fileBits);
      continue;
    }
    // Score each bit by its match edges within this cluster, keep top N
    const scored = fileBits.map(bit => {
      let score = 0;
      for (const m of matches) {
        if (m.sourceId === bit.id && bitIdSet.has(m.targetId)) score += edgeScore(m);
        else if (m.targetId === bit.id && bitIdSet.has(m.sourceId)) score += edgeScore(m);
      }
      return { bit, score };
    }).sort((a, b) => b.score - a.score);
    result.push(...scored.slice(0, MAX_BITS_PER_TRANSCRIPT).map(s => s.bit));
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

/**
 * Prune bits from a touchstone using text similarity as ground truth.
 * No LLM calls — ignores claimed match scores entirely and checks whether
 * the actual text of each bit corroborates membership.
 *
 * Strategy:
 *   1. Identify the "anchor" text — the core bits' fullText, or the 2 most-connected bits
 *   2. For every other bit, compute word overlap against ALL anchor texts
 *   3. Prune bits whose best text similarity to any anchor is below threshold
 *   4. Graph connectivity is a secondary signal (zero-edge bits always pruned)
 *
 * This catches the main failure mode: LLM gives inflated same_bit scores
 * to bits that are merely on the same topic but not the same joke.
 *
 * @param {object} touchstone - The touchstone to prune
 * @param {array} matches - All match edges
 * @param {array} bits - All bits (for text lookup)
 * @returns {{ pruned: object|null, removed: string[], details: object[] }}
 */
export function pruneWeakBits(touchstone, matches, bits) {
  const bitIds = new Set(touchstone.bitIds);
  if (bitIds.size <= 2) return { pruned: touchstone, removed: [], details: [] };

  const bitById = new Map(bits.map(b => [b.id, b]));
  const coreBitIdSet = new Set(touchstone.coreBitIds || []);

  // ── Identify anchor bits (ground truth for what this touchstone IS) ──
  // Use core bits if available; otherwise pick the 2 bits with strongest mutual edges
  let anchorIds;
  if (coreBitIdSet.size >= 2) {
    anchorIds = [...coreBitIdSet];
  } else {
    // Find the pair with the strongest edge within this touchstone
    let bestPair = null, bestScore = 0;
    for (const m of matches) {
      if (!bitIds.has(m.sourceId) || !bitIds.has(m.targetId)) continue;
      const score = edgeScore(m);
      if (score > bestScore) { bestScore = score; bestPair = [m.sourceId, m.targetId]; }
    }
    anchorIds = bestPair || [...bitIds].slice(0, 2);
  }
  const anchorSet = new Set(anchorIds);

  // Pre-compute anchor word bags (words 4+ chars, lowercased)
  const anchorWordBags = anchorIds
    .map(id => bitById.get(id))
    .filter(b => b?.fullText)
    .map(b => textToWordBag(b.fullText));

  // If the touchstone has an idealText, use it as the primary anchor —
  // it's the distilled essence of the joke and the best signal for membership
  if (touchstone.idealText) {
    anchorWordBags.unshift(textToWordBag(touchstone.idealText));
  }

  // Extract key terms from userReasons ("why matched") — these are high-signal
  // words/phrases the user explicitly identified as defining this touchstone
  const reasonKeywords = new Set();
  for (const reason of (touchstone.userReasons || [])) {
    for (const word of textToWordBag(reason)) {
      reasonKeywords.add(word);
    }
  }

  if (anchorWordBags.length === 0) return { pruned: touchstone, removed: [], details: [] };

  // ── Also compute pairwise text similarity between ALL pairs ──
  // This gives us median similarity to calibrate the threshold
  const allBitsWithText = [...bitIds].map(id => ({ id, bag: textToWordBag(bitById.get(id)?.fullText || "") })).filter(b => b.bag.size > 0);
  const pairSims = [];
  for (let i = 0; i < allBitsWithText.length; i++) {
    for (let j = i + 1; j < allBitsWithText.length; j++) {
      pairSims.push(wordBagOverlap(allBitsWithText[i].bag, allBitsWithText[j].bag));
    }
  }
  pairSims.sort((a, b) => a - b);
  const medianSim = pairSims.length > 0 ? pairSims[Math.floor(pairSims.length / 2)] : 0;

  // Threshold: at least 60% of median pairwise similarity, with a floor of 0.08
  // This is adaptive — a touchstone about a very specific joke will have high median sim
  // and thus a high threshold; a broad cluster will have lower threshold
  const SIM_FLOOR = 0.08;
  const threshold = Math.max(SIM_FLOOR, medianSim * 0.6);

  // ── Build graph connectivity as secondary signal ──
  const neighborCount = new Map();
  for (const id of bitIds) neighborCount.set(id, 0);
  for (const m of matches) {
    if (!bitIds.has(m.sourceId) || !bitIds.has(m.targetId)) continue;
    if (edgeScore(m) < MIN_EDGE_SCORE) continue;
    neighborCount.set(m.sourceId, (neighborCount.get(m.sourceId) || 0) + 1);
    neighborCount.set(m.targetId, (neighborCount.get(m.targetId) || 0) + 1);
  }

  // ── Evaluate each bit ──
  const removed = [];
  const details = [];
  for (const id of bitIds) {
    // Never prune sainted/blessed instances
    const instance = (touchstone.instances || []).find(i => i.bitId === id);
    if (instance?.communionStatus === "sainted" || instance?.communionStatus === "blessed") continue;
    // Never prune anchors
    if (anchorSet.has(id)) continue;

    const bit = bitById.get(id);
    const bag = bit?.fullText ? textToWordBag(bit.fullText) : new Set();
    const neighbors = neighborCount.get(id) || 0;

    // Compute best text similarity to any anchor (including idealText if present)
    let bestAnchorSim = 0;
    for (const anchorBag of anchorWordBags) {
      const sim = wordBagOverlap(bag, anchorBag);
      if (sim > bestAnchorSim) bestAnchorSim = sim;
    }

    // Check how many user-defined reason keywords appear in this bit's text
    let reasonHits = 0;
    if (reasonKeywords.size > 0) {
      for (const kw of reasonKeywords) {
        if (bag.has(kw)) reasonHits++;
      }
    }
    const reasonScore = reasonKeywords.size > 0 ? reasonHits / reasonKeywords.size : 0;

    // Also compute avg similarity to ALL other touchstone members
    let totalSim = 0, simCount = 0;
    for (const other of allBitsWithText) {
      if (other.id === id) continue;
      totalSim += wordBagOverlap(bag, other.bag);
      simCount++;
    }
    const avgSim = simCount > 0 ? totalSim / simCount : 0;

    // A bit is saved from pruning if it matches enough user-defined reason keywords
    // (these are high-confidence signals the user explicitly provided)
    const savedByReasons = reasonScore >= 0.4;

    const shouldPrune = !savedByReasons && (
      // No text at all
      bag.size === 0 ||
      // Zero graph edges AND below text threshold
      (neighbors === 0 && bestAnchorSim < threshold * 1.5) ||
      // Below text similarity threshold to anchors AND below average
      (bestAnchorSim < threshold && avgSim < threshold)
    );

    if (shouldPrune) {
      removed.push(id);
      details.push({ id, title: bit?.title, anchorSim: bestAnchorSim, avgSim, reasonScore, neighbors, threshold });
    }
  }

  if (removed.length === 0) return { pruned: touchstone, removed: [], details: [] };

  const removedSet = new Set(removed);
  const keptBitIds = touchstone.bitIds.filter(id => !removedSet.has(id));
  const keptInstances = (touchstone.instances || []).filter(i => !removedSet.has(i.bitId));

  if (keptBitIds.length < 2 && !touchstone.manual) {
    return { pruned: null, removed, details };
  }

  return {
    pruned: {
      ...touchstone,
      bitIds: keptBitIds,
      coreBitIds: (touchstone.coreBitIds || []).filter(id => !removedSet.has(id)),
      instances: keptInstances,
      frequency: keptBitIds.length,
      sourceCount: new Set(keptInstances.map(i => i.sourceFile)).size,
      removedBitIds: [...new Set([...(touchstone.removedBitIds || []), ...removed])],
    },
    removed,
    details,
  };
}

/**
 * Recalculate match percentages using text similarity as a ceiling.
 * Instant — no LLM calls. For each match edge:
 *   1. Compute word overlap between the two bits' fullText
 *   2. Map that overlap to a percentage ceiling (0.30 overlap → 90% ceiling, etc.)
 *   3. If the stored matchPercentage exceeds the ceiling, cap it
 *   4. Downgrade relationship if capped score drops below relationship threshold
 *   5. Remove matches that drop below minimum viable score
 *
 * @param {array} matches - All match edges
 * @param {array} bits - All bits (for text lookup)
 * @returns {{ updated: array, stats: { capped: number, downgraded: number, removed: number, unchanged: number } }}
 */
/**
 * Rebuild a touchstone's matchInfo from current match data.
 * Call this after recalcMatchScores to update the stale snapshot.
 */
export function rebuildMatchInfo(touchstone, matches) {
  const bitIdSet = new Set(touchstone.bitIds);
  const relevantMatches = matches.filter(m =>
    bitIdSet.has(m.sourceId) && bitIdSet.has(m.targetId)
  );

  const updatedInstances = (touchstone.instances || []).map(inst => {
    const instMatches = relevantMatches.filter(m =>
      m.sourceId === inst.bitId || m.targetId === inst.bitId
    );
    const bestMatch = instMatches.reduce((best, m) => {
      const pct = m.matchPercentage || (m.confidence || 0) * 100;
      return pct > (best.matchPercentage || 0) ? { ...best, matchPercentage: pct, relationship: m.relationship } : best;
    }, { matchPercentage: 0, relationship: inst.relationship });

    const pct = bestMatch.matchPercentage || inst.matchPercentage || 0;
    return {
      ...inst,
      relationship: bestMatch.relationship || inst.relationship,
      matchPercentage: pct,
      confidence: pct / 100,
    };
  });

  return {
    ...touchstone,
    instances: updatedInstances,
    matchInfo: {
      ...touchstone.matchInfo,
      totalMatches: relevantMatches.length,
      sameBitCount: relevantMatches.filter(m => m.relationship === "same_bit").length,
      evolvedCount: relevantMatches.filter(m => m.relationship === "evolved").length,
      relatedCount: relevantMatches.filter(m => m.relationship === "related").length,
      callbackCount: relevantMatches.filter(m => m.relationship === "callback").length,
      avgConfidence: relevantMatches.length > 0
        ? relevantMatches.reduce((s, m) => s + (m.confidence || 0), 0) / relevantMatches.length
        : 0,
      avgMatchPercentage: relevantMatches.length > 0
        ? Math.round(relevantMatches.reduce((s, m) => s + (m.matchPercentage || (m.confidence || 0) * 100), 0) / relevantMatches.length)
        : 0,
      reasons: relevantMatches.filter(m => m.reason).map(m => m.reason),
    },
  };
}

export function recalcMatchScores(matches, bits) {
  const bitById = new Map(bits.map(b => [b.id, b]));
  const stats = { capped: 0, downgraded: 0, removed: 0, unchanged: 0 };
  const updated = [];

  for (const m of matches) {
    const src = bitById.get(m.sourceId);
    const tgt = bitById.get(m.targetId);

    if (!src?.fullText || !tgt?.fullText) {
      updated.push(m);
      stats.unchanged++;
      continue;
    }

    const srcBag = textToWordBag(src.fullText);
    const tgtBag = textToWordBag(tgt.fullText);
    const overlap = wordBagOverlap(srcBag, tgtBag);

    // Map text overlap to a percentage ceiling.
    // These thresholds are calibrated for comedy bits:
    //   - Same joke verbatim: ~0.40+ overlap (comedy bits reuse specific punchline words)
    //   - Evolved joke: ~0.15-0.40 overlap (shared premise words, different execution)
    //   - Merely same topic: ~0.05-0.15 overlap (some shared vocabulary)
    //   - Unrelated: <0.05 overlap
    let ceiling;
    if (overlap >= 0.35) ceiling = 100;
    else if (overlap >= 0.25) ceiling = 90;
    else if (overlap >= 0.15) ceiling = 80;
    else if (overlap >= 0.10) ceiling = 70;
    else if (overlap >= 0.06) ceiling = 55;
    else ceiling = 35; // below this, even "evolved" is suspect

    const storedPct = m.matchPercentage || (m.confidence || 0) * 100;
    const newPct = Math.min(storedPct, ceiling);

    if (newPct < 50) {
      // Below minimum viable — remove
      stats.removed++;
      continue;
    }

    // Determine if relationship needs downgrade
    let newRel = m.relationship;
    if (newPct < 70 && m.relationship === "same_bit") {
      newRel = "evolved";
      stats.downgraded++;
    } else if (newPct < 70 && m.relationship === "evolved") {
      // evolved below 70 is suspect but keep it for now
    }

    if (newPct === storedPct && newRel === m.relationship) {
      updated.push(m);
      stats.unchanged++;
    } else {
      updated.push({
        ...m,
        matchPercentage: newPct,
        confidence: newPct / 100,
        relationship: newRel,
        _priorMatchPercentage: storedPct,
        _priorRelationship: m.relationship,
        _textOverlap: Math.round(overlap * 100),
      });
      stats.capped++;
    }
  }

  return { updated, stats };
}

/** Convert text to a Set of lowercased words (4+ chars), stripping common stop words */
function textToWordBag(text) {
  if (!text) return new Set();
  const STOP = new Set(["that", "this", "with", "have", "from", "they", "been", "were", "will", "would", "could", "should", "their", "there", "about", "which", "when", "what", "just", "like", "know", "going", "really", "right", "think", "because", "people", "thing", "things"]);
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOP.has(w));
  return new Set(words);
}

/** Compute Jaccard-like overlap between two word bags */
function wordBagOverlap(bag1, bag2) {
  if (bag1.size === 0 || bag2.size === 0) return 0;
  let overlap = 0;
  const [smaller, larger] = bag1.size <= bag2.size ? [bag1, bag2] : [bag2, bag1];
  for (const w of smaller) { if (larger.has(w)) overlap++; }
  return overlap / Math.max(bag1.size, bag2.size);
}
