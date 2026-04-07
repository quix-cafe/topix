import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { MixPanel } from "./MixPanel";
import { parseFilenameClient, ratingColor, ratingValue, RATING_FONT } from "../utils/filenameUtils";
import { SYSTEM_PARSE_V3 } from "../utils/prompts";
import { extractCompleteJsonObjects } from "../utils/jsonParser";


const TOUCHSTONE_PALETTE = [
  "#ff6b6b", "#ffa94d", "#ffd43b", "#51cf66",
  "#4ecdc4", "#74c0fc", "#da77f2", "#f783ac",
  "#a9e34b", "#63e6be", "#ff8787", "#ffb347",
];
function hashStr(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff; return Math.abs(h); }
function tsColor(tsId) { return TOUCHSTONE_PALETTE[hashStr(tsId) % TOUCHSTONE_PALETTE.length]; }
const WORDS_PER_MINUTE = 150;
const ROW_DURATION = 900; // 10 min in seconds


/**
 * PageTimeline - Interactive horizontal bit lane for a single transcript's page view.
 * Shows bit segments sized by word count, colored by touchstone, with hover details.
 */
function PageTimeline({ timeline, onViewBitDetail, onSelectBit, topics }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const hoveredBit = hoveredIdx !== null ? timeline.bits[hoveredIdx] : null;

  return (
    <div style={{ marginBottom: 16, padding: "10px 12px", background: "#0a0a14", borderRadius: 8, border: "1px solid #1e1e30" }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Set Timeline</div>
      <div style={{ display: "flex", flexWrap: "wrap", width: "100%", borderRadius: 3, overflow: "hidden" }}>
        {timeline.bits.map((bit, bIdx) => {
          const isHovered = hoveredIdx === bIdx;
          const bitDur = bit.wordCount * (timeline.duration / timeline.totalWords);
          const pct = (bitDur / ROW_DURATION) * 100;

          let bg, border;
          if (bit.tsId) {
            bg = tsColor(bit.tsId);
            border = "none";
          } else if (bit.isConnected) {
            bg = "#1e2a2a";
            border = "1px solid #4ecdc466";
          } else {
            bg = "#16161f";
            border = "1px solid #1e1e30";
          }

          return (
            <div
              key={bit.id}
              onMouseEnter={() => setHoveredIdx(bIdx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => {
                if (onSelectBit) {
                  onSelectBit(bit.id);
                } else {
                  const fullBit = topics.find(t => t.id === bit.id);
                  if (fullBit && onViewBitDetail) onViewBitDetail(fullBit);
                }
              }}
              style={{
                width: `${pct}%`,
                height: 20,
                minWidth: 2,
                background: bg,
                border,
                borderRadius: 2,
                opacity: isHovered ? 1 : 0.8,
                transition: "opacity 0.1s",
                cursor: "pointer",
                boxShadow: isHovered ? `0 0 0 1px ${bit.tsId ? tsColor(bit.tsId) : "#4ecdc4"}` : "none",
                boxSizing: "border-box",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {bit.tsKeyword && pct > 3 && (
                <span style={{ fontSize: 7, fontWeight: 700, color: "#000", opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 2px" }}>
                  {bit.tsKeyword}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{
        marginTop: 4,
        padding: "3px 8px",
        background: hoveredBit ? "#0d0d18" : "transparent",
        borderRadius: 4,
        fontSize: 10,
        borderLeft: hoveredBit ? `2px solid ${hoveredBit.tsId ? tsColor(hoveredBit.tsId) : "#4ecdc4"}` : "2px solid transparent",
        display: "flex",
        gap: 8,
        alignItems: "baseline",
        flexWrap: "wrap",
        minHeight: 18,
        visibility: hoveredBit ? "visible" : "hidden",
      }}>
        <span style={{ color: "#ddd", fontWeight: 600 }}>{hoveredBit?.title || "\u00A0"}</span>
        {hoveredBit?.tsKeyword && <span style={{ fontSize: 9, fontWeight: 700, color: "#4ecdc4", background: "#4ecdc418", padding: "0 4px", borderRadius: 2, border: "1px solid #4ecdc433", textTransform: "uppercase" }}>{hoveredBit.tsKeyword}</span>}
        {hoveredBit?.tsName && <span style={{ color: "#888" }}>· {hoveredBit.tsName}</span>}
        {hoveredBit?.tags?.length > 0 && <span style={{ color: "#555", fontSize: 9 }}>{hoveredBit.tags.slice(0, 3).join(", ")}</span>}
        <span style={{ color: "#444", fontSize: 9, marginLeft: "auto" }}>{hoveredBit?.wordCount || 0}w</span>
      </div>
    </div>
  );
}

/**
 * ReParseMenu — dropdown replacing the old Re-parse button.
 * Options: Ollama (default), Gemini/Claude via server.py, paste raw JSON, copy prompt.
 */
const PASTE_MODEL_OPTIONS = [
  { value: "gemini-thinking", label: "Gemini Thinking" },
  { value: "gemini-pro", label: "Gemini Pro" },
  { value: "gemini-flash", label: "Gemini Flash" },
  { value: "claude", label: "Claude" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "other", label: "Other..." },
];

function ReParseMenu({ transcript, processing, reParseTranscript, onImportParsedJSON, actionBtnStyle, selectedModel }) {
  const [open, setOpen] = useState(null); // null | "menu" | "paste"
  const [pasteText, setPasteText] = useState("");
  const [pasteModel, setPasteModel] = useState("gemini-thinking");
  const [customModel, setCustomModel] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const buildParsePrompt = () => {
    const text = transcript.text?.replace(/\n/g, " ") || "";
    return { system: SYSTEM_PARSE_V3, user: `Parse this comedy transcript:\n\n${text}` };
  };

  const handleCopyPrompt = async () => {
    const { system, user } = buildParsePrompt();
    await navigator.clipboard.writeText(`${system}\n\n${user}`);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
    setOpen(null);
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleExternalReparse = async (provider, geminiModel) => {
    setOpen(null);
    setBusy(true);
    setError(null);
    const { system, user } = buildParsePrompt();
    try {
      const res = await fetch("/api/llm/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, system, user, ...(geminiModel && { gemini_model: geminiModel }) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "API call failed");

      // Try direct JSON.parse first, fall back to extracting objects from markdown-wrapped response
      let parsed;
      try {
        parsed = JSON.parse(data.result);
      } catch {
        parsed = extractCompleteJsonObjects(data.result);
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        const modelName = provider === "gemini" ? `gemini-${geminiModel || "unknown"}` : provider;
        onImportParsedJSON(transcript, parsed, { model: modelName });
      } else {
        throw new Error(`No bits found in ${provider} response`);
      }
    } catch (e) {
      console.error(`[Re-parse] ${provider} error:`, e.message);
      setError(e.message);
      setTimeout(() => setError(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  const handlePasteSubmit = () => {
    try {
      const parsed = JSON.parse(pasteText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const model = pasteModel === "other" ? (customModel.trim() || "unknown") : pasteModel;
        onImportParsedJSON(transcript, parsed, { model });
        setOpen(null);
        setPasteText("");
      }
    } catch (e) {
      console.error("[Re-parse] Invalid JSON:", e.message);
    }
  };

  const menuItemStyle = (color) => ({
    display: "block", width: "100%", background: "none", border: "none", color,
    padding: "5px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600,
  });

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(open ? null : "menu")}
        disabled={processing || busy}
        style={actionBtnStyle(error ? "#ff6b6b" : copyFeedback ? "#51cf66" : busy ? "#888" : "#ffa94d", { disabled: processing || busy })}
      >
        {error ? "Error" : busy ? "Waiting..." : copyFeedback ? "Copied!" : "Re-parse \u25BE"}
      </button>
      {open === "menu" && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 4, zIndex: 100, minWidth: 180 }}>
          <button onClick={() => { setOpen(null); reParseTranscript(transcript); }} style={menuItemStyle("#ffa94d")}
            onMouseEnter={(e) => e.target.style.background = "#ffa94d11"} onMouseLeave={(e) => e.target.style.background = "none"}>
            Ollama (local)
          </button>
          <div style={{ borderTop: "1px solid #252538", margin: "2px 0" }} />
          <div style={{ fontSize: 10, color: "#4285f4", padding: "4px 10px", fontWeight: 600 }}>Gemini</div>
          {[{ id: "pro", label: "Pro" }, { id: "thinking", label: "Thinking" }, { id: "flash", label: "Flash" }].map((v) => (
            <button key={v.id} onClick={() => handleExternalReparse("gemini", v.id)} style={menuItemStyle("#4285f4")}
              onMouseEnter={(e) => e.target.style.background = "#4285f411"} onMouseLeave={(e) => e.target.style.background = "none"}>
              <span style={{ paddingLeft: 8 }}>{v.label}</span>
            </button>
          ))}
          <button onClick={() => handleExternalReparse("claude")} style={menuItemStyle("#c4946a")}
            onMouseEnter={(e) => e.target.style.background = "#c4946a11"} onMouseLeave={(e) => e.target.style.background = "none"}>
            Claude Sonnet
          </button>
          <div style={{ borderTop: "1px solid #252538", margin: "2px 0" }} />
          <button onClick={() => { setOpen("paste"); setPasteText(""); }} style={menuItemStyle("#4ecdc4")}
            onMouseEnter={(e) => e.target.style.background = "#4ecdc411"} onMouseLeave={(e) => e.target.style.background = "none"}>
            Paste JSON...
          </button>
          <button onClick={handleCopyPrompt} style={menuItemStyle("#aaa")}
            onMouseEnter={(e) => e.target.style.background = "#ffffff08"} onMouseLeave={(e) => e.target.style.background = "none"}>
            Copy prompt
          </button>
        </div>
      )}
      {open === "paste" && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 8, zIndex: 100, minWidth: 340 }}>
          <div style={{ fontSize: 10, color: "#4ecdc4", marginBottom: 6, fontWeight: 600 }}>Paste parsed JSON array:</div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder='[{"title":"...","fullText":"...","summary":"...","tags":[...],"keywords":[...],"textPosition":{"startChar":0,"endChar":100}}]'
            style={{ width: "100%", minHeight: 140, background: "#0d0d16", border: "1px solid #333", borderRadius: 4, color: "#ccc", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: 8, resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#888" }}>Model:</span>
            <select
              value={pasteModel}
              onChange={(e) => setPasteModel(e.target.value)}
              style={{ background: "#0d0d16", border: "1px solid #333", borderRadius: 4, color: "#ccc", fontSize: 10, padding: "3px 6px", flex: 1 }}
            >
              {selectedModel && <option value={selectedModel}>{selectedModel} (Ollama)</option>}
              {PASTE_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {pasteModel === "other" && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="model name"
                style={{ background: "#0d0d16", border: "1px solid #333", borderRadius: 4, color: "#ccc", fontSize: 10, padding: "3px 6px", width: 100 }}
              />
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setOpen("menu")}
              style={{ background: "none", border: "1px solid #333", color: "#666", borderRadius: 4, padding: "3px 10px", fontSize: 10, cursor: "pointer" }}>
              Back
            </button>
            <button onClick={handlePasteSubmit} disabled={!pasteText.trim()}
              style={{ background: pasteText.trim() ? "#51cf6622" : "none", border: `1px solid ${pasteText.trim() ? "#51cf6644" : "#333"}`, color: pasteText.trim() ? "#51cf66" : "#555", borderRadius: 4, padding: "3px 10px", fontSize: 10, cursor: pasteText.trim() ? "pointer" : "default", fontWeight: 600 }}>
              Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TranscriptTab({
  transcripts,
  topics,
  touchstones,
  matches,
  selectedTranscript,
  selectedTopic,
  processing,
  selectedModel,
  parseAll,
  parseUnparsed,
  setShouldStop,
  abortControllerRef,
  setSelectedTranscript,
  setSelectedTopic,
  reParseTranscript,
  onImportParsedJSON,
  purgeTranscriptData,
  removeTranscript,
  onHuntTranscript,
  // MixPanel props
  onJoinBits,
  onSplitBit,
  onTakeOverlap,
  onDeleteBit,
  onScrollBoundary,
  onGenerateTitle,
  onConfirmRename,
  onAddPhantomBit,
  onReParseGap,
  onViewBitDetail,
  mixTranscriptInit,
  mixBitInit,
  mixGapInit,
  onConsumeMixInit,
  approvedGaps,
  onApproveGap,
  onGoToPlay,
  onRemoveOrphans,
  onAbsorbUnmatched,
  sortCol: sortColProp,
  sortDir: sortDirProp,
  onSortChange,
}) {
  // Sort state: use parent-managed props if provided (persists across tab switches), else local
  const [localSortCol, setLocalSortCol] = useState("file");
  const [localSortDir, setLocalSortDir] = useState("asc");
  const sortCol = sortColProp ?? localSortCol;
  const sortDir = sortDirProp ?? localSortDir;
  const [searchFilter, setSearchFilter] = useState("");
  const [timelineScrollBitId, setTimelineScrollBitId] = useState(null);
  const prevSelectedRef = useRef(null);
  const listScrollY = useRef(0);

  // When entering page view: save list scroll position, scroll to top
  // When returning to list: restore saved scroll position
  useEffect(() => {
    if (selectedTranscript && selectedTranscript !== prevSelectedRef.current) {
      // Entering page view — save current scroll, then scroll to top
      if (!prevSelectedRef.current) {
        listScrollY.current = window.scrollY;
      }
      requestAnimationFrame(() => window.scrollTo(0, 0));
    } else if (!selectedTranscript && prevSelectedRef.current) {
      // Returning to list — restore scroll position
      requestAnimationFrame(() => window.scrollTo(0, listScrollY.current));
    }
    prevSelectedRef.current = selectedTranscript;
  }, [selectedTranscript]);

  // Build set of all bit IDs that belong to any touchstone
  const touchstoneBitIds = useMemo(() => {
    const ids = new Set();
    const all = [
      ...(touchstones?.confirmed || []),
      ...(touchstones?.possible || []),
    ];
    for (const ts of all) {
      for (const id of ts.bitIds || []) ids.add(id);
    }
    return ids;
  }, [touchstones]);

  // Count bits that have strong matches to touchstone members but aren't in any touchstone
  const unmatchedCount = useMemo(() => {
    if (!matches || !topics) return 0;
    const seen = new Set();
    for (const m of matches) {
      const mp = m.matchPercentage || (m.confidence || 0) * 100;
      if (mp < 85) continue;
      const rel = m.relationship;
      if (rel !== 'same_bit' && rel !== 'evolved') continue;
      if (touchstoneBitIds.has(m.sourceId) && !touchstoneBitIds.has(m.targetId)) seen.add(m.targetId);
      else if (touchstoneBitIds.has(m.targetId) && !touchstoneBitIds.has(m.sourceId)) seen.add(m.sourceId);
    }
    return seen.size;
  }, [matches, topics, touchstoneBitIds]);

  // Build bit→touchstone and touchstone-by-id maps for timeline coloring
  const { bitToTouchstone, tsById } = useMemo(() => {
    const btMap = new Map();
    const byId = new Map();
    const all = [...(touchstones?.confirmed || []), ...(touchstones?.possible || [])];
    for (const ts of all) {
      byId.set(ts.id, ts);
      for (const inst of (ts.instances || [])) btMap.set(inst.bitId, ts.id);
    }
    return { bitToTouchstone: btMap, tsById: byId };
  }, [touchstones]);

  const connectedBitIds = useMemo(() => {
    return new Set((matches || []).flatMap(m => [m.sourceId, m.targetId]));
  }, [matches]);

  // Pre-compute row data
  const rows = useMemo(() => {
    return transcripts.map((tr) => {
      const bitsParsed = topics.filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id);
      const lastModelRaw = bitsParsed.length > 0
        ? ([...bitsParsed].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]?.parsedWithModel || "unknown")
        : "-";
      const bareGemini = new Set(["pro", "thinking", "flash"]);
      const lastModel = bareGemini.has(lastModelRaw) ? `gemini-${lastModelRaw}` : lastModelRaw;
      const wordCount = tr.text.split(/\s+/).length;

      const textLen = tr.text.length;
      let coveredChars = 0;
      const sorted = [...bitsParsed]
        .filter(b => b.textPosition?.startChar != null && b.textPosition?.endChar != null)
        .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);
      let lastEnd = 0;
      for (const bit of sorted) {
        const s = Math.max(bit.textPosition.startChar, lastEnd);
        const e = bit.textPosition.endChar;
        if (e > s) {
          coveredChars += e - s;
          lastEnd = e;
        }
      }
      // Subtract approved gap chars from denominator so they don't drag coverage down
      let approvedGapChars = 0;
      const prefix = `${tr.name}:`;
      for (const key of (approvedGaps || [])) {
        if (key.startsWith(prefix)) {
          const range = key.slice(prefix.length);
          const [s, e] = range.split("-").map(Number);
          if (!isNaN(s) && !isNaN(e) && e > s) approvedGapChars += e - s;
        }
      }
      const effectiveLen = textLen - approvedGapChars;
      const coverage = effectiveLen > 0 ? Math.min(100, Math.round((coveredChars / effectiveLen) * 100)) : 0;

      const bitsInTouchstone = bitsParsed.filter(b => touchstoneBitIds.has(b.id)).length;
      const touchstonePct = bitsParsed.length > 0 ? Math.round((bitsInTouchstone / bitsParsed.length) * 100) : 0;
      
      const matchedBitIds = new Set((matches || []).flatMap(m => [m.sourceId, m.targetId]));
      const unmatchedCount = bitsParsed.filter(b => !matchedBitIds.has(b.id)).length;
      const unmatchedPct = bitsParsed.length > 0 ? Math.round((unmatchedCount / bitsParsed.length) * 100) : 0;

      const parsed = parseFilenameClient(tr.name);

      // Timeline data for this transcript
      const sortedBits = [...bitsParsed].sort((a, b) => (a.textPosition?.startChar ?? 0) - (b.textPosition?.startChar ?? 0));
      const timelineBits = sortedBits.map((bit) => {
        const wc = bit.fullText ? bit.fullText.trim().split(/\s+/).length : 1;
        const tsId = bitToTouchstone.get(bit.id) || null;
        const ts = tsId ? tsById.get(tsId) : null;
        return {
          id: bit.id,
          title: bit.title || "Untitled",
          wordCount: Math.max(wc, 1),
          tsId,
          tsName: ts?.name || null,
          tsKeyword: ts?.keyword || null,
          tags: bit.tags || [],
          isConnected: connectedBitIds.has(bit.id),
        };
      });
      const totalWords = timelineBits.reduce((s, b) => s + b.wordCount, 0);
      let realDuration = 0;
      if (parsed.duration) {
        const [m, s] = parsed.duration.split(":").map(Number);
        realDuration = (m * 60) + s;
      }
      const timeline = {
        source: tr.name,
        bits: timelineBits,
        totalWords,
        duration: realDuration || (totalWords / WORDS_PER_MINUTE) * 60,
      };

      return { tr, bitsParsed, lastModel, wordCount, coverage, touchstonePct, unmatchedPct, bitsInTouchstone, parsed, timeline };
    });
  }, [transcripts, topics, touchstoneBitIds, matches, approvedGaps]);

  // Filter by search
  const filteredRows = useMemo(() => {
    if (!searchFilter.trim()) return rows;
    const q = searchFilter.toLowerCase();
    return rows.filter(({ tr }) => tr.name.toLowerCase().includes(q));
  }, [rows, searchFilter]);

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortCol) {
        case "file": return dir * (a.parsed.title || a.tr.name).localeCompare(b.parsed.title || b.tr.name, undefined, { numeric: true });
        case "size": return dir * (a.wordCount - b.wordCount);
        case "bits": return dir * (a.bitsParsed.length - b.bitsParsed.length);
        case "model": return dir * (a.lastModel || "").localeCompare(b.lastModel || "");
        case "coverage": return dir * (a.coverage - b.coverage);
        case "touchstones": return dir * (a.touchstonePct - b.touchstonePct);
        case "unmatched": return dir * (a.unmatchedPct - b.unmatchedPct);
        case "rating": return dir * (ratingValue(a.parsed.rating) - ratingValue(b.parsed.rating));
        case "duration": {
          const durSecs = (d) => { if (!d) return 0; const [m, s] = d.split(":").map(Number); return m * 60 + s; };
          return dir * (durSecs(a.parsed.duration) - durSecs(b.parsed.duration));
        }
        default: return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = (col) => {
    const newDir = sortCol === col ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    const newCol = col;
    if (onSortChange) {
      onSortChange(newCol, newDir);
    } else {
      setLocalSortCol(newCol);
      setLocalSortDir(newDir);
    }
  };

  if (transcripts.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{"📄"}</div>
        No transcripts loaded. Upload transcripts in the Upload tab.
      </div>
    );
  }

  const thStyle = (col) => ({
    padding: "10px 6px",
    textAlign: col === "file" ? "left" : "center",
    color: sortCol === col ? "#4ecdc4" : "#888",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "color 0.15s",
    fontSize: 10,
  });

  const sortArrow = (col) => {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const actionBtnStyle = (color, opts = {}) => ({
    padding: "3px 6px",
    background: `${color}18`,
    border: `1px solid ${color}44`,
    color: color,
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: 600,
    cursor: opts.disabled ? "not-allowed" : "pointer",
    marginRight: 3,
    opacity: opts.disabled ? 0.4 : 1,
  });

  // Page view: when a transcript is selected, show full-page MixPanel
  // Always look up from the transcripts array to get the freshest version
  // (selectedTranscript is a separate state ref that goes stale after sync/trim)
  if (selectedTranscript) {
    const freshTranscript = transcripts.find(t => t.id === selectedTranscript.id) || selectedTranscript;
    const selectedParsed = parseFilenameClient(freshTranscript.name);
    const selectedRow = rows.find(r => r.tr.id === freshTranscript.id);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #1e1e30" }}>
          <button
            onClick={() => setSelectedTranscript(null)}
            style={{ background: "none", border: "1px solid #333", color: "#aaa", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
          >
            Back
          </button>
          {onGoToPlay && (
            <button
              onClick={() => onGoToPlay(freshTranscript)}
              style={{ padding: "6px 12px", background: "#6c5ce718", color: "#a78bfa", border: "1px solid #6c5ce733", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >
              Play
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {selectedParsed.rating && (
                <span style={{ ...RATING_FONT, fontSize: 11, padding: "2px 5px", borderRadius: 3, background: ratingColor(selectedParsed.rating).bg, color: ratingColor(selectedParsed.rating).fg }}>
                  {selectedParsed.rating}
                </span>
              )}
              <span style={{ color: "#ddd", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedParsed.title || freshTranscript.name.replace(/\.\w+$/, "")}
              </span>
              {selectedParsed.duration && <span style={{ fontSize: 12, color: "#74c0fc" }}>{selectedParsed.duration}</span>}
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 13, fontWeight: 700, marginTop: 4 }}>
              {selectedRow && <span style={{ color: "#4ecdc4" }}>{selectedRow.bitsParsed.length} bits</span>}
              {selectedRow && selectedRow.bitsParsed.length > 0 && <span style={{ color: selectedRow.coverage >= 80 ? "#51cf66" : selectedRow.coverage >= 50 ? "#ffa94d" : "#ff6b6b" }}>{selectedRow.coverage}% cov</span>}
              {selectedRow && (() => {
                const trBits = topics.filter(t => t.sourceFile === freshTranscript.name || t.transcriptId === freshTranscript.id);
                const allTs = [...(touchstones?.confirmed || []), ...(touchstones?.possible || [])];
                const inTs = trBits.filter(b => allTs.some(ts => (ts.instances || []).some(inst => inst.bitId === b.id))).length;
                if (inTs === 0 || trBits.length === 0) return null;
                const pct = Math.round((inTs / trBits.length) * 100);
                return <span style={{ color: "#a78bfa" }}>{pct}% TS</span>;
              })()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => onHuntTranscript?.(freshTranscript)} disabled={processing || !selectedRow?.bitsParsed.length} style={actionBtnStyle("#da77f2", { disabled: processing || !selectedRow?.bitsParsed.length })}>Hunt</button>
            <ReParseMenu transcript={freshTranscript} processing={processing} reParseTranscript={reParseTranscript} onImportParsedJSON={onImportParsedJSON} actionBtnStyle={actionBtnStyle} selectedModel={selectedModel} />
            <button onClick={() => purgeTranscriptData(freshTranscript)} disabled={processing} style={actionBtnStyle("#ff6b6b", { disabled: processing })}>Purge</button>
          </div>
          {selectedRow?.bitsParsed.length > 0 && selectedRow.lastModel !== "-" && (
            <div style={{ fontSize: 9, color: "#666", marginTop: 2, textAlign: "right" }}>
              parsed with {selectedRow.lastModel}
            </div>
          )}
        </div>
        {/* Set Timeline */}
        {selectedRow && selectedRow.timeline.bits.length > 0 && <PageTimeline
          timeline={selectedRow.timeline}
          onSelectBit={(bitId) => setTimelineScrollBitId(bitId)}
          topics={topics}
        />}

        <MixPanel
          hideHeader
          onGoToPlay={onGoToPlay ? () => onGoToPlay(freshTranscript) : null}
          topics={topics}
          transcripts={transcripts}
          touchstones={touchstones}
          onJoinBits={onJoinBits}
          onSplitBit={onSplitBit}
          onTakeOverlap={onTakeOverlap}
          onDeleteBit={onDeleteBit}
          onScrollBoundary={onScrollBoundary}
          onGenerateTitle={onGenerateTitle}
          onConfirmRename={onConfirmRename}
          onAddPhantomBit={onAddPhantomBit}
          onReParseGap={onReParseGap}
          onViewBitDetail={onViewBitDetail}
          scrollToBitId={timelineScrollBitId}
          onConsumeScrollToBit={() => setTimelineScrollBitId(null)}
          initialTranscript={freshTranscript}
          initialBitId={mixTranscriptInit?.id === freshTranscript.id ? mixBitInit : null}
          initialGap={mixTranscriptInit?.id === freshTranscript.id ? mixGapInit : null}
          onConsumeInitialTranscript={onConsumeMixInit}
          approvedGaps={approvedGaps}
          onApproveGap={onApproveGap}
          onBack={() => setSelectedTranscript(null)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Parse controls */}
      {(() => {
        const unparsedCount = transcripts.filter(
          (tr) => !topics.some((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
        ).length;
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            {parseAll && (
              <button
                className="btn btn-primary"
                onClick={() => parseAll()}
                disabled={processing}
                style={{ padding: "6px 14px", fontSize: 11 }}
              >
                {processing ? "Parsing..." : `Parse All with ${selectedModel}`}
              </button>
            )}
            {parseUnparsed && unparsedCount > 0 && unparsedCount < transcripts.length && (
              <button
                onClick={parseUnparsed}
                disabled={processing}
                style={{
                  padding: "6px 14px", background: "#4ecdc4", color: "#000", border: "none",
                  borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: processing ? "not-allowed" : "pointer",
                }}
              >
                {processing ? "..." : `Process ${unparsedCount} Unparsed`}
              </button>
            )}
            {processing && setShouldStop && (
              <button
                onClick={() => {
                  setShouldStop(true);
                  if (abortControllerRef?.current) abortControllerRef.current.abort();
                }}
                style={{
                  padding: "6px 14px", background: "#ff6b6b", color: "#fff", border: "none",
                  borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                Stop
              </button>
            )}
            {onAbsorbUnmatched && unmatchedCount > 0 && !processing && (
              <button
                onClick={onAbsorbUnmatched}
                style={{
                  padding: "6px 14px", background: "#da77f2", color: "#fff", border: "none",
                  borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                Absorb {unmatchedCount} Unmatched
              </button>
            )}
            {onRemoveOrphans && !processing && (
              <button
                onClick={onRemoveOrphans}
                style={{
                  padding: "6px 14px", background: "#ff6b6b22", color: "#ff6b6b", border: "1px solid #ff6b6b33",
                  borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                Remove Orphans
              </button>
            )}
          </div>
        );
      })()}

      {/* Search bar */}
      <div style={{ marginBottom: 12, position: "relative" }}>
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Filter transcripts by name..."
          style={{
            width: "100%",
            padding: "8px 12px",
            paddingRight: 32,
            background: "#0a0a14",
            border: "1px solid #252538",
            borderRadius: 6,
            color: "#ddd",
            fontSize: 12,
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        {searchFilter && (
          <button
            onClick={() => setSearchFilter("")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
          >
            x
          </button>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ overflow: "visible" }}>
        <table style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "collapse",
          fontSize: "12px",
        }}>
          <colgroup>
            <col />{/* file - takes remaining */}
            <col style={{ width: 66 }} />{/* rating */}
            <col style={{ width: 50 }} />{/* dur */}
            <col style={{ width: 50 }} />{/* size */}
            <col style={{ width: 38 }} />{/* bits */}
            <col style={{ width: 80 }} />{/* model */}
            <col style={{ width: 38 }} />{/* cov */}
            <col style={{ width: 50 }} />{/* ts */}
            <col style={{ width: 50 }} />{/* unmatched */}
            <col style={{ width: 240 }} />{/* actions */}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "2px solid #1e1e30" }}>
              <th style={thStyle("file")} onClick={() => handleSort("file")}>File{sortArrow("file")}</th>
              <th style={{ ...thStyle("rating"), whiteSpace: "nowrap" }} onClick={() => handleSort("rating")}>★{sortArrow("rating")}</th>
              <th style={{ ...thStyle("duration"), whiteSpace: "nowrap" }} onClick={() => handleSort("duration")}>Dur{sortArrow("duration")}</th>
              <th style={{ ...thStyle("size"), whiteSpace: "nowrap" }} onClick={() => handleSort("size")}>Size{sortArrow("size")}</th>
              <th style={{ ...thStyle("bits"), whiteSpace: "nowrap" }} onClick={() => handleSort("bits")}>Bits{sortArrow("bits")}</th>
              <th style={{ ...thStyle("model"), whiteSpace: "nowrap" }} onClick={() => handleSort("model")}>Model{sortArrow("model")}</th>
              <th style={{ ...thStyle("coverage"), whiteSpace: "nowrap" }} onClick={() => handleSort("coverage")}>Cov{sortArrow("coverage")}</th>
              <th style={{ ...thStyle("unmatched"), whiteSpace: "nowrap" }} onClick={() => handleSort("unmatched")}>UNM{sortArrow("unmatched")}</th>
              <th style={{ ...thStyle("touchstones"), whiteSpace: "nowrap" }} onClick={() => handleSort("touchstones")}>TS{sortArrow("touchstones")}</th>
              <th style={{ padding: "10px 6px", textAlign: "center", color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", fontSize: 10, whiteSpace: "nowrap" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ tr, bitsParsed, lastModel, wordCount, coverage, touchstonePct, unmatchedPct, bitsInTouchstone, parsed, timeline }) => {
              return (
                <tr
                  key={tr.id}
                  id={`transcript-row-${tr.id}`}
                  style={{
                    borderBottom: "1px solid #1a1a2a",
                    background: "transparent",
                    transition: "all 0.2s",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#161628"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onClick={() => setSelectedTranscript(tr)}
                >
                  <td
                    title={tr.name}
                    style={{ padding: "10px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                      <span style={{ color: "#ddd", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {parsed.title || tr.name.replace(/\.\w+$/, "")}
                      </span>
                    </div>
                    {timeline.bits.length > 0 && (
                      <div style={{ display: "flex", width: "100%", height: 4, marginTop: 4, borderRadius: 2, overflow: "hidden" }}>
                        {timeline.bits.map((bit) => {
                          const bitDur = bit.wordCount * (timeline.duration / timeline.totalWords);
                          const pct = (bitDur / ROW_DURATION) * 100;
                          let bg;
                          if (bit.tsId) bg = tsColor(bit.tsId);
                          else if (bit.isConnected) bg = "#4ecdc444";
                          else bg = "#1e1e30";
                          return <div key={bit.id} style={{ width: `${pct}%`, minWidth: 1, background: bg }} />;
                        })}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center" }}>
                    {parsed.rating && (
                      <span style={{
                        ...RATING_FONT, fontSize: 10, padding: "1px 5px",
                        borderRadius: 3, letterSpacing: 1,
                        background: ratingColor(parsed.rating).bg,
                        color: ratingColor(parsed.rating).fg,
                      }}>
                        {parsed.rating}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center", color: "#74c0fc", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    {parsed.duration || "-"}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center", color: "#999", fontSize: 11 }}>
                    {wordCount.toLocaleString()}w
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center", color: "#4ecdc4", fontWeight: 600 }}>
                    {bitsParsed.length}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center", fontSize: 9, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lastModel}>
                    {bitsParsed.length > 0 ? lastModel : "-"}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center" }}>
                    {bitsParsed.length > 0 ? (
                      <span style={{
                        color: coverage >= 80 ? "#51cf66" : coverage >= 50 ? "#ffa94d" : "#ff6b6b",
                        fontWeight: 600,
                      }}>
                        {coverage}%
                      </span>
                    ) : (
                      <span style={{ color: "#555" }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center" }}>
                    {bitsParsed.length > 0 ? (
                      <span style={{
                        color: unmatchedPct >= 50 ? "#ff6b6b" : unmatchedPct >= 20 ? "#ffa94d" : "#51cf66",
                        fontWeight: 600,
                      }}>
                        {unmatchedPct}%
                      </span>
                    ) : (
                      <span style={{ color: "#555" }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center" }}>
                    {bitsParsed.length > 0 ? (
                      <span title={`${bitsInTouchstone}/${bitsParsed.length} bits in touchstones`} style={{
                        color: touchstonePct >= 60 ? "#a78bfa" : touchstonePct > 0 ? "#74c0fc" : "#555",
                        fontWeight: 600,
                      }}>
                        {touchstonePct}%
                        <span style={{ color: "#666", fontWeight: 400, fontSize: 9, marginLeft: 3 }}>
                          ({bitsInTouchstone}/{bitsParsed.length})
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: "#555" }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onHuntTranscript?.(tr)}
                      disabled={processing || bitsParsed.length === 0}
                      style={actionBtnStyle("#da77f2", { disabled: processing || bitsParsed.length === 0 })}
                    >
                      Hunt
                    </button>
                    <ReParseMenu transcript={tr} processing={processing} reParseTranscript={reParseTranscript} onImportParsedJSON={onImportParsedJSON} actionBtnStyle={actionBtnStyle} selectedModel={selectedModel} />
                    <button
                      onClick={() => purgeTranscriptData(tr)}
                      disabled={processing}
                      title="Delete parsed bits but keep transcript"
                      style={actionBtnStyle("#ff6b6b", { disabled: processing })}
                    >
                      Purge
                    </button>
                    <button
                      onClick={() => removeTranscript(tr)}
                      disabled={processing}
                      title="Remove transcript and all its bits"
                      style={actionBtnStyle("#ff4444", { disabled: processing })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
