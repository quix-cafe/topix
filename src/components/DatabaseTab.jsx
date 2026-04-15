import { useState, useMemo, useCallback } from "react";
import { useHashParam, useHashParamSet } from "../hooks/useHashParam";
import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";



export function DatabaseTab({
  topics,
  setSelectedTopic,
  getMatchesForTopic,
  touchstones,
  onAddToTouchstone,
}) {
  const [shuffleKey, setShuffleKey] = useState(0);
  const [search, setSearch] = useHashParam("bs", "");
  const [selectedTags, setSelectedTags] = useHashParamSet("bt");
  const [tagsOpen, setTagsOpen] = useState(() => selectedTags.size > 0);
  const [tagSearch, setTagSearch] = useState("");
  const [showMaybes, setShowMaybes] = useState(false);

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

  // Touchstone lookup for tag results
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

  // Tag counts (> 3 instances)
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

  const filteredTagCounts = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tagCounts;
    return tagCounts.filter(([tag]) => tag.includes(q));
  }, [tagCounts, tagSearch]);

  // Bits matching selected tags (OR logic)
  const tagFilteredBits = useMemo(() => {
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

  // Search results — when search is active, show all matching bits
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    let matcher;
    if (q.includes("*")) {
      const pattern = q.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const re = new RegExp(pattern);
      matcher = (s) => re.test(s);
    } else {
      matcher = (s) => s.includes(q);
    }
    return topics.filter((t) =>
      matcher((t.title || "").toLowerCase()) ||
      matcher((t.summary || "").toLowerCase()) ||
      matcher((t.fullText || "").toLowerCase()) ||
      matcher((t.sourceFile || "").toLowerCase())
    );
  }, [topics, search]);

  // Bits with "maybe" touchstone connections — not in any TS but matched to TS members
  const maybeBits = useMemo(() => {
    const orphans = topics.filter((t) => !touchstoneBitIds.has(t.id));
    const result = [];
    for (const bit of orphans) {
      const topicMatches = getMatchesForTopic(bit.id);
      let bestPct = 0;
      const matchedTs = new Map();
      for (const m of topicMatches) {
        const otherId = m.sourceId === bit.id ? m.targetId : m.sourceId;
        const tsList = bitTouchstoneMap.get(otherId);
        if (tsList) {
          const pct = m.matchPercentage || (m.confidence || 0) * 100;
          if (pct > bestPct) bestPct = pct;
          for (const ts of tsList) {
            if (!matchedTs.has(ts.id) || matchedTs.get(ts.id).matchPct < pct) {
              matchedTs.set(ts.id, { ...ts, matchPct: pct });
            }
          }
        }
      }
      if (matchedTs.size > 0) result.push({ bit, bestPct, matchedTs: [...matchedTs.values()].sort((a, b) => b.matchPct - a.matchPct) });
    }
    result.sort((a, b) => b.bestPct - a.bestPct);
    return result;
  }, [topics, touchstoneBitIds, getMatchesForTopic, bitTouchstoneMap]);

  // Get bits NOT in any touchstone, then shuffle and take 20
  const displayedBits = useMemo(() => {
    const orphans = topics.filter((t) => !touchstoneBitIds.has(t.id));
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

  // When tags are selected, show tag results instead of normal bit list
  const showingTagResults = tagsOpen && selectedTags.size > 0;
  const showingMaybes = showMaybes && !searchResults && !showingTagResults;
  const bitsToShow = showingTagResults ? tagFilteredBits : (searchResults || (showingMaybes ? maybeBits.map(m => m.bit) : displayedBits));

  return (
    <div>
      {/* Search box */}
      <div style={{ marginBottom: 8, position: "relative" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bits by title, summary, text, or source..."
          style={{
            width: "100%", padding: "10px 14px", paddingRight: 32, background: "#0d1020", border: "1px solid #1e2a44",
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

      {/* Collapsible tag filter */}
      <div style={{ marginBottom: 16, borderRadius: 6, background: selectedTags.size > 0 ? "#1a1228" : "#110e1a", border: selectedTags.size > 0 ? "1px solid #ffa94d33" : "1px solid #2a1e3a" }}>
        <button
          onClick={() => setTagsOpen(!tagsOpen)}
          style={{
            width: "100%", padding: "6px 14px", background: "none", border: "none",
            color: selectedTags.size > 0 ? "#ffa94d" : "#555", fontSize: 11, fontWeight: 500,
            cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
            fontFamily: "inherit", letterSpacing: "0.03em",
          }}
        >
          <span>
            Tags{selectedTags.size > 0 ? ` (${selectedTags.size} selected)` : ` (${tagCounts.length})`}
          </span>
          <span style={{ fontSize: 10, color: "#555" }}>{tagsOpen ? "\u25B2" : "\u25BC"}</span>
        </button>

        {tagsOpen && tagCounts.length > 0 && (
          <div style={{ padding: "0 14px 12px" }}>
            {/* Tag search */}
            <div style={{ marginBottom: 8, position: "relative" }}>
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="Filter tags..."
                style={{
                  width: "100%", padding: "6px 10px", paddingRight: 28, background: "#12121f", border: "1px solid #1e1e30",
                  borderRadius: 6, color: "#ddd", fontSize: 11, fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
              {tagSearch && (
                <button
                  onClick={() => setTagSearch("")}
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 12, cursor: "pointer", lineHeight: 1 }}
                >
                  x
                </button>
              )}
            </div>

            {/* Clear selection */}
            {selectedTags.size > 0 && (
              <div style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#888" }}>
                  {tagFilteredBits.length} bit{tagFilteredBits.length !== 1 ? "s" : ""} matching {[...selectedTags].map((t) => `#${t}`).join(" | ")}
                </span>
                <button
                  onClick={() => setSelectedTags(new Set())}
                  style={{
                    padding: "2px 8px", background: "#ff6b6b18", color: "#ff6b6b", border: "1px solid #ff6b6b33",
                    borderRadius: 4, fontSize: 10, cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Tag cloud */}
            <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 4 }}>
              {filteredTagCounts.map(([tag, count]) => {
                const active = selectedTags.has(tag);
                return (
                  <span
                    key={tag}
                    className="tag-pill"
                    style={{
                      cursor: "pointer",
                      padding: "3px 8px",
                      fontSize: 11,
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
          </div>
        )}
      </div>

      {/* Results header */}
      {!showingTagResults && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "#888" }}>
            {searchResults
              ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${search.trim()}"`
              : showingMaybes
                ? `${maybeBits.length} bit${maybeBits.length !== 1 ? "s" : ""} with maybe-touchstone connections`
                : `${orphanCount} bits not in any touchstone \u2014 showing 20 random`
            }
          </span>
          {!searchResults && (
            <div style={{ display: "flex", gap: 6 }}>
              {maybeBits.length > 0 && (
                <button
                  onClick={() => setShowMaybes(!showMaybes)}
                  style={{
                    background: showMaybes ? "#ffa94d22" : "#1a1a2a",
                    color: showMaybes ? "#ffa94d" : "#bbb",
                    border: `1px solid ${showMaybes ? "#ffa94d44" : "#333"}`,
                    borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600,
                  }}
                >
                  Maybes ({maybeBits.length})
                </button>
              )}
              {!showingMaybes && (
                <button
                  className="btn btn-secondary"
                  onClick={reshuffle}
                  style={{ background: "#1a1a2a", color: "#bbb", border: "1px solid #333", fontSize: 12 }}
                >
                  Reshuffle
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
              {(() => {
                const p = parseFilenameClient(topic.sourceFile || "");
                const rc = ratingColor(p.rating);
                return (
                  <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {p.rating && <span style={{ padding: "1px 4px", borderRadius: 3, background: rc.bg, color: rc.fg, fontWeight: 700, ...RATING_FONT }}>{p.rating}</span>}
                    <span style={{ padding: "2px 6px", borderRadius: 4, background: "#1a1a2a", color: "#888" }}>{p.title}</span>
                    {p.duration && <span style={{ color: "#74c0fc" }}>{p.duration}</span>}
                  </span>
                );
              })()}
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#999", lineHeight: 1.5 }}>
            {topic.summary}
          </div>
          {(topic.tags || []).length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 2 }}>
              {(topic.tags || []).map((tag, ti) => {
                const norm = tag.trim().replace(/\s+/g, "-").toLowerCase();
                const isSelected = showingTagResults && selectedTags.has(norm);
                return (
                  <span key={`${tag}-${ti}`} className="tag-pill" style={{
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
          )}
          {!touchstoneBitIds.has(topic.id) && (() => {
            const matchedTs = new Map();
            const topicMatches = getMatchesForTopic(topic.id);
            for (const m of topicMatches) {
              const otherId = m.sourceId === topic.id ? m.targetId : m.sourceId;
              const tsList = bitTouchstoneMap.get(otherId);
              if (tsList) {
                for (const ts of tsList) {
                  if (!matchedTs.has(ts.id)) matchedTs.set(ts.id, { ...ts, matchPct: m.matchPercentage || (m.confidence || 0) * 100 });
                }
              }
            }
            if (matchedTs.size === 0) return null;
            const sorted = [...matchedTs.values()].sort((a, b) => b.matchPct - a.matchPct);
            return (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 9, color: "#666", marginRight: 2 }}>maybe:</span>
                {sorted.map((ts) => (
                  <span
                    key={ts.id}
                    style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                      background: ts.category === "confirmed" ? "#51cf6618" : "#ffa94d18",
                      color: ts.category === "confirmed" ? "#51cf66" : "#ffa94d",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {ts.keyword ? `${ts.keyword} · ` : ""}{ts.name} ({Math.round(ts.matchPct)}%)
                    {onAddToTouchstone && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddToTouchstone(topic.id, ts.id); }}
                        style={{
                          background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66",
                          borderRadius: 3, padding: "0 4px", fontSize: 9, cursor: "pointer",
                          fontWeight: 700, lineHeight: "16px",
                        }}
                      >
                        +
                      </button>
                    )}
                  </span>
                ))}
              </div>
            );
          })()}
          {showingTagResults && (bitTouchstoneMap.get(topic.id) || []).length > 0 && (
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
                  {ts.keyword ? `${ts.keyword} · ` : ""}{ts.name} ({ts.instances?.length || 0}x)
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
