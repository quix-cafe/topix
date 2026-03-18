import { uid } from "./ollama";

// Replace old bitIds with new bitIds in all touchstones (for split/join operations)
export function updateTouchstoneBitIds(touchstones, oldIds, newIds, newBits) {
  const oldSet = new Set(oldIds);
  const updateList = (list) => list.map((ts) => {
    const affected = ts.bitIds.some((id) => oldSet.has(id));
    if (!affected) return ts;

    // Remove old instances, add new ones
    const keptInstances = ts.instances.filter((i) => !oldSet.has(i.bitId));
    const keptBitIds = ts.bitIds.filter((id) => !oldSet.has(id));
    const newInstances = newBits.map((b, idx) => ({
      bitId: b.id,
      sourceFile: b.sourceFile,
      title: b.title || "Untitled",
      instanceNumber: keptInstances.length + idx + 1,
      confidence: 1,
      relationship: "same_bit",
    }));

    const finalInstances = [...keptInstances, ...newInstances];
    const finalBitIds = [...keptBitIds, ...newIds];

    // Invalidate name if 25%+ of bits were affected by split/join
    const affectedCount = ts.bitIds.filter((id) => oldSet.has(id)).length;
    const significantChange = ts.bitIds.length > 0 && (affectedCount / ts.bitIds.length) >= 0.25;
    return {
      ...ts,
      instances: finalInstances,
      bitIds: finalBitIds,
      frequency: finalInstances.length,
      sourceCount: new Set(finalInstances.map((i) => i.sourceFile)).size,
      autoNamed: significantChange ? false : ts.autoNamed,
      lastNamedBitCount: significantChange ? undefined : ts.lastNamedBitCount,
    };
  });
  return {
    confirmed: updateList(touchstones.confirmed || []),
    possible: updateList(touchstones.possible || []),
    rejected: updateList(touchstones.rejected || []),
  };
}

// Split: remove old bit, add new ones, clean matches + touchstones
// Returns: { updatedTopics, updatedMatches, updatedTouchstones, bitsWithIds }
export function prepareSplitUpdate(bitId, newBits, topics, matches, touchstones) {
  const withoutOriginal = topics.filter((t) => t.id !== bitId);
  const bitsWithIds = newBits.map((b) => ({ ...b, id: uid() }));
  const updatedTopics = [...withoutOriginal, ...bitsWithIds];

  // Remove matches referencing the split (now-deleted) bit — new bits need fresh matches
  const updatedMatches = matches.filter(
    (m) => m.sourceId !== bitId && m.targetId !== bitId
  );

  // Replace old bitId with all new bitIds in any touchstones that referenced it
  const updatedTouchstones = updateTouchstoneBitIds(touchstones, [bitId], bitsWithIds.map((b) => b.id), bitsWithIds);

  return { updatedTopics, updatedMatches, updatedTouchstones, bitsWithIds };
}

// Join: merge bits, clean matches + touchstones
// Returns: { updatedTopics, updatedMatches, updatedTouchstones, completeBit }
export function prepareJoinUpdate(bitsToJoin, joinedBit, topics, matches, touchstones, selectedModel) {
  const joiningIds = new Set(bitsToJoin.map((b) => b.id));
  const oldIds = [...joiningIds];
  const withoutOriginals = topics.filter((t) => !joiningIds.has(t.id));
  const completeBit = {
    ...joinedBit,
    id: uid(),
    timestamp: Date.now(),
    parsedWithModel: bitsToJoin[0]?.parsedWithModel || selectedModel || "qwen3.5:9b",
    bitFlow: bitsToJoin[0]?.bitFlow || null,
  };
  const updatedTopics = [...withoutOriginals, completeBit];

  // Clean up matches that reference the removed bit IDs
  const updatedMatches = matches.filter(
    (m) => !joiningIds.has(m.sourceId) && !joiningIds.has(m.targetId)
  );

  // Replace all old bitIds with the new joined bitId in touchstones
  const updatedTouchstones = updateTouchstoneBitIds(touchstones, oldIds, [completeBit.id], [completeBit]);

  return { updatedTopics, updatedMatches, updatedTouchstones, completeBit };
}

// Boundary change: update position + fullText + editHistory
// Returns: { updatedTopics }
export function applyBoundaryChange(bitId, newPosition, topics, transcripts) {
  const bit = topics.find((t) => t.id === bitId);
  const transcript = bit ? transcripts.find((tr) => tr.name === bit.sourceFile) : null;
  const originalText = transcript ? transcript.text.replace(/\n/g, " ") : "";

  const updatedTopics = topics.map((t) =>
    t.id === bitId
      ? {
          ...t,
          textPosition: newPosition,
          fullText: originalText
            ? originalText.substring(newPosition.startChar, newPosition.endChar)
            : t.fullText,
          editHistory: [
            ...(t.editHistory || []),
            {
              timestamp: Date.now(),
              action: "boundary-adjust",
              details: { from: t.textPosition, to: newPosition },
            },
          ],
        }
      : t
  );

  return { updatedTopics };
}

// Take overlap: shrink conflicting bits
// Returns: { updatedTopics, shrunkIds }
export function applyTakeOverlap(takerId, conflictingUpdates, topics, transcripts) {
  const transcript = transcripts.find((tr) => {
    const taker = topics.find((t) => t.id === takerId);
    return taker && tr.name === taker.sourceFile;
  });
  const originalText = transcript ? transcript.text.replace(/\n/g, " ") : "";

  const updatedTopics = topics.map((t) => {
    const update = conflictingUpdates.find((u) => u.id === t.id);
    if (update) {
      const newFullText = originalText
        ? originalText.substring(update.newPosition.startChar, update.newPosition.endChar)
        : t.fullText;
      return {
        ...t,
        textPosition: update.newPosition,
        fullText: newFullText,
        editHistory: [
          ...(t.editHistory || []),
          {
            timestamp: Date.now(),
            action: "take-shrink",
            details: { from: t.textPosition, to: update.newPosition, takenBy: takerId },
          },
        ],
      };
    }
    return t;
  });

  const shrunkIds = conflictingUpdates.map((u) => u.id);
  return { updatedTopics, shrunkIds };
}

// Scroll boundary: move boundary between adjacent bits by N words
// Returns: { updatedTopics, changedBitIds } or null if no change
export function applyScrollBoundary(bitId, nextBitId, direction, topics, transcripts) {
  const bit = topics.find((t) => t.id === bitId);
  const nextBit = topics.find((t) => t.id === nextBitId);
  if (!bit || !nextBit) return null;

  const transcript = transcripts.find((tr) => tr.name === bit.sourceFile);
  if (!transcript) return null;
  const text = transcript.text.replace(/\n/g, " ");

  const bitEnd = bit.textPosition?.endChar || 0;
  const count = Math.abs(direction);
  const growing = direction > 0;

  let newBitEnd = bitEnd;
  for (let i = 0; i < count; i++) {
    if (growing) {
      const after = text.substring(newBitEnd);
      const m = after.match(/^\s*\S+/);
      if (!m) break;
      newBitEnd = newBitEnd + m[0].length;
    } else {
      const before = text.substring(0, newBitEnd);
      const m = before.match(/\S+\s*$/);
      if (!m) break;
      newBitEnd = newBitEnd - m[0].length;
    }
  }
  if (newBitEnd === bitEnd) return null; // nothing changed
  const newNextStart = newBitEnd;

  const updatedTopics = topics.map((t) => {
    if (t.id === bitId) {
      const newPos = { startChar: t.textPosition.startChar, endChar: newBitEnd };
      return {
        ...t,
        textPosition: newPos,
        fullText: text.substring(newPos.startChar, newPos.endChar),
        editHistory: [...(t.editHistory || []), { timestamp: Date.now(), action: "scroll-boundary", details: { from: t.textPosition, to: newPos } }],
      };
    }
    if (t.id === nextBitId) {
      const newPos = { startChar: newNextStart, endChar: t.textPosition.endChar };
      return {
        ...t,
        textPosition: newPos,
        fullText: text.substring(newPos.startChar, newPos.endChar),
        editHistory: [...(t.editHistory || []), { timestamp: Date.now(), action: "scroll-boundary", details: { from: t.textPosition, to: newPos } }],
      };
    }
    return t;
  });

  return { updatedTopics, changedBitIds: [bitId, nextBitId] };
}
