import { useMemo, useState } from "react";
import { getSimilarityStats } from "../utils/similaritySearch";
import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";

const WORDS_PER_MINUTE = 150;

const TOUCHSTONE_PALETTE = [
  "#ff6b6b", "#ffa94d", "#ffd43b", "#51cf66",
  "#4ecdc4", "#74c0fc", "#da77f2", "#f783ac",
  "#a9e34b", "#63e6be", "#ff8787", "#ffb347",
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h);
}

function tsColor(tsId) {
  return TOUCHSTONE_PALETTE[hashStr(tsId) % TOUCHSTONE_PALETTE.length];
}

function formatDurationMinSec(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const CARD_STYLE = {
  gridColumn: "1 / -1",
  background: "#12121f",
  border: "1px solid #1e1e30",
  borderRadius: "10px",
  padding: "16px",
};

const SECTION_HEADER = {
  fontSize: 13,
  fontWeight: 600,
  color: "#888",
  textTransform: "uppercase",
  marginBottom: 12,
  letterSpacing: 1,
};

/**
 * AnalyticsDashboard - Comprehensive statistics and insights
 */
export function AnalyticsDashboard({ topics, matches, touchstones, rootBits, transcripts, onGoToTouchstone, onGoToMix, onGoToBit }) {
  const stats = useMemo(
    () => calculateStats(topics, matches, touchstones, rootBits, transcripts),
    [topics, matches, touchstones, rootBits, transcripts]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      {/* Overview Cards */}
      <StatCard label="Total Bits" value={stats.totalBits} color="#ff6b6b" icon="📝" />
      <StatCard label="Connections" value={stats.totalMatches} color="#4ecdc4" icon="🔗" />
      <StatCard label="Touchstones" value={stats.totalTouchstones} color="#51cf66" icon="🔄" />
      {stats.totalMaterialDuration > 0 && (
        <StatCard label="Total Material" value={formatDurationMinSec(stats.totalMaterialDuration)} color="#74c0fc" icon="⏱" />
      )}

      {/* Set Timelines */}
      {stats.transcriptTimelines.length > 0 && (
        <SetTimeline timelines={stats.transcriptTimelines} onGoToTouchstone={onGoToTouchstone} onGoToMix={onGoToMix} onGoToBit={onGoToBit} transcripts={transcripts} />
      )}

      {/* Set Comparison */}
      {stats.transcriptTimelines.length >= 2 && (
        <SetComparison timelines={stats.transcriptTimelines} />
      )}

      {/* Bit Distribution */}
      <div style={CARD_STYLE}>
        <h3 style={SECTION_HEADER}>Bit Distribution</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <DistribItem label="Top Tags" items={stats.topTags} limit={10} />
          <DistribItem label="Sources" items={stats.sourceDistribution} />
        </div>
      </div>

      {/* Transcript Durations */}
      {stats.transcriptDurations.length > 0 && (
        <div style={CARD_STYLE}>
          <h3 style={SECTION_HEADER}>Transcript Durations</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.transcriptDurations.map((td) => (
              <div key={td.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ color: "#bbb", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{td.name}</span>
                <span style={{ color: "#74c0fc", fontWeight: 600, marginLeft: 12, flexShrink: 0 }}>{formatDurationMinSec(td.duration)}</span>
                <span style={{ color: "#666", fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{td.bitCount} bits</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Similarity Analysis */}
      <div style={CARD_STYLE}>
        <h3 style={SECTION_HEADER}>Similarity Analysis</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>Average Similarity</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#4ecdc4" }}>
              {Math.round(stats.avgSimilarity * 100)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>Similarity Distribution</div>
            <div style={{ display: "flex", gap: 4, height: 24 }}>
              <div style={{ flex: stats.similarityDist.veryHigh, background: "#ff6b6b", borderRadius: 4, minWidth: 4 }} title={`Very High: ${stats.similarityDist.veryHigh}`} />
              <div style={{ flex: stats.similarityDist.high, background: "#ffa94d", borderRadius: 4, minWidth: 4 }} title={`High: ${stats.similarityDist.high}`} />
              <div style={{ flex: stats.similarityDist.medium, background: "#74c0fc", borderRadius: 4, minWidth: 4 }} title={`Medium: ${stats.similarityDist.medium}`} />
              <div style={{ flex: stats.similarityDist.low, background: "#51cf66", borderRadius: 4, minWidth: 4 }} title={`Low: ${stats.similarityDist.low}`} />
            </div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 6, display: "flex", gap: 12 }}>
              <span>{"Very High (>0.8)"}</span>
              <span>High (0.6-0.8)</span>
              <span>Medium (0.4-0.6)</span>
              <span>{"Low (<0.4)"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Analysis */}
      <div style={CARD_STYLE}>
        <h3 style={SECTION_HEADER}>Connection Analysis</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {Object.entries(stats.relationshipDistribution).map(([relationship, count]) => (
            <div key={relationship} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4, textTransform: "capitalize" }}>
                {relationship.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#4ecdc4" }}>{count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Set Flow — weighted transitions */}
      {stats.commonTransitions.length > 0 && (
        <div style={CARD_STYLE}>
          <h3 style={SECTION_HEADER}>Set Flow</h3>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>
            Directed touchstone transitions across sets — bar fill = frequency
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {stats.commonTransitions.map((t, idx) => (
              <div key={idx} style={{ position: "relative", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", inset: 0,
                  width: `${t.percentage}%`,
                  background: "#ffa94d18",
                  borderRadius: 6,
                }} />
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "7px 10px" }}>
                  <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.fromName}</span>
                  <span style={{ color: "#ffa94d", flexShrink: 0 }}>→</span>
                  <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.toName}</span>
                  <span style={{ color: "#74c0fc", fontWeight: 600, flexShrink: 0, fontSize: 11 }}>{t.count}x</span>
                  <span style={{ color: "#ffa94d", fontWeight: 600, fontSize: 10, flexShrink: 0, minWidth: 32, textAlign: "right" }}>{t.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Co-occurrence Pairings */}
      {stats.coOccurrencePairs.length > 0 && (
        <div style={CARD_STYLE}>
          <h3 style={SECTION_HEADER}>Common Pairings</h3>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>
            Touchstones that appear together in the same set (regardless of order)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {stats.coOccurrencePairs.map((p, idx) => (
              <div key={idx} style={{ position: "relative", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", inset: 0,
                  width: `${p.percentage}%`,
                  background: "#51cf6618",
                  borderRadius: 6,
                }} />
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "7px 10px" }}>
                  <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nameA}</span>
                  <span style={{ color: "#51cf66", flexShrink: 0 }}>↔</span>
                  <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nameB}</span>
                  <span style={{ color: "#74c0fc", fontWeight: 600, flexShrink: 0, fontSize: 11 }}>{p.count}x</span>
                  <span style={{ color: "#51cf66", fontWeight: 600, fontSize: 10, flexShrink: 0, minWidth: 32, textAlign: "right" }}>{p.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Set Position — with variance band */}
      {stats.setPositions.length > 0 && (
        <div style={CARD_STYLE}>
          <h3 style={SECTION_HEADER}>Set Position</h3>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#51cf66" }}>■ Opener (&lt;30%)</span>
            <span style={{ fontSize: 10, color: "#4ecdc4" }}>■ Mid-set</span>
            <span style={{ fontSize: 10, color: "#ffa94d" }}>■ Closer (&gt;70%)</span>
            <span style={{ fontSize: 10, color: "#444" }}>  shaded band = variance range</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {stats.setPositions.map((sp) => {
              const posColor = sp.avgPosition < 0.3 ? "#51cf66" : sp.avgPosition > 0.7 ? "#ffa94d" : "#4ecdc4";
              const posLabel = sp.avgPosition < 0.3 ? "Opener" : sp.avgPosition > 0.7 ? "Closer" : "Mid-set";
              const spread = sp.maxPosition - sp.minPosition;
              const isStable = spread < 0.2;
              return (
                <div key={sp.id} style={{ fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{sp.name}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                      <span style={{ fontSize: 10, color: isStable ? "#51cf66" : "#ffa94d" }}>{isStable ? "stable" : "variable"}</span>
                      <span style={{ color: posColor, fontWeight: 600, fontSize: 10 }}>{posLabel}</span>
                      <span style={{ color: "#555", fontSize: 10 }}>{sp.appearances}x</span>
                    </div>
                  </div>
                  <div style={{ background: "#0a0a14", borderRadius: 4, height: 10, overflow: "hidden", position: "relative" }}>
                    {/* variance range band */}
                    <div style={{
                      position: "absolute",
                      left: `${sp.minPosition * 100}%`,
                      width: `${Math.max((sp.maxPosition - sp.minPosition) * 100, 2)}%`,
                      height: "100%",
                      background: posColor + "33",
                    }} />
                    {/* avg position marker */}
                    <div style={{
                      position: "absolute",
                      left: `${Math.max(0, sp.avgPosition * 100 - 1.5)}%`,
                      width: "3%",
                      minWidth: 6,
                      height: "100%",
                      background: posColor,
                      borderRadius: 4,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vault Health */}
      <div style={CARD_STYLE}>
        <h3 style={SECTION_HEADER}>Vault Health</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <HealthMetric label="Connection Density" value={stats.connectionDensity} description="% of bits with matches" />
          <HealthMetric label="Merge Potential" value={stats.mergePotential} description="% of bits could be merged" />
          <HealthMetric label="Coverage" value={stats.coverage} description="% bits in positions/analysis" />
          <HealthMetric label="Touchstone Rate" value={stats.touchstoneRate} description="% of bits are recurring" />
        </div>
      </div>

      {/* Insights */}
      <div style={CARD_STYLE}>
        <h3 style={SECTION_HEADER}>Insights</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stats.insights.map((insight, idx) => (
            <div key={idx} style={{ padding: "8px 12px", background: "#0a0a14", borderRadius: 6, borderLeft: "3px solid #4ecdc4", fontSize: 12, color: "#bbb" }}>
              {insight}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * SetTimeline - Per-transcript horizontal bit lanes
 * Bits sized proportionally by word count, colored by touchstone/connection status
 */


function SetTimeline({ timelines, onGoToTouchstone, onGoToMix, onGoToBit, transcripts }) {
  const [hoveredBit, setHoveredBit] = useState(null); // { timelineIdx, bitIdx }
  const [filterTouchstones, setFilterTouchstones] = useState([]); // touchstone IDs to filter by
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [nameSearch, setNameSearch] = useState("");

  const ROW_DURATION = 900; // 10 minutes in seconds

  // Collect all touchstones appearing in timelines
  const allTimelineTouchstones = useMemo(() => {
    const map = new Map();
    for (const tl of timelines) {
      for (const bit of tl.bits) {
        if (bit.tsId && bit.tsName && !map.has(bit.tsId)) {
          map.set(bit.tsId, bit.tsName);
        }
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [timelines]);

  // Filter timelines by touchstones + filename search
  const filteredTimelines = useMemo(() => {
    let result = timelines;
    if (filterTouchstones.length > 0) {
      result = result.filter((tl) => {
        const tlTsIds = new Set(tl.bits.filter(b => b.tsId).map(b => b.tsId));
        return filterTouchstones.every(id => tlTsIds.has(id));
      });
    }
    if (nameSearch.trim()) {
      const q = nameSearch.toLowerCase();
      result = result.filter((tl) => tl.source.toLowerCase().includes(q));
    }
    return result;
  }, [timelines, filterTouchstones, nameSearch]);

  const toggleFilter = (tsId) => {
    setFilterTouchstones((prev) =>
      prev.includes(tsId) ? prev.filter(id => id !== tsId) : [...prev, tsId]
    );
  };

  const handleBitClick = (bit, timeline) => {
    if (bit.tsId && onGoToTouchstone) {
      onGoToTouchstone(bit.tsId);
    } else if (onGoToBit) {
      onGoToBit(bit.id, timeline.source);
    }
  };

  return (
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ ...SECTION_HEADER, marginBottom: 0 }}>Set Timelines</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(filterTouchstones.length > 0 || nameSearch.trim()) && (
            <button
              onClick={() => { setFilterTouchstones([]); setNameSearch(""); }}
              style={{ background: "none", border: "1px solid #333", borderRadius: 4, color: "#888", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}
            >Clear</button>
          )}
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Filter by name..."
            style={{ padding: "2px 8px", background: "#0d0d16", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 10, fontFamily: "inherit", width: 120 }}
          />
          <button
            onClick={() => { setFilterOpen(!filterOpen); setFilterSearch(""); }}
            style={{
              background: filterTouchstones.length > 0 ? "#51cf6618" : "#1a1a2a",
              border: `1px solid ${filterTouchstones.length > 0 ? "#51cf6644" : "#333"}`,
              borderRadius: 4, color: filterTouchstones.length > 0 ? "#51cf66" : "#888",
              fontSize: 10, padding: "2px 8px", cursor: "pointer",
            }}
          >{filterTouchstones.length > 0 ? `TS (${filterTouchstones.length})` : "Filter TS"}</button>
        </div>
      </div>

      {/* Touchstone filter dropdown */}
      {filterOpen && (
        <div style={{ marginBottom: 12, padding: 10, background: "#0a0a14", borderRadius: 8, border: "1px solid #1e1e30" }}>
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search touchstones..."
            autoFocus
            style={{ width: "100%", padding: "5px 8px", background: "#0d0d16", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 11, fontFamily: "inherit", marginBottom: 6, boxSizing: "border-box" }}
          />
          <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {allTimelineTouchstones
              .filter(([, name]) => !filterSearch.trim() || name.toLowerCase().includes(filterSearch.toLowerCase()))
              .map(([tsId, tsName]) => {
                const isSelected = filterTouchstones.includes(tsId);
                return (
                  <div
                    key={tsId}
                    onClick={() => toggleFilter(tsId)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                      borderRadius: 4, cursor: "pointer", fontSize: 11,
                      background: isSelected ? "#51cf6612" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#1a1a2a"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: tsColor(tsId), flexShrink: 0 }} />
                    <span style={{ color: isSelected ? "#51cf66" : "#bbb", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tsName}</span>
                    {isSelected && <span style={{ color: "#51cf66", fontSize: 10 }}>✓</span>}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div style={{ maxHeight: 480, overflowY: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredTimelines.map((timeline, tIdx) => {
            const hoveredIdx = hoveredBit?.timelineIdx === tIdx ? hoveredBit.bitIdx : null;
            const hoveredData = hoveredIdx !== null ? timeline.bits[hoveredIdx] : null;
            const p = parseFilenameClient(timeline.source);
            const rc = ratingColor(p.rating);

            return (
              <div key={timeline.source}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>
                    {p.rating && <span style={{ ...RATING_FONT, fontSize: 9, padding: "0px 3px", borderRadius: 2, background: rc.bg, color: rc.fg }}>{p.rating}</span>}
                    <span style={{ color: "#999" }}>{p.title}</span>
                    {p.duration && <span style={{ color: "#74c0fc" }}>{p.duration}</span>}
                  </span>
                  <span style={{ color: "#444" }}>{timeline.bits.length}b</span>
                  {onGoToMix && (
                    <button
                      onClick={() => {
                        const tr = (transcripts || []).find(t => t.name === timeline.source);
                        if (tr) onGoToMix(tr);
                      }}
                      style={{ background: "none", border: "1px solid #333", borderRadius: 3, color: "#a78bfa", fontSize: 9, padding: "1px 5px", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
                    >Mix</button>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", width: "100%", borderRadius: 2, overflow: "hidden" }}>
                  {timeline.bits.map((bit, bIdx) => {
                    const isHovered = hoveredIdx === bIdx;
                    const isFilterHighlight = filterTouchstones.length > 0 && bit.tsId && filterTouchstones.includes(bit.tsId);
                    
                    const bitDuration = bit.wordCount * (timeline.duration / timeline.totalWords);
                    const bitWidth = (bitDuration / ROW_DURATION) * 100;
                    
                    let bg, border;
                    if (bit.tsId) {
                      bg = tsColor(bit.tsId);
                      border = "none";
                    } else if (bit.isConnected) {
                      bg = "#1e2a2a";
                      border = "1px solid #4ecdc466";
                    } else {
                      bg = "#16161f";
                      border = "1px solid #1e1e30";
                    }

                    return (
                      <div
                        key={bit.id}
                        onMouseEnter={() => setHoveredBit({ timelineIdx: tIdx, bitIdx: bIdx })}
                        onMouseLeave={() => setHoveredBit(null)}
                        onClick={() => handleBitClick(bit, timeline)}
                        style={{
                          width: `${bitWidth}%`,
                          height: 16,
                          minWidth: 2,
                          background: bg,
                          border,
                          borderRadius: 2,
                          opacity: filterTouchstones.length > 0 ? (isFilterHighlight ? 1 : 0.3) : (isHovered ? 1 : 0.8),
                          transition: "opacity 0.1s",
                          cursor: "pointer",
                          boxShadow: isHovered ? `0 0 0 1px ${bit.tsId ? tsColor(bit.tsId) : "#4ecdc4"}` : "none",
                          boxSizing: "border-box",
                        }}
                      />
                    );
                  })}
                </div>

                {/* Info panel — always reserved height to prevent layout shift */}
                <div style={{
                  marginTop: 2,
                  padding: "3px 8px",
                  background: hoveredData ? "#0a0a14" : "transparent",
                  borderRadius: 4,
                  fontSize: 10,
                  borderLeft: hoveredData ? `2px solid ${hoveredData.tsId ? tsColor(hoveredData.tsId) : "#4ecdc4"}` : "2px solid transparent",
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  minHeight: 18,
                  visibility: hoveredData ? "visible" : "hidden",
                }}>
                  <span style={{ color: "#ddd", fontWeight: 600 }}>{hoveredData?.title || "\u00A0"}</span>
                  {hoveredData?.tsName && (
                    <span style={{ color: "#888" }}>· {hoveredData.tsName}</span>
                  )}
                  {hoveredData?.tags?.length > 0 && (
                    <span style={{ color: "#555", fontSize: 9 }}>{hoveredData.tags.slice(0, 3).join(", ")}</span>
                  )}
                  <span style={{ color: "#444", fontSize: 9, marginLeft: "auto" }}>{hoveredData?.wordCount || 0}w</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {filteredTimelines.length === 0 && (filterTouchstones.length > 0 || nameSearch.trim()) && (
        <div style={{ textAlign: "center", padding: 20, color: "#555", fontSize: 12 }}>
          No matching setlists.
        </div>
      )}
    </div>
  );
}

/**
 * SetComparison - Side-by-side touchstone sequence comparison between two transcripts
 */
function SetComparison({ timelines }) {
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(1);

  const leftTl = timelines[leftIdx];
  const rightTl = timelines[rightIdx];

  const leftTs = leftTl.bits.filter((b) => b.tsId);
  const rightTs = rightTl.bits.filter((b) => b.tsId);

  const leftTsIds = new Set(leftTs.map((b) => b.tsId));
  const rightTsIds = new Set(rightTs.map((b) => b.tsId));
  const sharedTsIds = new Set([...leftTsIds].filter((id) => rightTsIds.has(id)));

  const selectStyle = {
    padding: "6px 8px",
    background: "#0a0a14",
    border: "1px solid #252538",
    borderRadius: 4,
    color: "#ddd",
    fontSize: 11,
    fontFamily: "inherit",
    width: "100%",
  };

  return (
    <div style={CARD_STYLE}>
      <h3 style={SECTION_HEADER}>Set Comparison</h3>

      {/* Transcript selectors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <select value={leftIdx} onChange={(e) => setLeftIdx(Number(e.target.value))} style={selectStyle}>
          {timelines.map((t, i) => (
            <option key={i} value={i} disabled={i === rightIdx}>{t.source}</option>
          ))}
        </select>
        <span style={{ color: "#444", textAlign: "center", fontSize: 12, flexShrink: 0 }}>vs</span>
        <select value={rightIdx} onChange={(e) => setRightIdx(Number(e.target.value))} style={selectStyle}>
          {timelines.map((t, i) => (
            <option key={i} value={i} disabled={i === leftIdx}>{t.source}</option>
          ))}
        </select>
      </div>

      {/* Summary stats */}
      <div style={{ display: "flex", gap: 20, marginBottom: 12, fontSize: 11 }}>
        <span style={{ color: "#888" }}>
          Shared: <span style={{ color: "#51cf66", fontWeight: 600 }}>{sharedTsIds.size}</span>
        </span>
        <span style={{ color: "#888" }}>
          Only in {leftTl.source.split(".")[0]}: <span style={{ color: "#74c0fc", fontWeight: 600 }}>{leftTsIds.size - sharedTsIds.size}</span>
        </span>
        <span style={{ color: "#888" }}>
          Only in {rightTl.source.split(".")[0]}: <span style={{ color: "#ffa94d", fontWeight: 600 }}>{rightTsIds.size - sharedTsIds.size}</span>
        </span>
      </div>

      {/* Side-by-side sequences */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { ts: leftTs, label: leftTl.source, otherIds: rightTsIds },
          { ts: rightTs, label: rightTl.source, otherIds: leftTsIds },
        ].map(({ ts, label, otherIds }, side) => (
          <div key={side}>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {ts.length === 0 && (
                <div style={{ fontSize: 11, color: "#333", padding: "8px 0" }}>No touchstones</div>
              )}
              {ts.map((b, idx) => {
                const isShared = sharedTsIds.has(b.tsId);
                const color = tsColor(b.tsId);
                return (
                  <div
                    key={`${b.tsId}-${idx}`}
                    style={{
                      padding: "4px 8px",
                      background: isShared ? color + "18" : "#0a0a14",
                      border: `1px solid ${isShared ? color + "55" : "#1a1a2a"}`,
                      borderRadius: 4,
                      fontSize: 11,
                      color: isShared ? color : "#555",
                      fontWeight: isShared ? 600 : 400,
                    }}
                  >
                    {b.tsName || b.title}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * StatCard - Single statistic card
 */
function StatCard({ label, value, color, icon }) {
  return (
    <div style={{ background: "#12121f", border: "1px solid #1e1e30", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 8 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

/**
 * DistribItem - Distribution category
 */
function DistribItem({ label, items, limit = 3 }) {
  const sorted = Object.entries(items).sort(([, a], [, b]) => b - a).slice(0, limit);
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map(([item, count]) => (
          <div key={item} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", color: "#999" }}>
            <span>{item}</span>
            <span style={{ color: "#4ecdc4", fontWeight: 600 }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * HealthMetric - Health indicator with gauge
 */
function HealthMetric({ label, value, description }) {
  const getColor = (v) => v >= 75 ? "#51cf66" : v >= 50 ? "#ffa94d" : "#ff6b6b";
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, background: "#0a0a14", borderRadius: 4, height: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${value}%`, background: getColor(value), transition: "all 0.3s" }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: getColor(value), minWidth: 30 }}>{Math.round(value)}%</div>
      </div>
      <div style={{ fontSize: 10, color: "#666" }}>{description}</div>
    </div>
  );
}

/**
 * Calculate all statistics
 */

// Todo: rootBits are extinct code. 

function calculateStats(topics, matches, touchstonesRaw, rootBits, transcripts) {
  const touchstones = Array.isArray(touchstonesRaw)
    ? touchstonesRaw
    : [...(touchstonesRaw?.confirmed || []), ...(touchstonesRaw?.possible || [])];
  const similarityData = topics.length > 1 ? getSimilarityStats(topics) : null;

  // Tag distribution
  const tagDistribution = {};
  topics.forEach((t) => {
    t.tags?.forEach((tag) => {
      tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
    });
  });
  const topTags = Object.fromEntries(Object.entries(tagDistribution).sort(([, a], [, b]) => b - a));

  // Source distribution
  const sourceDistribution = {};
  topics.forEach((t) => {
    sourceDistribution[t.sourceFile] = (sourceDistribution[t.sourceFile] || 0) + 1;
  });

  // Relationship distribution
  const relationshipDistribution = {};
  matches.forEach((m) => {
    relationshipDistribution[m.relationship] = (relationshipDistribution[m.relationship] || 0) + 1;
  });

  // Metrics
  const bitsWithMatches = new Set(matches.flatMap((m) => [m.sourceId, m.targetId])).size;
  const connectionDensity = topics.length > 0 ? (bitsWithMatches / topics.length) * 100 : 0;

  const similarityDist = similarityData?.similarityDistribution || { veryHigh: 0, high: 0, medium: 0, low: 0 };
  const mergePotential = similarityDist.veryHigh > 0 ? (similarityDist.veryHigh / topics.length) * 100 : 0;

  const positionCoverageCount = topics.filter((t) => t.textPosition).length;
  const coverage = topics.length > 0 ? (positionCoverageCount / topics.length) * 100 : 0;

  const touchstoneInstances = touchstones.reduce((sum, ts) => sum + ts.frequency, 0);
  const touchstoneRate = topics.length > 0 ? (touchstoneInstances / topics.length) * 100 : 0;

  // Duration estimates
  const bitDurations = new Map();
  let totalMaterialDuration = 0;
  topics.forEach((t) => {
    const wordCount = t.fullText ? t.fullText.split(/\s+/).length : 0;
    const durationSec = (wordCount / WORDS_PER_MINUTE) * 60;
    bitDurations.set(t.id, durationSec);
    totalMaterialDuration += durationSec;
  });

  // Per-transcript durations
  const transcriptDurations = (transcripts || [])
    .map((tr) => {
      const trBits = topics.filter((t) => t.transcriptId === tr.id || t.sourceFile === tr.name);
      const duration = trBits.reduce((sum, b) => sum + (bitDurations.get(b.id) || 0), 0);
      return { name: tr.name, duration, bitCount: trBits.length };
    })
    .filter((td) => td.duration > 0)
    .sort((a, b) => b.duration - a.duration);

  // Build bit → touchstone map
  const bitToTouchstone = new Map();
  const tsById = new Map();
  touchstones.forEach((ts) => {
    tsById.set(ts.id, ts);
    (ts.instances || []).forEach((inst) => {
      bitToTouchstone.set(inst.bitId, ts.id);
    });
  });

  // Connected bits set
  const connectedBitIds = new Set(matches.flatMap((m) => [m.sourceId, m.targetId]));

  // Per-source analysis
  const coOccurrence = new Map();
  const transitions = new Map();
  const positionAccum = new Map(); // tsId → { sum, count, min, max }
  let transcriptsWithTouchstones = 0;
  const transcriptTimelines = [];

  const transcriptNames = new Set((transcripts || []).map((tr) => tr.name));
  const sourceFiles = [...new Set(topics.map((t) => t.sourceFile))];
  const allSources = [...new Set([...transcriptNames, ...sourceFiles])];

  allSources.forEach((source) => {
    const trBits = topics
      .filter((t) => t.sourceFile === source)
      .sort((a, b) => (a.textPosition?.startChar ?? 0) - (b.textPosition?.startChar ?? 0));

    if (trBits.length === 0) return;

    // Parse real duration if available
    const p = parseFilenameClient(source);
    let realDuration = 0;
    if (p.duration) {
      const [m, s] = p.duration.split(":").map(Number);
      realDuration = (m * 60) + s;
    }

    // Build timeline metadata
    const bitsWithMeta = trBits.map((bit) => {
      const wordCount = bit.fullText ? bit.fullText.trim().split(/\s+/).length : 1;
      const tsId = bitToTouchstone.get(bit.id) || null;
      const ts = tsId ? tsById.get(tsId) : null;
      return {
        id: bit.id,
        title: bit.title || "Untitled",
        wordCount: Math.max(wordCount, 1),
        tsId,
        tsName: ts?.name || null,
        tags: bit.tags || [],
        isConnected: connectedBitIds.has(bit.id),
      };
    });

    const totalWords = bitsWithMeta.reduce((s, b) => s + b.wordCount, 0);
    // If no real duration, estimate from word count
    const estimatedDuration = realDuration || (totalWords / WORDS_PER_MINUTE) * 60;

    transcriptTimelines.push({
      source,
      bits: bitsWithMeta,
      totalWords,
      duration: estimatedDuration,
    });

    // Touchstone sequence for transitions/positions
    const tsSequence = [];
    trBits.forEach((bit, bitIdx) => {
      const tsId = bitToTouchstone.get(bit.id);
      if (tsId) {
        const normalizedPos = trBits.length > 1 ? bitIdx / (trBits.length - 1) : 0.5;
        tsSequence.push({ tsId, normalizedPos });
      }
    });

    if (tsSequence.length === 0) return;
    transcriptsWithTouchstones++;

    // Accumulate positions with min/max for variance
    tsSequence.forEach(({ tsId, normalizedPos }) => {
      const acc = positionAccum.get(tsId) || { sum: 0, count: 0, min: 1, max: 0 };
      acc.sum += normalizedPos;
      acc.count++;
      acc.min = Math.min(acc.min, normalizedPos);
      acc.max = Math.max(acc.max, normalizedPos);
      positionAccum.set(tsId, acc);
    });

    // Co-occurrence (undirected pairs in same transcript)
    const uniqueTsIds = [...new Set(tsSequence.map((s) => s.tsId))];
    for (let i = 0; i < uniqueTsIds.length; i++) {
      for (let j = i + 1; j < uniqueTsIds.length; j++) {
        const pairKey = [uniqueTsIds[i], uniqueTsIds[j]].sort().join("|");
        coOccurrence.set(pairKey, (coOccurrence.get(pairKey) || 0) + 1);
      }
    }

    // Directed transitions between consecutive touchstones
    for (let i = 0; i < tsSequence.length - 1; i++) {
      const fromId = tsSequence[i].tsId;
      const toId = tsSequence[i + 1].tsId;
      if (fromId === toId) continue;
      const transKey = `${fromId}→${toId}`;
      transitions.set(transKey, (transitions.get(transKey) || 0) + 1);
    }
  });

  // Sort timelines by bit count desc
  transcriptTimelines.sort((a, b) => b.bits.length - a.bits.length);

  // Common transitions (top 10)
  const commonTransitions = [...transitions.entries()]
    .map(([key, count]) => {
      const [fromId, toId] = key.split("→");
      return {
        fromName: tsById.get(fromId)?.name || fromId,
        toName: tsById.get(toId)?.name || toId,
        count,
        percentage: transcriptsWithTouchstones > 0 ? Math.round((count / transcriptsWithTouchstones) * 100) : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Co-occurrence pairs (top 8)
  const coOccurrencePairs = [...coOccurrence.entries()]
    .map(([key, count]) => {
      const [idA, idB] = key.split("|");
      return {
        nameA: tsById.get(idA)?.name || idA,
        nameB: tsById.get(idB)?.name || idB,
        count,
        percentage: transcriptsWithTouchstones > 0 ? Math.round((count / transcriptsWithTouchstones) * 100) : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Set positions with variance
  const setPositions = [...positionAccum.entries()]
    .map(([tsId, acc]) => ({
      id: tsId,
      name: tsById.get(tsId)?.name || tsId,
      avgPosition: acc.count > 0 ? acc.sum / acc.count : 0.5,
      minPosition: acc.min,
      maxPosition: acc.max,
      appearances: acc.count,
    }))
    .sort((a, b) => a.avgPosition - b.avgPosition);

  // Dead zone detection: 4+ consecutive unconnected, non-touchstone bits > 150 words
  let hasDeadZone = false;
  transcriptTimelines.forEach(({ bits }) => {
    let run = 0;
    let runWords = 0;
    bits.forEach((bit) => {
      if (!bit.tsId && !bit.isConnected) {
        run++;
        runWords += bit.wordCount;
        if (run >= 4 && runWords > 150) hasDeadZone = true;
      } else {
        run = 0;
        runWords = 0;
      }
    });
  });

  const insights = generateInsights({
    totalBits: topics.length,
    connectionDensity,
    mergePotential,
    coverage,
    touchstoneRate,
    totalTouchstones: touchstones.length,
    totalRootBits: rootBits.length,
    hasDeadZone,
  });

  return {
    totalBits: topics.length,
    totalMatches: matches.length,
    totalTouchstones: touchstones.length,
    totalRootBits: rootBits.length,
    topTags,
    sourceDistribution,
    relationshipDistribution,
    avgSimilarity: similarityData?.avgSimilarityPerBit || 0,
    similarityDist,
    connectionDensity,
    mergePotential,
    coverage,
    touchstoneRate,
    insights,
    totalMaterialDuration,
    transcriptDurations,
    commonTransitions,
    coOccurrencePairs,
    setPositions,
    transcriptTimelines,
  };
}

/**
 * Generate actionable insights
 */
function generateInsights(metrics) {
  const insights = [];

  if (metrics.connectionDensity < 30) {
    insights.push("💡 Low connection density. Consider parsing more transcripts to find more matches.");
  }
  if (metrics.mergePotential > 20) {
    insights.push("🔄 High merge potential! Many bits could be aggregated into root bits.");
  }
  if (metrics.coverage < 50) {
    insights.push("⚠️ Low position coverage. Adjust boundaries to improve transcript linking.");
  }
  if (metrics.touchstoneRate > 10) {
    insights.push("🎯 Strong recurring themes detected. Touchstones show pattern consistency.");
  }
  if (metrics.totalTouchstones > 5 && metrics.totalBits > 10) {
    insights.push("🌟 Vault is mature! You have good bit organization and recurring patterns.");
  }
  if (metrics.totalRootBits > 0 && metrics.totalRootBits >= metrics.totalTouchstones) {
    insights.push("✨ Root bits are well-organized. Good deduplication and variation tracking.");
  }
  if (metrics.totalBits < 5) {
    insights.push("🚀 Getting started! Parse more transcripts to build a richer vault.");
  }
  if (metrics.hasDeadZone) {
    insights.push("⚠️ Dead zones detected — stretches of 4+ unconnected bits. These sections may contain weak or unanalyzed material.");
  }

  return insights.length > 0 ? insights : ["📊 Vault statistics are nominal. Keep building!"];
}
