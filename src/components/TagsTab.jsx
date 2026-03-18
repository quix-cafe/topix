import { useState, useMemo } from "react";

export function TagsTab({
  topics,
  setSelectedTopic,
  touchstones,
}) {
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagSearch, setTagSearch] = useState("");

  // Build tag counts, filter to > 3 instances
  const tagCounts = useMemo(() => {
    const counts = {};
    topics.forEach((t) => (t.tags || []).forEach((tag) => {
      const normalized = tag.trim().replace(/\s+/g, "-").toLowerCase();
      if (normalized) counts[normalized] = (counts[normalized] || 0) + 1;
    }));
    return Object.entries(counts)
      .filter(([, count]) => count > 3)
      .sort((a, b) => b[1] - a[1]);
  }, [topics]);

  // Filter tag list by search
  const filteredTagCounts = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tagCounts;
    return tagCounts.filter(([tag]) => tag.includes(q));
  }, [tagCounts, tagSearch]);

  // Build touchstone lookup
  const bitTouchstoneMap = useMemo(() => {
    const map = new Map();
    const allTs = [...(touchstones?.confirmed || []), ...(touchstones?.possible || [])];
    for (const ts of allTs) {
      for (const inst of ts.instances || []) {
        if (!map.has(inst.bitId)) map.set(inst.bitId, []);
        map.get(inst.bitId).push(ts);
      }
    }
    return map;
  }, [touchstones]);

  // Filter bits to those matching ANY selected tag (OR logic)
  const filteredBits = useMemo(() => {
    if (selectedTags.size === 0) return [];
    return topics.filter((t) => {
      const bitTags = new Set((t.tags || []).map((tag) => tag.trim().replace(/\s+/g, "-").toLowerCase()));
      for (const st of selectedTags) {
        if (bitTags.has(st)) return true;
      }
      return false;
    }).sort((a, b) => {
      if (a.sourceFile !== b.sourceFile) return (a.sourceFile || "").localeCompare(b.sourceFile || "");
      return (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0);
    });
  }, [topics, selectedTags]);

  const toggleTag = (tag) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <div>
      {tagCounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
          No tags with more than 3 instances yet.
        </div>
      ) : (
        <>
          {/* Tag search filter */}
          <div style={{ marginBottom: 10, position: "relative" }}>
            <input
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              placeholder="Filter tags..."
              style={{
                width: "100%", padding: "8px 12px", paddingRight: 32, background: "#0d0d16", border: "1px solid #1e1e30",
                borderRadius: 8, color: "#ddd", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            {tagSearch && (
              <button
                onClick={() => setTagSearch("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
              >
                x
              </button>
            )}
          </div>

          {/* Clear + tag count */}
          {selectedTags.size > 0 && (
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#888" }}>
                {selectedTags.size} tag{selectedTags.size !== 1 ? "s" : ""} selected
              </span>
              <button
                onClick={() => setSelectedTags(new Set())}
                style={{
                  padding: "3px 10px", background: "#ff6b6b18", color: "#ff6b6b", border: "1px solid #ff6b6b33",
                  borderRadius: 6, fontSize: 11, cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Scrollable tag container */}
          <div style={{ marginBottom: 16, maxHeight: 180, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 0" }}>
            {filteredTagCounts.map(([tag, count]) => {
              const active = selectedTags.has(tag);
              return (
                <span
                  key={tag}
                  className="tag-pill"
                  style={{
                    cursor: "pointer",
                    padding: "4px 10px",
                    fontSize: 12,
                    background: active ? "#ffa94d22" : "#1a1a2a",
                    color: active ? "#ffa94d" : "#777",
                    border: `1px solid ${active ? "#ffa94d44" : "#252538"}`,
                  }}
                  onClick={() => toggleTag(tag)}
                >
                  {tag} ({count})
                </span>
              );
            })}
          </div>

          {selectedTags.size === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 13 }}>
              Select one or more tags to filter bits.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
                {filteredBits.length} bit{filteredBits.length !== 1 ? "s" : ""} matching{" "}
                {[...selectedTags].map((t) => `#${t}`).join(" | ")}
              </div>
              {filteredBits.map((topic) => (
                <div key={topic.id} className="card" onClick={() => setSelectedTopic(topic)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "#eee", fontSize: 15 }}>{topic.title}</span>
                      <span style={{
                        marginLeft: 8,
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "#1a1a2a",
                        color: "#888",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {topic.sourceFile}
                      </span>
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#999", lineHeight: 1.5 }}>
                    {topic.summary}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 2 }}>
                    {(topic.tags || []).map((tag) => {
                      const norm = tag.trim().replace(/\s+/g, "-").toLowerCase();
                      const isSelected = selectedTags.has(norm);
                      return (
                        <span key={tag} className="tag-pill" style={{
                          background: isSelected ? "#ffa94d15" : "#ff6b6b10",
                          color: isSelected ? "#ffa94d" : "#ff8888",
                          border: `1px solid ${isSelected ? "#ffa94d30" : "#ff6b6b20"}`,
                          fontSize: 10,
                        }}>
                          #{tag}
                        </span>
                      );
                    })}
                  </div>
                  {(bitTouchstoneMap.get(topic.id) || []).length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(bitTouchstoneMap.get(topic.id) || []).map((ts) => (
                        <span
                          key={ts.id}
                          style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                            background: ts.category === "confirmed" ? "#51cf6618" : "#ffa94d18",
                            color: ts.category === "confirmed" ? "#51cf66" : "#ffa94d",
                          }}
                        >
                          {ts.name} ({ts.instances?.length || 0}x)
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
