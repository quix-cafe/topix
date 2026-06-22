import { useCallback, useRef } from "react";
import { saveSets } from "../utils/database";

let _counter = 0;
function uid() {
  return `set-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}
function itemUid() {
  return `si-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}

export function useSets(ctx) {
  const { dispatch, stateRef } = ctx;
  const savingRef = useRef(false);

  const persist = useCallback(async (sets) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await saveSets(sets);
    } finally {
      savingRef.current = false;
    }
  }, []);

  const normalizeItem = (item) => {
    const base = {
      id: itemUid(),
      type: item.type || "text", // "touchstone" | "text" | "hr" | "group"
      touchstoneId: item.touchstoneId || null,
      text: item.text || "",
    };
    if (item.type === "group") {
      base.title = item.title || "";
      base.note = item.note || "";
      base.children = (item.children || []).map(normalizeItem);
    }
    return base;
  };

  const createSet = useCallback(async (name = "Untitled Set", items = []) => {
    const newSet = {
      id: uid(),
      name,
      items: items.map(normalizeItem),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const sets = [...stateRef.current.sets, newSet];
    dispatch({ type: "MERGE", payload: { sets } });
    await persist(sets);
    return newSet.id;
  }, [dispatch, persist, stateRef]);

  const deleteSet = useCallback(async (setId) => {
    const sets = stateRef.current.sets.filter((s) => s.id !== setId);
    dispatch({ type: "MERGE", payload: { sets } });
    await persist(sets);
  }, [dispatch, persist, stateRef]);

  const renameSet = useCallback(async (setId, name) => {
    const sets = stateRef.current.sets.map((s) =>
      s.id === setId ? { ...s, name, updatedAt: Date.now() } : s
    );
    dispatch({ type: "MERGE", payload: { sets } });
    await persist(sets);
  }, [dispatch, persist, stateRef]);

  const updateSetItems = useCallback(async (setId, items) => {
    const sets = stateRef.current.sets.map((s) =>
      s.id === setId ? { ...s, items, updatedAt: Date.now() } : s
    );
    dispatch({ type: "MERGE", payload: { sets } });
    await persist(sets);
  }, [dispatch, persist, stateRef]);

  const addItem = useCallback(async (setId, item, atIndex, parentGroupId) => {
    const set = stateRef.current.sets.find((s) => s.id === setId);
    if (!set) return;
    const newItem = normalizeItem(item);
    let items;
    if (parentGroupId) {
      items = set.items.map((i) => {
        if (i.id !== parentGroupId || i.type !== "group") return i;
        const children = [...(i.children || [])];
        if (atIndex !== undefined) children.splice(atIndex, 0, newItem);
        else children.push(newItem);
        return { ...i, children };
      });
    } else {
      items = [...set.items];
      if (atIndex !== undefined) items.splice(atIndex, 0, newItem);
      else items.push(newItem);
    }
    await updateSetItems(setId, items);
    return newItem.id;
  }, [stateRef, updateSetItems]);

  const removeItem = useCallback(async (setId, itemId) => {
    const set = stateRef.current.sets.find((s) => s.id === setId);
    if (!set) return;
    let removed = false;
    let items = set.items.filter((i) => {
      if (i.id === itemId) { removed = true; return false; }
      return true;
    });
    if (!removed) {
      items = set.items.map((i) => {
        if (i.type !== "group" || !i.children) return i;
        const filtered = i.children.filter((c) => c.id !== itemId);
        return filtered.length === i.children.length ? i : { ...i, children: filtered };
      });
    }
    await updateSetItems(setId, items);
  }, [stateRef, updateSetItems]);

  const updateItem = useCallback(async (setId, itemId, changes) => {
    const set = stateRef.current.sets.find((s) => s.id === setId);
    if (!set) return;
    const items = set.items.map((i) => {
      if (i.id === itemId) return { ...i, ...changes };
      if (i.type === "group" && i.children?.some((c) => c.id === itemId)) {
        const children = i.children.map((c) => c.id === itemId ? { ...c, ...changes } : c);
        return { ...i, children };
      }
      return i;
    });
    await updateSetItems(setId, items);
  }, [stateRef, updateSetItems]);

  const importFromNote = useCallback(async (note, touchstones) => {
    // Parse note text into lines, try to match each line to a touchstone
    const lines = note.text.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    const allTs = [...(touchstones.confirmed || []), ...(touchstones.possible || [])];
    const items = lines.map((line) => {
      const lower = line.toLowerCase();
      const match = allTs.find((t) => {
        const name = (t.manualName ? t.name : t.name || "").toLowerCase();
        return name && (lower.includes(name) || name.includes(lower));
      });
      if (match) {
        return { type: "touchstone", touchstoneId: match.id, text: line };
      }
      return { type: "text", touchstoneId: null, text: line };
    });
    return createSet(note.title || "Imported Set", items);
  }, [createSet]);

  return {
    createSet,
    deleteSet,
    renameSet,
    updateSetItems,
    addItem,
    removeItem,
    updateItem,
    importFromNote,
  };
}
