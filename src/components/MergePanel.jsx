import { useState } from "react";
import { extractCommonWords } from "../utils/textSimilarity.js";

/**
 * MergePanel - Find and create root bits from matched bit clusters
 */
export function MergePanel({ bits, matches, onCreateRoot }) {
  const [selectedClusterId, setSelectedClusterId] = useState(null);

  // Find clusters of matched bits
  const clusters = findMatchClusters(bits, matches);

  if (clusters.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔗</div>
        <div>No bit clusters found to merge.</div>
        <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
          Parse multiple transcripts and run matching to find bits to merge.
        </div>
      </div>
    );
  }

  if (selectedClusterId !== null) {
    const cluster = clusters[selectedClusterId];
    return (
      <MergePanelDetail
        cluster={cluster}
        bits={bits}
        onCreateRoot={(bitIds) => {
          onCreateRoot(bitIds);
          setSelectedClusterId(null);
        }}
        onBack={() => setSelectedClusterId(null)}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>
          Merge Candidates ({clusters.length})
        </h3>
        <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
          Groups of matched bits from different transcripts that can be merged into root bits
        </p>
      </div>

      {clusters.map((cluster, idx) => (
        <RootBitCard
          key={idx}
          cluster={cluster}
          bits={bits}
          onClick={() => setSelectedClusterId(idx)}
        />
      ))}
    </div>
  );
}

/**
 * RootBitCard - Display a cluster of matched bits
 */
function RootBitCard({ cluster, bits, onClick }) {
  const clusterBits = cluster.map((id) => bits.find((b) => b.id === id)).filter(Boolean);

  if (clusterBits.length === 0) return null;

  const firstBit = clusterBits[0];
  const commonTitle = getCommonTitle(clusterBits);

  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: "#eee", fontSize: 15, marginBottom: 6 }}>
          {commonTitle || firstBit.title}
        </div>

        <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>
          {clusterBits.length} matched instances across {new Set(clusterBits.map((b) => b.sourceFile)).size} files
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {clusterBits.map((bit) => (
            <span
              key={bit.id}
              style={{
                fontSize: "10px",
                padding: "2px 8px",
                background: "#1a1a2a",
                borderRadius: "4px",
                color: "#999",
              }}
            >
              {bit.title.substring(0, 30)}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          marginLeft: 16,
        }}
      >
        <div
          style={{
            background: "#51cf66",
            color: "#000",
            padding: "6px 12px",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Create Root
        </div>
        <div style={{ fontSize: 10, color: "#666" }}>
          {clusterBits.length}x
        </div>
      </div>
    </div>
  );
}

/**
 * MergePanelDetail - Show detailed merge preview
 */
function MergePanelDetail({ cluster, bits, onCreateRoot, onBack }) {
  const clusterBits = cluster.map((id) => bits.find((b) => b.id === id)).filter(Boolean);
  const [customTitle, setCustomTitle] = useState("");
  const [customSummary, setCustomSummary] = useState("");

  const firstBit = clusterBits[0];
  const commonTitle = getCommonTitle(clusterBits);
  const finalTitle = customTitle || commonTitle || firstBit.title;
  const allTags = [...new Set(clusterBits.flatMap((b) => b.tags || []))];
  const allKeywords = [...new Set(clusterBits.flatMap((b) => b.keywords || []))];

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: "#ffa94d",
          fontSize: 14,
          cursor: "pointer",
          marginBottom: 16,
          fontWeight: 600,
        }}
      >
        ← Back to Clusters
      </button>

      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 24,
            fontWeight: 700,
            color: "#eee",
            marginBottom: 8,
          }}
        >
          Create Root Bit
        </h2>
        <p style={{ fontSize: 13, color: "#999" }}>
          Merge {clusterBits.length} matched bits into a single root bit that tracks all variations
        </p>
      </div>

      {/* Title input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 6 }}>
          Root Bit Title
        </label>
        <input
          type="text"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          placeholder={commonTitle || firstBit.title}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "#0a0a14",
            border: "1px solid #1a1a2a",
            borderRadius: "8px",
            color: "#ddd",
            fontSize: "12px",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Summary input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 6 }}>
          Root Bit Summary (optional)
        </label>
        <textarea
          value={customSummary}
          onChange={(e) => setCustomSummary(e.target.value)}
          placeholder="Describe the core joke premise"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "#0a0a14",
            border: "1px solid #1a1a2a",
            borderRadius: "8px",
            color: "#ddd",
            fontSize: "12px",
            fontFamily: "inherit",
            minHeight: "60px",
          }}
        />
      </div>

      {/* Instances preview */}
      <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8 }}>
          Instances ({clusterBits.length})
        </div>
        {clusterBits.map((bit, idx) => (
          <div
            key={bit.id}
            style={{
              padding: "8px",
              background: "#0a0a14",
              borderRadius: "6px",
              marginBottom: 6,
              fontSize: "11px",
              borderLeft: "2px solid #51cf66",
            }}
          >
            <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 2 }}>
              #{idx + 1} — {bit.title}
            </div>
            <div style={{ color: "#666", fontSize: "10px" }}>
              {bit.sourceFile}
            </div>
          </div>
        ))}
      </div>

      {/* Tags and keywords preview */}
      <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#888", marginBottom: 4 }}>
            Merged Tags ({allTags.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {allTags.slice(0, 8).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  background: "#ff6b6b10",
                  color: "#ff8888",
                  borderRadius: "4px",
                }}
              >
                #{tag}
              </span>
            ))}
            {allTags.length > 8 && (
              <span style={{ fontSize: "10px", color: "#666" }}>
                +{allTags.length - 8} more
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#888", marginBottom: 4 }}>
            Merged Keywords ({allKeywords.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {allKeywords.slice(0, 8).map((kw) => (
              <span
                key={kw}
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  background: "#ffa94d10",
                  color: "#ffa94d",
                  borderRadius: "4px",
                }}
              >
                {kw}
              </span>
            ))}
            {allKeywords.length > 8 && (
              <span style={{ fontSize: "10px", color: "#666" }}>
                +{allKeywords.length - 8} more
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onCreateRoot(cluster)}
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "#51cf66",
            color: "#000",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          ✓ Create Root Bit
        </button>
        <button
          onClick={onBack}
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "#1e1e30",
            color: "#ccc",
            border: "1px solid #252538",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "13px",
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

/**
 * Find clusters of matched bits using transitive closure
 */
function findMatchClusters(bits, matches) {
  const graph = new Map();
  const bitById = new Map();

  // Build lookup and adjacency list
  bits.forEach((bit) => {
    bitById.set(bit.id, bit);
    if (!graph.has(bit.id)) {
      graph.set(bit.id, []);
    }
  });

  // Only add edges between bits from DIFFERENT transcripts
  matches.forEach((match) => {
    const src = bitById.get(match.sourceId);
    const tgt = bitById.get(match.targetId);
    if (!src || !tgt) return;
    if (src.transcriptId === tgt.transcriptId) return; // skip same-transcript
    graph.get(match.sourceId)?.push(match.targetId);
    graph.get(match.targetId)?.push(match.sourceId);
  });

  // Find connected components
  const visited = new Set();
  const clusters = [];

  for (const bitId of graph.keys()) {
    if (visited.has(bitId)) continue;

    const cluster = [];
    const stack = [bitId];

    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current)) continue;

      visited.add(current);
      cluster.push(current);

      for (const neighbor of graph.get(current) || []) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Get a formatted common title from bits
 */
function getCommonTitle(bits) {
  const words = extractCommonWords(bits);
  if (words.length > 0) {
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return null;
}
