import { useCallback } from "react";
import { uid, requestOllamaRestart } from "../utils/ollama";
import { saveVaultState, exportDatabaseAsJSON, importDatabaseFromJSON, getDatabaseStats } from "../utils/database";
import { generateObsidianVault } from "../utils/obsidianExport";

export function useTranscriptOps(ctx, loadSavedData) {
  const { dispatch, stateRef, setShouldStop, embeddingStore, opQueue, abortControllerRef, huntControllerRef, touchstoneNamingController, touchstoneNameCache, restoreFileInput } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const purgeTranscriptData = useCallback(async (tr) => {
    if (!window.confirm(`Delete all parsed data for "${tr.name}"? This cannot be undone.`)) return;
    try {
      set('status', `Purging data for "${tr.name}"...`);
      const s = stateRef.current;
      const bitsToRemoveIds = new Set(s.topics.filter((t) => t.transcriptId === tr.id).map((t) => t.id));
      const updatedTopics = s.topics.filter((t) => t.transcriptId !== tr.id);
      const updatedMatches = s.matches.filter((m) => !bitsToRemoveIds.has(m.sourceId) && !bitsToRemoveIds.has(m.targetId));
      dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches } });
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: s.touchstones });
      set('status', `Purged all data for "${tr.name}"`);
      if (stateRef.current.selectedTranscript?.id === tr.id) dispatch({ type: 'SET', field: 'selectedTranscript', value: null });
    } catch (err) { set('status', `Error purging data: ${err.message}`); }
  }, []);

  const removeTranscript = useCallback(async (tr) => {
    if (!window.confirm(`Remove "${tr.name}" and all its parsed bits? This cannot be undone.`)) return;
    try {
      set('status', `Removing "${tr.name}"...`);
      const s = stateRef.current;
      const bitsToRemoveIds = new Set(s.topics.filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id).map((t) => t.id));
      const updatedTopics = s.topics.filter((t) => !bitsToRemoveIds.has(t.id));
      const updatedMatches = s.matches.filter((m) => !bitsToRemoveIds.has(m.sourceId) && !bitsToRemoveIds.has(m.targetId));
      const updatedTranscripts = s.transcripts.filter((t) => t.id !== tr.id);
      dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, transcripts: updatedTranscripts } });
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: updatedTranscripts, touchstones: s.touchstones });
      set('status', `Removed "${tr.name}" and ${bitsToRemoveIds.size} bits`);
      if (stateRef.current.selectedTranscript?.id === tr.id) dispatch({ type: 'SET', field: 'selectedTranscript', value: null });
    } catch (err) { set('status', `Error removing transcript: ${err.message}`); }
  }, []);

  const handleSyncApply = useCallback(async ({ toAdd, toRename, toDelete, toLink }) => {
    const s = stateRef.current;
    let updatedTranscripts = [...s.transcripts];
    let updatedTopics = [...s.topics];
    let updatedMatches = [...s.matches];
    let updatedTouchstones = { ...s.touchstones };

    // Dedup
    const seenNames = new Map();
    const dupeIds = new Set();
    for (const tr of updatedTranscripts) {
      const prev = seenNames.get(tr.name);
      if (prev) {
        if (tr.playHash && !prev.playHash) { dupeIds.add(prev.id); seenNames.set(tr.name, tr); }
        else dupeIds.add(tr.id);
      } else seenNames.set(tr.name, tr);
    }
    if (dupeIds.size > 0) {
      const keptByName = new Map([...seenNames].map(([name, tr]) => [name, tr]));
      updatedTopics = updatedTopics.map((t) => {
        if (dupeIds.has(t.transcriptId)) { const kept = keptByName.get(t.sourceFile); return kept ? { ...t, transcriptId: kept.id } : t; }
        return t;
      });
      updatedTranscripts = updatedTranscripts.filter((t) => !dupeIds.has(t.id));
    }

    // Deletes
    const deletedHashes = [];
    for (const tr of toDelete) {
      if (tr.playHash) deletedHashes.push(tr.playHash);
      const bitsToRemoveIds = new Set(updatedTopics.filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id).map((t) => t.id));
      updatedTopics = updatedTopics.filter((t) => !bitsToRemoveIds.has(t.id));
      updatedMatches = updatedMatches.filter((m) => !bitsToRemoveIds.has(m.sourceId) && !bitsToRemoveIds.has(m.targetId));
      updatedTranscripts = updatedTranscripts.filter((t) => t.id !== tr.id);
      for (const cat of ["confirmed", "possible"]) {
        updatedTouchstones[cat] = (updatedTouchstones[cat] || [])
          .map((ts) => ({ ...ts, bitIds: ts.bitIds.filter((id) => !bitsToRemoveIds.has(id)) }))
          .filter((ts) => ts.bitIds.length >= 2);
      }
    }
    if (deletedHashes.length > 0) {
      fetch("http://localhost:3001/api/prune-registry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: deletedHashes }),
      }).catch((err) => console.warn("[Sync] Registry prune failed:", err));
    }

    // Renames
    for (const { entry, existing } of toRename) {
      const oldName = existing.name;
      const newName = entry.transcript_filename;
      updatedTranscripts = updatedTranscripts.map((t) => t.id === existing.id ? { ...t, name: newName } : t);
      updatedTopics = updatedTopics.map((t) => t.sourceFile === oldName ? { ...t, sourceFile: newName } : t);
    }

    // Links
    for (const { entry, existing } of (toLink || [])) {
      updatedTranscripts = updatedTranscripts.map((t) => t.id === existing.id ? { ...t, playHash: entry.hash } : t);
    }

    // Adds
    for (const entry of toAdd) {
      updatedTranscripts.push({ id: uid(), name: entry.name, text: entry.text, playHash: entry.hash });
    }

    dispatch({ type: 'MERGE', payload: { transcripts: updatedTranscripts, topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones } });
    await saveVaultState({ transcripts: updatedTranscripts, topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones });

    const parts = [];
    if (toAdd.length) parts.push(`${toAdd.length} added`);
    if ((toLink || []).length) parts.push(`${toLink.length} linked`);
    if (toRename.length) parts.push(`${toRename.length} renamed`);
    if (toDelete.length) parts.push(`${toDelete.length} deleted`);
    set('status', `Sync complete: ${parts.join(", ")}`);
  }, []);

  const handleCreateTouchstoneFromBit = useCallback((name, bitId) => {
    const bit = stateRef.current.topics.find((t) => t.id === bitId);
    if (!bit) return;
    const newTouchstone = {
      id: `touchstone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      summary: `1 instance — in "${bit.sourceFile}"`,
      bitIds: [bitId],
      instances: [{ bitId, sourceFile: bit.sourceFile, title: bit.title, instanceNumber: 1, confidence: 1, relationship: "same_bit", communionStatus: "sainted" }],
      firstAppearance: { transcriptId: bit.transcriptId, bitId, sourceFile: bit.sourceFile },
      frequency: 1, crossTranscript: false, sourceCount: 1,
      tags: bit.tags || [], commonWords: [],
      matchInfo: { totalMatches: 0, sameBitCount: 0, evolvedCount: 0, relatedCount: 0, callbackCount: 0, avgConfidence: 0, avgMatchPercentage: 0, reasons: [] },
      category: "confirmed", manual: true,
    };
    update('touchstones', (prev) => ({
      confirmed: [...(prev.confirmed || []), newTouchstone],
      possible: prev.possible || [],
      rejected: prev.rejected || [],
    }));
  }, []);

  const rectifyOverlaps = useCallback(async () => {
    const s = stateRef.current;
    const ts = s.touchstones || {};
    const possibles = ts.possible || [];
    const confirmed = ts.confirmed || [];
    if (possibles.length === 0) return;

    let mergedCount = 0;
    let removedIds = new Set();

    const findOverlap = (source, targets) => {
      const srcSet = new Set(source.bitIds);
      let best = null, bestOverlap = 0;
      for (const target of targets) {
        if (target.id === source.id || removedIds.has(target.id)) continue;
        const overlap = target.bitIds.filter(id => srcSet.has(id)).length;
        const ratio = overlap / Math.max(1, Math.min(srcSet.size, target.bitIds.length));
        if (ratio >= 0.4 && overlap > bestOverlap) { bestOverlap = overlap; best = target; }
      }
      return best;
    };

    const absorbedPossibles = new Set();
    const updatedConfirmed = [...confirmed];
    const updatedPossibles = [...possibles];

    for (const possible of possibles) {
      if (absorbedPossibles.has(possible.id)) continue;
      let target = findOverlap(possible, updatedConfirmed);
      if (!target) {
        const otherPossibles = updatedPossibles.filter(p =>
          p.id !== possible.id && !absorbedPossibles.has(p.id) &&
          (p.instances.length > possible.instances.length || (p.instances.length === possible.instances.length && p.id < possible.id))
        );
        target = findOverlap(possible, otherPossibles);
      }
      if (!target) continue;

      const targetBitSet = new Set(target.bitIds);
      const newBitIds = possible.bitIds.filter(id => !targetBitSet.has(id));
      if (newBitIds.length > 0) {
        const newInstances = newBitIds.map(id => {
          const bit = s.topics.find(t => t.id === id);
          return bit ? { bitId: id, sourceFile: bit.sourceFile, title: bit.title, instanceNumber: target.instances.length + 1, confidence: 0.8, relationship: "evolved" } : null;
        }).filter(Boolean);
        target.bitIds = [...target.bitIds, ...newBitIds];
        target.instances = [...target.instances, ...newInstances];
        target.frequency = target.instances.length;
      }
      absorbedPossibles.add(possible.id);
      removedIds.add(possible.id);
      mergedCount++;
    }

    if (mergedCount === 0) { set('status', 'No overlapping touchstones found to rectify.'); return; }

    update('touchstones', (prev) => ({
      confirmed: updatedConfirmed,
      possible: updatedPossibles.filter(p => !absorbedPossibles.has(p.id)),
      rejected: prev.rejected || [],
    }));
    set('status', `Rectified ${mergedCount} overlapping touchstone${mergedCount !== 1 ? 's' : ''}.`);
    setTimeout(async () => {
      const s2 = stateRef.current;
      try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }); }
      catch (err) { console.error("Error saving after rectify:", err); }
    }, 100);
  }, []);

  const clearProcessedData = useCallback(async () => {
    if (!window.confirm("Clear all bits, matches, and touchstones? Transcripts will be kept but reset to unparsed.")) return;
    try {
      set('status', "Clearing processed data...");
      dispatch({ type: 'MERGE', payload: { topics: [], matches: [], touchstones: { confirmed: [], possible: [] }, selectedTopic: null, editingMode: null } });
      const s = stateRef.current;
      await saveVaultState({ topics: [], matches: [], transcripts: s.transcripts, touchstones: { confirmed: [], possible: [] } });
      set('status', "Processed data cleared. Transcripts kept.");
      getDatabaseStats().then(stats => set('dbStats', stats)).catch(console.error);
    } catch (err) { set('status', `Error: ${err.message}`); }
  }, []);

  const clearAllData = useCallback(async () => {
    if (!window.confirm("DELETE EVERYTHING? This will clear all transcripts, bits, matches, and settings. This cannot be undone.")) return;
    if (!window.confirm("Are you absolutely sure? Click OK to permanently delete all data.")) return;
    try {
      set('status', "Clearing database...");
      dispatch({ type: 'CLEAR_ALL' });
      embeddingStore.clear();
      set('embeddingStatus', { cached: 0, total: 0 });
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("comedy-parser-vault");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      set('status', "Database cleared. Start fresh!");
      set('dbStats', null);
      set('lastSave', null);
    } catch (err) { set('status', `Error clearing database: ${err.message}`); }
  }, []);

  const handleHardStop = useCallback(async () => {
    setShouldStop(true);
    const cleared = opQueue.clear();
    if (cleared > 0) console.log(`[HardStop] Cleared ${cleared} queued operations`);
    for (const ref of [abortControllerRef, huntControllerRef, touchstoneNamingController]) {
      if (ref.current) { ref.current.abort(); ref.current = null; }
    }
    set('processing', false);
    set('streamingProgress', null);
    set('huntProgress', null);
    set('status', "Stopping... restarting Ollama...");
    try {
      await requestOllamaRestart();
      set('status', "Hard stop complete. Ollama restarted.");
    } catch (err) { set('status', `Stopped. Ollama restart failed: ${err.message}`); }
    setShouldStop(false);
  }, []);

  const handleBackup = useCallback(async () => {
    try {
      set('status', "Exporting backup...");
      const json = await exportDatabaseAsJSON();
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `topix-backup-${dateStr}.json`; a.click();
      URL.revokeObjectURL(url);
      set('status', "Backup downloaded.");
    } catch (err) { set('status', `Backup failed: ${err.message}`); }
  }, []);

  const handleRestore = useCallback(() => { restoreFileInput.current?.click(); }, []);

  const handleRestoreFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      set('status', "Restoring from backup...");
      const text = await file.text();
      const json = JSON.parse(text);
      await importDatabaseFromJSON(json);
      embeddingStore.clear();
      set('embeddingStatus', { cached: 0, total: 0 });
      await loadSavedData();
      set('status', "Restored from backup.");
    } catch (err) { set('status', `Restore failed: ${err.message}`); }
    e.target.value = "";
  }, [loadSavedData]);

  const handleResetTouchstones = useCallback(async () => {
    if (!window.confirm("Clear all touchstone data and matches? Bits and transcripts will be kept. Touchstones will be re-detected from scratch.")) return;
    dispatch({ type: 'MERGE', payload: { touchstones: { confirmed: [], possible: [], rejected: [] }, matches: [] } });
    touchstoneNameCache.current.clear();
    try {
      const s = stateRef.current;
      await saveVaultState({ topics: s.topics, matches: [], transcripts: s.transcripts, touchstones: { confirmed: [], possible: [], rejected: [] } });
      set('status', 'Cleared all touchstone data and matches.');
    } catch (err) { console.error("Error clearing touchstones:", err); }
  }, []);

  const exportVault = useCallback(() => {
    const s = stateRef.current;
    const files = generateObsidianVault(s.topics, s.matches, s.transcripts, [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || [])]);
    const manifest = {
      vaultName: "Comedy Bit Vault", exportDate: new Date().toISOString(),
      stats: { totalBits: s.topics.length, touchstones: (s.touchstones.confirmed || []).length + (s.touchstones.possible || []).length, connections: s.matches.length, transcripts: s.transcripts.length },
      files,
      instructions: "Extract into your Comedy vault (~/ownCloud/Comedy/). Folders: 'Jokes/', 'Touchstones/', 'Performance Flows/'. The MOC file goes in the vault root.",
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "comedy-vault-export.json"; a.click(); URL.revokeObjectURL(url);
  }, []);

  const exportMarkdownZip = useCallback(() => {
    const s = stateRef.current;
    const files = generateObsidianVault(s.topics, s.matches, s.transcripts, [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || [])]);
    files.forEach((f) => {
      const blob = new Blob([f.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = f.name; a.click(); URL.revokeObjectURL(url);
    });
  }, []);

  const exportSingleMd = useCallback(() => {
    const s = stateRef.current;
    const files = generateObsidianVault(s.topics, s.matches, s.transcripts, [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || [])]);
    const combined = files.map((f) => `<!-- FILE: ${f.name} -->\n${f.content}`).join("\n\n---\n\n");
    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "comedy-vault-combined.md"; a.click(); URL.revokeObjectURL(url);
  }, []);

  const syncToVault = useCallback(async () => {
    const s = stateRef.current;
    const files = generateObsidianVault(s.topics, s.matches, s.transcripts, [...(s.touchstones.confirmed || []), ...(s.touchstones.possible || [])]);
    set("status", `Syncing ${files.length} files to Obsidian vault...`);
    try {
      const res = await fetch("/api/export/obsidian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");
      const errCount = data.errors?.length || 0;
      set("status", `Synced ${data.written} files to vault.${errCount > 0 ? ` ${errCount} errors.` : ""}`);
      return data;
    } catch (e) {
      set("status", `Vault sync failed: ${e.message}`);
      throw e;
    }
  }, []);

  const undoVaultSync = useCallback(async () => {
    set("status", "Undoing last vault sync...");
    try {
      const res = await fetch("/api/export/obsidian/undo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Undo failed");
      set("status", `Undo complete: ${data.restored} restored, ${data.removed} removed.`);
      return data;
    } catch (e) {
      set("status", `Undo failed: ${e.message}`);
      throw e;
    }
  }, []);

  return {
    purgeTranscriptData, removeTranscript, handleSyncApply,
    handleCreateTouchstoneFromBit, rectifyOverlaps,
    clearProcessedData, clearAllData, handleHardStop,
    handleBackup, handleRestore, handleRestoreFile, handleResetTouchstones,
    exportVault, exportMarkdownZip, exportSingleMd, syncToVault, undoVaultSync,
  };
}
