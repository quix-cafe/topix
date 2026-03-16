import { useState } from "react";
import { uid } from "../utils/ollama";

/**
 * BitJoiner - UI for merging multiple bits into one
 * Select bits from same transcript and merge them
 */
export function BitJoiner({ transcript, bits, onJoinComplete, onCancel }) {
  const [selectedBitIds, setSelectedBitIds] = useState([]);
  const [mergedTitle, setMergedTitle] = useState("");
  const [mergedSummary, setMergedSummary] = useState("");

  const transcriptText = transcript.text;

  // Filter bits from this transcript
  const availableBits = bits.filter((b) => b.transcriptId === transcript.id || b.sourceFile === transcript.name);

  // Get selected bits
  const selectedBits = availableBits.filter((b) => selectedBitIds.includes(b.id));

  // Check if selection is valid for joining
  const isValidSelection = () => {
    if (selectedBits.length < 2) return false;

    // Check if bits are contiguous or close together
    const sorted = [...selectedBits].sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const gap = (next.textPosition?.startChar || 0) - (current.textPosition?.endChar || 0);

      // Allow small gaps (whitespace)
      if (gap > 200) {
        return false;
      }
    }

    return true;
  };

  // Calculate merged position
  const getMergedPosition = () => {
    if (selectedBits.length === 0) return null;

    const sorted = [...selectedBits].sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));
    const firstBit = sorted[0];
    const lastBit = sorted[sorted.length - 1];

    return {
      startChar: firstBit.textPosition?.startChar || 0,
      endChar: lastBit.textPosition?.endChar || 0,
    };
  };

  // Generate merged bit
  const generateMergedBit = () => {
    const pos = getMergedPosition();
    if (!pos) return null;

    const mergedText = transcriptText.substring(pos.startChar, pos.endChar);
    const allTags = [...new Set(selectedBits.flatMap((b) => b.tags || []))];
    const allKeywords = [...new Set(selectedBits.flatMap((b) => b.keywords || []))];

    return {
      id: uid(),
      title: mergedTitle || `${selectedBits[0].title} + ${selectedBits.length - 1} more`,
      summary: mergedSummary || selectedBits.map((b) => b.summary).join(" "),
      fullText: mergedText,
      tags: allTags,
      keywords: allKeywords,
      textPosition: pos,
      sourceFile: transcript.name,
      transcriptId: transcript.id,
      editHistory: [
        {
          timestamp: Date.now(),
          action: "join",
          details: {
            joinedBitIds: selectedBits.map((b) => b.id),
            mergedFrom: selectedBits.length,
          },
        },
      ],
    };
  };

  const mergedBit = isValidSelection() ? generateMergedBit() : null;

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
        <div style={{ fontSize: 12, fontWeight: 600, color: "#51cf66", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Join Bits
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          Select 2 or more bits to join them into a single bit. Bits must be from the same transcript and reasonably close.
        </div>
      </div>

      {/* Bit selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8 }}>
          Available bits ({availableBits.length})
        </div>
        <div style={{ maxHeight: "250px", overflowY: "auto" }}>
          {availableBits.map((bit) => (
            <label
              key={bit.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px",
                background: "#0a0a14",
                borderRadius: "6px",
                marginBottom: 6,
                cursor: "pointer",
                border: selectedBitIds.includes(bit.id) ? "1px solid #51cf66" : "1px solid #1a1a2a",
              }}
            >
              <input
                type="checkbox"
                checked={selectedBitIds.includes(bit.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedBitIds([...selectedBitIds, bit.id]);
                  } else {
                    setSelectedBitIds(selectedBitIds.filter((id) => id !== bit.id));
                  }
                }}
                style={{ cursor: "pointer", marginRight: 8 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "#ddd", fontSize: "11px" }}>
                  {bit.title}
                </div>
                <div style={{ color: "#666", fontSize: "10px", marginTop: 2 }}>
                  {(bit.textPosition?.endChar || 0) - (bit.textPosition?.startChar || 0)} chars
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Validation messages */}
      {selectedBits.length > 0 && !isValidSelection() && (
        <div
          style={{
            padding: "8px",
            background: "#2a1f1f",
            border: "1px solid #3a2020",
            borderRadius: "6px",
            color: "#ff8888",
            fontSize: "11px",
            marginBottom: 16,
          }}
        >
          ⚠ Selected bits are too far apart or can't be joined. Choose bits that are close together.
        </div>
      )}

      {/* Merged bit preview */}
      {mergedBit && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 6 }}>
              Merged Bit Title (optional)
            </label>
            <input
              type="text"
              value={mergedTitle}
              onChange={(e) => setMergedTitle(e.target.value)}
              placeholder={mergedBit.title}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "#0a0a14",
                border: "1px solid #1a1a2a",
                borderRadius: "6px",
                color: "#ddd",
                fontSize: "12px",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 6 }}>
              Merged Bit Summary (optional)
            </label>
            <textarea
              value={mergedSummary}
              onChange={(e) => setMergedSummary(e.target.value)}
              placeholder={mergedBit.summary}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "#0a0a14",
                border: "1px solid #1a1a2a",
                borderRadius: "6px",
                color: "#ddd",
                fontSize: "12px",
                fontFamily: "inherit",
                minHeight: "60px",
              }}
            />
          </div>

          <div
            style={{
              padding: "10px",
              background: "#1a1a2a",
              borderRadius: "6px",
              marginBottom: 16,
              fontSize: "11px",
            }}
          >
            <div style={{ fontWeight: 600, color: "#51cf66", marginBottom: 6 }}>Preview</div>
            <div style={{ color: "#999" }}>
              <div>Merging {selectedBits.length} bits</div>
              <div style={{ marginTop: 4, color: "#666" }}>
                Combined: {(mergedBit.textPosition.endChar - mergedBit.textPosition.startChar).toLocaleString()} chars
              </div>
            </div>
          </div>
        </>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => {
            if (mergedBit) {
              onJoinComplete(selectedBits, mergedBit);
            }
          }}
          disabled={!mergedBit}
          style={{
            flex: 1,
            padding: "10px 16px",
            background: mergedBit ? "#51cf66" : "#333",
            color: mergedBit ? "#000" : "#666",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "12px",
            cursor: mergedBit ? "pointer" : "not-allowed",
            transition: "all 0.2s",
          }}
        >
          ✓ Join {selectedBits.length} Bits
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

// Helper function to generate unique IDs (can be imported from ollama.js)
