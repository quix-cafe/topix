import { useCallback } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_TOUCHSTONE_VERIFY } from "../utils/prompts";
import { saveVaultState } from "../utils/database";
import { autoRelateTouchstones } from "../utils/flowRelations";

export function useTouchstoneHandlers(ctx) {
  const { dispatch, stateRef, addDebugEntry, touchstoneNameCache } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const onRenameTouchstone = useCallback((touchstoneId, newName) => {
    update('touchstones', (prev) => {
      const rename = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        const key = [...t.bitIds].sort().join(",");
        touchstoneNameCache.current.set(key, newName);
        return { ...t, name: newName, manualName: true };
      });
      return { confirmed: rename(prev.confirmed || []), possible: rename(prev.possible || []), rejected: rename(prev.rejected || []) };
    });
  }, []);

  const onRemoveTouchstone = useCallback((touchstoneId) => {
    update('touchstones', (prev) => {
      const fromConfirmedOrPossible = [...(prev.confirmed || []), ...(prev.possible || [])].find((t) => t.id === touchstoneId);
      const alreadyRejected = (prev.rejected || []).find((t) => t.id === touchstoneId);

      if (fromConfirmedOrPossible) {
        // Move to rejected, clear bitIds/instances
        return {
          confirmed: (prev.confirmed || []).filter((t) => t.id !== touchstoneId),
          possible: (prev.possible || []).filter((t) => t.id !== touchstoneId),
          rejected: [...(prev.rejected || []), { ...fromConfirmedOrPossible, category: "rejected", bitIds: [], instances: [] }],
        };
      } else if (alreadyRejected) {
        // Already rejected — just clear bitIds/instances
        return {
          ...prev,
          rejected: (prev.rejected || []).map((t) =>
            t.id === touchstoneId ? { ...t, bitIds: [], instances: [] } : t
          ),
        };
      }
      return prev;
    });

    // Unlink notes that were matched to this touchstone
    update('notes', (prev) =>
      prev.map((n) => n.matchedTouchstoneId === touchstoneId ? { ...n, matchedTouchstoneId: null, matchScore: null } : n)
    );
  }, []);

  const onConfirmTouchstone = useCallback((touchstoneId) => {
    update('touchstones', (prev) => {
      const fromPossible = (prev.possible || []).find((t) => t.id === touchstoneId);
      if (!fromPossible) return prev;
      return {
        confirmed: [...(prev.confirmed || []), { ...fromPossible, category: "confirmed" }],
        possible: (prev.possible || []).filter((t) => t.id !== touchstoneId),
        rejected: prev.rejected || [],
      };
    });
  }, []);

  const onRestoreTouchstone = useCallback((touchstoneId) => {
    update('touchstones', (prev) => {
      const fromRejected = (prev.rejected || []).find((t) => t.id === touchstoneId);
      if (!fromRejected) return prev;
      return {
        confirmed: prev.confirmed || [],
        possible: [...(prev.possible || []), { ...fromRejected, category: "possible" }],
        rejected: (prev.rejected || []).filter((t) => t.id !== touchstoneId),
      };
    });
  }, []);

  const onRemoveInstance = useCallback((touchstoneId, bitId) => {
    update('touchstones', (prev) => {
      const removeFrom = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        const newInstances = t.instances.filter((i) => i.bitId !== bitId);
        const newBitIds = t.bitIds.filter((id) => id !== bitId);
        if (newInstances.length === 0) return null;
        return { ...t, instances: newInstances, bitIds: newBitIds, frequency: newInstances.length };
      }).filter(Boolean);
      return { confirmed: removeFrom(prev.confirmed || []), possible: removeFrom(prev.possible || []), rejected: removeFrom(prev.rejected || []) };
    });
  }, []);

  const onUpdateInstanceRelationship = useCallback((touchstoneId, bitId, newRelationship) => {
    update('touchstones', (prev) => {
      const updateIn = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        return { ...t, instances: t.instances.map((i) => i.bitId === bitId ? { ...i, relationship: newRelationship } : i) };
      });
      return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
    });
  }, []);

  const onMergeTouchstone = useCallback(async (sourceTouchstoneId, targetTouchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const source = allTs.find((t) => t.id === sourceTouchstoneId);
    const target = allTs.find((t) => t.id === targetTouchstoneId);
    if (!source || !target) return { accepted: 0, rejected: 0 };

    const groupBits = target.instances.map((i) => s.topics.find((b) => b.id === i.bitId)).filter(Boolean);
    const targetBitIds = new Set(target.instances.map((i) => i.bitId));
    const candidateBits = source.instances
      .filter((i) => !targetBitIds.has(i.bitId))
      .map((i) => ({ instance: i, bit: s.topics.find((b) => b.id === i.bitId) }))
      .filter((c) => c.bit);

    if (candidateBits.length === 0) {
      update('touchstones', (prev) => {
        const removeSource = (list) => list.filter((t) => t.id !== sourceTouchstoneId);
        return { confirmed: removeSource(prev.confirmed || []), possible: removeSource(prev.possible || []), rejected: removeSource(prev.rejected || []) };
      });
      set('status', `Merged "${source.name}" into "${target.name}" (all bits already present).`);
      setTimeout(async () => {
        const s2 = stateRef.current;
        try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }); } catch {}
      }, 100);
      return { accepted: source.instances.length, rejected: 0, alreadyMerged: true };
    }

    const applyCorr = (text) => {
      if (!target.corrections || target.corrections.length === 0) return text;
      let r = text;
      for (const c of target.corrections) { r = r.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to); }
      return r;
    };

    const groupText = groupBits.map((b, i) => `EXISTING ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorr(b.title)}\n${applyCorr(b.fullText || b.summary)}`).join('\n\n');
    const candText = candidateBits.map((c, i) => `CANDIDATE ${i + 1} (from "${c.bit.sourceFile}"):\nTitle: ${applyCorr(c.bit.title)}\n${applyCorr(c.bit.fullText || c.bit.summary)}`).join('\n\n');
    const rejBlock = (target.rejectedReasons || []).length > 0
      ? `\n\n--- REJECTED REASONING ---\n${target.rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';

    const userMsg = `TOUCHSTONE: "${target.name}"\n\n--- EXISTING GROUP (${groupBits.length} instances) ---\n${groupText}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) ---\n${candText}${rejBlock}`;

    try {
      set('processing', true);
      set('status', `Verifying merge: "${source.name}" → "${target.name}"...`);
      const result = await callOllama(SYSTEM_TOUCHSTONE_VERIFY, userMsg, () => {}, stateRef.current.selectedModel, stateRef.current.debugMode ? addDebugEntry : null);

      const accepted = [];
      const rejSet = new Set((target.rejectedReasons || []).map((r) => r.toLowerCase().trim()));
      const llmReasons = (result.group_reasoning || []).filter((r) => !rejSet.has(r.toLowerCase().trim())).slice(0, 6);
      if (result.candidates && Array.isArray(result.candidates)) {
        for (const c of result.candidates) {
          const idx = (c.candidate || 0) - 1;
          if (idx < 0 || idx >= candidateBits.length) continue;
          if (c.accepted) accepted.push({ ...candidateBits[idx].instance, relationship: c.relationship || "same_bit", confidence: c.confidence || 0.8 });
        }
      }

      update('touchstones', (prev) => {
        const updateTarget = (list) => list.map((t) => {
          if (t.id !== targetTouchstoneId) return t;
          const nextInstances = [...t.instances];
          const nextBitIds = [...t.bitIds];
          for (const inst of accepted) {
            if (!nextBitIds.includes(inst.bitId)) { nextInstances.push({ ...inst, instanceNumber: nextInstances.length + 1 }); nextBitIds.push(inst.bitId); }
          }
          return {
            ...t, instances: nextInstances, bitIds: nextBitIds, frequency: nextInstances.length,
            sourceCount: new Set(nextInstances.map((i) => i.sourceFile)).size,
            matchInfo: { ...t.matchInfo, reasons: llmReasons, sameBitCount: nextInstances.filter((i) => i.relationship === "same_bit").length, evolvedCount: nextInstances.filter((i) => i.relationship === "evolved").length },
          };
        });
        const removeSource = (list) => list.filter((t) => t.id !== sourceTouchstoneId);
        return { confirmed: updateTarget(removeSource(prev.confirmed || [])), possible: removeSource(prev.possible || []), rejected: removeSource(prev.rejected || []) };
      });

      set('status', `Merged ${accepted.length}/${candidateBits.length} bits from "${source.name}" into "${target.name}".`);
      set('processing', false);
      return { accepted: accepted.length, rejected: candidateBits.length - accepted.length };
    } catch (err) {
      set('status', `Merge failed: ${err.message}`);
      set('processing', false);
      return { accepted: 0, rejected: candidateBits.length };
    }
  }, []);

  const onRefreshReasons = useCallback(async (touchstoneId) => {
    const s = stateRef.current;
    const allTs = [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || []), ...(s.touchstones.rejected || [])];
    const ts = allTs.find((t) => t.id === touchstoneId);
    if (!ts || ts.instances.length < 2) return;

    const applyCorrections = (text) => {
      if (!ts.corrections || ts.corrections.length === 0) return text;
      let result = text;
      for (const c of ts.corrections) { result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to); }
      return result;
    };

    const trustedInstances = ts.instances.filter((i) => i.communionStatus === 'sainted' || i.communionStatus === 'blessed');
    const instancesToUse = trustedInstances.length >= 2 ? trustedInstances : ts.instances;
    const groupBits = instancesToUse.map((i) => s.topics.find((b) => b.id === i.bitId)).filter(Boolean);
    if (groupBits.length < 2) return;

    const anchorBit = groupBits[0];
    const candidateBits = groupBits.slice(1);
    const anchorText = `EXISTING 1 (from "${anchorBit.sourceFile}"):\nTitle: ${applyCorrections(anchorBit.title)}\n${applyCorrections(anchorBit.fullText || anchorBit.summary)}`;
    const candidateText = candidateBits.map((b, i) => `CANDIDATE ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorrections(b.title)}\n${applyCorrections(b.fullText || b.summary)}`).join('\n\n');
    const userReasonsBlock = (ts.userReasons || []).length > 0
      ? `\n\n--- USER-CONFIRMED REASONING ---\n${ts.userReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
    const rejectedBlock = (ts.rejectedReasons || []).length > 0
      ? `\n\n--- REJECTED REASONING ---\n${ts.rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';

    const userMsg = `TOUCHSTONE: "${ts.name}"\n\n--- GROUP (1 anchor instance) ---\n${anchorText}${userReasonsBlock}${rejectedBlock}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) ---\n${candidateText}`;

    try {
      set('processing', true);
      set('status', `Refreshing reasoning for "${ts.name}"...`);
      const result = await callOllama(SYSTEM_TOUCHSTONE_VERIFY, userMsg, () => {}, stateRef.current.selectedModel, stateRef.current.debugMode ? addDebugEntry : null);

      const rejected = new Set((ts.rejectedReasons || []).map((r) => r.toLowerCase().trim()));
      const finalReasons = (result.group_reasoning || []).filter((r) => !rejected.has(r.toLowerCase().trim())).slice(0, 6);

      const candidateScores = new Map();
      for (const c of (result.candidates || [])) {
        if (typeof c.candidate === 'number' && typeof c.confidence === 'number') {
          const idx = c.candidate - 1;
          if (idx >= 0 && idx < candidateBits.length) {
            candidateScores.set(candidateBits[idx].id, { confidence: c.confidence, relationship: c.relationship || 'same_bit' });
          }
        }
      }

      update('touchstones', (prev) => {
        const updateIn = (list) => list.map((t) => {
          if (t.id !== touchstoneId) return t;
          const updatedInstances = (t.instances || []).map((inst) => {
            if (inst.bitId === anchorBit.id) return { ...inst, confidence: 1, relationship: 'same_bit' };
            const score = candidateScores.get(inst.bitId);
            if (!score) return inst;
            return { ...inst, confidence: score.confidence, relationship: score.relationship };
          });
          const avgConf = updatedInstances.length > 0 ? updatedInstances.reduce((s, i) => s + (i.confidence || 0), 0) / updatedInstances.length : 0;
          return {
            ...t, instances: updatedInstances,
            matchInfo: { ...t.matchInfo, reasons: finalReasons.length > 0 ? finalReasons : t.matchInfo?.reasons || [], totalMatches: updatedInstances.length, sameBitCount: updatedInstances.filter((i) => i.relationship === "same_bit").length, evolvedCount: updatedInstances.filter((i) => i.relationship === "evolved").length, avgConfidence: avgConf, avgMatchPercentage: Math.round(avgConf * 100) },
          };
        });
        return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
      });

      set('status', `Refreshed reasoning for "${ts.name}".`);
      set('processing', false);
    } catch (err) {
      set('status', `Refresh failed: ${err.message}`);
      set('processing', false);
    }
  }, []);

  const onUpdateTouchstoneEdits = useCallback((touchstoneId, edits) => {
    update('touchstones', (prev) => {
      const updateIn = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        const updated = { ...t };
        if (edits.corrections !== undefined) updated.corrections = edits.corrections;
        if (edits.userReasons !== undefined) updated.userReasons = edits.userReasons;
        if (edits.rejectedReasons !== undefined) updated.rejectedReasons = edits.rejectedReasons;
        if (edits.instances !== undefined) updated.instances = edits.instances;
        if (edits.matchInfo !== undefined) updated.matchInfo = edits.matchInfo;
        else if (edits.reasons !== undefined) updated.matchInfo = { ...updated.matchInfo, reasons: edits.reasons };
        if (edits.idealText !== undefined) updated.idealText = edits.idealText;
        if (edits.manualIdealText !== undefined) updated.manualIdealText = edits.manualIdealText;
        if (edits.idealTextNotes !== undefined) updated.idealTextNotes = edits.idealTextNotes;
        if (edits.idealTextVersions !== undefined) updated.idealTextVersions = edits.idealTextVersions;
        if (edits.highEndCommunionResults !== undefined) updated.highEndCommunionResults = edits.highEndCommunionResults;
        if (edits.highEndVerifyResults !== undefined) updated.highEndVerifyResults = edits.highEndVerifyResults;
        if (edits.name !== undefined) {
          updated.name = edits.name;
          const key = [...updated.bitIds].sort().join(",");
          touchstoneNameCache.current.set(key, edits.name);
        }
        if (edits.manualName !== undefined) updated.manualName = edits.manualName;
        return updated;
      });
      return { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
    });
  }, []);

  const onSaintInstance = useCallback((touchstoneId, bitId, newStatus) => {
    const prev = stateRef.current.touchstones;
    const updateIn = (list) => list.map((t) => {
      if (t.id !== touchstoneId) return t;
      return { ...t, instances: t.instances.map((inst) => inst.bitId === bitId ? { ...inst, communionStatus: newStatus } : inst) };
    });
    const updatedTouchstones = { confirmed: updateIn(prev.confirmed || []), possible: updateIn(prev.possible || []), rejected: updateIn(prev.rejected || []) };
    set('touchstones', updatedTouchstones);
    const s2 = stateRef.current;
    saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: updatedTouchstones }).catch(console.error);
  }, []);

  const onRemoveFromTouchstone = useCallback(async (bitId, touchstoneId) => {
    update('touchstones', (prev) => {
      const removeFrom = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        const kept = t.bitIds.filter((id) => id !== bitId);
        if (kept.length < 2) return null;
        return {
          ...t, bitIds: kept,
          instances: t.instances.filter((i) => i.bitId !== bitId),
          frequency: kept.length,
          sourceCount: new Set(t.instances.filter((i) => i.bitId !== bitId).map((i) => i.sourceFile)).size,
          removedBitIds: [...new Set([...(t.removedBitIds || []), bitId])],
        };
      }).filter(Boolean);
      return { confirmed: removeFrom(prev.confirmed || []), possible: removeFrom(prev.possible || []), rejected: removeFrom(prev.rejected || []) };
    });
    setTimeout(async () => {
      const s = stateRef.current;
      try { await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }); } catch {}
    }, 100);
  }, []);

  const onAddToTouchstone = useCallback(async (bitId, touchstoneId) => {
    const bit = stateRef.current.topics.find((t) => t.id === bitId);
    if (!bit) return;
    update('touchstones', (prev) => {
      const addTo = (list) => list.map((t) => {
        if (t.id !== touchstoneId) return t;
        if (t.bitIds.includes(bitId)) return t;
        return {
          ...t,
          instances: [...t.instances, { bitId, sourceFile: bit.sourceFile, title: bit.title, instanceNumber: t.instances.length + 1, confidence: 1, relationship: "same_bit", communionStatus: "sainted" }],
          bitIds: [...t.bitIds, bitId],
          frequency: t.instances.length + 1,
          sourceCount: new Set([...t.instances.map((i) => i.sourceFile), bit.sourceFile]).size,
          autoNamed: t.autoNamed,
        };
      });
      return { confirmed: addTo(prev.confirmed || []), possible: addTo(prev.possible || []), rejected: addTo(prev.rejected || []) };
    });
    setTimeout(async () => {
      const s = stateRef.current;
      try { await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }); } catch {}
    }, 100);
  }, []);

  const onRelateTouchstone = useCallback((sourceId, targetId) => {
    update('touchstones', (prev) => {
      const link = (list) => list.map((t) => {
        if (t.id === sourceId) {
          const existing = t.relatedTouchstoneIds || [];
          if (existing.includes(targetId)) return t;
          return { ...t, relatedTouchstoneIds: [...existing, targetId] };
        }
        if (t.id === targetId) {
          const existing = t.relatedTouchstoneIds || [];
          if (existing.includes(sourceId)) return t;
          return { ...t, relatedTouchstoneIds: [...existing, sourceId] };
        }
        return t;
      });
      return { confirmed: link(prev.confirmed || []), possible: link(prev.possible || []), rejected: link(prev.rejected || []) };
    });
    setTimeout(async () => {
      const s = stateRef.current;
      try { await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }); } catch {}
    }, 100);
  }, []);

  const onUnrelateTouchstone = useCallback((sourceId, targetId) => {
    update('touchstones', (prev) => {
      const unlink = (list) => list.map((t) => {
        if (t.id === sourceId) return { ...t, relatedTouchstoneIds: (t.relatedTouchstoneIds || []).filter((id) => id !== targetId) };
        if (t.id === targetId) return { ...t, relatedTouchstoneIds: (t.relatedTouchstoneIds || []).filter((id) => id !== sourceId) };
        return t;
      });
      // Track as manually unlinked so auto-relate won't re-link
      const pairKey = [sourceId, targetId].sort().join(":");
      const existingUnlinked = prev._unlinkedPairs || [];
      const unlinkedPairs = existingUnlinked.includes(pairKey) ? existingUnlinked : [...existingUnlinked, pairKey];
      return {
        confirmed: unlink(prev.confirmed || []),
        possible: unlink(prev.possible || []),
        rejected: unlink(prev.rejected || []),
        _unlinkedPairs: unlinkedPairs,
      };
    });
    setTimeout(async () => {
      const s = stateRef.current;
      try { await saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }); } catch {}
    }, 100);
  }, []);

  const onAutoRelateAll = useCallback(() => {
    const s = stateRef.current;
    const result = autoRelateTouchstones(s.touchstones, s.topics);
    if (result !== s.touchstones) {
      set('touchstones', result);
      setTimeout(async () => {
        const s2 = stateRef.current;
        try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }); } catch {}
      }, 100);
    }
    return result !== s.touchstones;
  }, []);

  return {
    onRenameTouchstone, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone,
    onRemoveInstance, onUpdateInstanceRelationship,
    onMergeTouchstone, onRefreshReasons, onUpdateTouchstoneEdits,
    onSaintInstance, onRemoveFromTouchstone, onAddToTouchstone,
    onRelateTouchstone, onUnrelateTouchstone, onAutoRelateAll,
  };
}
