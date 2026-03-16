import { useState, useRef, useCallback } from "react";

/**
 * BitEditor - UI for splitting bits into multiple segments
 * Click on text to mark split points, then generate new bits
 */
export function BitEditor({ transcript, bit, onSplitComplete, onCancel }) {
  const [splitPoints, setSplitPoints] = useState([]);
  const [mode, setMode] = useState("split"); // "split" or "preview"
  const textRef = useRef(null);
  // Use the bit's own stored fullText as the source of truth
  const transcriptText = transcript.text.replace(/\n/g, " ");

  const start = bit.textPosition?.startChar || 0;
  const end = bit.textPosition?.endChar || 0;
  const bitText = bit.fullText || transcriptText.substring(start, end);

  // Handle clicks to add split points using Range API for accurate positioning
  const handleTextClick = useCallback((e) => {
    if (mode !== "split") return;

    // Use caretPositionFromPoint or caretRangeFromPoint for accurate char offset
    let charOffset;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (!pos) return;
      charOffset = pos.offset;
      // Walk up to find which text segment we're in
      const node = pos.offsetNode;
      if (node && node.parentElement) {
        const segIdx = node.parentElement.dataset?.segIdx;
        if (segIdx != null) {
          // Calculate offset within the full bitText from segment index + local offset
          const segments = getSegments();
          let cumulative = 0;
          for (let i = 0; i < Number(segIdx); i++) {
            cumulative += segments[i].length;
          }
          charOffset = cumulative + pos.offset;
        }
      }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;
      charOffset = range.startOffset;
      const node = range.startContainer;
      if (node && node.parentElement) {
        const segIdx = node.parentElement.dataset?.segIdx;
        if (segIdx != null) {
          const segments = getSegments();
          let cumulative = 0;
          for (let i = 0; i < Number(segIdx); i++) {
            cumulative += segments[i].length;
          }
          charOffset = cumulative + range.startOffset;
        }
      }
    } else {
      return; // Fallback: can't determine position
    }

    if (charOffset <= 0 || charOffset >= bitText.length) return;

    const globalCharPos = start + charOffset;

    // Snap to nearest word boundary (prefer splitting between words)
    const localPos = charOffset;
    let snapped = localPos;
    // Search within 5 chars for a word boundary
    for (let d = 0; d <= 5; d++) {
      if (localPos + d < bitText.length && /\s/.test(bitText[localPos + d]) && !/\s/.test(bitText[localPos + d - 1] || '')) {
        snapped = localPos + d;
        break;
      }
      if (localPos - d > 0 && /\s/.test(bitText[localPos - d]) && !/\s/.test(bitText[localPos - d + 1] || '')) {
        snapped = localPos - d + 1;
        break;
      }
    }
    const snappedGlobal = start + snapped;

    // Don't add duplicate or near-duplicate split points
    if (splitPoints.some((p) => Math.abs(p - snappedGlobal) < 5)) return;

    setSplitPoints([...splitPoints, snappedGlobal].sort((a, b) => a - b));
  }, [mode, splitPoints, start, bitText]);

  // Get text segments split by current split points (for rendering)
  const getSegments = useCallback(() => {
    const localPoints = splitPoints.map((p) => p - start).filter((p) => p > 0 && p < bitText.length);
    const allPoints = [0, ...localPoints, bitText.length];
    const segments = [];
    for (let i = 0; i < allPoints.length - 1; i++) {
      segments.push(bitText.substring(allPoints[i], allPoints[i + 1]));
    }
    return segments;
  }, [splitPoints, start, bitText]);

  // Generate new bits from split points
  const generateSplitBits = () => {
    if (splitPoints.length === 0) return [bit];

    // Convert global split points to local offsets within bitText
    const localPoints = splitPoints
      .map((p) => p - start)
      .filter((p) => p > 0 && p < bitText.length);
    const allLocalPoints = [0, ...localPoints, bitText.length];
    const newBits = [];

    for (let i = 0; i < allLocalPoints.length - 1; i++) {
      const localStart = allLocalPoints[i];
      const localEnd = allLocalPoints[i + 1];
      const segmentText = bitText.substring(localStart, localEnd).trim();

      if (segmentText.length > 0) {
        newBits.push({
          ...bit,
          id: undefined, // Will be assigned by parent
          title: `${bit.title} [${i + 1}/${allLocalPoints.length - 1}]`,
          summary: `Segment ${i + 1} of split bit`,
          fullText: segmentText,
          textPosition: {
            startChar: start + localStart,
            endChar: start + localEnd,
          },
          editHistory: [
            ...(bit.editHistory || []),
            {
              timestamp: Date.now(),
              action: "split",
              details: { originalBitId: bit.id, segmentNumber: i + 1 },
            },
          ],
        });
      }
    }

    return newBits;
  };

  const segments = getSegments();
  const newBits = mode === "preview" ? generateSplitBits() : [];

  return (
    <div
      style={{
        background: "#12121f",
        border: "1px solid #1e1e30",
        borderRadius: "10px",
        padding: "16px",
        marginTop: "12px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#ffa94d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Split Bit
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          {mode === "split"
            ? "Click on the text to mark split points. Splits snap to word boundaries."
            : `${splitPoints.length} split point(s). ${newBits.length} segment(s) will be created.`}
        </div>
      </div>

      {/* Text preview with split points shown inline */}
      <div
        ref={textRef}
        style={{
          background: "#0a0a14",
          border: "1px solid #1a1a2a",
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "16px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "12px",
          lineHeight: "1.6",
          color: "#bbb",
          cursor: mode === "split" ? "text" : "default",
          userSelect: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        onClick={handleTextClick}
      >
        {segments.map((seg, idx) => (
          <span key={idx}>
            {idx > 0 && (
              <span style={{
                display: "inline-block",
                width: 0,
                borderLeft: "2px solid #ff6b6b",
                height: "1.2em",
                verticalAlign: "text-bottom",
                margin: "0 1px",
                boxShadow: "0 0 4px #ff6b6b88",
              }} />
            )}
            <span
              data-seg-idx={idx}
              style={idx > 0 || splitPoints.length > 0 ? {
                background: `hsla(${(idx * 60 + 160) % 360}, 40%, 20%, 0.3)`,
                borderRadius: 2,
              } : undefined}
            >{seg}</span>
          </span>
        ))}
      </div>

      {/* Split points list */}
      {splitPoints.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8 }}>
            Split points ({splitPoints.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {splitPoints.map((point, idx) => {
              const localOffset = point - start;
              // Show a snippet around the split point
              const before = bitText.substring(Math.max(0, localOffset - 12), localOffset);
              const after = bitText.substring(localOffset, Math.min(bitText.length, localOffset + 12));
              return (
                <div
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    background: "#1a1a2a",
                    borderRadius: "6px",
                    border: "1px solid #ff6b6b44",
                    fontSize: "11px",
                  }}
                >
                  <span style={{ color: "#888", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                    …{before}<span style={{ color: "#ff6b6b", fontWeight: 700 }}>|</span>{after}…
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSplitPoints(splitPoints.filter((_, i) => i !== idx)); }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: "14px",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview of new bits */}
      {mode === "preview" && newBits.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8 }}>
            Preview ({newBits.length} segments)
          </div>
          {newBits.map((newBit, idx) => (
            <div
              key={idx}
              style={{
                padding: "8px",
                background: "#1a1a2a",
                borderRadius: "6px",
                marginBottom: 6,
                borderLeft: "3px solid #4ecdc4",
                fontSize: "11px",
              }}
            >
              <div style={{ fontWeight: 600, color: "#4ecdc4", marginBottom: 2 }}>
                {newBit.title}
              </div>
              <div style={{ color: "#999", fontSize: "10px", marginBottom: 2 }}>
                {newBit.textPosition.endChar - newBit.textPosition.startChar} chars
              </div>
              <div style={{ color: "#666", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {newBit.fullText.substring(0, 120)}{newBit.fullText.length > 120 ? "…" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        {mode === "split" ? (
          <>
            <button
              onClick={() => setMode("preview")}
              disabled={splitPoints.length === 0}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: splitPoints.length > 0 ? "#4ecdc4" : "#333",
                color: splitPoints.length > 0 ? "#000" : "#666",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: splitPoints.length > 0 ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}
            >
              Preview Split
            </button>
            <button
              onClick={onCancel}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: "#1e1e30",
                color: "#ccc",
                border: "1px solid #252538",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                const bitsToCreate = newBits.map((b) => ({ ...b, id: undefined }));
                onSplitComplete(bitsToCreate);
              }}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: "#51cf66",
                color: "#000",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              Create {newBits.length} Segments
            </button>
            <button
              onClick={() => setMode("split")}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: "#1e1e30",
                color: "#ccc",
                border: "1px solid #252538",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
