// deduplicateBitOwnership removed — bits can now belong to multiple touchstones

/**
 * Check if a bit has strong enough evidence to be absorbed into a touchstone.
 * Qualifies with: 1 same_bit/evolved edge at 90%+, or 2+ edges at 85%+.
 */
function hasAbsorptionEvidence(bitId, existingBitSet, matches) {
  let count85 = 0;
  for (const m of matches) {
    const isSource = m.sourceId === bitId && existingBitSet.has(m.targetId);
    const isTarget = m.targetId === bitId && existingBitSet.has(m.sourceId);
    if (!isSource && !isTarget) continue;
    const rel = m.relationship;
    if (rel !== 'same_bit' && rel !== 'evolved') continue;
    const mp = m.matchPercentage || (m.confidence || 0) * 100;
    if (mp >= 90) return true;
    if (mp >= 85) count85++;
    if (count85 >= 2) return true;
  }
  return false;
}

/**
 * Pure touchstone merge/dedup logic extracted from the touchstone detection useEffect.
 * Takes freshly detected touchstones and merges them with previous state,
 * handling confirmed/possible/rejected categories, absorptions, and removed bits.
 *
 * @param {Object} options
 * @param {Object} options.detected - output of detectTouchstones()
 * @param {Object} options.previousTouchstones - { confirmed, possible, rejected }
 * @param {Array} options.topics - current topics array
 * @param {Array} options.matches - current matches array
 * @param {Function} options.findCachedName - (bitIds) => string|null
 *
 * @returns {Object} { confirmed, possible, rejected } — the new merged touchstone state (bits may appear in multiple touchstones)
 */
export function assembleAndMergeTouchstones({
  detected,
  previousTouchstones,
  topics,
  matches,
  findCachedName,
}) {
  const prev = previousTouchstones || {};
  const keyOf = (ts) => [...ts.bitIds].sort().join(",");

  // Build sets of bitIds keys for touchstones already confirmed or rejected by the user
  const confirmedKeys = new Map((prev.confirmed || []).map(ts => [keyOf(ts), ts]));

  // Rejected touchstones: only block the EXACT same grouping or supersets.
  // Subsets (tighter groupings) are allowed — rejection means "too broad", not "unrelated".
  const rejectedTouchstones = prev.rejected || [];
  const isSubsetOfRejected = (detectedTs) => {
    const detectedSet = new Set(detectedTs.bitIds);
    return rejectedTouchstones.some(rts => {
      const rSet = new Set(rts.bitIds);
      // Block if detected is same size or larger AND all rejected bits are in it
      return detectedSet.size >= rSet.size && [...rSet].every(id => detectedSet.has(id));
    });
  };

  // Global set of bits that were explicitly removed from ANY touchstone.
  // Maps bitId -> Set<touchstoneId>
  const allExisting = [...(prev.confirmed || []), ...(prev.possible || [])];
  const globalRemovedBits = new Map();
  for (const ts of allExisting) {
    for (const removedId of (ts.removedBitIds || [])) {
      if (!globalRemovedBits.has(removedId)) globalRemovedBits.set(removedId, new Set());
      globalRemovedBits.get(removedId).add(ts.id);
    }
  }

  // Check if a bit was removed from a touchstone that overlaps with a detected cluster
  const wasRemovedFromOverlapping = (bitId, detectedBitIds) => {
    const removedFrom = globalRemovedBits.get(bitId);
    if (!removedFrom) return false;
    for (const tsId of removedFrom) {
      const ts = allExisting.find(t => t.id === tsId);
      if (!ts) continue;
      const overlap = ts.bitIds.some(id => detectedBitIds.includes(id));
      if (overlap) return true;
    }
    return false;
  };

  // Fuzzy overlap check: does a detected cluster substantially overlap with an existing touchstone?
  // Returns null if the non-overlapping bits outnumber the overlapping ones (distinct cluster).
  const findOverlappingTouchstone = (detectedTs, existingList) => {
    const detectedSet = new Set(detectedTs.bitIds);
    let bestMatch = null, bestOverlap = 0;
    for (const existing of existingList) {
      const overlap = existing.bitIds.filter(id => detectedSet.has(id)).length;
      const overlapRatio = overlap / Math.max(1, Math.min(detectedSet.size, existing.bitIds.length));
      if (overlapRatio >= 0.5 && overlap > bestOverlap) {
        // If the detected cluster has more unique bits than shared bits, it's a distinct cluster
        const uniqueInDetected = detectedTs.bitIds.filter(id => !existing.bitIds.includes(id)).length;
        if (uniqueInDetected > overlap) continue; // let it coexist as a separate possible
        bestOverlap = overlap;
        bestMatch = existing;
      }
    }
    return bestMatch;
  };

  // Apply cached LLM names to freshly-detected touchstones
  const applyNames = (list) => list.map(ts => {
    const cached = findCachedName(ts.bitIds);
    return cached ? { ...ts, name: cached } : ts;
  });

  // Track which detected touchstones get absorbed into existing ones
  const absorbedIntoConfirmed = new Set();
  const confirmedAbsorptions = new Map(); // confirmed ts id -> set of new bitIds to add

  // First pass: check if detected clusters overlap with confirmed touchstones
  const allConfirmed = prev.confirmed || [];
  const allPossible = prev.possible || [];

  for (const detectedTs of (detected.possible || [])) {
    const key = keyOf(detectedTs);
    if (confirmedKeys.has(key)) {
      absorbedIntoConfirmed.add(key);
      continue;
    }
    // Block exact re-creation or supersets of rejected touchstones, but allow tighter subsets
    if (isSubsetOfRejected(detectedTs)) {
      absorbedIntoConfirmed.add(key);
      continue;
    }

    // Check fuzzy overlap with confirmed touchstones
    const overlapping = findOverlappingTouchstone(detectedTs, allConfirmed);
    if (overlapping) {
      absorbedIntoConfirmed.add(key);
      const removedFromThis = new Set(overlapping.removedBitIds || []);
      const newBitIds = detectedTs.bitIds.filter(id => !overlapping.bitIds.includes(id) && !removedFromThis.has(id));
      if (newBitIds.length > 0) {
        const existing = confirmedAbsorptions.get(overlapping.id) || new Set();
        newBitIds.forEach(id => existing.add(id));
        confirmedAbsorptions.set(overlapping.id, existing);
      }
      continue;
    }

    // Check fuzzy overlap with existing possible touchstones
    const overlappingPossible = findOverlappingTouchstone(detectedTs, allPossible);
    if (overlappingPossible) {
      absorbedIntoConfirmed.add(key);
    }
  }

  // Newly detected are all "possible" — filter out ones matched to existing touchstones
  const existingPossibleByKey = new Map((prev.possible || []).map(ts => [keyOf(ts), ts]));
  const newPossible = applyNames(
    (detected.possible || []).filter(ts => {
      const key = keyOf(ts);
      if (absorbedIntoConfirmed.has(key)) return false;
      if (confirmedKeys.has(key) || isSubsetOfRejected(ts)) return false;

      // Also check fuzzy overlap with existing possibles — if there's a match, don't create a new one
      const overlapping = findOverlappingTouchstone(ts, allPossible);
      if (overlapping) return false;

      return true;
    })
  ).map(ts => {
    // Filter out bits removed from any overlapping touchstone (global check)
    const globalFiltered = ts.bitIds.filter(id => !wasRemovedFromOverlapping(id, ts.bitIds));
    const globalFilteredInstances = ts.instances.filter(i => globalFiltered.includes(i.bitId));

    // Preserve user edits from existing possible touchstones
    const existing = existingPossibleByKey.get(keyOf(ts));
    if (!existing) {
      if (globalFiltered.length < 2) return null; // dissolved
      return { ...ts, bitIds: globalFiltered, instances: globalFilteredInstances, frequency: globalFiltered.length };
    }
    // Also filter out bits removed from this specific touchstone
    const removedSet = new Set(existing.removedBitIds || []);
    const filteredBitIds = globalFiltered.filter(id => !removedSet.has(id));
    const filteredInstances = globalFilteredInstances.filter(i => !removedSet.has(i.bitId));
    return {
      ...ts,
      bitIds: filteredBitIds,
      instances: filteredInstances,
      frequency: filteredBitIds.length,
      name: (existing.manualName || existing.autoNamed) ? existing.name : ts.name,
      manualName: existing.manualName,
      autoNamed: existing.autoNamed,
      lastNamedBitCount: existing.lastNamedBitCount,
      corrections: existing.corrections,
      userReasons: existing.userReasons,
      rejectedReasons: existing.rejectedReasons,
      removedBitIds: existing.removedBitIds,
    };
  }).filter(ts => ts && ts.bitIds.length >= 2);

  // Update confirmed touchstones: refresh detection data + absorb new bits from overlapping clusters
  const updatedConfirmed = (prev.confirmed || []).map(existing => {
    const key = keyOf(existing);
    const fresh = (detected.possible || []).find(ts => keyOf(ts) === key);
    const absorbed = confirmedAbsorptions.get(existing.id);

    // If new bits were absorbed from overlapping detected clusters, only add
    // those with a strong same_bit/evolved match edge to an existing member
    let updated = existing;
    if (absorbed && absorbed.size > 0) {
      const existingSet = new Set(existing.bitIds);
      const removedSet = new Set(existing.removedBitIds || []);
      const newBitIds = [...absorbed].filter(id => {
        if (existingSet.has(id)) return false;
        if (removedSet.has(id)) return false;
        return hasAbsorptionEvidence(id, existingSet, matches);
      });
      if (newBitIds.length > 0) {
        const newInstances = newBitIds.map(id => {
          const bit = topics.find(t => t.id === id);
          const edge = matches.find(m =>
            ((m.sourceId === id && existingSet.has(m.targetId)) || (m.targetId === id && existingSet.has(m.sourceId)))
            && (m.relationship === 'same_bit' || m.relationship === 'evolved')
          );
          return bit ? {
            bitId: id, sourceFile: bit.sourceFile, title: bit.title,
            instanceNumber: existing.instances.length + newBitIds.indexOf(id) + 1,
            confidence: edge ? (edge.matchPercentage || edge.confidence * 100) / 100 : 0.85,
            relationship: edge?.relationship || "evolved",
          } : null;
        }).filter(Boolean);
        updated = {
          ...existing,
          bitIds: [...existing.bitIds, ...newBitIds],
          instances: [...existing.instances, ...newInstances],
          frequency: existing.instances.length + newInstances.length,
        };
        console.log(`[Touchstones] Absorbed ${newBitIds.length} new bit(s) into confirmed "${existing.name}"`);
      }
    }

    if (fresh) {
      const cached = findCachedName(updated.bitIds);
      // Filter removed bits from fresh detection data
      const removedSet = new Set(updated.removedBitIds || []);
      const freshBitIds = removedSet.size > 0 ? fresh.bitIds.filter(id => !removedSet.has(id)) : fresh.bitIds;
      return {
        ...fresh,
        ...updated,
        bitIds: [...new Set([...updated.bitIds, ...freshBitIds])],
        instances: updated.instances,
        category: "confirmed",
        name: updated.manualName ? updated.name : (cached || updated.name),
        manualName: updated.manualName,
        corrections: updated.corrections,
        userReasons: updated.userReasons,
        rejectedReasons: updated.rejectedReasons,
        removedBitIds: updated.removedBitIds,
      };
    }
    return updated;
  });

  // Also update existing possibles with new bits from overlapping detected clusters
  const updatedExistingPossible = (prev.possible || []).map(existing => {
    const detectedSet = new Set(existing.bitIds);
    const overlapping = (detected.possible || []).find(dts => {
      if (keyOf(dts) === keyOf(existing)) return false;
      const overlap = dts.bitIds.filter(id => detectedSet.has(id)).length;
      return overlap / Math.max(1, Math.min(detectedSet.size, dts.bitIds.length)) >= 0.5;
    });
    if (!overlapping) return existing;

    const existingSet = new Set(existing.bitIds);
    const removedSet = new Set(existing.removedBitIds || []);
    const newBitIds = overlapping.bitIds.filter(id => {
      if (existingSet.has(id)) return false;
      if (removedSet.has(id)) return false;
      return hasAbsorptionEvidence(id, existingSet, matches);
    });
    if (newBitIds.length === 0) return existing;

    const newInstances = newBitIds.map(id => {
      const bit = topics.find(t => t.id === id);
      const edge = matches.find(m =>
        ((m.sourceId === id && existingSet.has(m.targetId)) || (m.targetId === id && existingSet.has(m.sourceId)))
        && (m.relationship === 'same_bit' || m.relationship === 'evolved')
      );
      return bit ? {
        bitId: id, sourceFile: bit.sourceFile, title: bit.title,
        instanceNumber: existing.instances.length + newBitIds.indexOf(id) + 1,
        confidence: edge ? (edge.matchPercentage || edge.confidence * 100) / 100 : 0.85,
        relationship: edge?.relationship || "evolved",
      } : null;
    }).filter(Boolean);

    console.log(`[Touchstones] Absorbed ${newBitIds.length} new bit(s) into possible "${existing.name}"`);
    return {
      ...existing,
      bitIds: [...existing.bitIds, ...newBitIds],
      instances: [...existing.instances, ...newInstances],
      frequency: existing.instances.length + newInstances.length,
      autoNamed: existing.autoNamed,
      lastNamedBitCount: existing.lastNamedBitCount,
    };
  });

  return {
    confirmed: updatedConfirmed,
    possible: [...updatedExistingPossible, ...newPossible],
    rejected: prev.rejected || [],
  };
}
