import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { embedText, cosineSimilarity } from "../utils/embeddings";
import { searchTouchstones } from "../utils/touchstoneSearch";

const CATEGORY_COLORS = {
  set: { bg: "#1e3a2f", color: "#6ee7b7", border: "#059669" },
  setlist: { bg: "#1e3a2f", color: "#6ee7b7", border: "#059669" }, // legacy alias
  category: { bg: "#422006", color: "#fbbf24", border: "#b45309" },
  project: { bg: "#1e1b3a", color: "#f0abfc", border: "#9333ea" },
  prompts: { bg: "#1a2332", color: "#7dd3fc", border: "#0284c7" },
  misc: { bg: "#1e293b", color: "#94a3b8", border: "#475569" },
};

const CATEGORIES = [
  { key: "set", label: "Set" },
  { key: "category", label: "Category" },
  { key: "project", label: "Project" },
  { key: "prompts", label: "Prompts" },
  { key: "misc", label: "Misc" },
];

export default function NotesTab({
  notes, touchstones, topics, embeddingStore, embeddingModel,
  onImportClickUp, onImportKeep, onSyncJournals, onClearImports, onRemoveNote,
  onUpdateSortOrders, onLoadListMeta, onUpdateListMeta, onUpdateNote, onRenameListTag, onPromoteNote,
  initialNoteNav, onConsumeNoteNav,
}) {
  const [search, setSearch] = useState("");
  const [genFilter, setGenFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [heartFilter, setHeartFilter] = useState(false);
  const [noHeartFilter, setNoHeartFilter] = useState(false);
  const [noCategoryFilter, setNoCategoryFilter] = useState(false);
  const [journalSortDir, setJournalSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [rearranging, setRearranging] = useState(false);
  const [listMeta, setListMeta] = useState({});
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editText, setEditText] = useState("");
  const [renamingList, setRenamingList] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [matchingNoteId, setMatchingNoteId] = useState(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [showImportBox, setShowImportBox] = useState(false);
  const [dragFromIdx, setDragFromIdx] = useState(null);
  const [dropGapIdx, setDropGapIdx] = useState(null);
  const [settling, setSettling] = useState(false);
  const [listCategoryFilter, setListCategoryFilter] = useState("all");
  const cardRefsMap = useRef({}); // noteId -> DOM element
  const prevRectsRef = useRef({}); // noteId -> DOMRect snapshot before reorder
  const renameInputRef = useRef(null);
  const editTextareaRef = useRef(null);

  const PAGE_SIZE = 100;

  useEffect(() => {
    if (onLoadListMeta) onLoadListMeta().then(m => setListMeta(m || {}));
  }, [onLoadListMeta]);

  // Handle cross-tab navigation to a note's list
  useEffect(() => {
    if (!initialNoteNav) return;
    setSourceFilter(initialNoteNav.source || "all");
    setTagFilter(initialNoteNav.tag || "all");
    setPage(0);
    onConsumeNoteNav?.();
  }, [initialNoteNav]);

  // All touchstones flattened for matching
  const allTouchstones = useMemo(() => {
    if (!touchstones) return [];
    return [
      ...(touchstones.confirmed || []).map(t => ({ ...t, _cat: "confirmed" })),
      ...(touchstones.possible || []).map(t => ({ ...t, _cat: "possible" })),
    ];
  }, [touchstones]);

  // Map of noteId -> touchstone for matched notes
  const noteMatchMap = useMemo(() => {
    const map = {};
    for (const n of notes) {
      if (n.matchedTouchstoneId) {
        const ts = allTouchstones.find(t => t.id === n.matchedTouchstoneId);
        if (ts) map[n.id] = ts;
      }
    }
    return map;
  }, [notes, allTouchstones]);

  const counts = useMemo(() => {
    const c = { clickup: 0, keep: 0, journal: 0, g1: 0, g2: 0 };
    for (const n of notes) {
      if (n.source === "clickup") c.clickup++;
      else if (n.source === "keep") c.keep++;
      else if (n.source === "journal") c.journal++;
      if (n.generation === "g1") c.g1++;
      else if (n.generation === "g2") c.g2++;
    }
    return c;
  }, [notes]);

  const tagList = useMemo(() => {
    const map = {};
    for (const n of notes) {
      for (const t of (n.tags || [])) {
        map[t] = (map[t] || 0) + 1;
      }
      if (!n.tags || n.tags.length === 0) {
        map["(unlisted)"] = (map["(unlisted)"] || 0) + 1;
      }
    }
    return Object.entries(map).sort((a, b) => {
      const aMisc = listMeta[a[0]]?.category === "misc" ? 1 : 0;
      const bMisc = listMeta[b[0]]?.category === "misc" ? 1 : 0;
      if (aMisc !== bMisc) return aMisc - bMisc;
      return a[0].localeCompare(b[0]);
    });
  }, [notes, listMeta]);

  // Flat list of all unique tag names for autosuggest
  const allTagNames = useMemo(() => tagList.map(([t]) => t).filter(t => t !== "(unlisted)"), [tagList]);

  // Resolve effective category for a note:
  // - clickup notes: inherit from their list's category in listMeta
  // - keep/journal notes: use their own noteCategory field
  const getNoteCategory = useCallback((note) => {
    let cat = note.noteCategory;
    if (!cat && note.source === "clickup") {
      for (const t of (note.tags || [])) {
        if (listMeta[t]?.category) { cat = listMeta[t].category; break; }
      }
    }
    // Normalize legacy "setlist" → "set"
    if (cat === "setlist") cat = "set";
    return cat || null;
  }, [listMeta]);

  const filtered = useMemo(() => {
    let result = notes;
    if (genFilter !== "all") result = result.filter(n => n.generation === genFilter);
    if (sourceFilter !== "all") result = result.filter(n => n.source === sourceFilter);
    if (tagFilter !== "all") {
      if (tagFilter === "(unlisted)") {
        result = result.filter(n => !n.tags || n.tags.length === 0);
      } else {
        result = result.filter(n => (n.tags || []).includes(tagFilter));
      }
    }
    if (categoryFilter !== "all") {
      result = result.filter(n => getNoteCategory(n) === categoryFilter);
    }
    if (heartFilter) {
      result = result.filter(n => n.hearted);
    }
    if (noHeartFilter) {
      result = result.filter(n => !n.hearted);
    }
    if (noCategoryFilter) {
      result = result.filter(n => !getNoteCategory(n));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        n.text.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    // Journal-only view: sort by date; otherwise sort by sortOrder
    const isJournalOnly = sourceFilter === "journal";
    if (isJournalOnly) {
      result = [...result].sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return journalSortDir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      });
    } else {
      result = [...result].sort((a, b) => {
        const oa = a.sortOrder ?? Infinity;
        const ob = b.sortOrder ?? Infinity;
        if (oa !== ob) return oa - ob;
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
    }
    return result;
  }, [notes, genFilter, sourceFilter, tagFilter, categoryFilter, heartFilter, noHeartFilter, noCategoryFilter, search, getNoteCategory, journalSortDir]);

  // Count matched notes in current filtered view
  const matchedCount = useMemo(() => {
    return filtered.filter(n => n.matchedTouchstoneId && noteMatchMap[n.id]).length;
  }, [filtered, noteMatchMap]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [pageCount, page]);

  const pageNotes = rearranging ? filtered : filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // FLIP animation: after reorder renders, animate cards from old position to new
  useEffect(() => {
    if (!settling) return;
    const prev = prevRectsRef.current;
    if (!Object.keys(prev).length) { setSettling(false); return; }

    const animations = [];
    for (const [id, el] of Object.entries(cardRefsMap.current)) {
      if (!el || !prev[id]) continue;
      const newRect = el.getBoundingClientRect();
      const deltaY = prev[id].top - newRect.top;
      if (Math.abs(deltaY) < 1) continue;
      // Invert: place element at old position
      el.style.transform = `translateY(${deltaY}px)`;
      el.style.transition = "none";
      // Play: animate to new position
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.2s ease";
        el.style.transform = "";
        animations.push(el);
      });
    }
    prevRectsRef.current = {};
    const cleanup = setTimeout(() => {
      for (const el of animations) {
        el.style.transition = "";
        el.style.transform = "";
      }
      setSettling(false);
    }, 250);
    return () => clearTimeout(cleanup);
  }, [settling, pageNotes]);

  const doImport = async (type, fn) => {
    setImporting(type);
    setStatus(`Importing ${type}...`);
    try {
      const result = await fn();
      if (type === "journal") {
        setStatus(`Journals: ${result.added} added, ${result.updated} updated (${result.total} total)`);
      } else {
        setStatus(`${type}: ${result.imported} new notes imported (${result.total} total in source)`);
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
    setImporting(null);
  };

  const handleRemove = async (e, noteId) => {
    e.stopPropagation();
    await onRemoveNote(noteId);
  };

  // Drag and drop — gap-based indicator
  const handleDragStart = useCallback((e, idx) => {
    setDragFromIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, []);

  const handleCardDragOver = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Determine if cursor is in top or bottom half of the card
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const gapIdx = e.clientY < midY ? idx : idx + 1;
    setDropGapIdx(gapIdx);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragFromIdx(null);
    setDropGapIdx(null);
  }, []);

  const handleContainerDrop = useCallback(async (e) => {
    e.preventDefault();
    const fromIdx = dragFromIdx;
    let toGap = dropGapIdx;
    setDragFromIdx(null);
    setDropGapIdx(null);
    if (fromIdx === null || toGap === null) return;
    if (toGap === fromIdx || toGap === fromIdx + 1) return;

    // FLIP step 1: snapshot current positions (First)
    const rects = {};
    for (const [id, el] of Object.entries(cardRefsMap.current)) {
      if (el) rects[id] = el.getBoundingClientRect();
    }
    prevRectsRef.current = rects;
    setSettling(true);

    const reordered = [...filtered];
    const [moved] = reordered.splice(fromIdx, 1);
    const insertIdx = toGap > fromIdx ? toGap - 1 : toGap;
    reordered.splice(insertIdx, 0, moved);
    await onUpdateSortOrders(reordered.map(n => n.id));

    // FLIP steps 2-4 happen in useEffect after render
  }, [filtered, onUpdateSortOrders, dragFromIdx, dropGapIdx]);

  const handleStartRearrange = useCallback(() => {
    const needsInit = filtered.some(n => n.sortOrder == null);
    if (needsInit) onUpdateSortOrders(filtered.map(n => n.id));
    setRearranging(true);
    setPage(0);
  }, [filtered, onUpdateSortOrders]);

  // List category
  const currentListCategory = tagFilter !== "all" && tagFilter !== "(unlisted)" ? ((listMeta[tagFilter]?.category === "setlist" ? "set" : listMeta[tagFilter]?.category) || null) : null;

  const handleSetListCategory = async (category) => {
    if (!tagFilter || tagFilter === "all" || tagFilter === "(unlisted)") return;
    const newCat = currentListCategory === category ? null : category;
    const updated = await onUpdateListMeta(tagFilter, { category: newCat });
    setListMeta(updated);
  };

  // List rename
  const startRename = () => {
    setRenameValue(tagFilter);
    setRenamingList(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    if (!newName || newName === tagFilter) { setRenamingList(false); return; }
    const updatedMeta = await onRenameListTag(tagFilter, newName);
    setListMeta(updatedMeta);
    setTagFilter(newName);
    setRenamingList(false);
  };

  // Note editing
  const startEdit = (e, note) => {
    e.stopPropagation();
    setEditingNoteId(note.id);
    setEditText(note.text);
    setExpanded(note.id);
    setTimeout(() => editTextareaRef.current?.focus(), 0);
  };

  const saveEdit = async (e) => {
    e.stopPropagation();
    if (editingNoteId) {
      await onUpdateNote(editingNoteId, { text: editText });
      setEditingNoteId(null);
    }
  };

  const cancelEdit = (e) => {
    e.stopPropagation();
    setEditingNoteId(null);
  };

  // Generation toggle
  const toggleGeneration = async (e, note) => {
    e.stopPropagation();
    await onUpdateNote(note.id, { generation: note.generation === "g1" ? "g2" : "g1" });
  };

  // Note category — works for all note types
  const [catPickerNoteId, setCatPickerNoteId] = useState(null);

  const setNoteCategory = async (e, noteId, cat) => {
    e.stopPropagation();
    const note = notes.find(n => n.id === noteId);
    const newCat = note?.noteCategory === cat ? null : cat;
    await onUpdateNote(noteId, { noteCategory: newCat });
    setCatPickerNoteId(null);
  };

  const handleCategoryBadgeClick = (e, note) => {
    e.stopPropagation();
    if (note.noteCategory) {
      // Has individual override — clear it to fall back to list category (or none)
      onUpdateNote(note.id, { noteCategory: null });
      setCatPickerNoteId(null);
    } else {
      // Auto-applied from list — open picker to override
      setCatPickerNoteId(catPickerNoteId === note.id ? null : note.id);
    }
  };

  // List picker
  const [listPickerNoteId, setListPickerNoteId] = useState(null);
  const [listPickerValue, setListPickerValue] = useState("");
  const listInputRef = useRef(null);

  const openListPicker = (e, noteId) => {
    e.stopPropagation();
    if (listPickerNoteId === noteId) { setListPickerNoteId(null); return; }
    setListPickerNoteId(noteId);
    setListPickerValue("");
    setTimeout(() => listInputRef.current?.focus(), 0);
  };

  const assignList = async (e, noteId, tagName) => {
    e.stopPropagation();
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const newTags = [tagName];
    await onUpdateNote(noteId, { tags: newTags });
    setListPickerNoteId(null);
  };

  const removeFromList = async (e, noteId, tagName) => {
    e.stopPropagation();
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const newTags = (note.tags || []).filter(t => t !== tagName);
    await onUpdateNote(noteId, { tags: newTags });
  };

  const listSuggestions = useMemo(() => {
    if (!listPickerValue) return allTagNames.slice(0, 15);
    const q = listPickerValue.toLowerCase();
    return allTagNames.filter(t => t.toLowerCase().includes(q)).slice(0, 15);
  }, [allTagNames, listPickerValue]);

  // Promote note to bit + touchstone
  const [promotingNoteId, setPromotingNoteId] = useState(null);
  const [promoteName, setPromoteName] = useState("");
  const promoteInputRef = useRef(null);

  const openPromote = (e, note) => {
    e.stopPropagation();
    if (promotingNoteId === note.id) { setPromotingNoteId(null); return; }
    setPromotingNoteId(note.id);
    setPromoteName(note.title || note.text.slice(0, 60));
    setTimeout(() => promoteInputRef.current?.select(), 0);
  };

  const confirmPromote = async (e) => {
    e.stopPropagation();
    if (!promotingNoteId || !promoteName.trim()) return;
    await onPromoteNote(promotingNoteId, promoteName.trim());
    setPromotingNoteId(null);
  };

  // Touchstone matching
  const startMatching = (e, noteId) => {
    e.stopPropagation();
    setMatchingNoteId(matchingNoteId === noteId ? null : noteId);
    setMatchSearch("");
  };

  const assignTouchstone = async (e, noteId, tsId) => {
    e.stopPropagation();
    await onUpdateNote(noteId, { matchedTouchstoneId: tsId });
    setMatchingNoteId(null);
  };

  const unlinkTouchstone = async (e, noteId) => {
    e.stopPropagation();
    await onUpdateNote(noteId, { matchedTouchstoneId: null });
  };

  const filteredTouchstones = useMemo(() => {
    return searchTouchstones(allTouchstones, matchSearch).slice(0, 20);
  }, [allTouchstones, matchSearch]);

  // Embedding-based touchstone suggestions
  const [suggestingNoteId, setSuggestingNoteId] = useState(null);
  const [suggestions, setSuggestions] = useState([]); // [{touchstone, score}]
  const [suggestStatus, setSuggestStatus] = useState("");
  const [bulkSuggesting, setBulkSuggesting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);

  // Build bitId → touchstone lookup
  const bitToTouchstone = useMemo(() => {
    const map = {};
    for (const ts of allTouchstones) {
      for (const id of (ts.bitIds || [])) {
        map[id] = ts;
      }
    }
    return map;
  }, [allTouchstones]);

  const suggestMatches = useCallback(async (e, noteId) => {
    e?.stopPropagation();
    if (!embeddingStore || !topics?.length) {
      setSuggestStatus("No embeddings available — run a hunt first to embed bits.");
      return;
    }
    setSuggestingNoteId(noteId);
    setSuggestions([]);
    setSuggestStatus("Embedding note...");
    try {
      const note = notes.find(n => n.id === noteId);
      if (!note) return;
      const vec = await embedText(note.text, embeddingModel || "mxbai-embed-large");
      setSuggestStatus("Finding nearest bits...");
      const nearest = embeddingStore.findNearestByVector(vec, 20, new Set());

      // Map bits → touchstones, keep best score per touchstone
      const tsScores = new Map();
      for (const { bitId, score } of nearest) {
        const ts = bitToTouchstone[bitId];
        if (!ts) continue;
        const existing = tsScores.get(ts.id);
        if (!existing || score > existing.score) {
          tsScores.set(ts.id, { touchstone: ts, score });
        }
      }

      const ranked = [...tsScores.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      setSuggestions(ranked);
      setSuggestStatus(ranked.length ? `${ranked.length} suggestions` : "No close matches found.");
    } catch (err) {
      setSuggestStatus(`Error: ${err.message}`);
    }
  }, [notes, embeddingStore, embeddingModel, topics, bitToTouchstone]);

  const suggestMatchesBulk = useCallback(async () => {
    if (!embeddingStore || !topics?.length || bulkSuggesting) return;
    setBulkSuggesting(true);
    const unmatched = filtered.filter(n => !n.matchedTouchstoneId);
    let matched = 0;
    for (let i = 0; i < unmatched.length; i++) {
      const note = unmatched[i];
      setBulkProgress({ done: i, total: unmatched.length, matched });
      try {
        const vec = await embedText(note.text, embeddingModel || "mxbai-embed-large");
        const nearest = embeddingStore.findNearestByVector(vec, 10, new Set());
        let bestTs = null, bestScore = 0;
        for (const { bitId, score } of nearest) {
          const ts = bitToTouchstone[bitId];
          if (ts && score > bestScore) { bestTs = ts; bestScore = score; }
        }
        if (bestTs && bestScore >= 0.65) {
          await onUpdateNote(note.id, { matchedTouchstoneId: bestTs.id, matchScore: Math.round(bestScore * 100) });
          matched++;
        }
      } catch (err) {
        console.warn(`[NoteSuggest] Failed for note ${note.id}:`, err.message);
      }
    }
    setBulkProgress({ done: unmatched.length, total: unmatched.length, matched });
    setBulkSuggesting(false);
  }, [embeddingStore, embeddingModel, topics, bitToTouchstone, filtered, onUpdateNote, bulkSuggesting]);

  const FilterPill = ({ label, value, current, onClick }) => (
    <button
      onClick={() => onClick(value)}
      style={{
        padding: "3px 10px", borderRadius: 12, border: "1px solid",
        borderColor: current === value ? "#6366f1" : "#555",
        background: current === value ? "#6366f1" : "transparent",
        color: current === value ? "#fff" : "#ccc",
        cursor: "pointer", fontSize: 12,
      }}
    >
      {label}
    </button>
  );

  const CategoryBadge = ({ tag }) => {
    let cat = listMeta[tag]?.category;
    if (!cat) return null;
    if (cat === "setlist") cat = "set";
    const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.misc;
    return (
      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: c.bg, color: c.color, border: `1px solid ${c.border}`, marginLeft: 4 }}>
        {cat}
      </span>
    );
  };

  const showSidebar = tagList.length > 0;

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search notes..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #555", background: "#0f172a", color: "#e2e8f0", width: 200, fontSize: 13 }}
        />
        <span style={{ fontSize: 11, color: "#64748b" }}>Gen:</span>
        <FilterPill label="All" value="all" current={genFilter} onClick={v => { setGenFilter(v); setPage(0); }} />
        <FilterPill label="g1" value="g1" current={genFilter} onClick={v => { setGenFilter(v); setPage(0); }} />
        <FilterPill label="g2" value="g2" current={genFilter} onClick={v => { setGenFilter(v); setPage(0); }} />
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>Source:</span>
        <FilterPill label="All" value="all" current={sourceFilter} onClick={v => { setSourceFilter(v); setTagFilter("all"); setPage(0); }} />
        <FilterPill label="ClickUp" value="clickup" current={sourceFilter} onClick={v => { setSourceFilter(v); setPage(0); }} />
        <FilterPill label="Keep" value="keep" current={sourceFilter} onClick={v => { setSourceFilter(v); setTagFilter("all"); setPage(0); }} />
        <FilterPill label="Journal" value="journal" current={sourceFilter} onClick={v => { setSourceFilter(v); setTagFilter("all"); setPage(0); }} />
        <button
          onClick={() => { setCategoryFilter(categoryFilter === "prompts" ? "all" : "prompts"); setPage(0); }}
          style={{
            padding: "3px 10px", borderRadius: 12, fontSize: 12, cursor: "pointer", marginLeft: 4,
            border: `1px solid ${categoryFilter === "prompts" ? "#0284c7" : "#555"}`,
            background: categoryFilter === "prompts" ? "#1a2332" : "transparent",
            color: categoryFilter === "prompts" ? "#7dd3fc" : "#ccc",
          }}
        >
          Prompts
        </button>
        <button
          onClick={() => { setHeartFilter(h => !h); if (!heartFilter) setNoHeartFilter(false); setPage(0); }}
          style={{
            padding: "3px 10px", borderRadius: 12, fontSize: 12, cursor: "pointer",
            border: `1px solid ${heartFilter ? "#e11d48" : "#555"}`,
            background: heartFilter ? "#1c0a10" : "transparent",
            color: heartFilter ? "#fb7185" : "#ccc",
          }}
        >
          ❤️
        </button>
        <button
          onClick={() => { setNoHeartFilter(h => !h); if (!noHeartFilter) setHeartFilter(false); setPage(0); }}
          style={{
            padding: "3px 10px", borderRadius: 12, fontSize: 12, cursor: "pointer",
            border: `1px solid ${noHeartFilter ? "#e11d48" : "#555"}`,
            background: noHeartFilter ? "#1c0a10" : "transparent",
            color: noHeartFilter ? "#fb7185" : "#ccc",
          }}
          title="No heart"
        >
          🚫❤️
        </button>
        <button
          onClick={() => { setNoCategoryFilter(h => !h); setPage(0); }}
          style={{
            padding: "3px 10px", borderRadius: 12, fontSize: 12, cursor: "pointer",
            border: `1px solid ${noCategoryFilter ? "#fbbf24" : "#555"}`,
            background: noCategoryFilter ? "#1a1608" : "transparent",
            color: noCategoryFilter ? "#fbbf24" : "#ccc",
          }}
          title="No category"
        >
          🏷️✖️
        </button>
        {categoryFilter !== "all" && categoryFilter !== "prompts" && (
          <span style={{ fontSize: 11, color: CATEGORY_COLORS[categoryFilter]?.color || "#94a3b8", marginLeft: 4 }}>
            [{categoryFilter}]
            <button onClick={() => setCategoryFilter("all")} style={{ border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 11, padding: "0 4px" }}>&times;</button>
          </span>
        )}
        {sourceFilter === "journal" && (
          <button
            onClick={() => setJournalSortDir(d => d === "desc" ? "asc" : "desc")}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: 12, marginLeft: 4 }}
          >
            Date {journalSortDir === "desc" ? "\u2193" : "\u2191"}
          </button>
        )}
        {!rearranging ? (
          <button
            onClick={handleStartRearrange}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#a78bfa", cursor: "pointer", fontSize: 12, marginLeft: 4 }}
          >
            Rearrange
          </button>
        ) : (
          <button
            onClick={() => setRearranging(false)}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #a78bfa", background: "#312e81", color: "#c4b5fd", cursor: "pointer", fontSize: 12, marginLeft: 4 }}
          >
            Done
          </button>
        )}
      </div>

      {/* Results count */}
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span>
          {filtered.length} notes{filtered.length !== notes.length ? ` (filtered from ${notes.length})` : ""}
          {matchedCount > 0 && ` \u2014 ${matchedCount} matched`}
          {!rearranging && pageCount > 1 && ` \u2014 page ${page + 1}/${pageCount}`}
          {rearranging && " \u2014 drag to reorder"}
        </span>
        {!rearranging && embeddingStore && topics?.length > 0 && (
          <button
            onClick={suggestMatchesBulk}
            disabled={bulkSuggesting}
            style={{
              padding: "2px 8px", borderRadius: 4, border: "1px solid #555", fontSize: 11,
              background: bulkSuggesting ? "#1e293b" : "transparent",
              color: bulkSuggesting ? "#64748b" : "#6ee7b7",
              cursor: bulkSuggesting ? "wait" : "pointer",
            }}
          >
            {bulkSuggesting ? `Suggesting ${bulkProgress?.done || 0}/${bulkProgress?.total || 0}...` : "Suggest All Matches"}
          </button>
        )}
        {bulkProgress && !bulkSuggesting && bulkProgress.matched > 0 && (
          <span style={{ color: "#6ee7b7", fontSize: 11 }}>
            {bulkProgress.matched} auto-matched
          </span>
        )}
      </div>

      {/* Main content: sidebar + cards */}
      <div style={{ display: "flex", gap: 16 }}>
        {/* ClickUp list sidebar */}
        {showSidebar && tagList.length > 0 && (
          <div style={{ width: 160, flexShrink: 0, borderRight: "1px solid #334155", paddingRight: 12 }}>
            {/* Category filter dropdown */}
            <select
              value={listCategoryFilter}
              onChange={e => setListCategoryFilter(e.target.value)}
              style={{
                width: "100%", padding: "3px 6px", borderRadius: 4, fontSize: 11,
                border: "1px solid #555", background: "#0f172a", color: "#e2e8f0",
                cursor: "pointer", marginBottom: 8,
              }}
            >
              <option value="all">All categories</option>
              {CATEGORIES.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            {/* Selected list details — always visible to prevent layout jumps */}
            <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid #334155", minHeight: 44 }}>
              {tagFilter !== "all" && tagFilter !== "(unlisted)" ? (
                <>
                  {renamingList ? (
                    <form onSubmit={(e) => { e.preventDefault(); commitRename(); }} style={{ marginBottom: 4 }}>
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === "Escape") setRenamingList(false); }}
                        style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #6366f1", background: "#1e293b", color: "#e2e8f0", fontSize: 12, fontWeight: 600, width: "100%", boxSizing: "border-box" }}
                      />
                    </form>
                  ) : (
                    <div
                      onClick={startRename}
                      style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", cursor: "pointer", borderBottom: "1px dashed #475569", marginBottom: 4, display: "inline-block" }}
                      title="Click to rename"
                    >
                      {tagFilter}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
                    {filtered.length} notes &middot; {matchedCount} matched
                  </div>
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {CATEGORIES.map(({ key, label }) => {
                      const c = CATEGORY_COLORS[key];
                      const active = currentListCategory === key;
                      return (
                        <button
                          key={key}
                          onClick={() => handleSetListCategory(key)}
                          style={{
                            padding: "1px 5px", borderRadius: 8, fontSize: 9, cursor: "pointer",
                            border: `1px solid ${active ? c.border : "transparent"}`,
                            background: active ? c.bg : "transparent",
                            color: active ? c.color : c.color + "66",
                            opacity: active ? 1 : 0.5,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                    {tagFilter === "(unlisted)" ? "Unlisted" : "All lists"}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, marginBottom: tagFilter === "(unlisted)" ? 6 : 0 }}>
                    {filtered.length} notes &middot; {matchedCount} matched
                  </div>
                  {tagFilter === "(unlisted)" && (
                    <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      {CATEGORIES.filter(({ key }) => key === "project" || key === "prompts" || key === "misc").map(({ key, label }) => {
                        const c = CATEGORY_COLORS[key];
                        const active = categoryFilter === key;
                        return (
                          <button
                            key={key}
                            onClick={() => { setCategoryFilter(active ? "all" : key); setPage(0); }}
                            style={{
                              padding: "1px 5px", borderRadius: 8, fontSize: 9, cursor: "pointer",
                              border: `1px solid ${active ? c.border : "transparent"}`,
                              background: active ? c.bg : "transparent",
                              color: active ? c.color : c.color + "66",
                              opacity: active ? 1 : 0.5,
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Lists</div>
            <div
              onClick={() => { setTagFilter("all"); setPage(0); setRenamingList(false); }}
              style={{
                padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginBottom: 2,
                background: tagFilter === "all" ? "#1e293b" : "transparent",
                color: tagFilter === "all" ? "#e2e8f0" : "#94a3b8",
              }}
            >
              All lists
            </div>
            {tagList
              .filter(([tag]) => {
                if (listCategoryFilter === "all") return true;
                if (tag === "(unlisted)") return listCategoryFilter === "all";
                const tc = listMeta[tag]?.category === "setlist" ? "set" : listMeta[tag]?.category;
                return tc === listCategoryFilter;
              })
              .map(([tag, count]) => {
                const isMisc = listMeta[tag]?.category === "misc";
                return (
              <div
                key={tag}
                onClick={() => { setTagFilter(tag); if (tag === "(unlisted)") setSourceFilter("all"); setPage(0); setRenamingList(false); }}
                style={{
                  padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginBottom: 1,
                  background: tagFilter === tag ? (isMisc ? "#151a22" : "#1e293b") : "transparent",
                  color: tagFilter === tag ? "#e2e8f0" : isMisc ? "#64748b" : "#94a3b8",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  opacity: isMisc && tagFilter !== tag ? 0.65 : 1,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
                  {tag}
                  <CategoryBadge tag={tag} />
                </span>
                <span style={{ color: "#475569", fontSize: 11, marginLeft: 4, flexShrink: 0 }}>{count}</span>
              </div>
                );
              })}
          </div>
        )}

        {/* Note cards */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: rearranging ? 2 : 6, flex: 1, minWidth: 0 }}
          onDrop={rearranging ? handleContainerDrop : undefined}
          onDragOver={rearranging ? (e) => e.preventDefault() : undefined}
        >
          {pageNotes.map((note, idx) => {
            const isExpanded = !rearranging && expanded === note.id;
            const isEditing = editingNoteId === note.id;
            const preview = note.text.length > 160 ? note.text.slice(0, 160) + "..." : note.text;
            const matchedTs = noteMatchMap[note.id];
            const isMatching = matchingNoteId === note.id;
            const isSuggesting = suggestingNoteId === note.id;
            const isDragging = rearranging && dragFromIdx === idx;
            const showGapBefore = rearranging && dropGapIdx === idx && dragFromIdx !== null && dropGapIdx !== dragFromIdx && dropGapIdx !== dragFromIdx + 1;
            const showGapAfter = rearranging && idx === pageNotes.length - 1 && dropGapIdx === pageNotes.length && dragFromIdx !== null && dropGapIdx !== dragFromIdx + 1;
            return (
              <div key={note.id} ref={el => { if (el) cardRefsMap.current[note.id] = el; }} style={{
                position: "relative",
              }}>
                {showGapBefore && (
                  <div style={{ height: 3, background: "#6366f1", borderRadius: 2, marginBottom: 2, transition: "height 0.15s ease" }} />
                )}
                <div
                  draggable={rearranging}
                  onDragStart={rearranging ? (e) => handleDragStart(e, idx) : undefined}
                  onDragOver={rearranging ? (e) => handleCardDragOver(e, idx) : undefined}
                  onDragEnd={rearranging ? handleDragEnd : undefined}
                  onClick={rearranging || isEditing ? undefined : () => setExpanded(isExpanded ? null : note.id)}
                  style={{
                    padding: rearranging ? "6px 10px" : "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #334155",
                    background: isExpanded ? "#1e293b" : "#0f172a",
                    cursor: rearranging ? "grab" : isEditing ? "default" : "pointer",
                    transition: "background 0.15s, opacity 0.15s",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    opacity: isDragging ? 0.3 : 1,
                  }}
                >
                {rearranging && (
                  <span style={{ color: "#64748b", fontSize: 16, lineHeight: "20px", cursor: "grab", userSelect: "none", flexShrink: 0, paddingTop: 1 }}>
                    &#x2630;
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0, width: 0 }}>
                  {/* Note text / editor */}
                  {isEditing && isExpanded ? (
                    <div onClick={e => e.stopPropagation()}>
                      <textarea
                        ref={editTextareaRef}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        style={{
                          width: "100%", minHeight: 120, padding: 8, borderRadius: 6,
                          border: "1px solid #6366f1", background: "#0f172a", color: "#e2e8f0",
                          fontSize: 13, fontFamily: "inherit", resize: "vertical",
                        }}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={saveEdit} style={{ padding: "2px 10px", borderRadius: 4, border: "1px solid #6366f1", background: "#312e81", color: "#a5b4fc", cursor: "pointer", fontSize: 11 }}>Save</button>
                        <button onClick={cancelEdit} style={{ padding: "2px 10px", borderRadius: 4, border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: 11 }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#e2e8f0", whiteSpace: isExpanded ? "pre-line" : "nowrap", overflow: isExpanded ? "visible" : "hidden", textOverflow: isExpanded ? "unset" : "ellipsis", wordBreak: isExpanded ? "break-word" : undefined }}>
                      {isExpanded ? note.text : preview}
                    </div>
                  )}

                  {/* Matched touchstone badge */}
                  {matchedTs && !rearranging && (
                    <div style={{ fontSize: 11, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ background: "#1e3a2f", color: "#6ee7b7", border: "1px solid #059669", padding: "1px 6px", borderRadius: 8, fontSize: 10 }}>
                        {matchedTs._cat === "confirmed" ? "\u2713" : "?"} {matchedTs.name}{note.matchScore ? ` (${note.matchScore}%)` : ""}
                      </span>
                      <button
                        onClick={(e) => unlinkTouchstone(e, note.id)}
                        style={{ padding: "0 4px", border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 11 }}
                        title="Unlink touchstone"
                      >
                        \u00d7
                      </button>
                    </div>
                  )}

                  {/* Touchstone matching dropdown */}
                  {isMatching && !rearranging && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "#1e293b", border: "1px solid #334155" }}>
                      <input
                        type="text"
                        placeholder="Search touchstones..."
                        value={matchSearch}
                        onChange={e => setMatchSearch(e.target.value)}
                        autoFocus
                        style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #555", background: "#0f172a", color: "#e2e8f0", fontSize: 12, marginBottom: 6 }}
                      />
                      <div style={{ maxHeight: 180, overflowY: "auto" }}>
                        {matchedTs && (
                          <div
                            onClick={(e) => { unlinkTouchstone(e, note.id); setMatchingNoteId(null); }}
                            style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12, color: "#f87171", display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}
                            onMouseEnter={e => e.currentTarget.style.background = "#334155"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <span style={{ fontSize: 10, flexShrink: 0 }}>&times;</span>
                            <span>No touchstone</span>
                          </div>
                        )}
                        {filteredTouchstones.length === 0 && <div style={{ fontSize: 11, color: "#64748b", padding: 4 }}>No touchstones found</div>}
                        {filteredTouchstones.map(ts => (
                          <div
                            key={ts.id}
                            onClick={(e) => assignTouchstone(e, note.id, ts.id)}
                            style={{
                              padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12,
                              color: "#e2e8f0", display: "flex", gap: 6, alignItems: "center",
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "#334155"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <span style={{ color: ts._cat === "confirmed" ? "#6ee7b7" : "#fbbf24", fontSize: 10, flexShrink: 0 }}>
                              {ts._cat === "confirmed" ? "\u2713" : "?"}
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ts.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Embedding suggestions dropdown */}
                  {isSuggesting && !rearranging && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "#0f2318", border: "1px solid #064e3b" }}>
                      <div style={{ fontSize: 11, color: "#6ee7b7", marginBottom: 4 }}>{suggestStatus}</div>
                      {suggestions.length > 0 && (
                        <div style={{ maxHeight: 200, overflowY: "auto" }}>
                          {suggestions.map(({ touchstone: ts, score }) => (
                            <div
                              key={ts.id}
                              onClick={(e) => assignTouchstone(e, note.id, ts.id)}
                              style={{
                                padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12,
                                color: "#e2e8f0", display: "flex", gap: 6, alignItems: "center",
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = "#1e3a2f"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            >
                              <span style={{ color: ts._cat === "confirmed" ? "#6ee7b7" : "#fbbf24", fontSize: 10, flexShrink: 0 }}>
                                {ts._cat === "confirmed" ? "\u2713" : "?"}
                              </span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{ts.name}</span>
                              <span style={{ color: score >= 0.65 ? "#6ee7b7" : score >= 0.5 ? "#fbbf24" : "#94a3b8", fontSize: 10, flexShrink: 0 }}>
                                {Math.round(score * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Metadata footer */}
                  {!rearranging && (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {note.date && <span>{note.date}</span>}
                      <span style={{ color: note.source === "clickup" ? "#60a5fa" : note.source === "keep" ? "#a78bfa" : "#34d399" }}>{note.source}</span>
                      <button
                        onClick={(e) => toggleGeneration(e, note)}
                        style={{
                          padding: "0 4px", border: "1px solid #555", borderRadius: 4, background: "transparent",
                          color: note.generation === "g1" ? "#94a3b8" : "#60a5fa", cursor: "pointer", fontSize: 11,
                        }}
                        title="Click to toggle generation"
                      >
                        {note.generation}
                      </button>
                      {(note.tags || []).map((t, i) => (
                        <span key={`${t}-${i}`} style={{ background: "#334155", padding: "1px 6px", borderRadius: 8, fontSize: 10 }}>{t}</span>
                      ))}
                      {(() => {
                        const effCat = getNoteCategory(note);
                        const showPicker = catPickerNoteId === note.id;
                        const isAutoApplied = effCat && !note.noteCategory && note.source === "clickup";
                        const isUnlisted = !note.tags || note.tags.length === 0;
                        const availCats = isUnlisted
                          ? CATEGORIES.filter(({ key }) => key !== "set" && key !== "category")
                          : CATEGORIES;
                        // Show inline buttons if: picker is open, or no category set
                        if (showPicker || !effCat) {
                          return (
                            <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                              {availCats.map(({ key, label }) => {
                                const cc = CATEGORY_COLORS[key];
                                const active = effCat === key;
                                return (
                                  <button
                                    key={key}
                                    onClick={(e) => setNoteCategory(e, note.id, key)}
                                    style={{
                                      padding: "0px 5px", borderRadius: 8, fontSize: 9, cursor: "pointer",
                                      border: `1px solid ${active ? cc.border : "transparent"}`,
                                      background: active ? cc.bg : "transparent",
                                      color: active ? cc.color : cc.color + "66",
                                      opacity: active ? 1 : 0.5,
                                    }}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                              {showPicker && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCatPickerNoteId(null); }}
                                  style={{ border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                                >&times;</button>
                              )}
                            </span>
                          );
                        }
                        // Has a category — show badge
                        const cc = CATEGORY_COLORS[effCat] || CATEGORY_COLORS.misc;
                        return (
                          <span
                            style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: cc.bg, color: cc.color, border: `1px solid ${cc.border}`, cursor: "pointer" }}
                            onClick={(e) => handleCategoryBadgeClick(e, note)}
                            title={isAutoApplied ? "Click to override list category" : "Click to remove"}
                          >
                            {effCat}
                          </span>
                        );
                      })()}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onUpdateNote(note.id, { hearted: !note.hearted }); }}
                          style={{ padding: "1px 4px", borderRadius: 4, border: "1px solid transparent", background: "transparent", cursor: "pointer", fontSize: 11, opacity: note.hearted ? 1 : 0.3 }}
                          title={note.hearted ? "Remove heart" : "Heart this note"}
                        >
                          {note.hearted ? "❤️" : "🩶"}
                        </button>
                        <button
                          onClick={(e) => openListPicker(e, note.id)}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: listPickerNoteId === note.id ? "#1e293b" : "transparent", color: listPickerNoteId === note.id ? "#e2e8f0" : "#a78bfa", cursor: "pointer", fontSize: 11 }}
                          title="Add to list"
                        >
                          List
                        </button>
                        <button
                          onClick={(e) => startMatching(e, note.id)}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: isMatching ? "#312e81" : "transparent", color: isMatching ? "#a5b4fc" : "#60a5fa", cursor: "pointer", fontSize: 11 }}
                          title="Search touchstones manually"
                        >
                          Match
                        </button>
                        <button
                          onClick={embeddingStore && topics?.length > 0 ? (e) => { e.stopPropagation(); if (isSuggesting) { setSuggestingNoteId(null); } else { suggestMatches(e, note.id); } } : undefined}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: isSuggesting ? "#1e3a2f" : "transparent", color: "#6ee7b7", cursor: embeddingStore && topics?.length > 0 ? "pointer" : "default", fontSize: 11, opacity: embeddingStore && topics?.length > 0 ? 1 : 0.3 }}
                          title="Find touchstone matches via embeddings"
                        >
                          Suggest
                        </button>
                        <button
                          onClick={isEditing ? undefined : (e) => startEdit(e, note)}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: "transparent", color: "#38bdf8", cursor: isEditing ? "default" : "pointer", fontSize: 11, opacity: isEditing ? 0.3 : 1 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={matchedTs ? undefined : (e) => openPromote(e, note)}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: promotingNoteId === note.id ? "#422006" : "transparent", color: "#fbbf24", cursor: matchedTs ? "default" : "pointer", fontSize: 11, opacity: matchedTs ? 0.3 : 1 }}
                          title="Create bit + touchstone from this note"
                        >
                          Promote
                        </button>
                        <button
                          onClick={(e) => handleRemove(e, note.id)}
                          style={{ padding: "1px 6px", borderRadius: 4, border: "1px solid transparent", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 11 }}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                  )}

                  {/* Promote to touchstone */}
                  {promotingNoteId === note.id && !rearranging && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "#1a1206", border: "1px solid #854d0e" }}>
                      <div style={{ fontSize: 11, color: "#fbbf24", marginBottom: 4 }}>Name this touchstone:</div>
                      <form onSubmit={(e) => { e.preventDefault(); confirmPromote(e); }} style={{ display: "flex", gap: 6 }}>
                        <input
                          ref={promoteInputRef}
                          value={promoteName}
                          onChange={e => setPromoteName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Escape") setPromotingNoteId(null); }}
                          style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #854d0e", background: "#0f172a", color: "#e2e8f0", fontSize: 12 }}
                        />
                        <button type="submit" style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #854d0e", background: "#422006", color: "#fbbf24", cursor: "pointer", fontSize: 11 }}>
                          Create
                        </button>
                        <button type="button" onClick={() => setPromotingNoteId(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #555", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>
                          Cancel
                        </button>
                      </form>
                    </div>
                  )}

                  {/* List picker */}
                  {listPickerNoteId === note.id && !rearranging && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "#1e293b", border: "1px solid #334155" }}>
                      {/* Current tags */}
                      {(note.tags || []).length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                          {(note.tags || []).map((t, i) => (
                            <span key={`${t}-${i}`} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#334155", color: "#e2e8f0", display: "flex", alignItems: "center", gap: 4 }}>
                              {t}
                              <button
                                onClick={(e) => removeFromList(e, note.id, t)}
                                style={{ border: "none", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}
                              >&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input
                        ref={listInputRef}
                        type="text"
                        placeholder="Type to search or create list..."
                        value={listPickerValue}
                        onChange={e => setListPickerValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && listPickerValue.trim()) {
                            assignList(e, note.id, listPickerValue.trim());
                          } else if (e.key === "Escape") {
                            setListPickerNoteId(null);
                          }
                        }}
                        style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #555", background: "#0f172a", color: "#e2e8f0", fontSize: 12, marginBottom: listSuggestions.length ? 4 : 0 }}
                      />
                      {listSuggestions.length > 0 && (
                        <div style={{ maxHeight: 150, overflowY: "auto" }}>
                          {listPickerValue.trim() && !allTagNames.includes(listPickerValue.trim()) && (
                            <div
                              onClick={(e) => assignList(e, note.id, listPickerValue.trim())}
                              style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12, color: "#6ee7b7", display: "flex", alignItems: "center", gap: 4 }}
                              onMouseEnter={e => e.currentTarget.style.background = "#334155"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            >
                              + Create "{listPickerValue.trim()}"
                            </div>
                          )}
                          {listSuggestions.map(tag => {
                            const already = (note.tags || []).includes(tag);
                            return (
                              <div
                                key={tag}
                                onClick={already ? undefined : (e) => assignList(e, note.id, tag)}
                                style={{
                                  padding: "4px 8px", borderRadius: 4, fontSize: 12,
                                  cursor: already ? "default" : "pointer",
                                  color: already ? "#475569" : "#e2e8f0",
                                  display: "flex", justifyContent: "space-between", alignItems: "center",
                                }}
                                onMouseEnter={e => { if (!already) e.currentTarget.style.background = "#334155"; }}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                <span>{tag}</span>
                                {already && <span style={{ fontSize: 10, color: "#475569" }}>current</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {showGapAfter && (
                <div style={{ height: 3, background: "#6366f1", borderRadius: 2, marginTop: 2 }} />
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Pagination */}
      {!rearranging && pageCount > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#ccc", cursor: page === 0 ? "default" : "pointer" }}>Prev</button>
          <span style={{ color: "#94a3b8", fontSize: 13, lineHeight: "28px" }}>{page + 1} / {pageCount}</span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#ccc", cursor: page >= pageCount - 1 ? "default" : "pointer" }}>Next</button>
        </div>
      )}

      {notes.length === 0 && !showImportBox && (
        <div style={{ textAlign: "center", color: "#64748b", marginTop: 40, fontSize: 14 }}>
          No notes imported yet. Open the import section below to get started.
        </div>
      )}

      {/* Import / Clear - collapsed box at bottom */}
      <div style={{ marginTop: 24, borderTop: "1px solid #334155", paddingTop: 12 }}>
        <button
          onClick={() => setShowImportBox(v => !v)}
          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ fontSize: 10 }}>{showImportBox ? "\u25BC" : "\u25B6"}</span>
          Import &amp; Manage
        </button>
        {showImportBox && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => doImport("clickup", onImportClickUp)}
              disabled={!!importing}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #555", background: "#1e293b", color: "#e2e8f0", cursor: importing ? "wait" : "pointer" }}
            >
              Import ClickUp
            </button>
            <button
              onClick={() => doImport("keep", onImportKeep)}
              disabled={!!importing}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #555", background: "#1e293b", color: "#e2e8f0", cursor: importing ? "wait" : "pointer" }}
            >
              Import Keep
            </button>
            <button
              onClick={() => doImport("journal", onSyncJournals)}
              disabled={!!importing}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #555", background: "#1e293b", color: "#e2e8f0", cursor: importing ? "wait" : "pointer" }}
            >
              Sync Journals
            </button>
            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                disabled={!!importing || counts.clickup + counts.keep === 0}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #555", background: "#1e293b", color: "#f87171", cursor: importing || counts.clickup + counts.keep === 0 ? "default" : "pointer", marginLeft: "auto" }}
              >
                Clear Imports
              </button>
            ) : (
              <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#f87171" }}>Clear {counts.clickup + counts.keep} notes?</span>
                <button
                  onClick={async () => {
                    setConfirmClear(false);
                    setImporting("clear");
                    setStatus("Clearing ClickUp + Keep notes...");
                    try {
                      const result = await onClearImports();
                      setStatus(`Cleared ${result.removed} imported notes (${result.kept} journals kept)`);
                      setTagFilter("all");
                    } catch (err) {
                      setStatus(`Error: ${err.message}`);
                    }
                    setImporting(null);
                  }}
                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #f87171", background: "#7f1d1d", color: "#fca5a5", cursor: "pointer", fontSize: 12 }}
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: 12 }}
                >
                  Cancel
                </button>
              </span>
            )}
            {status && <span style={{ fontSize: 12, color: "#94a3b8", flexBasis: "100%" }}>{status}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
