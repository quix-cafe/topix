import { useState, useMemo, useCallback } from "react";

export function DatabaseTab({
  topics,
  setSelectedTopic,
  getMatchesForTopic,
  touchstones,
}) {
  const [shuffleKey, setShuffleKey] = useState(0);
  const [search, setSearch] = useState("");

  // Map bit IDs to their touchstone names
  const bitToTouchstone = useMemo(() => {
    const map = new Map();
    for (const cat of ["confirmed", "possible"]) {
      for (const ts of touchstones?.[cat] || []) {
        for (const id of ts.bitIds || []) {
          map.set(id, ts.name || ts.manualName || "unnamed");
        }
      }
    }
    return map;
  }, [touchstones]);
  const touchstoneBitIds = useMemo(() => new Set(bitToTouchstone.keys()), [bitToTouchstone]);

  // Search results — when search is active, show all matching bits
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return topics.filter((t) =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.summary || "").toLowerCase().includes(q) ||
      (t.fullText || "").toLowerCase().includes(q) ||
      (t.sourceFile || "").toLowerCase().includes(q)
    );
  }, [topics, search]);

  // Get bits NOT in any touchstone, then shuffle and take 20
  const displayedBits = useMemo(() => {
    const orphans = topics.filter((t) => !touchstoneBitIds.has(t.id));
    // Fisher-Yates shuffle
    const arr = [...orphans];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 20);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, touchstoneBitIds, shuffleKey]);

  const orphanCount = useMemo(() =>
    topics.filter((t) => !touchstoneBitIds.has(t.id)).length,
    [topics, touchstoneBitIds]
  );

  const reshuffle = useCallback(() => setShuffleKey((k) => k + 1), []);

  if (topics.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
        No bits parsed yet. Sync transcripts and hit Parse.
      </div>
    );
  }

  const bitsToShow = searchResults || displayedBits;

  return (
    <div>
      {/* Search box */}
      <div style={{ marginBottom: 16, position: "relative" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bits by title, summary, text, or source..."
          style={{
            width: "100%", padding: "10px 14px", paddingRight: 32, background: "#0d0d16", border: "1px solid #1e1e30",
            borderRadius: 8, color: "#ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
          >
            x
          </button>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#888" }}>
          {searchResults
            ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${search.trim()}"`
            : `${orphanCount} bits not in any touchstone \u2014 showing 20 random`
          }
        </span>
        {!searchResults && (
          <button
            className="btn btn-secondary"
            onClick={reshuffle}
            style={{ background: "#1a1a2a", color: "#bbb", border: "1px solid #333", fontSize: 12 }}
          >
            Reshuffle
          </button>
        )}
      </div>

      {bitsToShow.map((topic) => (
        <div key={topic.id} className="card" onClick={() => setSelectedTopic(topic)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, color: "#eee", fontSize: 15 }}>{topic.title}</span>
              {bitToTouchstone.has(topic.id) && (
                <span style={{
                  fontSize: 9, padding: "1px 5px", borderRadius: 4,
                  background: "#da77f218", color: "#da77f2", border: "1px solid #da77f233",
                  flexShrink: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {bitToTouchstone.get(topic.id)}
                </span>
              )}
              <span style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: "#1a1a2a",
                color: "#888",
                fontFamily: "'JetBrains Mono', monospace",
                flexShrink: 0,
              }}>
                {topic.sourceFile}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#999", lineHeight: 1.5 }}>
            {topic.summary}
          </div>
          {(topic.tags || []).length > 0 && (
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
          )}
        </div>
      ))}
    </div>
  );
}
