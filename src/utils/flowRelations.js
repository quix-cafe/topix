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

    // Build touchstone sequence (deduplicate consecutive same-touchstone)
    const tsSequence = [];
    bits.forEach((bit) => {
      const tsId = bitToTouchstone.get(bit.id);
      if (tsId && (tsSequence.length === 0 || tsSequence[tsSequence.length - 1] !== tsId)) {
        tsSequence.push(tsId);
      }
    });

    // Count adjacent pairs (undirected)
    for (let i = 0; i < tsSequence.length - 1; i++) {
      const pairKey = [tsSequence[i], tsSequence[i + 1]].sort().join(":");
      adjacency.set(pairKey, (adjacency.get(pairKey) || 0) + 1);
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

  if (pairsToLink.length === 0) return touchstones;

  // Build a set of links to add per touchstone
  const linksToAdd = new Map(); // tsId → Set<otherTsId>
  for (const [idA, idB] of pairsToLink) {
    if (!linksToAdd.has(idA)) linksToAdd.set(idA, new Set());
    if (!linksToAdd.has(idB)) linksToAdd.set(idB, new Set());
    linksToAdd.get(idA).add(idB);
    linksToAdd.get(idB).add(idA);
  }

  // Apply links, skipping already-linked pairs
  let changed = false;
  const addLinks = (list) => list.map((t) => {
    const toAdd = linksToAdd.get(t.id);
    if (!toAdd) return t;
    const existing = new Set(t.relatedTouchstoneIds || []);
    const newIds = [...toAdd].filter((id) => !existing.has(id));
    if (newIds.length === 0) return t;
    changed = true;
    return { ...t, relatedTouchstoneIds: [...existing, ...newIds] };
  });

  const result = {
    confirmed: addLinks(touchstones.confirmed || []),
    possible: addLinks(touchstones.possible || []),
    rejected: touchstones.rejected || [],
    _unlinkedPairs: touchstones._unlinkedPairs || [],
  };

  return changed ? result : touchstones;
}
