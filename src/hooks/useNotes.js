import { useCallback, useRef } from "react";
import { saveNotes, saveNoteListMeta, loadNoteListMeta, saveRemovedJournals, loadRemovedJournals } from "../utils/database";

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function makeId(source, text, date, title) {
  return `note-${source}-${hashString(text + (date || "") + (title || ""))}`;
}

export function useNotes(ctx) {
  const { dispatch, stateRef } = ctx;
  const importingRef = useRef(false);

  const importClickUp = useCallback(async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      const res = await fetch("/api/notes/clickup");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { notes: raw } = await res.json();

      const existing = new Set(stateRef.current.notes.map(n => n.id));
      const newNotes = [];
      for (const n of raw) {
        const id = makeId("clickup", n.text, n.date, n.title);
        if (existing.has(id)) continue;
        newNotes.push({
          id,
          text: n.text,
          title: n.title,
          source: "clickup",
          generation: "g1",
          date: n.date,
          tags: n.tags,
          sourceFile: "data.csv",
          importedAt: Date.now(),
          syncHash: hashString(n.text),
        });
      }

      if (newNotes.length > 0) {
        const merged = [...stateRef.current.notes, ...newNotes];
        dispatch({ type: "MERGE", payload: { notes: merged } });
        await saveNotes(merged);
      }

      return { imported: newNotes.length, total: raw.length };
    } finally {
      importingRef.current = false;
    }
  }, []);

  const importKeep = useCallback(async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      const res = await fetch("/api/notes/keep");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { notes: raw } = await res.json();

      const existing = new Set(stateRef.current.notes.map(n => n.id));
      const newNotes = [];
      for (const n of raw) {
        const id = makeId("keep", n.text, n.date, n.title);
        if (existing.has(id)) continue;
        newNotes.push({
          id,
          text: n.text,
          title: n.title,
          source: "keep",
          generation: "g1",
          date: n.date,
          tags: [],
          sourceFile: n.sourceFile,
          importedAt: Date.now(),
          syncHash: hashString(n.text),
        });
      }

      if (newNotes.length > 0) {
        const merged = [...stateRef.current.notes, ...newNotes];
        dispatch({ type: "MERGE", payload: { notes: merged } });
        await saveNotes(merged);
      }

      return { imported: newNotes.length, total: raw.length };
    } finally {
      importingRef.current = false;
    }
  }, []);

  const syncJournals = useCallback(async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      const res = await fetch("/api/notes/journals");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { notes: raw } = await res.json();

      const removedSet = await loadRemovedJournals();
      const existingMap = new Map(
        stateRef.current.notes.filter(n => n.source === "journal").map(n => [n.sourceFile, n])
      );

      let added = 0, updated = 0;
      const currentNotes = [...stateRef.current.notes];

      for (const n of raw) {
        if (removedSet.has(n.sourceFile)) continue;
        const id = makeId("journal", n.sourceFile, n.date, n.title);
        const newHash = hashString(n.text);
        const existing = existingMap.get(n.sourceFile);

        if (existing && existing.syncHash === newHash) continue;

        const note = {
          id,
          text: n.text,
          title: n.title,
          source: "journal",
          generation: "g2",
          date: n.date,
          tags: [],
          sourceFile: n.sourceFile,
          importedAt: Date.now(),
          syncHash: newHash,
        };

        if (existing) {
          const idx = currentNotes.findIndex(x => x.id === existing.id);
          if (idx !== -1) currentNotes[idx] = note;
          updated++;
        } else {
          currentNotes.push(note);
          added++;
        }
      }

      if (added > 0 || updated > 0) {
        dispatch({ type: "MERGE", payload: { notes: currentNotes } });
        await saveNotes(currentNotes);
      }

      return { added, updated, total: raw.length };
    } finally {
      importingRef.current = false;
    }
  }, []);

  const clearImports = useCallback(async () => {
    const current = stateRef.current.notes;
    const journals = current.filter(n => n.source === "journal");
    const removed = current.length - journals.length;
    dispatch({ type: "MERGE", payload: { notes: journals } });
    await saveNotes(journals);
    return { removed, kept: journals.length };
  }, []);

  const removeNote = useCallback(async (noteId) => {
    const note = stateRef.current.notes.find(n => n.id === noteId);
    const updated = stateRef.current.notes.filter(n => n.id !== noteId);
    dispatch({ type: "MERGE", payload: { notes: updated } });
    await saveNotes(updated);
    // Track removed journals so sync doesn't re-add them
    if (note?.source === "journal" && note.sourceFile) {
      const removed = await loadRemovedJournals();
      removed.add(note.sourceFile);
      await saveRemovedJournals(removed);
    }
  }, []);

  const updateNoteSortOrders = useCallback(async (orderedIds) => {
    const current = [...stateRef.current.notes];
    for (let i = 0; i < orderedIds.length; i++) {
      const idx = current.findIndex(n => n.id === orderedIds[i]);
      if (idx !== -1) current[idx] = { ...current[idx], sortOrder: i };
    }
    dispatch({ type: "MERGE", payload: { notes: current } });
    await saveNotes(current);
  }, []);

  const loadListMeta = useCallback(async () => {
    return await loadNoteListMeta();
  }, []);

  const updateListMeta = useCallback(async (tag, meta) => {
    const current = await loadNoteListMeta();
    const updated = { ...current, [tag]: { ...(current[tag] || {}), ...meta } };
    await saveNoteListMeta(updated);
    return updated;
  }, []);

  const updateNote = useCallback(async (noteId, changes) => {
    const current = [...stateRef.current.notes];
    const idx = current.findIndex(n => n.id === noteId);
    if (idx === -1) return;
    current[idx] = { ...current[idx], ...changes };
    dispatch({ type: "MERGE", payload: { notes: current } });
    await saveNotes(current);
  }, []);

  const renameListTag = useCallback(async (oldTag, newTag) => {
    const current = stateRef.current.notes.map(n => {
      if (!n.tags || !n.tags.includes(oldTag)) return n;
      return { ...n, tags: n.tags.map(t => t === oldTag ? newTag : t) };
    });
    dispatch({ type: "MERGE", payload: { notes: current } });
    await saveNotes(current);
    // Also migrate list meta
    const meta = await loadNoteListMeta();
    if (meta[oldTag]) {
      const updated = { ...meta, [newTag]: meta[oldTag] };
      delete updated[oldTag];
      await saveNoteListMeta(updated);
      return updated;
    }
    return meta;
  }, []);

  return { importClickUp, importKeep, syncJournals, clearImports, removeNote, updateNoteSortOrders, loadListMeta, updateListMeta, updateNote, renameListTag };
}
