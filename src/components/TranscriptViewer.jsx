import { useState, useRef, useEffect } from "react";

/**
 * TranscriptViewer - Display transcript with sidebar bit list
 * Sidebar shows all bits as clickable list, click to highlight in transcript
 */

// Todo: see if this is dead code, I believe it was used in an older version.

export function TranscriptViewer({ transcript, bits, onSelectBit, selectedBitId }) {
  const [hoveredBitId, setHoveredBitId] = useState(null);
  const [sortBy, setSortBy] = useState("position"); // "position" or "title"
  const transcriptRef = useRef(null);

  if (!transcript) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
        No transcript selected
      </div>
    );
  }

  // Filter bits belonging to this transcript
  const relevantBits = bits.filter((b) => b.sourceFile === transcript.name);

  // Use the original transcript text — bit positions were computed against it
  const rawText = transcript.text;

  // Create color palette for bits
  const colorPalette = [
    { bg: "#ff6b6b", bgLight: "#ff6b6b20", text: "#ff6b6b" },
    { bg: "#ffa94d", bgLight: "#ffa94d20", text: "#ffa94d" },
    { bg: "#74c0fc", bgLight: "#74c0fc20", text: "#74c0fc" },
    { bg: "#51cf66", bgLight: "#51cf6620", text: "#51cf66" },
    { bg: "#a78bfa", bgLight: "#a78bfa20", text: "#a78bfa" },
    { bg: "#f472b6", bgLight: "#f472b620", text: "#f472b6" },
    { bg: "#22d3ee", bgLight: "#22d3ee20", text: "#22d3ee" },
    { bg: "#fbbf24", bgLight: "#fbbf2420", text: "#fbbf24" },
  ];

  const getBitColor = (bitIndex) => colorPalette[bitIndex % colorPalette.length];

  // Split text into segments: bits and gaps
  // Handle overlapping bits by filtering them out and using the first occurrence
  const segments = [];
  let lastEnd = 0;

  const sortedBits = [...relevantBits]
    .sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));

  // Filter out overlapping bits - keep only non-overlapping ones
  const nonOverlappingBits = [];
  for (const bit of sortedBits) {
    const start = bit.textPosition?.startChar || 0;
    const end = bit.textPosition?.endChar || 0;

    const overlaps = nonOverlappingBits.some(existing => {
      const existStart = existing.textPosition?.startChar || 0;
      const existEnd = existing.textPosition?.endChar || 0;
      return start < existEnd && end > existStart;
    });

    if (!overlaps && start < end && start < rawText.length) {
      nonOverlappingBits.push(bit);
    }
  }

  // Create segments from non-overlapping bits
  nonOverlappingBits.forEach((bit) => {
    const start = bit.textPosition?.startChar || 0;
    const end = Math.min(bit.textPosition?.endChar || 0, rawText.length);

    if (start >= lastEnd) {
      if (start > lastEnd) {
        segments.push({
          type: "gap",
          text: rawText.substring(lastEnd, start),
        });
      }

      segments.push({
        type: "bit",
        text: rawText.substring(start, end),
        bit,
        bitIndex: relevantBits.findIndex(b => b.id === bit.id),
      });
      lastEnd = end;
    }
  });

  // Add final gap
  if (lastEnd < rawText.length) {
    segments.push({
      type: "gap",
      text: rawText.substring(lastEnd),
    });
  }

  // Sort bits by position or title for sidebar
  const sortedRelevantBits = [...relevantBits].sort((a, b) => {
    if (sortBy === "position") {
      return (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0);
    }
    return a.title.localeCompare(b.title);
  });

  // Scroll to bit in transcript when clicked from sidebar
  const scrollToBit = (bitId) => {
    const el = transcriptRef.current?.querySelector(`[data-bit-id="${bitId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        background: "#0a0a14",
        border: "1px solid #1e1e30",
        borderRadius: "10px",
        overflow: "hidden",
        height: "70vh",
      }}
    >
      {/* Left: Bits sidebar — independent scroll */}
      {relevantBits.length > 0 && (
        <div
          style={{
            width: "280px",
            minWidth: "280px",
            display: "flex",
            flexDirection: "column",
            background: "#12121f",
            borderRight: "1px solid #1e1e30",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #1e1e30",
              fontSize: "11px",
              flexShrink: 0,
            }}
          >
            <div style={{ color: "#888", fontWeight: 600, marginBottom: 8 }}>
              BITS ({relevantBits.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setSortBy("position")}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: sortBy === "position" ? "#ff6b6b" : "#1e1e30",
                  color: sortBy === "position" ? "#fff" : "#888",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "10px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Position
              </button>
              <button
                onClick={() => setSortBy("title")}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: sortBy === "title" ? "#ff6b6b" : "#1e1e30",
                  color: sortBy === "title" ? "#fff" : "#888",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "10px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Name
              </button>
            </div>
          </div>

          {/* Bits list — scrolls independently */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px",
            }}
          >
            {sortedRelevantBits.map((bit) => {
              const color = getBitColor(
                relevantBits.findIndex((b) => b.id === bit.id)
              );
              const isSelected = selectedBitId === bit.id;
              const isHovered = hoveredBitId === bit.id;
              const charCount =
                (bit.textPosition?.endChar || 0) -
                (bit.textPosition?.startChar || 0);

              return (
                <div
                  key={bit.id}
                  onClick={() => { onSelectBit(bit); scrollToBit(bit.id); }}
                  onMouseEnter={() => setHoveredBitId(bit.id)}
                  onMouseLeave={() => setHoveredBitId(null)}
                  style={{
                    padding: "10px 12px",
                    marginBottom: "8px",
                    background: isSelected
                      ? color.bg
                      : isHovered
                        ? color.bgLight
                        : "transparent",
                    border: `1px solid ${isSelected ? color.text : color.bgLight}`,
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: isSelected ? "#fff" : color.text,
                      marginBottom: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {bit.title}
                  </div>
                  <div
                    style={{
                      fontSize: "9px",
                      color: isSelected ? "rgba(255,255,255,0.6)" : "#666",
                      lineHeight: "1.4",
                    }}
                  >
                    <div>{charCount} chars</div>
                    {bit.tags?.length > 0 && (
                      <div
                        style={{
                          marginTop: "4px",
                          display: "flex",
                          gap: "3px",
                          flexWrap: "wrap",
                        }}
                      >
                        {(bit.tags || []).slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            style={{
                              background: isSelected
                                ? "rgba(0,0,0,0.3)"
                                : "rgba(255,255,255,0.1)",
                              padding: "1px 4px",
                              borderRadius: "2px",
                              fontSize: "8px",
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Center: Transcript content — scrolls independently */}
      <div
        ref={transcriptRef}
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
            lineHeight: "1.8",
            color: "#bbb",
            padding: "12px 16px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {segments.map((segment, idx) => {
            if (segment.type === "gap") {
              return (
                <span key={idx} style={{ color: "#555" }}>
                  {segment.text}
                </span>
              );
            }

            const color = getBitColor(segment.bitIndex);
            const isSelected = selectedBitId === segment.bit.id;
            const isHovered = hoveredBitId === segment.bit.id;

            return (
              <span
                key={idx}
                data-bit-id={segment.bit.id}
                onClick={() => onSelectBit(segment.bit)}
                onMouseEnter={() => setHoveredBitId(segment.bit.id)}
                onMouseLeave={() => setHoveredBitId(null)}
                style={{
                  background: isSelected ? color.bg : isHovered ? color.bgLight : color.bgLight,
                  color: isSelected || isHovered ? color.text : "#bbb",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  padding: "2px 4px",
                  borderRadius: "3px",
                  textDecoration: isSelected ? "underline" : "none",
                  fontWeight: isSelected ? 600 : "normal",
                  borderLeft: `2px solid ${color.bg}`,
                }}
                title={segment.bit.title}
              >
                {segment.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
