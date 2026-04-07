/**
 * Auto-relate touchstones based on set flow adjacency.
 * Counts how often touchstones appear next to each other in performance order
 * across all transcripts, then links pairs that co-occur >= threshold times.
 *
 * Respects manually unlinked pairs (_unlinkedPairs) — those are never auto-linked.
 */

const MIN_ADJACENCY = 3;

/**
 * Compute undirected adjacency counts between touchstones.
 * Only counts pairs that are truly directly adjacent — no unmatched bits between them.
 * Returns Map<"idA:idB", count> where idA < idB (sorted for consistency).
 */
export function computeTouchstoneAdjacency(topics, touchstones) {
  // Build bit → touchstone lookup from all non-rejected touchstones
  const allTs = [...(touchstones.confirmed || []), ...(touchstones.possible || [])];
  const bitToTouchstone = new Map();
  allTs.forEach((ts) => {
    (ts.instances || []).forEach((inst) => {
      bitToTouchstone.set(inst.bitId, ts.id);
    });
  });

  // Count undirected adjacency across all transcripts
  const adjacency = new Map();
  const sourceFiles = [...new Set(topics.map((t) => t.sourceFile))];

  sourceFiles.forEach((source) => {
    const bits = topics
      .filter((t) => t.sourceFile === source)
      .sort((a, b) => (a.textPosition?.startChar ?? 0) - (b.textPosition?.startChar ?? 0));

    // Walk bits in order — only count truly adjacent touchstone pairs
    // (no unmatched bits between them)
    let prevTsId = null;
    for (const bit of bits) {
      const tsId = bitToTouchstone.get(bit.id);
      if (!tsId) {
        // Unmatched bit breaks adjacency
        prevTsId = null;
        continue;
      }
      if (tsId === prevTsId) continue; // same touchstone, skip
      if (prevTsId) {
        const pairKey = [prevTsId, tsId].sort().join(":");
        adjacency.set(pairKey, (adjacency.get(pairKey) || 0) + 1);
      }
      prevTsId = tsId;
    }
  });

  return adjacency;
}

/**
 * Apply auto-relate to touchstones based on adjacency counts.
 * Returns updated touchstones object with new relatedTouchstoneIds where needed.
 */
export function autoRelateTouchstones(touchstones, topics, threshold = MIN_ADJACENCY) {
  const adjacency = computeTouchstoneAdjacency(topics, touchstones);
  const unlinkedPairs = new Set(touchstones._unlinkedPairs || []);

  // Collect pairs that meet the threshold and aren't manually unlinked
  const pairsToLink = [];
  for (const [pairKey, count] of adjacency) {
    if (count >= threshold && !unlinkedPairs.has(pairKey)) {
      const [idA, idB] = pairKey.split(":");
      pairsToLink.push([idA, idB]);
    }
  }

  // Build the set of auto-linked neighbors per touchstone
  const autoLinks = new Map(); // tsId → Set<otherTsId>
  for (const [idA, idB] of pairsToLink) {
    if (!autoLinks.has(idA)) autoLinks.set(idA, new Set());
    if (!autoLinks.has(idB)) autoLinks.set(idB, new Set());
    autoLinks.get(idA).add(idB);
    autoLinks.get(idB).add(idA);
  }

  // Rebuild relatedTouchstoneIds from scratch: auto-links + manual links
  let changed = false;
  const rebuildLinks = (list) => list.map((t) => {
    const auto = autoLinks.has(t.id) ? [...autoLinks.get(t.id)] : [];
    const manual = t.manualFlowLinks || [];
    const merged = [...new Set([...auto, ...manual])];
    const prev = t.relatedTouchstoneIds || [];
    const same = prev.length === merged.length && merged.every((id) => prev.includes(id));
    if (same) return t;
    changed = true;
    return { ...t, relatedTouchstoneIds: merged };
  });

  const result = {
    confirmed: rebuildLinks(touchstones.confirmed || []),
    possible: rebuildLinks(touchstones.possible || []),
    rejected: touchstones.rejected || [],
    _unlinkedPairs: touchstones._unlinkedPairs || [],
  };

  return changed ? result : touchstones;
}
