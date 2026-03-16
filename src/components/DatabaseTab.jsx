import { useState, useMemo } from "react";

export function DatabaseTab({
  allTags,
  filteredTopics,
  filterTag,
  topics,
  setFilterTag,
  setSelectedTopic,
  getMatchesForTopic,
  touchstones,
}) {
  const [search, setSearch] = useState("");

  // Build a map of bitId -> touchstones for quick lookup
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

  const displayedTopics = useMemo(() => {
    if (!search.trim()) return filteredTopics;
    const q = search.toLowerCase();
    return filteredTopics.filter((t) =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.summary || "").toLowerCase().includes(q) ||
      (t.fullText || "").toLowerCase().includes(q) ||
      (t.tags || []).some((tag) => tag.toLowerCase().includes(q)) ||
      (t.keywords || []).some((kw) => kw.toLowerCase().includes(q)) ||
      (t.sourceFile || "").toLowerCase().includes(q)
    );
  }, [filteredTopics, search]);

  return (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${topics.length} bits...`}
          style={{
            width: "100%", padding: "10px 14px", background: "#0d0d16",
            border: "1px solid #252538", borderRadius: 8, color: "#ddd",
            fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
      </div>

      {allTags.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 2 }}>
          <span
            className="tag-pill"
            style={{
              background: !filterTag ? "#ff6b6b22" : "#1a1a2a",
              color: !filterTag ? "#ff6b6b" : "#666",
              border: `1px solid ${!filterTag ? "#ff6b6b44" : "#252538"}`,
            }}
            onClick={() => setFilterTag(null)}
          >
            All ({topics.length})
          </span>
          {allTags.slice(0, 50).map((tag) => {
            const count = topics.filter((t) => (t.tags || []).some((tt) => tt.trim().replace(/\s+/g, "-").toLowerCase() === tag)).length;
            const active = filterTag === tag;
            return (
              <span
                key={tag}
                className="tag-pill"
                style={{
                  background: active ? "#ffa94d22" : "#1a1a2a",
                  color: active ? "#ffa94d" : "#666",
                  border: `1px solid ${active ? "#ffa94d44" : "#252538"}`,
                }}
                onClick={() => setFilterTag(active ? null : tag)}
              >
                {tag} ({count})
              </span>
            );
          })}
        </div>
      )}

      {displayedTopics.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
          {search.trim() ? (
            <div style={{ fontSize: 13, color: "#666" }}>No bits matching "{search}"</div>
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{"📝"}</div>
              No bits parsed yet. Upload transcripts and hit Parse.
            </>
          )}
        </div>
      ) : (
        displayedTopics.map((topic) => {
          const tm = getMatchesForTopic(topic.id);
          return (
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
                <div style={{ display: "flex", gap: 6 }}>
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: "#999", lineHeight: 1.5 }}>
                {topic.summary}
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 2 }}>
                {(topic.tags || []).map((tag) => (
                  <span key={tag} className="tag-pill" style={{
                    background: "#ff6b6b10",
                    color: "#ff8888",
                    border: "1px solid #ff6b6b20",
                    fontSize: 10,
                  }}>
                    #{tag}
                  </span>
                ))}
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
          );
        })
      )}
    </div>
  );
}
