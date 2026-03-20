import React, { useState, useMemo, useEffect, useRef } from "react";
import { MixPanel } from "./MixPanel";
import { parseFilenameClient, ratingColor, ratingValue, RATING_FONT } from "../utils/filenameUtils";

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
function PageTimeline({ timeline, onViewBitDetail, topics }) {
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
                const fullBit = topics.find(t => t.id === bit.id);
                if (fullBit && onViewBitDetail) onViewBitDetail(fullBit);
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
              }}
            />
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
        {hoveredBit?.tsName && <span style={{ color: "#888" }}>· {hoveredBit.tsName}</span>}
        {hoveredBit?.tags?.length > 0 && <span style={{ color: "#555", fontSize: 9 }}>{hoveredBit.tags.slice(0, 3).join(", ")}</span>}
        <span style={{ color: "#444", fontSize: 9, marginLeft: "auto" }}>{hoveredBit?.wordCount || 0}w</span>
      </div>
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
      const lastModel = bitsParsed.length > 0
        ? bitsParsed[bitsParsed.length - 1]?.parsedWithModel || "unknown"
        : "-";
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
        case "file": return dir * a.tr.name.localeCompare(b.tr.name);
        case "size": return dir * (a.wordCount - b.wordCount);
        case "bits": return dir * (a.bitsParsed.length - b.bitsParsed.length);
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
  if (selectedTranscript) {
    const selectedParsed = parseFilenameClient(selectedTranscript.name);
    const selectedRow = rows.find(r => r.tr.id === selectedTranscript.id);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #1e1e30" }}>
          <button
            onClick={() => setSelectedTranscript(null)}
            style={{ background: "none", border: "1px solid #333", color: "#aaa", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
          >
            Back
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#ddd", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedParsed.title || selectedTranscript.name.replace(/\.\w+$/, "")}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#666", marginTop: 2 }}>
              {selectedParsed.rating && (
                <span style={{ ...RATING_FONT, padding: "0 4px", borderRadius: 2, background: ratingColor(selectedParsed.rating).bg, color: ratingColor(selectedParsed.rating).fg }}>
                  {selectedParsed.rating}
                </span>
              )}
              {selectedParsed.duration && <span style={{ color: "#74c0fc" }}>{selectedParsed.duration}</span>}
              {selectedRow && <span>{selectedRow.bitsParsed.length} bits</span>}
              {selectedRow && selectedRow.bitsParsed.length > 0 && <span style={{ color: selectedRow.coverage >= 80 ? "#51cf66" : selectedRow.coverage >= 50 ? "#ffa94d" : "#ff6b6b" }}>{selectedRow.coverage}% coverage</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onHuntTranscript?.(selectedTranscript)} disabled={processing || !selectedRow?.bitsParsed.length} style={actionBtnStyle("#da77f2", { disabled: processing || !selectedRow?.bitsParsed.length })}>Hunt</button>
            <button onClick={() => reParseTranscript(selectedTranscript)} disabled={processing} style={actionBtnStyle("#ffa94d", { disabled: processing })}>Re-parse</button>
            <button onClick={() => purgeTranscriptData(selectedTranscript)} disabled={processing} style={actionBtnStyle("#ff6b6b", { disabled: processing })}>Purge</button>
          </div>
        </div>
        {/* Set Timeline */}
        {selectedRow && selectedRow.timeline.bits.length > 0 && <PageTimeline
          timeline={selectedRow.timeline}
          onViewBitDetail={onViewBitDetail}
          topics={topics}
        />}

        <MixPanel
          onGoToPlay={onGoToPlay ? () => onGoToPlay(selectedTranscript) : null}
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
          initialTranscript={selectedTranscript}
          initialBitId={mixTranscriptInit?.id === selectedTranscript.id ? mixBitInit : null}
          initialGap={mixTranscriptInit?.id === selectedTranscript.id ? mixGapInit : null}
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
        <div style={{ overflowX: "hidden" }}>
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
                    <button
                      onClick={() => reParseTranscript(tr)}
                      disabled={processing}
                      style={actionBtnStyle("#ffa94d", { disabled: processing })}
                    >
                      Re-parse
                    </button>
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
