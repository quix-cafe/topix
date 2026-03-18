import React, { useState, useMemo, useEffect, useRef } from "react";
import { MixPanel } from "./MixPanel";

export function TranscriptTab({
  transcripts,
  topics,
  touchstones,
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
}) {
  const [sortCol, setSortCol] = useState("file");
  const [sortDir, setSortDir] = useState("asc");
  const [searchFilter, setSearchFilter] = useState("");
  const prevSelectedRef = useRef(null);

  // Scroll to transcript row when selectedTranscript changes from external navigation
  useEffect(() => {
    if (selectedTranscript && selectedTranscript !== prevSelectedRef.current) {
      requestAnimationFrame(() => {
        const el = document.getElementById(`transcript-row-${selectedTranscript.id}`);
        if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
      });
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
      const coverage = textLen > 0 ? Math.round((coveredChars / textLen) * 100) : 0;

      const bitsInTouchstone = bitsParsed.filter(b => touchstoneBitIds.has(b.id)).length;
      const touchstonePct = bitsParsed.length > 0 ? Math.round((bitsInTouchstone / bitsParsed.length) * 100) : 0;

      return { tr, bitsParsed, lastModel, wordCount, coverage, touchstonePct, bitsInTouchstone };
    });
  }, [transcripts, topics, touchstoneBitIds]);

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
        case "model": return dir * a.lastModel.localeCompare(b.lastModel);
        default: return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
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

  const actionBtnStyle = (bg, color, opts = {}) => ({
    padding: "3px 6px",
    background: bg,
    border: "none",
    color: color,
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: 600,
    cursor: "pointer",
    marginRight: 3,
    opacity: opts.disabled ? 0.5 : 1,
    ...opts,
  });

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
        <table style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "collapse",
          fontSize: "12px",
        }}>
          <colgroup>
            <col />
            <col style={{ width: 60 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 240 }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "2px solid #1e1e30" }}>
              <th style={thStyle("file")} onClick={() => handleSort("file")}>File{sortArrow("file")}</th>
              <th style={thStyle("size")} onClick={() => handleSort("size")}>Size{sortArrow("size")}</th>
              <th style={thStyle("bits")} onClick={() => handleSort("bits")}>Bits{sortArrow("bits")}</th>
              <th style={thStyle("coverage")} onClick={() => handleSort("coverage")}>Cov{sortArrow("coverage")}</th>
              <th style={thStyle("touchstones")} onClick={() => handleSort("touchstones")}>TS{sortArrow("touchstones")}</th>
              <th style={thStyle("model")} onClick={() => handleSort("model")}>Model{sortArrow("model")}</th>
              <th style={{ padding: "10px 6px", textAlign: "center", color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", fontSize: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ tr, bitsParsed, lastModel, wordCount, coverage, touchstonePct, bitsInTouchstone }) => {
              const isSelected = selectedTranscript?.id === tr.id;

              return (
                <React.Fragment key={tr.id}>
                  <tr
                    id={`transcript-row-${tr.id}`}
                    style={{
                      borderBottom: isSelected ? "none" : "1px solid #1a1a2a",
                      background: isSelected ? "#1a1a2a" : "transparent",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#161628"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <td style={{ padding: "10px 6px", color: "#ddd", fontWeight: 500, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      onClick={() => setSelectedTranscript(isSelected ? null : tr)}
                      title={tr.name}
                    >
                      {tr.name}
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
                    <td style={{ padding: "10px 6px", textAlign: "center", color: "#ffa94d", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
                      {lastModel}
                    </td>
                    <td style={{ padding: "10px 6px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => onHuntTranscript?.(tr)}
                        disabled={processing || bitsParsed.length === 0}
                        style={actionBtnStyle("#da77f2", "#000", { disabled: processing || bitsParsed.length === 0 })}
                      >
                        Hunt
                      </button>
                      <button
                        onClick={() => reParseTranscript(tr)}
                        disabled={processing}
                        style={actionBtnStyle("#ffa94d", "#000", { disabled: processing })}
                      >
                        Re-parse
                      </button>
                      <button
                        onClick={() => purgeTranscriptData(tr)}
                        disabled={processing}
                        title="Delete parsed bits but keep transcript"
                        style={actionBtnStyle("#ff6b6b", "#fff", { disabled: processing })}
                      >
                        Purge
                      </button>
                      <button
                        onClick={() => removeTranscript(tr)}
                        disabled={processing}
                        title="Remove transcript and all its bits"
                        style={actionBtnStyle("#661111", "#ff6b6b", { disabled: processing, border: "1px solid #992222" })}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  {isSelected && (
                    <tr>
                      <td colSpan={7} style={{ padding: "0 4px 12px", background: "#0e0e1a", borderBottom: "1px solid #1a1a2a" }}>
                        {onGoToPlay && (
                          <div style={{ padding: "8px 8px 4px", display: "flex", justifyContent: "flex-end" }}>
                            <button
                              onClick={() => onGoToPlay(tr)}
                              style={{
                                padding: "4px 12px", background: "#6c5ce718", color: "#a78bfa",
                                border: "1px solid #6c5ce733", borderRadius: 6, fontSize: 11,
                                fontWeight: 600, cursor: "pointer",
                              }}
                            >
                              View in Play
                            </button>
                          </div>
                        )}
                        <MixPanel
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
                          initialTranscript={tr}
                          initialBitId={mixTranscriptInit?.id === tr.id ? mixBitInit : null}
                          initialGap={mixTranscriptInit?.id === tr.id ? mixGapInit : null}
                          onConsumeInitialTranscript={onConsumeMixInit}
                          approvedGaps={approvedGaps}
                          onApproveGap={onApproveGap}
                          onBack={() => setSelectedTranscript(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
