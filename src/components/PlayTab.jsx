import { useState, useEffect, useCallback, useMemo, useReducer, useRef } from "react";

const SERVER_URL = "http://localhost:3001";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unrated", label: "Unrated" },
  { key: "rated", label: "Rated" },
  { key: "parsed", label: "Parsed" },
  { key: "unparsed", label: "Unparsed" },
];

const SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "rating", label: "Rating" },
  { key: "duration", label: "Duration" },
];

const QUICK_RATINGS = ["+++++", "++++_", "+++__", "++___", "+____", "_____", "xxxxx"];

function playReducer(state, action) {
  switch (action.type) {
    case "SET":
      return { ...state, [action.field]: action.value };
    case "MERGE":
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

export function PlayTab({
  transcripts,
  topics,
  processing,
  selectedModel,
  parseAll,
  parseUnparsed,
  setShouldStop,
  abortControllerRef,
  onGoToMix,
  onSyncApply,
  playInitFile,
  onConsumePlayInit,
  onNowPlaying,
  nowPlaying,
}) {
  const [state, dispatch] = useReducer(playReducer, {
    files: [],
    selectedHash: null,
    selectedDetail: null,
    search: "",
    filter: "all",
    saving: false,
    syncDiff: null,
    loading: true,
  });

  const { files, selectedHash, selectedDetail, search, filter, saving, syncDiff, loading } = state;
  const set = (field, value) => dispatch({ type: "SET", field, value });

  // Sort state — separate useState to avoid closure issues
  const [sortBy, setSortBy] = useState("name");
  const [sortAsc, setSortAsc] = useState(false);

  // Editing state for right panel
  const [editRating, setEditRating] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTrimStart, setEditTrimStart] = useState("00:00");
  const [editTrimEnd, setEditTrimEnd] = useState("");
  const [applying, setApplying] = useState(false);


  // Fetch file list
  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/transcripts`);
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      dispatch({ type: "MERGE", payload: { files: data, loading: false } });
    } catch (err) {
      console.error("Failed to fetch files:", err);
      set("loading", false);
    }
  }, []);

  // Compute sync diff — returns the diff object (or null)
  const computeSyncDiff = useCallback(async (playFiles) => {
    const withTranscript = playFiles.filter((e) => e.has_transcript);
    const playByHash = new Map(withTranscript.map((e) => [e.hash, e]));
    const topixByHash = new Map();
    for (const tr of transcripts) {
      if (tr.playHash) topixByHash.set(tr.playHash, tr);
    }

    const toAdd = [];
    const toRename = [];
    const toDelete = [];
    const toLink = [];
    let unchanged = 0;

    const unlinkedByName = new Map();
    for (const tr of transcripts) {
      if (!tr.playHash) unlinkedByName.set(tr.name, tr);
    }

    for (const [hash, entry] of playByHash) {
      const existing = topixByHash.get(hash);
      if (existing) {
        if (existing.name !== entry.transcript_filename) {
          toRename.push({ entry, existing });
        } else {
          unchanged++;
        }
      } else {
        const unlinked = unlinkedByName.get(entry.transcript_filename);
        if (unlinked) {
          toLink.push({ entry, existing: unlinked });
          unlinkedByName.delete(entry.transcript_filename);
        } else {
          toAdd.push(entry);
        }
      }
    }

    for (const tr of transcripts) {
      if (tr.playHash && !playByHash.has(tr.playHash)) {
        toDelete.push(tr);
      }
    }

    const hasChanges = toAdd.length > 0 || toRename.length > 0 || toDelete.length > 0 || toLink.length > 0;
    const diff = hasChanges ? { toAdd, toRename, toDelete, toLink, unchanged, total: withTranscript.length } : null;
    set("syncDiff", diff);
    return diff;
  }, [transcripts]);

  // Auto-apply sync: fetch transcript text for new entries, then call onSyncApply
  const autoSync = useCallback(async (playFiles) => {
    const diff = await computeSyncDiff(playFiles);
    if (!diff) return;
    try {
      const addEntries = [];
      for (const entry of diff.toAdd) {
        const res = await fetch(`${SERVER_URL}/api/transcripts/${entry.hash}`);
        if (!res.ok) continue;
        const data = await res.json();
        addEntries.push({ hash: entry.hash, name: entry.transcript_filename, text: data.text });
      }
      await onSyncApply({
        toAdd: addEntries,
        toRename: diff.toRename,
        toDelete: diff.toDelete,
        toLink: diff.toLink || [],
      });
      set("syncDiff", null);
    } catch (err) {
      console.error("[PlayTab] Auto-sync failed:", err);
    }
  }, [computeSyncDiff, onSyncApply]);

  // On mount: fetch files + compute sync
  useEffect(() => {
    fetchFiles().then(() => {});
  }, [fetchFiles]);

  // After files load, auto-sync (only on file list changes, not on transcripts changes)
  const autoSyncRef = useRef(autoSync);
  autoSyncRef.current = autoSync;
  useEffect(() => {
    if (files.length > 0) autoSyncRef.current(files);
  }, [files]);


  // Select a file
  const selectFile = useCallback(async (hash) => {
    set("selectedHash", hash);
    try {
      const res = await fetch(`${SERVER_URL}/api/transcripts/${hash}`);
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      set("selectedDetail", data);

      // Parse filename for editing fields
      const parsed = parseFilenameClient(data.audio_filename);
      setEditRating(parsed?.rating || "_____");
      setEditTitle(parsed?.title || "");
      setEditTrimStart("00:00");
      setEditTrimEnd(data.duration_formatted || "");

      // Set nowPlaying (won't auto-play, just loads the player)
      onNowPlaying?.({
        url: `${SERVER_URL}/api/audio/${encodeURIComponent(data.audio_filename)}`,
        title: parsed?.title || data.audio_filename,
        hash,
      });
    } catch (err) {
      console.error("Failed to fetch file detail:", err);
    }
  }, [onNowPlaying]);

  // Auto-select file from external navigation (e.g. Transcripts tab)
  useEffect(() => {
    if (!playInitFile || files.length === 0) return;
    const match = files.find((f) => f.transcript_filename === playInitFile);
    if (match) selectFile(match.hash);
    onConsumePlayInit?.();
  }, [playInitFile, files, selectFile, onConsumePlayInit]);

  // Track hashes currently awaiting transcription
  const [transcribingHashes, setTranscribingHashes] = useState(new Set());
  const pollRef = useRef(null);

  // Poll for transcript arrival on transcribing files
  useEffect(() => {
    if (transcribingHashes.size === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/transcripts`);
        if (!res.ok) return;
        const data = await res.json();
        dispatch({ type: "SET", field: "files", value: data });

        // Check which transcribing hashes now have transcripts
        const arrived = new Set();
        for (const hash of transcribingHashes) {
          const f = data.find((e) => e.hash === hash);
          if (f && f.has_transcript) arrived.add(hash);
        }
        if (arrived.size > 0) {
          setTranscribingHashes((prev) => {
            const next = new Set(prev);
            for (const h of arrived) next.delete(h);
            return next;
          });
          // Auto-sync to pick up the new transcript
          await autoSync(data);
        }
      } catch (err) {
        // Silently retry
      }
    }, 10000); // poll every 10s
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [transcribingHashes, autoSync]);

  // Save changes (rate, rename, trim)
  const handleSave = useCallback(async () => {
    if (!selectedDetail || saving) return;
    set("saving", true);

    const parsed = parseFilenameClient(selectedDetail.audio_filename);
    const currentRating = parsed?.rating || "_____";
    const currentTitle = parsed?.title || "";
    let currentHash = selectedHash;
    let didTrim = false;

    try {
      // Rate if changed
      if (editRating !== currentRating) {
        await fetch(`${SERVER_URL}/api/files/${currentHash}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: editRating }),
        });
      }

      // Rename if changed
      if (editTitle.trim() && editTitle.trim() !== currentTitle) {
        await fetch(`${SERVER_URL}/api/files/${currentHash}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: editTitle.trim() }),
        });
      }

      // Trim if changed from defaults
      const origDur = selectedDetail.duration_formatted || "";
      if (editTrimStart !== "00:00" || (editTrimEnd && editTrimEnd !== origDur)) {
        const trimRes = await fetch(`${SERVER_URL}/api/files/${currentHash}/trim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: editTrimStart, end: editTrimEnd }),
        });
        const trimData = await trimRes.json();
        if (trimData.hash) {
          currentHash = trimData.hash;
          didTrim = true;
        }
      }

      // Refresh file list
      const res = await fetch(`${SERVER_URL}/api/transcripts`);
      const freshFiles = res.ok ? await res.json() : files;
      dispatch({ type: "SET", field: "files", value: freshFiles });

      // Auto-sync: propagate renames/deletes/adds to Topix
      await autoSync(freshFiles);

      // If we trimmed, start polling for the new transcript
      if (didTrim) {
        setTranscribingHashes((prev) => new Set([...prev, currentHash]));
      }

      selectFile(currentHash);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      set("saving", false);
    }
  }, [selectedDetail, selectedHash, editRating, editTitle, editTrimStart, editTrimEnd, saving, files, autoSync, selectFile]);

  // Delete file
  const handleDelete = useCallback(async () => {
    if (!selectedHash) return;
    if (!window.confirm("Delete this recording and its transcript? This cannot be undone.")) return;
    try {
      await fetch(`${SERVER_URL}/api/files/${selectedHash}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      dispatch({ type: "MERGE", payload: { selectedHash: null, selectedDetail: null } });
      fetchFiles();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, [selectedHash, fetchFiles]);

  // Apply sync
  const handleApplySync = useCallback(async () => {
    if (!syncDiff) return;
    setApplying(true);
    try {
      const addEntries = [];
      for (const entry of syncDiff.toAdd) {
        const res = await fetch(`${SERVER_URL}/api/transcripts/${entry.hash}`);
        if (!res.ok) throw new Error(`Failed to fetch ${entry.transcript_filename}`);
        const data = await res.json();
        addEntries.push({ hash: entry.hash, name: entry.transcript_filename, text: data.text });
      }
      await onSyncApply({
        toAdd: addEntries,
        toRename: syncDiff.toRename,
        toDelete: syncDiff.toDelete,
        toLink: syncDiff.toLink || [],
      });
      set("syncDiff", null);
    } catch (err) {
      console.error("Sync apply failed:", err);
    } finally {
      setApplying(false);
    }
  }, [syncDiff, onSyncApply]);

  // Enriched + filtered + sorted file list
  const displayFiles = useMemo(() => {
    let list = files.map((f) => {
      // Match by filename or by playHash (filename may have changed after rename/trim)
      const matchedTr = transcripts.find((t) => t.name === f.transcript_filename || t.playHash === f.hash);
      const bitCount = matchedTr
        ? topics.filter((t) => t.sourceFile === matchedTr.name || t.transcriptId === matchedTr.id).length
        : 0;
      const parsed = parseFilenameClient(f.audio_filename);
      const rating = f.rating || parsed?.rating || "_____";
      // Parse duration from formatted string if duration_seconds missing
      let duration_seconds = f.duration_seconds;
      if (!duration_seconds && f.duration_formatted && f.duration_formatted !== "--:--") {
        const [m, s] = f.duration_formatted.split(":").map(Number);
        duration_seconds = (m || 0) * 60 + (s || 0);
      }
      if (!duration_seconds && parsed?.duration) {
        const [m, s] = parsed.duration.split(":").map(Number);
        duration_seconds = (m || 0) * 60 + (s || 0);
      }
      return { ...f, bitCount, rating, duration_seconds: duration_seconds || 0, _parsed: parsed };
    });

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((f) => f.audio_filename.toLowerCase().includes(q) || f.transcript_filename.toLowerCase().includes(q));
    }

    // Filter
    switch (filter) {
      case "unrated": list = list.filter((f) => f.rating === "_____"); break;
      case "rated": list = list.filter((f) => f.rating !== "_____"); break;
      case "no-transcript": list = list.filter((f) => !f.has_transcript); break;
      case "parsed": list = list.filter((f) => f.bitCount > 0); break;
      case "unparsed": list = list.filter((f) => f.has_transcript && f.bitCount === 0); break;
    }

    // Sort — name always A-Z, rating always best→worst, duration toggles
    list.sort((a, b) => {
      switch (sortBy) {
        case "name": return (a._parsed?.title || a.audio_filename).localeCompare(b._parsed?.title || b.audio_filename);
        case "rating": return ratingRank(b.rating) - ratingRank(a.rating); // best first
        case "duration": {
          const cmp = (a.duration_seconds || 0) - (b.duration_seconds || 0);
          return sortAsc ? cmp : -cmp;
        }
        default: return 0;
      }
    });

    return list;
  }, [files, topics, search, filter, sortBy, sortAsc]);

  // Sync diff summary
  const syncSummary = useMemo(() => {
    if (!syncDiff) return null;
    const parts = [];
    if (syncDiff.toAdd.length) parts.push(`${syncDiff.toAdd.length} new`);
    if (syncDiff.toLink.length) parts.push(`${syncDiff.toLink.length} to link`);
    if (syncDiff.toRename.length) parts.push(`${syncDiff.toRename.length} renamed`);
    if (syncDiff.toDelete.length) parts.push(`${syncDiff.toDelete.length} deleted`);
    return parts.join(", ");
  }, [syncDiff]);

  if (loading) {
    return <div style={{ textAlign: "center", padding: 60, color: "#555" }}>Loading files...</div>;
  }

  const selectedFile = files.find((f) => f.hash === selectedHash);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 0, margin: "-24px -32px", height: "calc(100vh - 130px)" }}>
      {/* Left panel — file list */}
      <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid #1a1a2a", overflow: "hidden" }}>
        {/* Search */}
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => set("search", e.target.value)}
              placeholder="Search recordings..."
              style={{
                width: "100%", padding: "10px 36px 10px 14px", background: "#0d0d16", border: "1px solid #1e1e30",
                borderRadius: 8, color: "#ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            {search && (
              <button
                onClick={() => set("search", "")}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer" }}
              >
                x
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: "10px 20px 0", display: "flex", flexWrap: "wrap", gap: 4 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => set("filter", f.key)}
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "1px solid",
                background: filter === f.key ? "#ff6b6b18" : "transparent",
                color: filter === f.key ? "#ff6b6b" : "#666",
                borderColor: filter === f.key ? "#ff6b6b44" : "#1e1e30",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div style={{ padding: "10px 20px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#555" }}>Sort:</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                if (s.key === "duration" && sortBy === "duration") {
                  setSortAsc((prev) => !prev);
                } else {
                  setSortBy(s.key);
                  setSortAsc(false);
                }
              }}
              style={{
                padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "1px solid",
                background: sortBy === s.key ? "#1a1a2a" : "transparent",
                color: sortBy === s.key ? "#bbb" : "#555",
                borderColor: sortBy === s.key ? "#2a2a40" : "transparent",
              }}
            >
              {s.label} {sortBy === s.key && s.key === "duration" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#555" }}>
            {displayFiles.length} file{displayFiles.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Sync bar */}
        {syncSummary && (
          <div style={{
            margin: "10px 20px 0", padding: "8px 12px", background: "#4ecdc410",
            border: "1px solid #4ecdc433", borderRadius: 8,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 12, color: "#4ecdc4" }}>{syncSummary}</span>
            <button
              onClick={handleApplySync}
              disabled={applying}
              style={{
                padding: "4px 12px", background: "#4ecdc4", color: "#000", border: "none",
                borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: applying ? "not-allowed" : "pointer",
                opacity: applying ? 0.6 : 1,
              }}
            >
              {applying ? "Applying..." : "Apply"}
            </button>
          </div>
        )}

        {/* spacer before file list */}
        <div style={{ height: 10 }} />

        {/* File list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {displayFiles.map((f) => {
            const isSelected = f.hash === selectedHash;
            return (
              <div
                key={f.hash}
                onClick={() => selectFile(f.hash)}
                style={{
                  padding: "10px 12px", marginBottom: 2, borderRadius: 8, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10,
                  background: isSelected ? "#1a1a2e" : "transparent",
                  borderLeft: isSelected ? "3px solid #ff6b6b" : "3px solid transparent",
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#12121f"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Rating badge */}
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "2px 6px",
                  borderRadius: 4, flexShrink: 0, letterSpacing: 1,
                  background: ratingColor(f.rating || "_____").bg,
                  color: ratingColor(f.rating || "_____").fg,
                }}>
                  {f.rating || "_____"}
                </span>

                {/* Title */}
                <span style={{
                  flex: 1, fontSize: 13, color: "#ccc", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {f._parsed?.title || f.audio_filename}
                </span>

                {/* Bit count pill or Parse button */}
                {f.bitCount > 0 ? (
                  <span style={{
                    fontSize: 10, padding: "1px 7px", borderRadius: 10, fontWeight: 600, flexShrink: 0,
                    background: "#4ecdc418", color: "#4ecdc4",
                  }}>
                    {f.bitCount}
                  </span>
                ) : (() => {
                  // No bits — show transcribing / sync / parse depending on state
                  if (!f.has_transcript || transcribingHashes.has(f.hash)) {
                    return (
                      <span style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 10, flexShrink: 0,
                        color: "#da77f2", border: "1px solid #da77f233",
                        animation: "pulse 2s ease-in-out infinite",
                      }}>
                        transcribing
                      </span>
                    );
                  }
                  const tr = transcripts.find((t) => t.name === f.transcript_filename || t.playHash === f.hash);
                  if (tr) return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        parseAll([tr]);
                      }}
                      disabled={processing}
                      style={{
                        fontSize: 10, padding: "1px 8px", borderRadius: 10, fontWeight: 600, flexShrink: 0,
                        background: processing ? "#33333a" : "#ffa94d18", color: processing ? "#666" : "#ffa94d",
                        border: "1px solid #ffa94d33", cursor: processing ? "default" : "pointer",
                      }}
                    >
                      parse
                    </button>
                  );
                  // Has transcript on disk but not synced to Topix yet
                  return (
                    <span style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: 10, flexShrink: 0,
                      color: "#555", border: "1px solid #252538",
                    }}>
                      sync
                    </span>
                  );
                })()}

                {/* Duration */}
                <span style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, width: 40, textAlign: "right" }}>
                  {f.duration_formatted}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel — detail */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "#0a0a14" }}>
        {!selectedDetail ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
            Select a recording
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {/* Header */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#eee", marginBottom: 4, fontFamily: "'Playfair Display', serif" }}>
                {parseFilenameClient(selectedDetail.audio_filename)?.title || selectedDetail.audio_filename}
              </div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>
                {selectedDetail.duration_formatted}
              </div>
            </div>


            {/* Rating */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Rating
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={editRating}
                  onChange={(e) => setEditRating(e.target.value.slice(0, 5))}
                  maxLength={5}
                  style={{
                    width: 80, padding: "6px 8px", background: "#12121f", border: "1px solid #1e1e30",
                    borderRadius: 6, color: "#ddd", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                    textAlign: "center", letterSpacing: 2,
                  }}
                />
                {QUICK_RATINGS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setEditRating(r)}
                    style={{
                      padding: "4px 6px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                      background: editRating === r ? ratingColor(r).bg : "#12121f",
                      color: editRating === r ? ratingColor(r).fg : "#555",
                      border: `1px solid ${editRating === r ? ratingColor(r).fg + "44" : "#1e1e30"}`,
                      borderRadius: 4, cursor: "pointer", letterSpacing: 1,
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Title
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px", background: "#12121f", border: "1px solid #1e1e30",
                  borderRadius: 6, color: "#ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Trim */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Trim
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={editTrimStart}
                  onChange={(e) => setEditTrimStart(e.target.value)}
                  placeholder="00:00"
                  style={{
                    width: 70, padding: "6px 8px", background: "#12121f", border: "1px solid #1e1e30",
                    borderRadius: 6, color: "#ddd", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
                  }}
                />
                <span style={{ color: "#444" }}>to</span>
                <input
                  type="text"
                  value={editTrimEnd}
                  onChange={(e) => setEditTrimEnd(e.target.value)}
                  placeholder={selectedDetail.duration_formatted || ""}
                  style={{
                    width: 70, padding: "6px 8px", background: "#12121f", border: "1px solid #1e1e30",
                    borderRadius: 6, color: "#ddd", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
                  }}
                />
              </div>
            </div>

            {/* Save / Delete buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 1, padding: "10px", background: saving ? "#333" : "#6c5ce7", color: "#fff",
                  border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: "10px 16px", background: "#ff6b6b18", color: "#ff6b6b",
                  border: "1px solid #ff6b6b44", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>

            {/* Topix section */}
            <div style={{ borderTop: "1px solid #1a1a2a", paddingTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                Topix
              </div>

              {(() => {
                const bitCount = topics.filter((t) => t.sourceFile === selectedDetail.transcript_filename).length;
                if (bitCount > 0) {
                  return (
                    <div
                      onClick={() => {
                        const tr = transcripts.find((t) => t.name === selectedDetail.transcript_filename);
                        if (tr && onGoToMix) onGoToMix(tr);
                      }}
                      style={{
                        padding: "10px 12px", background: "#4ecdc410", border: "1px solid #4ecdc433",
                        borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#4ecdc4", marginBottom: 12,
                      }}
                    >
                      {bitCount} bits extracted &rarr; Mix
                    </div>
                  );
                } else if (selectedDetail.has_transcript !== false) {
                  return (
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>
                      Not parsed yet
                    </div>
                  );
                }
                return null;
              })()}

              {/* Transcript text */}
              {selectedDetail.text && (
                <div style={{
                  fontSize: 12, color: "#888", lineHeight: 1.7,
                  fontFamily: "'JetBrains Mono', monospace",
                  background: "#12121f", padding: 12, borderRadius: 8,
                  border: "1px solid #1e1e30", whiteSpace: "pre-wrap",
                }}>
                  {selectedDetail.text}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helpers ---

function parseFilenameClient(filename) {
  const ratingMatch = filename.match(/^\[(.{5})\]\s*/);
  const durationMatch = filename.match(/\s*\{(\d+):(\d+)\}\.m4a$/);
  if (!ratingMatch && !durationMatch) return null;
  const rating = ratingMatch ? ratingMatch[1] : "_____";
  const title = filename
    .replace(/^\[.{5}\]\s*/, "")
    .replace(/\s*\{\d+:\d+\}\.m4a$/, "")
    .trim();
  const duration = durationMatch
    ? `${String(parseInt(durationMatch[1])).padStart(2, "0")}:${String(parseInt(durationMatch[2])).padStart(2, "0")}`
    : null;
  return { rating, title, duration };
}

function ratingRank(rating) {
  if (!rating || rating === "_____") return 0;
  const plusCount = (rating.match(/\+/g) || []).length;
  const xCount = (rating.match(/x/g) || []).length;
  if (xCount > 0) return -xCount; // x ratings are worst, more x = worse
  return plusCount; // more + = better
}

function ratingColor(rating) {
  if (!rating) return { bg: "#1a1a2a", fg: "#555" };
  const plusCount = (rating.match(/\+/g) || []).length;
  if (rating === "xxxxx") return { bg: "#ff6b6b18", fg: "#ff6b6b" };
  if (plusCount >= 4) return { bg: "#51cf6618", fg: "#51cf66" };
  if (plusCount >= 2) return { bg: "#ffa94d18", fg: "#ffa94d" };
  if (plusCount >= 1) return { bg: "#74c0fc18", fg: "#74c0fc" };
  return { bg: "#1a1a2a", fg: "#555" };
}
