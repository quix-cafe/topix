import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { uid } from "../utils/ollama";
import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";

/**
 * MixPanel - Intuitive join/split interface for bits within transcripts.
 * Bits are sorted by their position in the transcript so adjacent bits
 * are visually next to each other, making join/split decisions obvious.
 *
 * - Click a bit to select/deselect it
 * - Selected bits show their full text inline
 * - Multiple selected bits highlight overlapping regions
 * - "View" toggles expanded full text without leaving the page
 */
export function MixPanel({ topics, transcripts, touchstones, onJoinBits, onSplitBit, onTakeOverlap, onDeleteBit, onScrollBoundary, onGenerateTitle, onConfirmRename, onAddPhantomBit, onReParseGap, onViewBitDetail, initialTranscript, initialBitId, initialGap, onConsumeInitialTranscript, approvedGaps, onApproveGap, onBack, onGoToPlay, hideHeader, scrollToBitId, onConsumeScrollToBit }) {
  const [selectedTranscript, setSelectedTranscript] = useState(null);

  const [pendingScrollBitId, setPendingScrollBitId] = useState(null);
  const [pendingScrollGap, setPendingScrollGap] = useState(null);

  // Accept pre-selected transcript from parent (e.g. clicking from Upload tab)
  useEffect(() => {
    if (!initialTranscript) return;
    setSelectedTranscript(initialTranscript);
    if (initialBitId) {
      setSelectedIds(new Set([initialBitId]));
      setExpandedIds(new Set([initialBitId]));
      setPendingScrollBitId(initialBitId);
    } else {
      setSelectedIds(new Set());
      setExpandedIds(new Set());
    }
    if (initialGap) {
      setPendingScrollGap(initialGap);
    }
    onConsumeInitialTranscript?.();
  }, [initialTranscript]);

  // Timeline click: scroll to and select a bit
  useEffect(() => {
    if (!scrollToBitId) return;
    setSelectedIds(new Set([scrollToBitId]));
    setExpandedIds((prev) => new Set(prev).add(scrollToBitId));
    setPendingScrollBitId(scrollToBitId);
    onConsumeScrollToBit?.();
  }, [scrollToBitId]);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [joinTitle, setJoinTitle] = useState("");
  const mixRootRef = useRef(null);
  const [joinBarRect, setJoinBarRect] = useState(null);
  useEffect(() => {
    if (!mixRootRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = mixRootRef.current?.getBoundingClientRect();
      if (r) setJoinBarRect({ left: r.left, width: r.width });
    });
    ro.observe(mixRootRef.current);
    return () => ro.disconnect();
  }, [selectedTranscript]);
  // renamePending: { [bitId]: { loading: bool, suggested: string|null } }
  const [renamePending, setRenamePending] = useState({});
  // Track which phantom gaps are expanded and which are being added
  const [expandedGaps, setExpandedGaps] = useState(new Set());
  const [addingGaps, setAddingGaps] = useState(new Set());
  const [reparsingGaps, setReparsingGaps] = useState(new Set());

  // Get transcripts that have bits
  const transcriptsWithBits = useMemo(() => {
    const sourceFiles = new Set(topics.map((t) => t.sourceFile));
    return transcripts.filter((tr) => sourceFiles.has(tr.name));
  }, [topics, transcripts]);

  // Get bits for selected transcript, sorted by position
  // Build map of bitId -> touchstone name for display
  const bitTouchstoneMap = useMemo(() => {
    const map = new Map();
    const allTs = [...(touchstones?.confirmed || []), ...(touchstones?.possible || [])];
    for (const ts of allTs) {
      for (const id of ts.bitIds || []) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push({ name: ts.name, category: ts.category });
      }
    }
    return map;
  }, [touchstones]);

  const sortedBits = useMemo(() => {
    if (!selectedTranscript) return [];
    return topics
      .filter((t) => t.sourceFile === selectedTranscript.name)
      .sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));
  }, [topics, selectedTranscript]);

  // Scroll to a bit after the DOM has rendered it
  useEffect(() => {
    if (!pendingScrollBitId || sortedBits.length === 0) return;
    if (!sortedBits.some((b) => b.id === pendingScrollBitId)) return;
    // Bits are now in sortedBits — wait for DOM paint then scroll
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`mix-bit-${pendingScrollBitId}`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        setPendingScrollBitId(null);
      });
    });
  }, [pendingScrollBitId, sortedBits]);

  // Arrow key navigation — use functional setState to avoid stale closure on rapid presses
  useEffect(() => {
    if (!selectedTranscript || sortedBits.length === 0) return;
    const bits = sortedBits; // capture current snapshot
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();

      setSelectedIds((prev) => {
        const currentIdx = bits.findIndex((b) => prev.has(b.id));
        let nextIdx;
        if (e.key === "ArrowDown") {
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, bits.length - 1);
        } else {
          nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        }
        const el = document.getElementById(`mix-bit-${bits[nextIdx].id}`);
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return new Set([bits[nextIdx].id]);
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTranscript, sortedBits]);

  // Detect gaps and overlaps between adjacent bits (including trailing gap after last bit)
  const bitAnalysis = useMemo(() => {
    const analysis = [];
    const textLen = selectedTranscript?.text?.length || 0;
    for (let i = 0; i < sortedBits.length; i++) {
      const bit = sortedBits[i];
      const next = sortedBits[i + 1];
      let gapInfo = null;
      if (next) {
        const gapStart = bit.textPosition?.endChar || 0;
        const gapEnd = next.textPosition?.startChar || 0;
        const gapSize = gapEnd - gapStart;
        if (gapSize < 0) {
          gapInfo = { type: "overlap", chars: Math.abs(gapSize) };
        } else if (gapSize <= 10) {
          gapInfo = { type: "adjacent", chars: gapSize };
        } else {
          gapInfo = { type: "gap", chars: gapSize, gapStart, gapEnd };
        }
      } else if (textLen > 0) {
        // Trailing gap after last bit
        const gapStart = bit.textPosition?.endChar || 0;
        const trailingSize = textLen - gapStart;
        if (trailingSize > 10) {
          gapInfo = { type: "trailing", chars: trailingSize, gapStart, gapEnd: textLen };
        }
      }
      analysis.push({ bit, gapInfo, index: i });
    }
    return analysis;
  }, [sortedBits, selectedTranscript]);

  // Auto-expand and scroll to a gap when navigating from ValidationTab
  useEffect(() => {
    if (!pendingScrollGap || bitAnalysis.length === 0) return;
    const { gapStart, gapEnd } = pendingScrollGap;
    // Find matching gap key
    let targetKey = null;
    // Check leading gap
    if (sortedBits.length > 0) {
      const firstStart = sortedBits[0].textPosition?.startChar || 0;
      if (gapStart === 0 && gapEnd === firstStart) targetKey = "leading";
    }
    // Check inter-bit gaps
    if (!targetKey) {
      for (const { gapInfo, index } of bitAnalysis) {
        if (gapInfo && gapInfo.gapStart === gapStart && gapInfo.gapEnd === gapEnd) {
          targetKey = `${index}`;
          break;
        }
      }
    }
    // Check trailing gap
    if (!targetKey && sortedBits.length > 0) {
      const lastEnd = sortedBits[sortedBits.length - 1].textPosition?.endChar || 0;
      if (gapStart === lastEnd) targetKey = "trailing";
    }
    if (targetKey) {
      setExpandedGaps((prev) => new Set(prev).add(targetKey));
      requestAnimationFrame(() => {
        const el = document.getElementById(`mix-gap-${targetKey}`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
    setPendingScrollGap(null);
  }, [pendingScrollGap, bitAnalysis]);

  const selectedBits = sortedBits.filter((b) => selectedIds.has(b.id));

  // Build overlap ranges for selected bits, tracking which bits are involved
  const overlapData = useMemo(() => {
    if (selectedBits.length < 2) return { ranges: [], byBitId: {} };
    const ranges = selectedBits
      .filter((b) => b.textPosition && b.textPosition.endChar > b.textPosition.startChar)
      .map((b) => ({ start: b.textPosition.startChar, end: b.textPosition.endChar, id: b.id }))
      .sort((a, b) => a.start - b.start);

    const overlaps = [];
    const byBitId = {}; // bitId -> [{start, end, otherBitId}]
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const oStart = Math.max(ranges[i].start, ranges[j].start);
        const oEnd = Math.min(ranges[i].end, ranges[j].end);
        if (oEnd > oStart) {
          overlaps.push({ start: oStart, end: oEnd, bitIds: [ranges[i].id, ranges[j].id] });
          if (!byBitId[ranges[i].id]) byBitId[ranges[i].id] = [];
          if (!byBitId[ranges[j].id]) byBitId[ranges[j].id] = [];
          byBitId[ranges[i].id].push({ start: oStart, end: oEnd, otherBitId: ranges[j].id });
          byBitId[ranges[j].id].push({ start: oStart, end: oEnd, otherBitId: ranges[i].id });
        }
      }
    }
    return { ranges: overlaps, byBitId };
  }, [selectedBits]);

  const overlapRanges = overlapData.ranges;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectRange = (fromIdx, toIdx) => {
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    const ids = new Set();
    for (let i = start; i <= end; i++) {
      ids.add(sortedBits[i].id);
    }
    setSelectedIds(ids);
  };

  // Handle "take" — this bit claims the overlapping text, shrinking conflicting bits
  const handleTake = (takerId) => {
    const overlaps = overlapData.byBitId[takerId];
    if (!overlaps || overlaps.length === 0) return;

    const takerBit = sortedBits.find((b) => b.id === takerId);
    if (!takerBit) return;

    const conflictingUpdates = [];
    for (const overlap of overlaps) {
      const otherBit = sortedBits.find((b) => b.id === overlap.otherBitId);
      if (!otherBit || !otherBit.textPosition) continue;

      const otherStart = otherBit.textPosition.startChar;
      const otherEnd = otherBit.textPosition.endChar;
      const takerStart = takerBit.textPosition?.startChar || 0;
      const takerEnd = takerBit.textPosition?.endChar || 0;

      let newStart = otherStart;
      let newEnd = otherEnd;

      // If the taker's range covers the start of the other bit, push other's start forward
      if (takerStart <= otherStart && takerEnd > otherStart && takerEnd < otherEnd) {
        newStart = takerEnd;
      }
      // If the taker's range covers the end of the other bit, pull other's end back
      else if (takerStart > otherStart && takerStart < otherEnd && takerEnd >= otherEnd) {
        newEnd = takerStart;
      }
      // If the taker completely contains the other bit, shrink to nothing
      else if (takerStart <= otherStart && takerEnd >= otherEnd) {
        newStart = otherEnd;
        newEnd = otherEnd;
      }
      // If the taker is fully inside the other bit, split: keep the larger side
      else if (takerStart > otherStart && takerEnd < otherEnd) {
        const leftSize = takerStart - otherStart;
        const rightSize = otherEnd - takerEnd;
        if (leftSize >= rightSize) {
          newEnd = takerStart;
        } else {
          newStart = takerEnd;
        }
      }

      if (newStart !== otherStart || newEnd !== otherEnd) {
        // Check we haven't already added this bit
        if (!conflictingUpdates.some((u) => u.id === otherBit.id)) {
          conflictingUpdates.push({
            id: otherBit.id,
            newPosition: { startChar: newStart, endChar: newEnd },
          });
        }
      }
    }

    if (conflictingUpdates.length > 0 && onTakeOverlap) {
      onTakeOverlap(takerId, conflictingUpdates);
    }
  };

  // Check if selected bits can be joined
  const canJoin = useMemo(() => {
    if (selectedBits.length < 2) return false;
    const sorted = [...selectedBits].sort(
      (a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0)
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = (sorted[i + 1].textPosition?.startChar || 0) - (sorted[i].textPosition?.endChar || 0);
      if (gap > 500) return false;
    }
    return true;
  }, [selectedBits]);

  const handleJoin = () => {
    if (!canJoin || !selectedTranscript) return;
    const sorted = [...selectedBits].sort(
      (a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0)
    );
    const startChar = sorted[0].textPosition?.startChar || 0;
    const endChar = sorted[sorted.length - 1].textPosition?.endChar || 0;
    const fullText = selectedTranscript.text.replace(/\n/g, " ").substring(startChar, endChar);
    const allTags = [...new Set(sorted.flatMap((b) => b.tags || []))];
    const allKeywords = [...new Set(sorted.flatMap((b) => b.keywords || []))].slice(0, 8);

    const joinedBit = {
      id: uid(),
      title: joinTitle || sorted.map((b) => b.title).join(" + "),
      summary: sorted.map((b) => b.summary).join(" "),
      fullText,
      tags: allTags,
      keywords: allKeywords,
      textPosition: { startChar, endChar },
      sourceFile: selectedTranscript.name,
      transcriptId: selectedTranscript.id,
      editHistory: [{
        timestamp: Date.now(),
        action: "join",
        details: { joinedBitIds: sorted.map((b) => b.id), mergedFrom: sorted.length },
      }],
    };

    onJoinBits(sorted, joinedBit);
    setSelectedIds(new Set());
    setJoinTitle("");
  };

  /**
   * Render full text with overlap regions highlighted.
   * overlapRanges are in original-text coordinates.
   * bit.textPosition maps the bit's text into original coordinates.
   */
  const renderFullText = (bit) => {
    const text = bit.fullText || "";
    if (!text) return null;

    const bitStart = bit.textPosition?.startChar || 0;

    // Find overlaps that intersect this bit's range
    const relevant = overlapRanges.filter(
      (o) => o.start < (bit.textPosition?.endChar || 0) && o.end > bitStart
    );

    if (relevant.length === 0) {
      return <span>{text}</span>;
    }

    // Convert overlap ranges from original-text coords to bit-local coords
    const localOverlaps = relevant
      .map((o) => ({
        start: Math.max(0, o.start - bitStart),
        end: Math.min(text.length, o.end - bitStart),
      }))
      .filter((o) => o.end > o.start)
      .sort((a, b) => a.start - b.start);

    // Build segments: normal text and highlighted overlaps
    const parts = [];
    let cursor = 0;
    for (const overlap of localOverlaps) {
      if (overlap.start > cursor) {
        parts.push({ text: text.substring(cursor, overlap.start), highlight: false });
      }
      parts.push({ text: text.substring(overlap.start, overlap.end), highlight: true });
      cursor = overlap.end;
    }
    if (cursor < text.length) {
      parts.push({ text: text.substring(cursor), highlight: false });
    }

    return (
      <span>
        {parts.map((p, i) =>
          p.highlight ? (
            <mark
              key={i}
              style={{
                background: "#ff6b6b33",
                color: "#ff8888",
                borderRadius: 2,
                padding: "0 1px",
              }}
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </span>
    );
  };

  // Transcript selector
  if (!selectedTranscript) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 16, textTransform: "uppercase", letterSpacing: 1 }}>
          Select a transcript to mix
        </div>
        {transcriptsWithBits.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
            <div style={{ fontSize: 14, color: "#888" }}>No parsed transcripts yet.</div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Upload and parse transcripts to get started.</div>
          </div>
        ) : (
          transcriptsWithBits.map((tr) => {
            const bitCount = topics.filter((t) => t.sourceFile === tr.name).length;
            return (
              <div
                key={tr.id}
                className="card"
                onClick={() => { setSelectedTranscript(tr); setSelectedIds(new Set()); setExpandedIds(new Set()); }}
                style={{ cursor: "pointer" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#eee", fontSize: 14 }}>{tr.name}</div>
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                      {bitCount} bit{bitCount !== 1 ? "s" : ""} &middot; {Math.round(tr.text.length / 1000)}K chars
                    </div>
                  </div>
                  <span style={{ color: "#4ecdc4", fontSize: 12, fontWeight: 600 }}>Mix &rarr;</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Should a bit show its full text? Yes if it's selected OR manually expanded
  const shouldShowText = (id) => selectedIds.has(id) || expandedIds.has(id);

  return (
    <div ref={mixRootRef}>
      {/* Header — hidden when parent provides its own */}
      {!hideHeader ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <button
              onClick={() => { if (onBack) { onBack(); } else { setSelectedTranscript(null); setSelectedIds(new Set()); setExpandedIds(new Set()); } }}
              style={{
                background: "none", border: "none", color: "#ffa94d",
                fontSize: 13, cursor: "pointer", fontWeight: 600, padding: 0,
              }}
            >
              &larr; Back
            </button>
            <div style={{ margin: "8px 0 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {(() => {
                const p = parseFilenameClient(selectedTranscript.name);
                const rc = ratingColor(p.rating);
                return (
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#eee", margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {p.rating && <span style={{ ...RATING_FONT, fontSize: 11, padding: "2px 5px", borderRadius: 3, background: rc.bg, color: rc.fg }}>{p.rating}</span>}
                    <span>{p.title}</span>
                    {p.duration && <span style={{ fontSize: 12, color: "#74c0fc", fontWeight: 400 }}>{p.duration}</span>}
                  </h3>
                );
              })()}
              {onGoToPlay && (
                <button
                  onClick={onGoToPlay}
                  style={{
                    padding: "3px 10px", background: "#6c5ce718", color: "#a78bfa",
                    border: "1px solid #6c5ce733", borderRadius: 4, fontSize: 10,
                    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  Play
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 6, display: "flex", alignItems: "left", gap: 6 }}>
              <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "left" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4ecdc4" }}>{sortedBits.length} bits</span>
                {(() => {
                  const textLen = selectedTranscript.text?.length || 0;
                  if (!textLen || sortedBits.length === 0) return null;
                  let coveredChars = 0, lastEnd = 0;
                  const positioned = sortedBits.filter(b => b.textPosition?.startChar != null && b.textPosition?.endChar != null);
                  for (const bit of positioned) {
                    const s = Math.max(bit.textPosition.startChar, lastEnd);
                    const e = bit.textPosition.endChar;
                    if (e > s) { coveredChars += e - s; lastEnd = e; }
                  }
                  const cov = Math.round((coveredChars / textLen) * 100);
                  return <span style={{ fontSize: 13, fontWeight: 700, color: cov >= 80 ? "#51cf66" : cov >= 50 ? "#ffa94d" : "#ff6b6b" }}>{cov}% cov</span>;
                })()}
                {(() => {
                  const inTs = sortedBits.filter(b => (bitTouchstoneMap.get(b.id) || []).length > 0).length;
                  if (inTs === 0) return null;
                  const pct = Math.round((inTs / sortedBits.length) * 100);
                  return <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{pct}% TS</span>;
                })()}
              </span>
            </div>
          </div>
          {selectedBits.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#4ecdc4", marginBottom: 4 }}>
                {selectedBits.length} selected
                {overlapRanges.length > 0 && (
                  <span style={{ color: "#ff6b6b", marginLeft: 6 }}>
                    {overlapRanges.length} overlap{overlapRanges.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  background: "none", border: "1px solid #333", color: "#888",
                  fontSize: 10, cursor: "pointer", borderRadius: 4, padding: "4px 8px",
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      ) : selectedBits.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#4ecdc4" }}>
              {selectedBits.length} selected
              {overlapRanges.length > 0 && (
                <span style={{ color: "#ff6b6b", marginLeft: 6 }}>
                  {overlapRanges.length} overlap{overlapRanges.length !== 1 ? "s" : ""}
                </span>
              )}
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                background: "none", border: "1px solid #333", color: "#888",
                fontSize: 10, cursor: "pointer", borderRadius: 4, padding: "4px 8px",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {/* Join bar — fixed to viewport top */}
      {selectedBits.length >= 2 && (
        <>
        <div style={{ height: 52 }} /> {/* spacer for fixed bar */}
        <div style={{
          padding: 12, background: canJoin ? "#1a2a1a" : "#2a1f1f",
          border: `1px solid ${canJoin ? "#2a3a2a" : "#3a2020"}`,
          borderRadius: "0 0 8px 8px", display: "flex", alignItems: "center", gap: 12,
          position: "fixed", top: 0, zIndex: 1000,
          left: joinBarRect ? joinBarRect.left : 0,
          width: joinBarRect ? joinBarRect.width : "100%",
          boxSizing: "border-box",
        }}>
          {canJoin ? (
            <>
              <input
                type="text"
                value={joinTitle}
                onChange={(e) => setJoinTitle(e.target.value)}
                placeholder={`Join ${selectedBits.length} bits — optional title`}
                style={{
                  flex: 1, padding: "8px 12px", background: "#0a0a14",
                  border: "1px solid #1a1a2a", borderRadius: 6, color: "#ddd",
                  fontSize: 12, fontFamily: "inherit",
                }}
              />
              <button
                onClick={handleJoin}
                style={{
                  padding: "8px 20px", background: "#51cf66", color: "#000",
                  border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Join {selectedBits.length} bits
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  padding: "8px 14px", background: "none", color: "#888",
                  border: "1px solid #333", borderRadius: 6, fontSize: 12,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Clear selection
              </button>
            </>
          ) : (
            <>
              <div style={{ color: "#ff8888", fontSize: 11, flex: 1 }}>
                Selected bits are too far apart to join. Select adjacent or nearby bits.
              </div>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  padding: "8px 14px", background: "none", color: "#888",
                  border: "1px solid #333", borderRadius: 6, fontSize: 12,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Clear selection
              </button>
            </>
          )}
        </div>
        </>
      )}

      {/* Leading gap — text before first bit */}
      {selectedTranscript && sortedBits.length > 0 && (() => {
        const firstStart = sortedBits[0].textPosition?.startChar || 0;
        if (firstStart <= 10) return null;
        const gapKey = "leading";
        const isGapExpanded = expandedGaps.has(gapKey);
        const isAdding = addingGaps.has(gapKey);
        const gapText = isGapExpanded ? selectedTranscript.text.substring(0, firstStart).trim() : "";
        const leadApproveKey = `${selectedTranscript.name}:0-${firstStart}`;
        const isLeadApproved = (approvedGaps || []).includes(leadApproveKey);
        return (
          <div id={`mix-gap-${gapKey}`}>
            <div
              style={{ display: "flex", alignItems: "center", padding: "2px 12px", fontSize: 10, color: "#c4b5fd", cursor: "pointer" }}
              onClick={() => setExpandedGaps((prev) => { const next = new Set(prev); if (next.has(gapKey)) next.delete(gapKey); else next.add(gapKey); return next; })}
            >
              <div style={{ flex: 1, height: 1, background: "#c4b5fd33" }} />
              <span style={{ padding: "0 8px" }}>{firstStart} char gap (start) {isGapExpanded ? "▾" : "▸"}{isLeadApproved && <span style={{ color: "#51cf66", marginLeft: 6, fontSize: 13, fontWeight: 700 }}>✓</span>}</span>
              <div style={{ flex: 1, height: 1, background: "#c4b5fd33" }} />
            </div>
            {isGapExpanded && gapText && (
              <div style={{ margin: "4px 12px", padding: 12, background: "#0d0a1a", border: "1px dashed #c4b5fd33", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>{gapText}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    disabled={isAdding}
                    onClick={() => {
                      if (!onAddPhantomBit || isAdding) return;
                      setAddingGaps((prev) => new Set(prev).add(gapKey));
                      onAddPhantomBit(gapText, 0, firstStart, selectedTranscript.name, selectedTranscript.id)
                        .then(() => { setAddingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); setExpandedGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); })
                        .catch(() => { setAddingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); });
                    }}
                    style={{ padding: "6px 14px", background: isAdding ? "#333" : "#c4b5fd22", color: isAdding ? "#888" : "#c4b5fd", border: `1px solid ${isAdding ? "#333" : "#c4b5fd44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isAdding ? "default" : "pointer" }}
                  >{isAdding ? "Adding..." : "Add as bit"}</button>
                  {onReParseGap && (() => { const isReparsing = reparsingGaps.has(gapKey); return (
                    <button
                      disabled={isReparsing}
                      onClick={() => {
                        if (isReparsing) return;
                        setReparsingGaps((prev) => new Set(prev).add(gapKey));
                        onReParseGap(gapText, 0, firstStart, selectedTranscript.name, selectedTranscript.id)
                          .then(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); setExpandedGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); })
                          .catch(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); });
                      }}
                      style={{ padding: "6px 14px", background: isReparsing ? "#333" : "#ffa94d18", color: isReparsing ? "#888" : "#ffa94d", border: `1px solid ${isReparsing ? "#333" : "#ffa94d44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isReparsing ? "default" : "pointer" }}
                    >{isReparsing ? "Re-parsing..." : "Re-parse"}</button>
                  ); })()}
                  {onApproveGap && (() => {
                    const approveKey = `${selectedTranscript.name}:0-${firstStart}`;
                    const isApproved = (approvedGaps || []).includes(approveKey);
                    if (isApproved) return <button onClick={() => onApproveGap(approveKey)} style={{ padding: "6px 12px", background: "#ff6b6b22", border: "1px solid #ff6b6b44", color: "#ff6b6b", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}>Unapprove</button>;
                    return (
                      <button
                        onClick={() => onApproveGap(approveKey)}
                        style={{ padding: "6px 12px", background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                      >Approve Gap</button>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Bit list sorted by position */}
      <div>
        {bitAnalysis.map(({ bit, gapInfo, index }) => {
          const isSelected = selectedIds.has(bit.id);
          const isExpanded = shouldShowText(bit.id);
          const charSpan = (bit.textPosition?.endChar || 0) - (bit.textPosition?.startChar || 0);

          return (
            <div key={bit.id} id={`mix-bit-${bit.id}`}>
              {/* Bit card */}
              <div
                className="card"
                onClick={(e) => {
                  if (e.shiftKey && selectedIds.size > 0) {
                    const lastIdx = sortedBits.findIndex((b) => selectedIds.has(b.id));
                    if (lastIdx >= 0) selectRange(lastIdx, index);
                  } else {
                    toggleSelect(bit.id);
                  }
                }}
                style={{
                  cursor: "pointer",
                  borderLeft: isSelected ? "3px solid #51cf66" : "3px solid transparent",
                  background: isSelected ? "#0d1a0d" : undefined,
                  marginBottom: 0,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  {onViewBitDetail && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewBitDetail(bit); }}
                      title="Open bit detail panel"
                      style={{
                        background: "#74c0fc12", border: "1px solid #74c0fc44", color: "#74c0fc",
                        borderRadius: 4, padding: "4px 5px", fontSize: 9, cursor: "pointer",
                        fontWeight: 600, whiteSpace: "nowrap", alignSelf: "stretch",
                        display: "flex", alignItems: "center", marginRight: 6, flexShrink: 0,
                      }}
                    >
                      &#x25B6;
                    </button>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace",
                        minWidth: 50,
                      }}>
                        {bit.textPosition?.startChar || 0}-{bit.textPosition?.endChar || 0}
                      </span>
                      <span style={{ fontWeight: 600, color: "#ddd", fontSize: 13 }}>
                        {bit.title}
                      </span>
                      {onConfirmRename && !renamePending[bit.id] && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamePending((prev) => ({ ...prev, [bit.id]: { loading: false, suggested: bit.title || "" } }));
                          }}
                          title="Rename this bit"
                          style={{
                            background: "none", border: "1px solid #333", color: "#c4b5fd",
                            borderRadius: 4, padding: "2px 6px", fontSize: 9, cursor: "pointer",
                            whiteSpace: "nowrap", fontWeight: 600,
                          }}
                        >
                          Rename
                        </button>
                      )}
                    </div>
                    {!isExpanded && bit.summary && (
                      <div style={{
                        fontSize: 11, color: "#777", marginTop: 4, lineHeight: 1.4,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {bit.summary}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#74c0fc", fontFamily: "'JetBrains Mono', monospace" }}>{charSpan} chars</span>
                      {(() => {
                        const secs = Math.round(charSpan / 15); // ~15 chars/sec at speaking pace
                        const mm = String(Math.floor(secs / 60)).padStart(2, "0");
                        const ss = String(secs % 60).padStart(2, "0");
                        return <span style={{ fontSize: 10, color: "#74c0fc", fontFamily: "'JetBrains Mono', monospace" }}>~{mm}:{ss}</span>;
                      })()}
                      {(bitTouchstoneMap.get(bit.id) || []).map((ts, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
                          background: ts.category === "confirmed" ? "#51cf6618" : "#ffa94d18",
                          color: ts.category === "confirmed" ? "#51cf66" : "#ffa94d",
                        }}>
                          {ts.name}
                        </span>
                      ))}
                    </div>
                    {/* Rename confirm/edit/cancel */}
                    {renamePending[bit.id] && !renamePending[bit.id].loading && renamePending[bit.id].suggested != null && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <input
                          type="text"
                          value={renamePending[bit.id].suggested}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRenamePending((prev) => ({ ...prev, [bit.id]: { ...prev[bit.id], suggested: val } }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const title = renamePending[bit.id].suggested.trim();
                              if (title) onConfirmRename(bit.id, title);
                              setRenamePending((prev) => { const next = { ...prev }; delete next[bit.id]; return next; });
                            } else if (e.key === "Escape") {
                              setRenamePending((prev) => { const next = { ...prev }; delete next[bit.id]; return next; });
                            }
                          }}
                          autoFocus
                          style={{
                            flex: 1, padding: "4px 8px", background: "#0a0a14",
                            border: "1px solid #c4b5fd44", borderRadius: 4, color: "#c4b5fd",
                            fontSize: 12, fontFamily: "inherit", minWidth: 0,
                          }}
                        />
                        <button
                          onClick={() => {
                            const title = renamePending[bit.id].suggested.trim();
                            if (title) onConfirmRename(bit.id, title);
                            setRenamePending((prev) => { const next = { ...prev }; delete next[bit.id]; return next; });
                          }}
                          style={{
                            background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66",
                            borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600,
                          }}
                        >
                          OK
                        </button>
                        <button
                          onClick={() => setRenamePending((prev) => { const next = { ...prev }; delete next[bit.id]; return next; })}
                          style={{
                            background: "none", border: "1px solid #333", color: "#888",
                            borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginLeft: 8, flexShrink: 0, alignItems: "stretch" }}>
                    {/* Boundary scroll +/- */}
                    {isSelected && onScrollBoundary && (sortedBits[index + 1] || gapInfo?.type === "trailing") && (
                      <div style={{ display: "flex", gap: 3, marginRight: 4 }}>
                        {[[-10, "−10"], [-1, "−"], [1, "+"], [10, "+10"]].map(([delta, label]) => (
                          <button
                            key={delta}
                            onClick={(e) => { e.stopPropagation(); onScrollBoundary(bit.id, sortedBits[index + 1]?.id || null, delta); }}
                            title={delta < 0 ? `Give ${Math.abs(delta)} word${Math.abs(delta) > 1 ? 's' : ''} to ${sortedBits[index + 1] ? 'next bit' : 'gap'}` : `Take ${delta} word${delta > 1 ? 's' : ''} from ${sortedBits[index + 1] ? 'next bit' : 'gap'}`}
                            style={{
                              background: "none",
                              border: `1px solid ${delta < 0 ? '#ffa94d44' : '#51cf6644'}`,
                              color: delta < 0 ? "#ffa94d" : "#51cf66",
                              borderRadius: 4,
                              padding: Math.abs(delta) > 1 ? "6px 6px" : "6px 10px",
                              fontSize: Math.abs(delta) > 1 ? 10 : 13,
                              cursor: "pointer",
                              fontWeight: 700,
                              lineHeight: 1,
                              minWidth: 28,
                              minHeight: 28,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {isSelected && overlapData.byBitId[bit.id] && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTake(bit.id);
                        }}
                        title="Claim overlapping text from other selected bits"
                        style={{
                          background: "#ffa94d18", border: "1px solid #ffa94d44",
                          color: "#ffa94d", borderRadius: 4, padding: "12px 8px",
                          fontSize: 10, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
                          display: "flex", alignItems: "center",
                        }}
                      >
                        Take
                      </button>
                    )}
                    {isSelected && onDeleteBit && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (bit.fullText?.trim() && !confirm(`Remove "${bit.title}"?`)) return;
                          onDeleteBit(bit.id);
                          setSelectedIds((prev) => { const next = new Set(prev); next.delete(bit.id); return next; });
                          setExpandedIds((prev) => { const next = new Set(prev); next.delete(bit.id); return next; });
                        }}
                        title="Remove this bit"
                        style={{
                          background: "#ff6b6b22", border: "1px solid #ff6b6b44",
                          color: "#ff8888", borderRadius: 4, padding: "12px 8px",
                          fontSize: 10, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
                          display: "flex", alignItems: "center",
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {onViewBitDetail && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewBitDetail(bit); }}
                        title="Open bit detail panel"
                        style={{
                          background: "#74c0fc12", border: "1px solid #74c0fc44", color: "#74c0fc",
                          borderRadius: 4, padding: "6px 8px", fontSize: 10, cursor: "pointer",
                          fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center",
                        }}
                      >
                        Detail
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded full text */}
                {isExpanded && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      marginTop: 10, padding: 12, background: "#0a0a14",
                      borderRadius: 6, border: "1px solid #1a1a2a",
                      fontSize: 12, color: "#bbb", lineHeight: 1.6,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      maxHeight: 400, overflowY: "auto",
                      cursor: "text", userSelect: "text",
                    }}
                  >
                    {renderFullText(bit)}
                  </div>
                )}
              </div>

              {/* Gap indicator between bits */}
              {gapInfo && gapInfo.type !== "trailing" && (() => {
                const gapKey = `${index}`;
                const isPhantom = gapInfo.type === "gap" && gapInfo.chars > 10;
                const isGapExpanded = expandedGaps.has(gapKey);
                const isAdding = addingGaps.has(gapKey);
                const gapText = isPhantom && isGapExpanded && selectedTranscript
                  ? selectedTranscript.text.substring(gapInfo.gapStart, gapInfo.gapEnd).trim()
                  : "";
                const gapApproveKey = isPhantom && selectedTranscript ? `${selectedTranscript.name}:${gapInfo.gapStart}-${gapInfo.gapEnd}` : null;
                const isGapApproved = gapApproveKey && (approvedGaps || []).includes(gapApproveKey);

                return (
                  <div id={`mix-gap-${gapKey}`}>
                    <div
                      style={{
                        display: "flex", alignItems: "center", padding: "2px 12px",
                        fontSize: 10,
                        color: gapInfo.type === "overlap" ? "#ff6b6b" : gapInfo.type === "adjacent" ? "#51cf66" : "#c4b5fd",
                        cursor: isPhantom ? "pointer" : undefined,
                      }}
                      onClick={isPhantom ? () => {
                        setExpandedGaps((prev) => {
                          const next = new Set(prev);
                          if (next.has(gapKey)) next.delete(gapKey); else next.add(gapKey);
                          return next;
                        });
                      } : undefined}
                    >
                      <div style={{
                        flex: 1, height: 1,
                        background: gapInfo.type === "overlap" ? "#ff6b6b33" : gapInfo.type === "adjacent" ? "#51cf6633" : "#c4b5fd33",
                      }} />
                      <span style={{ padding: "0 8px" }}>
                        {gapInfo.type === "overlap" ? `${gapInfo.chars} char overlap` :
                         gapInfo.type === "adjacent" ? `${gapInfo.chars} chars` :
                         `${gapInfo.chars} char gap ${isGapExpanded ? "▾" : "▸"}`}
                        {isPhantom && isGapApproved && <span style={{ color: "#51cf66", marginLeft: 6, fontSize: 13, fontWeight: 700 }}>✓</span>}
                      </span>
                      <div style={{
                        flex: 1, height: 1,
                        background: gapInfo.type === "overlap" ? "#ff6b6b33" : gapInfo.type === "adjacent" ? "#51cf6633" : "#c4b5fd33",
                      }} />
                    </div>
                    {isPhantom && isGapExpanded && gapText && (
                      <div style={{
                        margin: "4px 12px 4px 12px", padding: 12,
                        background: "#0d0a1a", border: "1px dashed #c4b5fd33",
                        borderRadius: 8,
                      }}>
                        <div style={{
                          fontSize: 12, color: "#999", lineHeight: 1.6,
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                          maxHeight: 200, overflowY: "auto",
                          fontFamily: "'JetBrains Mono', monospace",
                          marginBottom: 8,
                        }}>
                          {gapText}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            disabled={isAdding}
                            onClick={() => {
                              if (!onAddPhantomBit || isAdding) return;
                              setAddingGaps((prev) => new Set(prev).add(gapKey));
                              onAddPhantomBit(
                                gapText,
                                gapInfo.gapStart,
                                gapInfo.gapEnd,
                                selectedTranscript.name,
                                selectedTranscript.id,
                              ).then(() => {
                                setAddingGaps((prev) => { const next = new Set(prev); next.delete(gapKey); return next; });
                                setExpandedGaps((prev) => { const next = new Set(prev); next.delete(gapKey); return next; });
                              }).catch(() => {
                                setAddingGaps((prev) => { const next = new Set(prev); next.delete(gapKey); return next; });
                              });
                            }}
                            style={{
                              padding: "6px 14px", background: isAdding ? "#333" : "#c4b5fd22",
                              color: isAdding ? "#888" : "#c4b5fd", border: `1px solid ${isAdding ? "#333" : "#c4b5fd44"}`,
                              borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isAdding ? "default" : "pointer",
                            }}
                          >
                            {isAdding ? "Adding..." : "Add as bit"}
                          </button>
                          {onReParseGap && (() => { const isReparsing = reparsingGaps.has(gapKey); return (
                            <button
                              disabled={isReparsing}
                              onClick={() => {
                                if (isReparsing) return;
                                setReparsingGaps((prev) => new Set(prev).add(gapKey));
                                onReParseGap(gapText, gapInfo.gapStart, gapInfo.gapEnd, selectedTranscript.name, selectedTranscript.id)
                                  .then(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); setExpandedGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); })
                                  .catch(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); });
                              }}
                              style={{ padding: "6px 14px", background: isReparsing ? "#333" : "#ffa94d18", color: isReparsing ? "#888" : "#ffa94d", border: `1px solid ${isReparsing ? "#333" : "#ffa94d44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isReparsing ? "default" : "pointer" }}
                            >{isReparsing ? "Re-parsing..." : "Re-parse"}</button>
                          ); })()}
                          {onApproveGap && isPhantom && (() => {
                            const approveKey = `${selectedTranscript.name}:${gapInfo.gapStart}-${gapInfo.gapEnd}`;
                            const isApproved = (approvedGaps || []).includes(approveKey);
                            if (isApproved) return <button onClick={() => onApproveGap(approveKey)} style={{ padding: "6px 12px", background: "#ff6b6b22", border: "1px solid #ff6b6b44", color: "#ff6b6b", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}>Unapprove</button>;
                            return (
                              <button
                                onClick={() => onApproveGap(approveKey)}
                                style={{ padding: "6px 12px", background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                              >Approve Gap</button>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* Trailing gap — text after last bit */}
        {selectedTranscript && sortedBits.length > 0 && (() => {
          const lastEnd = sortedBits[sortedBits.length - 1].textPosition?.endChar || 0;
          const cleanText = selectedTranscript.text.replace(/\n/g, " ");
          const trailingSize = cleanText.length - lastEnd;
          if (trailingSize <= 10) return null;
          const gapKey = "trailing";
          const isGapExpanded = expandedGaps.has(gapKey);
          const isAdding = addingGaps.has(gapKey);
          const gapText = isGapExpanded ? cleanText.substring(lastEnd).trim() : "";
          const trailApproveKey = `${selectedTranscript.name}:${lastEnd}-${cleanText.length}`;
          const isTrailApproved = (approvedGaps || []).includes(trailApproveKey);
          return (
            <div id={`mix-gap-${gapKey}`}>
              <div
                style={{ display: "flex", alignItems: "center", padding: "2px 12px", fontSize: 10, color: "#c4b5fd", cursor: "pointer" }}
                onClick={() => setExpandedGaps((prev) => { const next = new Set(prev); if (next.has(gapKey)) next.delete(gapKey); else next.add(gapKey); return next; })}
              >
                <div style={{ flex: 1, height: 1, background: "#c4b5fd33" }} />
                <span style={{ padding: "0 8px" }}>{trailingSize} char gap (end) {isGapExpanded ? "▾" : "▸"}{isTrailApproved && <span style={{ color: "#51cf66", marginLeft: 6, fontSize: 13, fontWeight: 700 }}>✓</span>}</span>
                <div style={{ flex: 1, height: 1, background: "#c4b5fd33" }} />
              </div>
              {isGapExpanded && gapText && (
                <div style={{ margin: "4px 12px", padding: 12, background: "#0d0a1a", border: "1px dashed #c4b5fd33", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>{gapText}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      disabled={isAdding}
                      onClick={() => {
                        if (!onAddPhantomBit || isAdding) return;
                        setAddingGaps((prev) => new Set(prev).add(gapKey));
                        onAddPhantomBit(gapText, lastEnd, cleanText.length, selectedTranscript.name, selectedTranscript.id)
                          .then(() => { setAddingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); setExpandedGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); })
                          .catch(() => { setAddingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); });
                      }}
                      style={{ padding: "6px 14px", background: isAdding ? "#333" : "#c4b5fd22", color: isAdding ? "#888" : "#c4b5fd", border: `1px solid ${isAdding ? "#333" : "#c4b5fd44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isAdding ? "default" : "pointer" }}
                    >{isAdding ? "Adding..." : "Add as bit"}</button>
                    {onReParseGap && (() => { const isReparsing = reparsingGaps.has(gapKey); return (
                      <button
                        disabled={isReparsing}
                        onClick={() => {
                          if (isReparsing) return;
                          setReparsingGaps((prev) => new Set(prev).add(gapKey));
                          onReParseGap(gapText, lastEnd, cleanText.length, selectedTranscript.name, selectedTranscript.id)
                            .then(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); setExpandedGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); })
                            .catch(() => { setReparsingGaps((prev) => { const n = new Set(prev); n.delete(gapKey); return n; }); });
                        }}
                        style={{ padding: "6px 14px", background: isReparsing ? "#333" : "#ffa94d18", color: isReparsing ? "#888" : "#ffa94d", border: `1px solid ${isReparsing ? "#333" : "#ffa94d44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: isReparsing ? "default" : "pointer" }}
                      >{isReparsing ? "Re-parsing..." : "Re-parse"}</button>
                    ); })()}
                    {onApproveGap && (() => {
                      const approveKey = `${selectedTranscript.name}:${lastEnd}-${cleanText.length}`;
                      const isApproved = (approvedGaps || []).includes(approveKey);
                      if (isApproved) return <button onClick={() => onApproveGap(approveKey)} style={{ padding: "6px 12px", background: "#ff6b6b22", border: "1px solid #ff6b6b44", color: "#ff6b6b", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}>Unapprove</button>;
                      return (
                        <button
                          onClick={() => onApproveGap(approveKey)}
                          style={{ padding: "6px 12px", background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
                        >Approve Gap</button>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
