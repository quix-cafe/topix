import { useState, useMemo } from "react";
import { findWordBoundary } from "../utils/ollama";

/**
 * BoundaryAdjuster - Interactive UI for adjusting bit position boundaries
 * Shows before/current/after context with sliders for fine-tuning
 */
export function BoundaryAdjuster({ transcript, bit, onSave, onCancel }) {
  // Clean transcript text (replace newlines with spaces, matching how it was sent to the model)
  const transcriptText = transcript.text.replace(/\n/g, " ");
  const [startOffset, setStartOffset] = useState(0);
  const [endOffset, setEndOffset] = useState(0);
  const [snapToWords, setSnapToWords] = useState(true);

  const originalStart = bit.textPosition?.startChar || 0;
  const originalEnd = bit.textPosition?.endChar || 0;

  // Calculate adjusted positions
  let newStart = Math.max(0, originalStart + startOffset);
  let newEnd = Math.min(transcriptText.length, originalEnd + endOffset);

  // Validate that extracted text matches fullText
  const extractedText = transcriptText.substring(originalStart, originalEnd);
  const expectedText = (bit.fullText || "").trim().replace(/\s+/g, " ");
  const actualText = extractedText.trim().replace(/\s+/g, " ");
  const textsMatch = expectedText === actualText;

  // Snap to word boundaries if enabled
  if (snapToWords) {
    newStart = findWordBoundary(transcriptText, newStart, "start");
    newEnd = findWordBoundary(transcriptText, newEnd, "end");
  }

  // Extract context text (before, current, after)
  const contextBefore = Math.max(0, newStart - 60);
  const contextAfter = Math.min(transcriptText.length, newEnd + 60);

  const before = transcriptText.substring(contextBefore, newStart);
  const current = transcriptText.substring(newStart, newEnd);
  const after = transcriptText.substring(newEnd, contextAfter);

  const charCount = newEnd - newStart;
  const wordCount = current.match(/\b\w+\b/g)?.length || 0;

  const hasChanges = startOffset !== 0 || endOffset !== 0;

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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#ffa94d", textTransform: "uppercase", letterSpacing: 1 }}>
            Adjust Boundaries
          </div>
          {textsMatch ? (
            <span style={{ fontSize: 10, color: "#51cf66", fontWeight: 600 }}>✓ Positions match</span>
          ) : (
            <span style={{ fontSize: 10, color: "#ff6b6b", fontWeight: 600 }}>⚠ Position mismatch</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          Fine-tune the start and end positions of this bit using the sliders below
        </div>
      </div>

      {/* Visual preview */}
      <div
        style={{
          background: "#0a0a14",
          border: "1px solid #1a1a2a",
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "16px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "11px",
          lineHeight: "1.6",
          color: "#bbb",
          wordBreak: "break-word",
        }}
      >
        <span style={{ color: "#555" }}>{before}</span>
        <span
          style={{
            background: "rgba(255, 107, 107, 0.2)",
            color: "#ff6b6b",
            padding: "0 2px",
            borderRadius: "2px",
            fontWeight: 600,
          }}
        >
          {current || "(empty)"}
        </span>
        <span style={{ color: "#555" }}>{after}</span>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginBottom: "16px",
          fontSize: "12px",
        }}
      >
        <div>
          <span style={{ color: "#666" }}>Characters:</span>
          <span style={{ color: "#4ecdc4", marginLeft: 6, fontWeight: 600 }}>
            {charCount}
          </span>
        </div>
        <div>
          <span style={{ color: "#666" }}>Words:</span>
          <span style={{ color: "#4ecdc4", marginLeft: 6, fontWeight: 600 }}>
            {wordCount}
          </span>
        </div>
        <div>
          <span style={{ color: "#666" }}>Position:</span>
          <span style={{ color: "#4ecdc4", marginLeft: 6, fontWeight: 600 }}>
            {newStart} - {newEnd}
          </span>
        </div>
      </div>

      {/* Snap to words toggle */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={snapToWords}
          onChange={(e) => setSnapToWords(e.target.checked)}
          style={{ cursor: "pointer" }}
          id="snap-words"
        />
        <label htmlFor="snap-words" style={{ fontSize: 12, color: "#999", cursor: "pointer" }}>
          Snap to word boundaries
        </label>
      </div>

      {/* Start boundary slider */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Start Position
          </label>
          <span style={{ fontSize: 11, color: "#666" }}>
            {startOffset > 0 ? "+" : ""}{startOffset}
          </span>
        </div>
        <input
          type="range"
          min="-1000"
          max="1000"
          value={startOffset}
          onChange={(e) => setStartOffset(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* End boundary slider */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
            End Position
          </label>
          <span style={{ fontSize: 11, color: "#666" }}>
            {endOffset > 0 ? "+" : ""}{endOffset}
          </span>
        </div>
        <input
          type="range"
          min="-1000"
          max="1000"
          value={endOffset}
          onChange={(e) => setEndOffset(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onSave({ startChar: newStart, endChar: newEnd })}
          disabled={!hasChanges}
          style={{
            flex: 1,
            padding: "10px 16px",
            background: hasChanges ? "#ff6b6b" : "#333",
            color: hasChanges ? "#fff" : "#666",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "12px",
            cursor: hasChanges ? "pointer" : "not-allowed",
            transition: "all 0.2s",
          }}
        >
          Save Changes
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
      </div>
    </div>
  );
}
