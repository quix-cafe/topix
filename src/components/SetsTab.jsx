import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useHashParam } from "../hooks/useHashParam";
import { searchTouchstones } from "../utils/touchstoneSearch";
import { loadNoteListMeta } from "../utils/database";

const WORDS_PER_MINUTE = 150;

const TOUCHSTONE_PALETTE = [
  // Primary Distinct Set (High contrast sequence)
  "#ff8787", "#339af0", "#51cf66", "#fcc419", // Red, Blue, Green, Yellow
  "#f06595", "#22b8cf", "#94d82d", "#ff922b", // Pink, Cyan, Lime, Orange
  "#cc5de8", "#20c997", "#f08c00", "#5c7cfa", // Purple, Teal, Dark Orange, Indigo
  
  // Secondary High-Luminance Set
  "#845ef7", "#38d9a9", "#ffd43b", "#ff6b6b", // Violet, Mint, Bright Yellow, Soft Red
  "#4dabf7", "#69db7c", "#ffa94d", "#da77f2", // Light Blue, Light Green, Peach, Lavender
  "#15aabf", "#a9e34b", "#fd7e14", "#e64980", // Ocean, Chartreuse, Burnt Orange, Rose
  
  // Tertiary Differentiation Set
  "#74c0fc", "#63e6be", "#fcc419", "#ffc9c9", // Sky, Seafoam, Gold, Pale Red
  "#be4bdb", "#3bc9db", "#82c91e", "#fab005", // Grape, Electric Blue, Olive-Lime, Amber
  "#748ffc", "#96f2d7", "#f783ac", "#4ecdc4"  // Periwinkle, Aquamarine, Flamingo, Turquoise
];
function hashStr(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff; return Math.abs(h); }
function tsColor(tsId) { return TOUCHSTONE_PALETTE[hashStr(tsId) % TOUCHSTONE_PALETTE.length]; }

function KeywordBadge({ keyword }) {
  if (!keyword) return null;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#4ecdc4", background: "#4ecdc418", padding: "1px 6px", borderRadius: 3, border: "1px solid #4ecdc433", marginRight: 6, letterSpacing: 0.3, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {keyword}
    </span>
  );
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function textWordDuration(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  return (words / WORDS_PER_MINUTE) * 60;
}

export default function SetsTab({
  sets,
  touchstones,
  topics,
  notes,
  onCreateSet,
  onDeleteSet,
  onRenameSet,
  onUpdateSetItems,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onImportFromNote,
  onGoToTouchstone,
}) {
  const [selectedSetId, setSelectedSetId] = useHashParam("ss", "", { pushHistory: true });
  const [viewingPendingList, setViewingPendingList] = useHashParam("sp", "", { pushHistory: true });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [addMode, setAddMode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemText, setEditItemText] = useState("");
  const [dragFromIdx, setDragFromIdx] = useState(null);
  const [dropGapIdx, setDropGapIdx] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmRemoveItemId, setConfirmRemoveItemId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [detailView, setDetailView] = useState(false);
  const [viewMode, setViewMode] = useState("edit"); // "edit" | "fulltext" | "setlist"
  const [matchingItemId, setMatchingItemId] = useState(null);
  const [hoveredTimelineIdx, setHoveredTimelineIdx] = useState(null);
  const timelineRef = useRef(null);
  const [matchQuery, setMatchQuery] = useState("");
  const [listMeta, setListMeta] = useState({});
  const renameInputRef = useRef(null);
  const textInputRef = useRef(null);
  // Guard: prevent onBlur from firing during the same tick as mount
  const renameJustOpened = useRef(false);

  useEffect(() => {
    loadNoteListMeta().then(setListMeta);
  }, []);

  const bitById = useMemo(() => {
    const map = {};
    for (const t of topics || []) map[t.id] = t;
    return map;
  }, [topics]);

  const allTouchstones = useMemo(
    () => [...(touchstones.confirmed || []), ...(touchstones.possible || [])],
    [touchstones]
  );

  const getTouchstoneDuration = useCallback((tsId) => {
    const ts = allTouchstones.find((t) => t.id === tsId);
    if (!ts) return 0;
    if (ts.idealText) return textWordDuration(ts.idealText);
    const bitIds = ts.bitIds || [];
    let totalWords = 0;
    let count = 0;
    for (const bid of bitIds) {
      const bit = bitById[bid];
      if (bit?.fullText) {
        totalWords += bit.fullText.trim().split(/\s+/).length;
        count++;
      }
    }
    if (count === 0) return 0;
    return ((totalWords / count) / WORDS_PER_MINUTE) * 60;
  }, [allTouchstones, bitById]);

  const getItemDuration = useCallback((item) => {
    if (item.type === "hr") return 0;
    if (item.touchstoneId) return getTouchstoneDuration(item.touchstoneId);
    if (item.text) return textWordDuration(item.text);
    return 0;
  }, [getTouchstoneDuration]);

  const getListCategory = useCallback((tag) => {
    const cat = listMeta[tag]?.category;
    if (cat === "setlist") return "set";
    return cat || null;
  }, [listMeta]);

  const selectedSet = useMemo(
    () => (selectedSetId ? sets.find((s) => s.id === selectedSetId) : null) || null,
    [sets, selectedSetId]
  );

  const pendingSetLists = useMemo(() => {
    if (!notes) return [];
    const tagMap = {};
    for (const n of notes) {
      for (const t of (n.tags || [])) {
        if (!tagMap[t]) tagMap[t] = [];
        tagMap[t].push(n);
      }
    }
    return Object.entries(tagMap)
      .filter(([tag]) => getListCategory(tag) === "set")
      .map(([tag, tagNotes]) => ({ tag, notes: tagNotes }));
  }, [notes, getListCategory]);

  const getSetDuration = useCallback((items) => {
    let total = 0;
    for (const item of items) total += getItemDuration(item);
    return total;
  }, [getItemDuration]);

  const usedTouchstoneIds = useMemo(() => {
    if (!selectedSet) return new Set();
    return new Set(selectedSet.items.filter((i) => i.touchstoneId).map((i) => i.touchstoneId));
  }, [selectedSet]);

  const relatedTouchstoneIds = useMemo(() => {
    if (!selectedSet) return new Set();
    const related = new Set();
    for (const item of selectedSet.items) {
      if (item.touchstoneId) {
        const ts = allTouchstones.find((t) => t.id === item.touchstoneId);
        if (ts?.relatedTouchstoneIds) {
          for (const rid of ts.relatedTouchstoneIds) {
            if (!usedTouchstoneIds.has(rid)) related.add(rid);
          }
        }
      }
    }
    return related;
  }, [selectedSet, allTouchstones, usedTouchstoneIds]);

  const relatedTouchstones = useMemo(() => {
    return allTouchstones.filter((t) => relatedTouchstoneIds.has(t.id));
  }, [allTouchstones, relatedTouchstoneIds]);

  const searchResults = useMemo(() => {
    const results = searchTouchstones(allTouchstones, searchQuery);
    const filtered = results.filter((t) => !usedTouchstoneIds.has(t.id)).slice(0, 20);
    if (!searchQuery.trim() && relatedTouchstones.length > 0) {
      const relatedIds = new Set(relatedTouchstones.map((t) => t.id));
      const rest = filtered.filter((t) => !relatedIds.has(t.id));
      return [...relatedTouchstones, ...rest].slice(0, 25);
    }
    return filtered;
  }, [allTouchstones, searchQuery, usedTouchstoneIds, relatedTouchstones]);

  const matchResults = useMemo(() => {
    if (!matchingItemId) return [];
    if (!matchQuery.trim()) {
      const related = [...relatedTouchstones];
      const relIds = new Set(related.map((t) => t.id));
      for (const t of touchstones.confirmed || []) {
        if (related.length >= 20) break;
        if (!relIds.has(t.id)) related.push(t);
      }
      return related;
    }
    const results = searchTouchstones(allTouchstones, matchQuery);
    if (results.length > 0) return results.slice(0, 20);
    return allTouchstones.slice(0, 20);
  }, [allTouchstones, matchQuery, matchingItemId, relatedTouchstones, touchstones.confirmed]);

  const suggestions = useMemo(() => {
    if (!selectedSet || selectedSet.items.length === 0) return allTouchstones.slice(0, 10);
    const setTsIds = new Set(selectedSet.items.filter((i) => i.touchstoneId).map((i) => i.touchstoneId));
    if (setTsIds.size === 0) return allTouchstones.slice(0, 10);
    const setTs = allTouchstones.filter((t) => setTsIds.has(t.id));
    const setSourceFiles = new Set();
    for (const t of setTs) {
      for (const inst of t.instances || []) {
        if (inst.sourceFile) setSourceFiles.add(inst.sourceFile);
      }
    }
    const scored = allTouchstones
      .filter((t) => !setTsIds.has(t.id))
      .map((t) => {
        let score = 0;
        for (const inst of t.instances || []) {
          if (inst.sourceFile && setSourceFiles.has(inst.sourceFile)) score += 1;
        }
        return { ts: t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const result = scored.map((s) => s.ts).slice(0, 15);
    if (result.length < 5) {
      for (const t of touchstones.confirmed || []) {
        if (result.length >= 15) break;
        if (!setTsIds.has(t.id) && !result.includes(t)) result.push(t);
      }
    }
    return result;
  }, [selectedSet, allTouchstones, touchstones.confirmed]);

  const getTouchstone = useCallback(
    (id) => allTouchstones.find((ts) => ts.id === id) || null,
    [allTouchstones]
  );

  const getTouchstoneCategory = useCallback(
    (id) => {
      if ((touchstones.confirmed || []).find((t) => t.id === id)) return "confirmed";
      if ((touchstones.possible || []).find((t) => t.id === id)) return "possible";
      return null;
    },
    [touchstones]
  );

  // --- handlers ---

  const handleDragStart = useCallback((e, idx) => {
    setDragFromIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  }, []);
  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropGapIdx(e.clientY < midY ? idx : idx + 1);
  }, []);
  const handleDragEnd = useCallback(() => { setDragFromIdx(null); setDropGapIdx(null); }, []);
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    if (dragFromIdx === null || dropGapIdx === null || !selectedSet) return;
    const items = [...selectedSet.items];
    const [moved] = items.splice(dragFromIdx, 1);
    const insertIdx = dropGapIdx > dragFromIdx ? dropGapIdx - 1 : dropGapIdx;
    items.splice(insertIdx, 0, moved);
    await onUpdateSetItems(selectedSet.id, items);
    setDragFromIdx(null);
    setDropGapIdx(null);
  }, [dragFromIdx, dropGapIdx, selectedSet, onUpdateSetItems]);

  const handleCreateNew = async () => {
    const id = await onCreateSet("New Set");
    setSelectedSetId(id);
    setViewingPendingList("");
  };

  const startRename = () => {
    if (!selectedSet) return;
    renameJustOpened.current = true;
    setRenamingId(selectedSet.id);
    setRenameValue(selectedSet.name);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      renameJustOpened.current = false;
    }, 50);
  };

  const handleConfirmRename = async () => {
    if (renameJustOpened.current) return; // don't close on mount blur
    if (renamingId && renameValue.trim()) {
      await onRenameSet(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  // addAtTop: when true, inserts at index 0 instead of appending
  const addAtTopRef = useRef(false);

  const handleAddTouchstone = async (ts) => {
    if (!selectedSet) return;
    await onAddItem(selectedSet.id, { type: "touchstone", touchstoneId: ts.id, text: "" }, addAtTopRef.current ? 0 : undefined);
  };
  const handleAddText = async () => {
    if (!selectedSet || !textDraft.trim()) return;
    await onAddItem(selectedSet.id, { type: "text", text: textDraft.trim() }, addAtTopRef.current ? 0 : undefined);
    setTextDraft("");
    textInputRef.current?.focus();
  };
  const handleAddHr = async () => {
    if (!selectedSet) return;
    await onAddItem(selectedSet.id, { type: "hr", text: "" }, addAtTopRef.current ? 0 : undefined);
  };

  const handleMatchItem = async (itemId, ts) => {
    // Preserve existing text as the note when matching
    const item = selectedSet?.items.find((i) => i.id === itemId);
    const existingText = item?.text || "";
    await onUpdateItem(selectedSet.id, itemId, { type: "touchstone", touchstoneId: ts.id, text: existingText });
    setMatchingItemId(null);
    setMatchQuery("");
  };
  const handleUnmatchItem = async (itemId) => {
    await onUpdateItem(selectedSet.id, itemId, { type: "text", touchstoneId: null });
  };

  const handlePromotePending = async (tag, pendingNotes) => {
    const items = [];
    for (const n of pendingNotes) {
      const lines = (n.text || "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
      const matchedTs = n.matchedTouchstoneId ? allTouchstones.find((t) => t.id === n.matchedTouchstoneId) : null;
      if (matchedTs && lines.length <= 1) {
        items.push({ type: "touchstone", touchstoneId: matchedTs.id, text: lines[0] || n.title || "" });
      } else if (matchedTs && lines.length > 1) {
        items.push({ type: "touchstone", touchstoneId: matchedTs.id, text: n.title || lines[0] || "" });
        const startIdx = n.title ? 0 : 1;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i];
          const lower = line.toLowerCase();
          const fuzzy = allTouchstones.find((t) => {
            const name = (t.name || "").toLowerCase();
            return name && name.length > 3 && (lower.includes(name) || name.includes(lower));
          });
          items.push({ type: fuzzy ? "touchstone" : "text", touchstoneId: fuzzy?.id || null, text: line });
        }
      } else {
        for (const line of lines) {
          const lower = line.toLowerCase();
          const fuzzy = allTouchstones.find((t) => {
            const name = (t.name || "").toLowerCase();
            return name && name.length > 3 && (lower.includes(name) || name.includes(lower));
          });
          items.push({ type: fuzzy ? "touchstone" : "text", touchstoneId: fuzzy?.id || null, text: line });
        }
      }
    }
    const id = await onCreateSet(tag, items);
    setSelectedSetId(id);
    setViewingPendingList("");
  };

  const handleItemEditSave = async () => {
    if (!selectedSet || !editingItemId) return;
    await onUpdateItem(selectedSet.id, editingItemId, { text: editItemText });
    setEditingItemId(null);
  };

  // --- render helpers ---

  const renderTsRow = (ts, onClick, opts = {}) => {
    const dur = getTouchstoneDuration(ts.id);
    return (
      <div key={ts.id} className="set-ts-result" onClick={onClick}>
        <span className={`ts-dot ${getTouchstoneCategory(ts.id)}`} />
        <KeywordBadge keyword={ts.keyword} />
        <span>{ts.name}</span>
        {opts.isRelated && <span style={{ fontSize: 9, color: "#e599f7", marginLeft: 4 }}>related</span>}
        <span style={{ color: "#555", fontSize: 11, marginLeft: "auto", display: "flex", gap: 8 }}>
          {formatDuration(dur) && <span style={{ color: "#74c0fc" }}>{formatDuration(dur)}</span>}
          {(ts.instances || []).length} inst
        </span>
      </div>
    );
  };

  const renderAddButtons = (top) => (
    <div style={{ display: "flex", gap: 6 }}>
      <button className={`btn-sm ${addMode === "touchstone" ? "btn-green" : ""}`}
        onClick={() => { addAtTopRef.current = top; setAddMode(addMode === "touchstone" ? null : "touchstone"); setSearchQuery(""); }}>+ touchstone</button>
      <button className={`btn-sm ${addMode === "text" ? "btn-green" : ""}`}
        onClick={() => { addAtTopRef.current = top; setAddMode(addMode === "text" ? null : "text"); }}>+ text</button>
      <button className="btn-sm" onClick={() => { addAtTopRef.current = top; handleAddHr(); }} title="Insert divider">+ hr</button>
    </div>
  );

  const addPanel = (
    <>
      {addMode === "touchstone" && (
        <div className="set-add-panel">
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search touchstones..." className="dark-input" style={{ width: "100%", marginBottom: 8 }} autoFocus />
          {!searchQuery.trim() && relatedTouchstones.length > 0 && (
            <div style={{ fontSize: 10, color: "#e599f7", marginBottom: 4, fontWeight: 600 }}>Related to set</div>
          )}
          <div className="set-ts-results">
            {searchResults.map((ts) =>
              renderTsRow(ts, () => handleAddTouchstone(ts), { isRelated: !searchQuery.trim() && relatedTouchstoneIds.has(ts.id) })
            )}
            {searchResults.length === 0 && <div style={{ color: "#666", fontSize: 12, padding: 8 }}>No results</div>}
          </div>
        </div>
      )}
      {addMode === "text" && (
        <form onSubmit={(e) => { e.preventDefault(); handleAddText(); }} className="set-add-panel">
          <div style={{ display: "flex", gap: 6 }}>
            <input ref={textInputRef} value={textDraft} onChange={(e) => setTextDraft(e.target.value)}
              placeholder="Type a bit name, note, transition..." className="dark-input" style={{ flex: 1 }} autoFocus />
            <button type="submit" className="btn-sm btn-green" disabled={!textDraft.trim()}>add</button>
          </div>
        </form>
      )}
    </>
  );

  // --- sidebar ---

  const renderSetList = () => (
    <div className="sets-sidebar">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className="section-heading" style={{ margin: 0 }}>Sets</h2>
        <button onClick={handleCreateNew} className="btn-sm btn-green">+ New Set</button>
      </div>

      {sets.length === 0 && pendingSetLists.length === 0 && (
        <div style={{ color: "#666", fontSize: 13, padding: "16px 0" }}>No sets yet. Create one or categorize notes as "set" to get started.</div>
      )}

      {sets.map((s) => {
        const dur = getSetDuration(s.items);
        const bitCount = s.items.filter((i) => i.type !== "hr").length;
        return (
          <div key={s.id}
            className={`card card-static ${selectedSetId === s.id && !viewingPendingList ? "set-selected" : ""}`}
            onClick={() => { setSelectedSetId(s.id); setViewingPendingList(""); setDetailView(false); setViewMode("edit"); }}
            style={{ cursor: "pointer", padding: "10px 14px", marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
              <span style={{ color: "#666", fontSize: 12, whiteSpace: "nowrap" }}>
                {bitCount} bit{bitCount !== 1 ? "s" : ""}
                {dur > 0 && <span style={{ color: "#74c0fc", marginLeft: 6 }}>{formatDuration(dur)}</span>}
              </span>
            </div>
          </div>
        );
      })}

      {pendingSetLists.length > 0 && (
        <>
          <h3 style={{ color: "#6ee7b7", fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 8 }}>Pending Setlists</h3>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Note lists categorized as "set"</div>
          {pendingSetLists.map(({ tag, notes: listNotes }) => (
            <div key={tag}
              className={`card card-static ${viewingPendingList === tag ? "set-selected" : ""}`}
              style={{ cursor: "pointer", padding: "8px 12px", marginBottom: 4, borderColor: "#059669", borderStyle: "dashed" }}
              onClick={() => { setViewingPendingList(tag); setSelectedSetId(""); }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: "#6ee7b7" }}>{tag}</div>
              <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>{listNotes.length} note{listNotes.length !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  // --- pending viewer ---

  const renderPendingViewer = () => {
    const list = pendingSetLists.find((l) => l.tag === viewingPendingList);
    if (!list) return null;
    return (
      <div className="sets-editor">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <h2 className="section-heading" style={{ margin: 0, flex: 1, color: "#6ee7b7" }}>{viewingPendingList}</h2>
          <button className="btn-sm btn-green" onClick={() => handlePromotePending(viewingPendingList, list.notes)}>Create Set from This</button>
        </div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>Preview of notes in this list. Click "Create Set from This" to promote to a real set.</div>
        {list.notes.map((n) => {
          const matchedTs = n.matchedTouchstoneId ? allTouchstones.find((t) => t.id === n.matchedTouchstoneId) : null;
          return (
            <div key={n.id} className="card card-static" style={{ padding: "10px 14px", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                {n.title && <span style={{ fontWeight: 600, fontSize: 13, color: "#ddd" }}>{n.title}</span>}
                {matchedTs && (
                  <span style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "#555" }}>&rarr;</span>
                    <span className={`ts-dot ${getTouchstoneCategory(matchedTs.id)}`} />
                    <KeywordBadge keyword={matchedTs.keyword} />
                    <span style={{ color: "#aaa" }}>{matchedTs.name}</span>
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#aaa", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {(n.text || "").slice(0, 500)}{(n.text || "").length > 500 ? "..." : ""}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // --- set item ---

  const renderItem = (item, idx) => {
    const ts = item.touchstoneId ? getTouchstone(item.touchstoneId) : null;
    const dur = getItemDuration(item);
    const isExpanded = detailView || expandedItemId === item.id;
    const idealText = ts?.idealText;
    const isMatching = matchingItemId === item.id;
    const isEditingNote = editingItemId === item.id;

    if (item.type === "hr") {
      return (
        <div key={item.id}>
          {dropGapIdx === idx && dragFromIdx !== null && dragFromIdx !== idx && (
            <div style={{ height: 2, background: "#3b82f6", borderRadius: 1, margin: "2px 0" }} />
          )}
          <div
            className={`set-item hr ${dragFromIdx === idx ? "dragging" : ""}`}
            draggable onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
          >
            <span className="set-item-handle">&#x2807;</span>
            <hr style={{ flex: 1, border: "none", borderTop: "1px solid #333", margin: "0 8px" }} />
            {confirmRemoveItemId === item.id ? (
              <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button className="btn-sm btn-red" style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => { onRemoveItem(selectedSet.id, item.id); setConfirmRemoveItemId(null); }}>remove</button>
                <button className="btn-sm" style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => setConfirmRemoveItemId(null)}>cancel</button>
              </span>
            ) : (
              <button className="set-item-remove" onClick={() => setConfirmRemoveItemId(item.id)} title="Remove">&times;</button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div key={item.id}>
        {dropGapIdx === idx && dragFromIdx !== null && dragFromIdx !== idx && (
          <div style={{ height: 2, background: "#3b82f6", borderRadius: 1, margin: "2px 0" }} />
        )}
        <div
          className={`set-item ${ts ? "touchstone" : "text"} ${dragFromIdx === idx ? "dragging" : ""}`}
          draggable onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
          style={{ flexWrap: "wrap" }}
        >
          <span className="set-item-handle">&#x2807;</span>
          <span className="set-item-num">{idx + 1}</span>

          {ts ? (
            <span className="set-item-label" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
              onClick={() => !detailView && setExpandedItemId(isExpanded ? null : item.id)}
              title={!detailView ? "Click to expand" : undefined}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className={`ts-dot ${getTouchstoneCategory(item.touchstoneId)}`} />
                {onGoToTouchstone ? (
                  <span onClick={(e) => { e.stopPropagation(); onGoToTouchstone(ts.id); }} style={{ cursor: "pointer" }} title="Go to touchstone detail">
                    <KeywordBadge keyword={ts.keyword} />
                  </span>
                ) : (
                  <KeywordBadge keyword={ts.keyword} />
                )}
                <span style={{ color: "#ddd" }}>{ts.name}</span>
              </span>
              {item.text && <span style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>{item.text}</span>}
            </span>
          ) : isEditingNote ? (
            <form onSubmit={(e) => { e.preventDefault(); handleItemEditSave(); }} style={{ flex: 1 }}>
              <input value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                onBlur={handleItemEditSave}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingItemId(null); }}
                className="dark-input" style={{ width: "100%", fontSize: 13 }} autoFocus />
            </form>
          ) : (
            <span className="set-item-label"
              onClick={() => { setEditingItemId(item.id); setEditItemText(item.text || ""); }}
              title="Click to edit">
              {item.text || <span style={{ color: "#555" }}>(empty)</span>}
            </span>
          )}

          {dur > 0 && <span style={{ color: "#74c0fc", fontSize: 11, whiteSpace: "nowrap" }}>{formatDuration(dur)}</span>}

          <span style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "center" }}>
            {ts && (
              <button className="btn-sm" style={{ padding: "1px 6px", fontSize: 10 }}
                onClick={(e) => { e.stopPropagation(); setEditingItemId(item.id); setEditItemText(item.text || ""); }}
                title={item.text ? "Edit note" : "Add note"}>{item.text ? "edit note" : "+ note"}</button>
            )}
            {!ts && !isMatching && (
              <button className="btn-sm" style={{ padding: "1px 6px", fontSize: 10 }}
                onClick={() => { setMatchingItemId(item.id); setMatchQuery(""); }}
                title="Match to touchstone">match</button>
            )}
            {ts && (
              <button className="btn-sm" style={{ padding: "1px 6px", fontSize: 10, color: "#666" }}
                onClick={() => handleUnmatchItem(item.id)} title="Remove touchstone match">unmatch</button>
            )}
            {confirmRemoveItemId === item.id ? (
              <>
                <button className="btn-sm btn-red" style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => { onRemoveItem(selectedSet.id, item.id); setConfirmRemoveItemId(null); }}>remove</button>
                <button className="btn-sm" style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => setConfirmRemoveItemId(null)}>cancel</button>
              </>
            ) : (
              <button className="set-item-remove" onClick={() => setConfirmRemoveItemId(item.id)} title="Remove from set">&times;</button>
            )}
          </span>

          {ts && isEditingNote && (
            <form onSubmit={(e) => { e.preventDefault(); handleItemEditSave(); }} style={{ width: "100%", marginTop: 6 }}>
              <input value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                onBlur={handleItemEditSave}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingItemId(null); }}
                placeholder="Add a note..." className="dark-input" style={{ width: "100%", fontSize: 12 }} autoFocus />
            </form>
          )}

          {isExpanded && idealText && (
            <div style={{ width: "100%", marginTop: 6, padding: "8px 10px", background: "#0a0a14", borderRadius: 5, border: "1px solid #1a1a2a", fontSize: 11, color: "#999", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {idealText}
            </div>
          )}

          {isMatching && (
            <div style={{ width: "100%", marginTop: 6 }} className="set-add-panel">
              <input value={matchQuery} onChange={(e) => setMatchQuery(e.target.value)}
                placeholder="Search touchstones to match..." className="dark-input"
                style={{ width: "100%", marginBottom: 6 }} autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") { setMatchingItemId(null); setMatchQuery(""); } }} />
              <div className="set-ts-results" style={{ maxHeight: 180 }}>
                {matchResults.map((mts) => renderTsRow(mts, () => handleMatchItem(item.id, mts)))}
                {matchResults.length === 0 && <div style={{ color: "#666", fontSize: 12, padding: 8 }}>No touchstones found</div>}
              </div>
              <button className="btn-sm" style={{ marginTop: 4, fontSize: 10 }} onClick={() => { setMatchingItemId(null); setMatchQuery(""); }}>cancel</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- editor ---

  const renderSetEditor = () => {
    if (viewingPendingList) return renderPendingViewer();

    if (!selectedSet) {
      return (
        <div className="sets-editor" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
          Select a set or create a new one
        </div>
      );
    }

    const totalDur = getSetDuration(selectedSet.items);

    return (
      <div className="sets-editor">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          {renamingId === selectedSet.id ? (
            <form onSubmit={(e) => { e.preventDefault(); handleConfirmRename(); }} style={{ flex: 1 }}
              onClick={(e) => e.stopPropagation()}>
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleConfirmRename}
                onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                className="dark-input"
                style={{ width: "100%", fontSize: 18, fontWeight: 600 }}
              />
            </form>
          ) : (
            <h2 className="section-heading" style={{ margin: 0, flex: 1, cursor: "pointer" }}
              onClick={startRename} title="Click to rename">
              {selectedSet.name}
            </h2>
          )}
          {totalDur > 0 && <span style={{ color: "#74c0fc", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{formatDuration(totalDur)}</span>}
          <button onClick={() => setViewMode(viewMode === "fulltext" ? "edit" : "fulltext")}
            className={`btn-sm ${viewMode === "fulltext" ? "btn-green" : ""}`} title="Show all ideal text consecutively">
            full text
          </button>
          <button onClick={() => setViewMode(viewMode === "setlist" ? "edit" : "setlist")}
            className={`btn-sm ${viewMode === "setlist" ? "btn-green" : ""}`} title="Stage setlist with keywords and breaks">
            setlist
          </button>
          <button onClick={() => { setDetailView((v) => !v); setViewMode("edit"); }}
            className={`btn-sm ${detailView && viewMode === "edit" ? "btn-green" : ""}`} title="Detail view — expand all">
            detail
          </button>
          <button onClick={() => setShowSuggestions((v) => !v)}
            className={`btn-sm ${showSuggestions ? "btn-green" : ""}`} title="Show suggested touchstones">
            suggestions
          </button>
          {confirmDeleteId === selectedSet.id ? (
            <span style={{ display: "flex", gap: 4 }}>
              <button className="btn-sm btn-red" onClick={async () => { await onDeleteSet(selectedSet.id); setSelectedSetId(""); setConfirmDeleteId(null); }}>confirm</button>
              <button className="btn-sm" onClick={() => setConfirmDeleteId(null)}>cancel</button>
            </span>
          ) : (
            <button className="btn-sm btn-red" onClick={() => setConfirmDeleteId(selectedSet.id)}>delete</button>
          )}
        </div>

        {/* Timeline bar — 100% width = 15 min, wraps if longer, scales if shorter */}
        {selectedSet.items.filter(i => i.type !== "hr").length > 0 && (() => {
          const ROW_DURATION = 900; // 15 min in seconds
          const timelineItems = selectedSet.items.filter(i => i.type !== "hr");
          const durations = timelineItems.map(i => Math.max(getItemDuration(i), 1));
          const hoveredItem = hoveredTimelineIdx !== null ? timelineItems[hoveredTimelineIdx] : null;
          const hoveredTs = hoveredItem?.touchstoneId ? allTouchstones.find(t => t.id === hoveredItem.touchstoneId) : null;
          const hoveredLabel = hoveredItem ? (hoveredTs ? `${hoveredTs.keyword ? `[${hoveredTs.keyword}] ` : ""}${hoveredTs.name}${durations[hoveredTimelineIdx] > 1 ? ` (${formatDuration(durations[hoveredTimelineIdx])})` : ""}` : hoveredItem.text || "Text") : null;
          return (
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "#0a0a14", borderRadius: 8, border: "1px solid #1e1e30" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Set Timeline</span>
                {hoveredLabel && <span style={{ fontSize: 11, color: "#ddd", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{hoveredLabel}</span>}
              </div>
              <div ref={timelineRef} style={{ display: "flex", flexWrap: "wrap", width: "100%", borderRadius: 3, overflow: "hidden", gap: "2px 0" }}
                onMouseLeave={() => setHoveredTimelineIdx(null)}>
                {timelineItems.map((item, idx) => {
                  const pct = (durations[idx] / ROW_DURATION) * 100;
                  const ts = item.touchstoneId ? allTouchstones.find(t => t.id === item.touchstoneId) : null;
                  const bg = ts ? tsColor(ts.id) : "#16161f";
                  const border = ts ? "none" : "1px solid #1e1e30";
                  const keyword = ts?.keyword;
                  return (
                    <div key={item.id} style={{
                      width: `${pct}%`,
                      height: 20,
                      minWidth: 2,
                      background: bg,
                      border,
                      borderRadius: 2,
                      opacity: hoveredTimelineIdx !== null && hoveredTimelineIdx !== idx ? 0.4 : 0.85,
                      boxSizing: "border-box",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "opacity 0.1s",
                      cursor: "default",
                    }}
                      onMouseEnter={() => setHoveredTimelineIdx(idx)}
                    >
                      {keyword && pct > 3 && (
                        <span style={{ fontSize: 7, fontWeight: 700, color: "#000", opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 2px" }}>
                          {keyword}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Suggestions at top when active */}
        {showSuggestions && viewMode === "edit" && (
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ color: "#6ee7b7", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Suggested Touchstones</h3>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Based on shared performances with touchstones already in this set</div>
            <div className="set-ts-results">
              {suggestions.filter((t) => !usedTouchstoneIds.has(t.id)).map((ts) => renderTsRow(ts, () => handleAddTouchstone(ts)))}
              {suggestions.filter((t) => !usedTouchstoneIds.has(t.id)).length === 0 && (
                <div style={{ color: "#666", fontSize: 12, padding: 8 }}>No suggestions — add some touchstones first</div>
              )}
            </div>
          </div>
        )}

        {viewMode === "fulltext" && (() => {
          const textBlocks = [];
          for (const item of selectedSet.items) {
            if (item.type === "hr") { textBlocks.push({ type: "hr" }); continue; }
            const ts = item.touchstoneId ? getTouchstone(item.touchstoneId) : null;
            const text = ts?.idealText || item.text || "";
            if (text) textBlocks.push({ type: "text", text, name: ts?.name || item.text, keyword: ts?.keyword });
          }
          return (
            <div style={{ padding: "12px 0", lineHeight: 1.7, fontSize: 14, color: "#ccc" }}>
              {textBlocks.map((block, i) => block.type === "hr"
                ? <hr key={i} style={{ border: "none", borderTop: "1px solid #333", margin: "16px 0" }} />
                : <div key={i} style={{ marginBottom: 12 }}>
                    {block.keyword && <span style={{ fontSize: 10, fontWeight: 700, color: "#4ecdc4", textTransform: "uppercase", letterSpacing: 0.5 }}>{block.keyword}</span>}
                    <div style={{ whiteSpace: "pre-wrap" }}>{block.text}</div>
                  </div>
              )}
              {textBlocks.length === 0 && <div style={{ color: "#666" }}>No text content in this set.</div>}
            </div>
          );
        })()}

        {viewMode === "setlist" && (() => {
          return (
            <div style={{ padding: "12px 0" }}>
              {selectedSet.items.map((item, idx) => {
                if (item.type === "hr") return <hr key={item.id} style={{ border: "none", borderTop: "2px solid #555", margin: "12px 0" }} />;
                const ts = item.touchstoneId ? getTouchstone(item.touchstoneId) : null;
                const dur = getItemDuration(item);
                const label = ts?.keyword || ts?.name || item.text || "(untitled)";
                return (
                  <div key={item.id} style={{ padding: "6px 0", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #1a1a2a" }}>
                    <span style={{ color: "#555", fontSize: 11, minWidth: 20, textAlign: "right" }}>{idx + 1}</span>
                    {ts && <span className={`ts-dot ${getTouchstoneCategory(item.touchstoneId)}`} />}
                    <span style={{ fontSize: 15, fontWeight: ts ? 600 : 400, color: ts ? "#ddd" : "#999", flex: 1 }}>{label}</span>
                    {dur > 0 && <span style={{ color: "#74c0fc", fontSize: 12 }}>{formatDuration(dur)}</span>}
                  </div>
                );
              })}
              {selectedSet.items.length === 0 && <div style={{ color: "#666", fontSize: 13, padding: "24px 0", textAlign: "center" }}>Empty set.</div>}
            </div>
          );
        })()}

        {viewMode === "edit" && (
          <>
            {/* Top add buttons */}
            <div style={{ marginBottom: 8 }}>
              {renderAddButtons(true)}
              {addMode && addAtTopRef.current && <div style={{ marginTop: 8 }}>{addPanel}</div>}
            </div>

            {/* Items */}
            <div className="set-items-container" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
              {selectedSet.items.length === 0 && (
                <div style={{ color: "#666", fontSize: 13, padding: "24px 0", textAlign: "center" }}>Empty set. Add touchstones or text above.</div>
              )}
              {selectedSet.items.map((item, idx) => renderItem(item, idx))}
              {dropGapIdx === selectedSet.items.length && dragFromIdx !== null && (
                <div style={{ height: 2, background: "#3b82f6", borderRadius: 1, margin: "2px 0" }} />
              )}
            </div>

            {/* Bottom add controls */}
            <div className="set-add-controls">
              {renderAddButtons(false)}
              {addMode && !addAtTopRef.current && <div style={{ marginTop: 8 }}>{addPanel}</div>}
            </div>
          </>
        )}

        {/* Suggestions at bottom when active */}
        {showSuggestions && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ color: "#6ee7b7", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Suggested Touchstones</h3>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Based on shared performances with touchstones already in this set</div>
            <div className="set-ts-results">
              {suggestions.filter((t) => !usedTouchstoneIds.has(t.id)).map((ts) => renderTsRow(ts, () => handleAddTouchstone(ts)))}
              {suggestions.filter((t) => !usedTouchstoneIds.has(t.id)).length === 0 && (
                <div style={{ color: "#666", fontSize: 12, padding: 8 }}>No suggestions — add some touchstones first</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sets-tab">
      {renderSetList()}
      {renderSetEditor()}
    </div>
  );
}
