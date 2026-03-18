import { useState, useMemo, useCallback } from "react";
import { validateAllBits, autoCorrectPosition } from "../utils/textContinuityValidator";

/**
 * ValidationTab - Shows all bit validation issues with rectification UI
 */
export function ValidationTab({
  topics,
  transcripts,
  touchstones,
  onUpdateBitPosition,
  onGoToMix,
  onSelectBit,
  approvedGaps,
  onApproveGap,
}) {
  const [expandedIssue, setExpandedIssue] = useState(null);
  const [autoFixing, setAutoFixing] = useState(null);
  const [filter, setFilter] = useState("all"); // "all", "overlap", "mismatch", "missing", "bounds", "gap", "join"

  // Build transcript map
  const transcriptMap = useMemo(() => {
    const map = {};
    transcripts.forEach((tr) => {
      map[tr.name] = tr;
      map[tr.id] = tr;
    });
    return map;
  }, [transcripts]);

  // Run validation
  const validation = useMemo(
    () => validateAllBits(topics, transcripts),
    [topics, transcripts]
  );

  // Detect significant gaps in transcript coverage
  const gapIssues = useMemo(() => {
    const MIN_GAP_CHARS = 100; // Only show gaps >= 100 chars
    const gaps = [];
    const approvedSet = new Set(approvedGaps || []);
    for (const tr of transcripts) {
      const trBits = topics
        .filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
        .filter((t) => t.textPosition && t.textPosition.endChar > t.textPosition.startChar)
        .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);
      if (trBits.length === 0) continue;
      const cleanText = tr.text.replace(/\n/g, " ");
      // Leading gap
      const firstStart = trBits[0].textPosition.startChar;
      if (firstStart >= MIN_GAP_CHARS) {
        const gapKey = `${tr.name}:0-${firstStart}`;
        gaps.push({
          bitId: null, bitTitle: `Gap in "${tr.name}"`, source: tr.name,
          error: `Uncovered gap: chars 0-${firstStart} (${firstStart} chars)`,
          severity: firstStart, type: "gap", gapStart: 0, gapEnd: firstStart,
          gapKey, approved: approvedSet.has(gapKey),
          gapPreview: cleanText.substring(0, Math.min(firstStart, 200)),
        });
      }
      // Inter-bit gaps
      for (let i = 0; i < trBits.length - 1; i++) {
        const gapStart = trBits[i].textPosition.endChar;
        const gapEnd = trBits[i + 1].textPosition.startChar;
        const gapSize = gapEnd - gapStart;
        if (gapSize >= MIN_GAP_CHARS) {
          const gapKey = `${tr.name}:${gapStart}-${gapEnd}`;
          gaps.push({
            bitId: trBits[i].id, bitTitle: `Gap after "${trBits[i].title}"`, source: tr.name,
            error: `Uncovered gap: chars ${gapStart}-${gapEnd} (${gapSize} chars)`,
            severity: gapSize, type: "gap", gapStart, gapEnd,
            gapKey, approved: approvedSet.has(gapKey),
            gapPreview: cleanText.substring(gapStart, Math.min(gapEnd, gapStart + 200)),
          });
        }
      }
      // Trailing gap
      const lastEnd = trBits[trBits.length - 1].textPosition.endChar;
      const trailingSize = cleanText.length - lastEnd;
      if (trailingSize >= MIN_GAP_CHARS) {
        const gapKey = `${tr.name}:${lastEnd}-${cleanText.length}`;
        gaps.push({
          bitId: null, bitTitle: `Gap at end of "${tr.name}"`, source: tr.name,
          error: `Uncovered gap: chars ${lastEnd}-${cleanText.length} (${trailingSize} chars)`,
          severity: trailingSize, type: "gap", gapStart: lastEnd, gapEnd: cleanText.length,
          gapKey, approved: approvedSet.has(gapKey),
          gapPreview: cleanText.substring(lastEnd, Math.min(cleanText.length, lastEnd + 200)),
        });
      }
    }
    return gaps;
  }, [topics, transcripts, approvedGaps]);

  // Detect adjacent bits in the same transcript that belong to the same touchstone
  const joinSuggestions = useMemo(() => {
    const allTs = [
      ...(touchstones?.confirmed || []),
      ...(touchstones?.possible || []),
    ];
    if (allTs.length === 0) return [];

    // Build bitId → touchstone(s) lookup
    const bitToTouchstones = new Map();
    for (const ts of allTs) {
      for (const bitId of ts.bitIds || []) {
        if (!bitToTouchstones.has(bitId)) bitToTouchstones.set(bitId, []);
        bitToTouchstones.get(bitId).push(ts);
      }
    }

    const suggestions = [];

    for (const tr of transcripts) {
      // Get bits for this transcript, sorted by position
      const trBits = topics
        .filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
        .filter((t) => t.textPosition && t.textPosition.startChar != null)
        .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);

      if (trBits.length < 2) continue;

      // For each touchstone, find runs of adjacent bits
      const touchstoneRuns = new Map(); // tsId → array of bit indices in trBits

      for (let i = 0; i < trBits.length; i++) {
        const bitTs = bitToTouchstones.get(trBits[i].id) || [];
        for (const ts of bitTs) {
          if (!touchstoneRuns.has(ts.id)) touchstoneRuns.set(ts.id, []);
          touchstoneRuns.get(ts.id).push(i);
        }
      }

      for (const [tsId, indices] of touchstoneRuns) {
        if (indices.length < 2) continue;
        const ts = allTs.find((t) => t.id === tsId);

        // Find runs of consecutive indices (adjacent in transcript order)
        let runStart = 0;
        for (let i = 1; i <= indices.length; i++) {
          if (i < indices.length && indices[i] === indices[i - 1] + 1) continue;
          // End of a run: indices[runStart..i-1]
          const runLen = i - runStart;
          if (runLen >= 2) {
            const runBits = [];
            for (let j = runStart; j < i; j++) {
              runBits.push(trBits[indices[j]]);
            }
            const titles = runBits.map((b) => `"${b.title}"`).join(", ");
            suggestions.push({
              bitId: runBits[0].id,
              bitTitle: `Join ${runLen} adjacent bits`,
              source: tr.name,
              error: `${runLen} adjacent bits all match touchstone "${ts.name || ts.manualName || "unnamed"}": ${titles}`,
              severity: runLen * 100,
              type: "join",
              joinBitIds: runBits.map((b) => b.id),
              touchstoneName: ts.name || ts.manualName || "unnamed",
              touchstoneId: tsId,
            });
          }
          runStart = i;
        }
      }
    }

    return suggestions;
  }, [topics, transcripts, touchstones]);

  // Categorize issues (excluding trivial ones <= 10 chars)
  const categorized = useMemo(() => {
    const cats = { overlap: [], mismatch: [], missing: [], bounds: [], gap: [], join: [] };
    (validation.issues || []).filter((issue) => (issue.severity || 0) > 10).forEach((issue) => {
      if (issue.error.includes("Overlaps with")) cats.overlap.push(issue);
      else if (issue.error.includes("mismatch") || issue.error.includes("similarity")) cats.mismatch.push(issue);
      else if (issue.error.includes("not found") || issue.error.includes("No position")) cats.missing.push(issue);
      else cats.bounds.push(issue);
    });
    cats.gap = gapIssues.filter((g) => !g.approved);
    cats.join = joinSuggestions;
    return cats;
  }, [validation, gapIssues, joinSuggestions]);

  const allIssues = useMemo(() => {
    const base = (validation.issues || []).filter((issue) => (issue.severity || 0) > 10);
    const unapprovedGaps = gapIssues.filter((g) => !g.approved);
    return [...base, ...unapprovedGaps, ...joinSuggestions];
  }, [validation, gapIssues, joinSuggestions]);

  const filteredIssues = (filter === "all"
    ? allIssues
    : categorized[filter] || [])
    .sort((a, b) => (b.severity || 0) - (a.severity || 0));

  const handleAutoFix = async (issue) => {
    const bit = topics.find((t) => t.id === issue.bitId);
    if (!bit) return;

    const transcript = transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId];
    if (!transcript) return;

    setAutoFixing(issue.bitId);
    const cleanText = transcript.text.replace(/\n/g, " ");
    const corrected = autoCorrectPosition(bit, cleanText);

    if (corrected) {
      await onUpdateBitPosition(issue.bitId, corrected);
    }
    setAutoFixing(null);
  };

  const categoryColors = {
    overlap: { bg: "#ff6b6b", label: "Overlap" },
    mismatch: { bg: "#ffa94d", label: "Text Mismatch" },
    missing: { bg: "#a78bfa", label: "Missing Data" },
    bounds: { bg: "#74c0fc", label: "Bounds Error" },
    gap: { bg: "#c4b5fd", label: "Gap" },
    join: { bg: "#4ecdc4", label: "Join" },
  };

  const getIssueCategory = (issue) => {
    if (issue.type === "join") return "join";
    if (issue.type === "gap") return "gap";
    if (issue.error.includes("Overlaps with")) return "overlap";
    if (issue.error.includes("mismatch") || issue.error.includes("similarity")) return "mismatch";
    if (issue.error.includes("not found") || issue.error.includes("No position")) return "missing";
    return "bounds";
  };

  if (topics.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
        No bits to validate. Parse some transcripts first.
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 0",
        borderBottom: "1px solid #1e1e30",
        marginBottom: 16,
      }}>
        <div style={{
          fontSize: 24,
          color: filteredIssues.length === 0 ? "#4ecdc4" : "#ff6b6b",
        }}>
          {filteredIssues.length === 0 ? "\u2713" : "\u26A0"}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: filteredIssues.length === 0 ? "#4ecdc4" : "#ff6b6b" }}>
            {filteredIssues.length === 0
              ? "All bits valid"
              : `${filteredIssues.length} issue${filteredIssues.length !== 1 ? "s" : ""} found`}
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {validation.summary.total} bits total across {transcripts.length} transcript{transcripts.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Category counts */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.entries(categoryColors).map(([key, { bg, label }]) => {
            const count = categorized[key].length;
            if (count === 0) return null;
            return (
              <div
                key={key}
                onClick={() => setFilter(filter === key ? "all" : key)}
                style={{
                  padding: "4px 10px",
                  background: filter === key ? bg : `${bg}20`,
                  color: filter === key ? "#000" : bg,
                  borderRadius: "12px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {count} {label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues list */}
      {filteredIssues.length === 0 && filter !== "all" && (
        <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>
          No issues in this category
        </div>
      )}

      {filteredIssues.length === 0 && filter === "all" && (
        <div style={{ textAlign: "center", padding: 40, color: "#4ecdc4", fontSize: 13 }}>
          All {validation.summary.total} bits pass validation checks.
        </div>
      )}

      {filteredIssues.map((issue, idx) => {
        const bit = topics.find((t) => t.id === issue.bitId);
        const category = getIssueCategory(issue);
        const catColor = categoryColors[category];
        const isExpanded = expandedIssue === idx;
        const canAutoFix = category === "mismatch" || category === "bounds";
        const transcript = bit
          ? transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId]
          : issue.source ? transcriptMap[issue.source] : null;

        return (
          <div
            key={`${issue.bitId}-${idx}`}
            style={{
              background: "#12121f",
              border: `1px solid ${isExpanded ? catColor.bg : "#1e1e30"}`,
              borderRadius: "8px",
              marginBottom: 8,
              overflow: "hidden",
              transition: "all 0.15s",
            }}
          >
            {/* Issue header */}
            <div
              onClick={() => setExpandedIssue(isExpanded ? null : idx)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                cursor: "pointer",
              }}
            >
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: catColor.bg,
                flexShrink: 0,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#ddd",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {issue.bitTitle || "Unknown bit"}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                  {issue.error}
                  {issue.severity && issue.severity !== Infinity && (
                    <span style={{ color: "#ff6b6b", marginLeft: 6, fontWeight: 600 }}>
                      {issue.severity} chars
                    </span>
                  )}
                </div>
              </div>

              {issue.source && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const tr = transcripts.find((t) => t.name === issue.source);
                    if (tr) onGoToMix(tr, issue.bitId, issue.type === "gap" ? { gapStart: issue.gapStart, gapEnd: issue.gapEnd } : null);
                  }}
                  style={{
                    padding: "3px 8px",
                    background: "#1e1e30",
                    borderRadius: "4px",
                    fontSize: 10,
                    color: "#74c0fc",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  title="View in mix"
                >
                  {issue.source}
                </div>
              )}

              <span style={{
                fontSize: 10,
                color: catColor.bg,
                background: `${catColor.bg}20`,
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {catColor.label}
              </span>

              <span style={{ color: "#666", fontSize: 10 }}>
                {isExpanded ? "\u25B2" : "\u25BC"}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (bit || category === "gap" || category === "join") && (
              <div style={{
                padding: "0 16px 16px",
                borderTop: "1px solid #1e1e30",
              }}>
                {/* Bit info — only for non-gap issues */}
                {bit && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginTop: 12,
                    fontSize: 11,
                  }}>
                    <div>
                      <div style={{ color: "#666", marginBottom: 4 }}>Position</div>
                      <div style={{ color: "#ddd", fontFamily: "'JetBrains Mono', monospace" }}>
                        {bit.textPosition
                          ? `${bit.textPosition.startChar} - ${bit.textPosition.endChar} (${bit.textPosition.endChar - bit.textPosition.startChar} chars)`
                          : "No position data"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#666", marginBottom: 4 }}>Source</div>
                      <div style={{ color: "#ddd" }}>{bit.sourceFile || "unknown"}</div>
                    </div>
                  </div>
                )}

                {/* Text preview */}
                {bit && bit.fullText && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Stored text (first 200 chars)</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#bbb",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 80,
                      overflow: "hidden",
                    }}>
                      {bit.fullText.substring(0, 200)}{bit.fullText.length > 200 ? "..." : ""}
                    </div>
                  </div>
                )}

                {/* Transcript text at position */}
                {bit && transcript && bit.textPosition && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Text at position (first 200 chars)</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#ffa94d",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 80,
                      overflow: "hidden",
                    }}>
                      {transcript.text.replace(/\n/g, " ").substring(
                        bit.textPosition.startChar,
                        Math.min(bit.textPosition.endChar, bit.textPosition.startChar + 200)
                      )}
                      {(bit.textPosition.endChar - bit.textPosition.startChar) > 200 ? "..." : ""}
                    </div>
                  </div>
                )}

                {/* Gap preview */}
                {category === "gap" && issue.gapPreview && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Gap text preview</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#c4b5fd",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 120,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}>
                      {issue.gapPreview}{issue.gapEnd - issue.gapStart > 200 ? "..." : ""}
                    </div>
                  </div>
                )}

                {/* Join suggestion detail */}
                {category === "join" && issue.joinBitIds && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 6 }}>
                      Adjacent bits matching touchstone "{issue.touchstoneName}"
                    </div>
                    {issue.joinBitIds.map((jbId) => {
                      const jb = topics.find((t) => t.id === jbId);
                      if (!jb) return null;
                      return (
                        <div
                          key={jbId}
                          style={{
                            background: "#0a0a14",
                            padding: "6px 12px",
                            borderRadius: "4px",
                            marginBottom: 4,
                            fontSize: 11,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ color: "#4ecdc4", fontWeight: 600, flexShrink: 0 }}>
                            {jb.textPosition ? `${jb.textPosition.startChar}-${jb.textPosition.endChar}` : "?"}
                          </span>
                          <span style={{ color: "#ddd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {jb.title}
                          </span>
                          <span
                            onClick={() => onSelectBit(jb)}
                            style={{ color: "#74c0fc", cursor: "pointer", fontSize: 10, flexShrink: 0 }}
                          >
                            detail
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ color: "#888", fontSize: 10, marginTop: 4 }}>
                      These bits are sequential in the transcript and all belong to the same touchstone.
                      Joining them will merge their text and titles into a single bit.
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {canAutoFix && (
                    <button
                      onClick={() => handleAutoFix(issue)}
                      disabled={autoFixing === issue.bitId}
                      style={{
                        padding: "6px 12px",
                        background: "#4ecdc4",
                        border: "none",
                        color: "#000",
                        borderRadius: "4px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: autoFixing === issue.bitId ? 0.5 : 1,
                      }}
                    >
                      {autoFixing === issue.bitId ? "Fixing..." : "Auto-fix Position"}
                    </button>
                  )}

                  {category === "gap" && onApproveGap && (
                    <button
                      onClick={() => onApproveGap(issue.gapKey)}
                      style={{
                        padding: "6px 12px",
                        background: "#51cf6622",
                        border: "1px solid #51cf6644",
                        color: "#51cf66",
                        borderRadius: "4px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Approve Gap
                    </button>
                  )}

                  {bit && (
                    <button
                      onClick={() => onSelectBit(bit)}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #2a2a40",
                        color: "#ccc",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View Detail
                    </button>
                  )}

                  {transcript && (
                    <button
                      onClick={() => onGoToMix(transcript, issue.bitId, issue.type === "gap" ? { gapStart: issue.gapStart, gapEnd: issue.gapEnd } : null)}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #2a2a40",
                        color: "#74c0fc",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View in Mix
                    </button>
                  )}

                  {category === "join" && issue.joinBitIds && (
                    <button
                      onClick={() => {
                        const tr = transcripts.find((t) => t.name === issue.source);
                        if (tr) onGoToMix(tr, issue.joinBitIds[0]);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "#4ecdc422",
                        border: "1px solid #4ecdc444",
                        color: "#4ecdc4",
                        borderRadius: "4px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Join in Mix
                    </button>
                  )}

                  {category === "overlap" && issue.overlappingBitId && (
                    <button
                      onClick={() => {
                        const otherBit = topics.find((t) => t.id === issue.overlappingBitId);
                        if (otherBit) onSelectBit(otherBit);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #ff6b6b40",
                        color: "#ff6b6b",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View Overlapping Bit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
