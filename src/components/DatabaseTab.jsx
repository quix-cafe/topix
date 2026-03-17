import { useState, useMemo, useCallback } from "react";

export function DatabaseTab({
  topics,
  setSelectedTopic,
  getMatchesForTopic,
  touchstones,
}) {
  const [shuffleKey, setShuffleKey] = useState(0);

  // Collect all bit IDs that belong to any touchstone
  const touchstoneBitIds = useMemo(() => {
    const ids = new Set();
    for (const cat of ["confirmed", "possible"]) {
      for (const ts of touchstones?.[cat] || []) {
        for (const id of ts.bitIds || []) ids.add(id);
      }
    }
    return ids;
  }, [touchstones]);

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#888" }}>
          {orphanCount} bits not in any touchstone — showing 20 random
        </span>
        <button
          className="btn btn-secondary"
          onClick={reshuffle}
          style={{ background: "#1a1a2a", color: "#bbb", border: "1px solid #333", fontSize: 12 }}
        >
          Reshuffle
        </button>
      </div>

      {displayedBits.map((topic) => (
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
