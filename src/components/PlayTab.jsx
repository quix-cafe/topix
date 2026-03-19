import { useState, useEffect, useCallback, useMemo, useReducer, useRef } from "react";
import { parseFilenameClient, ratingColor, ratingValue, RATING_FONT } from "../utils/filenameUtils";

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

const RATING_SCALE = ["xxxxx", "xxxx_", "xxx__", "xx___", "x____", "_____", "+____", "++___", "+++__", "++++_", "+++++"];

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
  vaultReady,
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

  // Keep a ref to transcripts so computeSyncDiff always uses latest
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

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
    const currentTranscripts = transcriptsRef.current;
    const withTranscript = playFiles.filter((e) => e.has_transcript);
    const playByHash = new Map(withTranscript.map((e) => [e.hash, e]));
    const topixByHash = new Map();
    for (const tr of currentTranscripts) {
      if (tr.playHash) topixByHash.set(tr.playHash, tr);
    }

    const toAdd = [];
    const toRename = [];
    const toDelete = [];
    const toLink = [];
    let unchanged = 0;

    // Build name-based lookup for ALL transcripts (not just unlinked)
    const topixByName = new Map();
    for (const tr of currentTranscripts) {
      topixByName.set(tr.name, tr);
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
        // Check by name — transcript may exist without playHash (or with a stale hash)
        const byName = topixByName.get(entry.transcript_filename);
        if (byName) {
          if (!byName.playHash) {
            toLink.push({ entry, existing: byName });
          } else {
            unchanged++; // already exists by name, just hash mismatch — don't re-add
          }
        } else {
          toAdd.push(entry);
        }
      }
    }

    for (const tr of currentTranscripts) {
      if (tr.playHash && !playByHash.has(tr.playHash)) {
        toDelete.push(tr);
      }
    }

    const hasChanges = toAdd.length > 0 || toRename.length > 0 || toDelete.length > 0 || toLink.length > 0;
    const diff = hasChanges ? { toAdd, toRename, toDelete, toLink, unchanged, total: withTranscript.length } : null;
    set("syncDiff", diff);
    return diff;
  }, []);

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

  // After files load, auto-sync — but wait until vault data has loaded from IndexedDB
  const autoSyncRef = useRef(autoSync);
  autoSyncRef.current = autoSync;
  const lastSyncedFilesRef = useRef(null);
  useEffect(() => {
    if (files.length > 0 && vaultReady && files !== lastSyncedFilesRef.current) {
      lastSyncedFilesRef.current = files;
      autoSyncRef.current(files);
    }
  }, [files, vaultReady]);


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
  const [transcribeStatus, setTranscribeStatus] = useState(null); // null=hidden, { status, lines[], filesDone, filesTotal }
  const [transcribeRunning, setTranscribeRunning] = useState(false);
  const transcribeRunningRef = useRef(false);

  const startTranscribe = useCallback(async () => {
    if (transcribeRunningRef.current) return;
    transcribeRunningRef.current = true;
    setTranscribeStatus({ status: "Starting transcription...", lines: [], filesDone: 0, filesTotal: 0 });
    setTranscribeRunning(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/transcribe`, { method: "POST" });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let filesDone = 0;
      let filesTotal = 0;
      let currentStatus = "Starting transcription...";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const line = part.replace(/^data: /, "");
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.done) {
              transcribeRunningRef.current = false;
              setTranscribeRunning(false);
              setTranscribeStatus((prev) => ({ ...prev, status: "Transcription complete" }));
              fetchFiles();
            } else if (msg.line) {
              const text = msg.line;
              // 🎤 lines = file status updates
              if (text.includes("🎤") || text.includes("\uD83C\uDFA4")) {
                currentStatus = text;
                // Try to extract file count from patterns like "Transcribing 2/5"
                const countMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
                if (countMatch) { filesDone = parseInt(countMatch[1]) - 1; filesTotal = parseInt(countMatch[2]); }
                setTranscribeStatus((prev) => ({ ...prev, status: currentStatus, filesDone, filesTotal }));
              } else if (/^[\u2800-\u28FF]/.test(text) || text.includes('\u2501')) {
                // Spinner/progress lines — update progress indicator
                setTranscribeStatus((prev) => ({ ...prev, progress: text }));
              } else if (text.startsWith("[") && text.includes("-->")) {
                // Timestamp segment lines — show latest transcript chunk
                const content = text.replace(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, "");
                setTranscribeStatus((prev) => ({
                  ...prev,
                  lines: [content].slice(-1),
                }));
              } else if (text.startsWith("Error")) {
                setTranscribeStatus((prev) => ({ ...prev, status: text }));
              }
              // Ignore other noise
            }
          } catch {}
        }
      }
    } catch (err) {
      setTranscribeStatus((prev) => ({ ...(prev || {}), status: `Error: ${err.message}` }));
      transcribeRunningRef.current = false;
      setTranscribeRunning(false);
    }
  }, [fetchFiles]);
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

      // If we trimmed, trigger transcription with live terminal
      if (didTrim) {
        setTranscribingHashes((prev) => new Set([...prev, currentHash]));
        startTranscribe();
      }

      selectFile(currentHash);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      set("saving", false);
    }
  }, [selectedDetail, selectedHash, editRating, editTitle, editTrimStart, editTrimEnd, saving, files, autoSync, selectFile, startTranscribe]);

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
        case "rating": return ratingValue(b.rating) - ratingValue(a.rating); // best first
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
        <div style={{ padding: "10px 20px 0", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
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
          <button
            disabled={transcribeRunning}
            onClick={startTranscribe}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
              border: "1px solid #2a4a2a", background: transcribeRunning ? "#2a4a2a" : "#1a2e1a",
              color: transcribeRunning ? "#4a8a4a" : "#6bc46b", marginLeft: 8,
              opacity: transcribeRunning ? 0.7 : 1,
            }}
          >
            {transcribeRunning ? "Transcribing..." : "Transcribe"}
          </button>
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

        {/* Transcribe status */}
        {transcribeStatus !== null && (
          <div style={{
            margin: "10px 20px 0", background: "#0a0a14", border: "1px solid #1e1e30",
            borderRadius: 8, overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", gap: 10 }}>
              {transcribeRunning && (
                <span style={{ fontSize: 14, animation: "spin 1s linear infinite", display: "inline-block" }}>🎤</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600,
                  color: transcribeStatus.status?.startsWith("Error") ? "#ff6b6b" : transcribeRunning ? "#6bc46b" : "#888",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {transcribeStatus.status}
                </div>
                {transcribeStatus.lines?.length > 0 && (
                  <div style={{
                    fontSize: 11, color: "#666", fontFamily: "monospace", marginTop: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {transcribeStatus.lines[0]}
                  </div>
                )}
              </div>
              {transcribeStatus.filesTotal > 0 && transcribeRunning && (
                <span style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>
                  {transcribeStatus.filesDone}/{transcribeStatus.filesTotal}
                </span>
              )}
              {!transcribeRunning && (
                <span
                  onClick={() => setTranscribeStatus(null)}
                  style={{ fontSize: 12, color: "#666", cursor: "pointer", padding: "0 4px" }}
                >✕</span>
              )}
            </div>
            {transcribeRunning && transcribeStatus.progress && (
              <div style={{
                padding: "0 12px 6px", fontSize: 11, color: "#555", fontFamily: "monospace",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {transcribeStatus.progress}
              </div>
            )}
          </div>
        )}

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
                  ...RATING_FONT, fontSize: 11, padding: "2px 6px",
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 20 }}>
            {/* Header: title + duration */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#eee", fontFamily: "'Playfair Display', serif", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {parseFilenameClient(selectedDetail.audio_filename)?.title || selectedDetail.audio_filename}
              </div>
              <span style={{ fontSize: 12, color: "#555", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                {selectedDetail.duration_formatted}
              </span>
            </div>

            {/* Rating slider */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  ...RATING_FONT, fontSize: 15, fontWeight: 700, letterSpacing: 2,
                  color: ratingColor(editRating).fg, background: ratingColor(editRating).bg,
                  padding: "3px 8px", borderRadius: 4, flexShrink: 0,
                }}>
                  {editRating}
                </span>
                <input
                  type="range"
                  min={0}
                  max={RATING_SCALE.length - 1}
                  value={RATING_SCALE.indexOf(editRating) >= 0 ? RATING_SCALE.indexOf(editRating) : 5}
                  onChange={(e) => setEditRating(RATING_SCALE[parseInt(e.target.value)])}
                  style={{ flex: 1, accentColor: "#666" }}
                />
              </div>
            </div>

            {/* Title input */}
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              style={{
                width: "100%", padding: "8px 12px", background: "#12121f", border: "1px solid #1e1e30",
                borderRadius: 6, color: "#ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
                marginBottom: 12,
              }}
            />

            {/* Trim inputs */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
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
              <span style={{ color: "#444", fontSize: 12 }}>to</span>
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
              <div style={{ flex: 1 }} />
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "8px 20px", background: saving ? "#333" : "#6c5ce7", color: "#fff",
                  border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: "8px 12px", background: "#ff6b6b18", color: "#ff6b6b",
                  border: "1px solid #ff6b6b44", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>

            {/* Topix section */}
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
                      padding: "8px 12px", background: "#4ecdc410", border: "1px solid #4ecdc433",
                      borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#4ecdc4", marginBottom: 12, flexShrink: 0,
                    }}
                  >
                    {bitCount} bits extracted &rarr; Mix
                  </div>
                );
              } else if (selectedDetail.has_transcript !== false) {
                return (
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 12, flexShrink: 0 }}>
                    Not parsed yet
                  </div>
                );
              }
              return null;
            })()}

            {/* Transcript text — scrollable */}
            {selectedDetail.text && (
              <div style={{
                flex: 1, minHeight: 0, overflowY: "auto",
                fontSize: 12, color: "#888", lineHeight: 1.7,
                fontFamily: "'JetBrains Mono', monospace",
                background: "#12121f", padding: 12, borderRadius: 8,
                border: "1px solid #1e1e30", whiteSpace: "pre-wrap",
              }}>
                {selectedDetail.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helpers ---

