import { useMemo, useState, useEffect } from "react";
import { getSimilarityStats } from "../utils/similaritySearch";

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
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
export function AnalyticsDashboard({ topics, matches, touchstones, transcripts, onMergeTags, processing, tagMergeResult, onDismissMergeResult }) {
  const stats = useMemo(
    () => calculateStats(topics, matches, touchstones, transcripts),
    [topics, matches, touchstones, transcripts]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      {/* Overview Cards */}
      <StatCard label="Total Bits" value={stats.totalBits} color="#ff6b6b" icon="🎯" />
      <StatCard label="Connections" value={stats.totalMatches} color="#4ecdc4" icon="🔗" />
      <StatCard label="Touchstones" value={stats.totalTouchstones} color="#51cf66" icon="🌳" />
      {stats.totalMaterialDuration > 0 && (
        <StatCard label="Total Material" value={formatDurationMinSec(stats.totalMaterialDuration)} color="#74c0fc" icon="⏱" />
      )}

      {/* Bit Distribution — tags with 2+, scrollable */}
      {stats.filteredTags.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ ...SECTION_HEADER, marginBottom: 0 }}>Bit Distribution <span style={{ fontWeight: 400, fontSize: 10, color: "#555", textTransform: "none" }}>{stats.filteredTags.length} tags</span></h3>
            {onMergeTags && (
              <button
                onClick={onMergeTags}
                disabled={processing}
                style={{
                  padding: "4px 12px", background: processing ? "#333" : "#4ecdc418",
                  border: `1px solid ${processing ? "#333" : "#4ecdc444"}`,
                  color: processing ? "#666" : "#4ecdc4", borderRadius: 5,
                  fontSize: 10, fontWeight: 600, cursor: processing ? "default" : "pointer",
                }}
              >
                {processing ? "Merging..." : "Merge Similar Tags"}
              </button>
            )}
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {stats.filteredTags.map(([tag, count]) => {
                const maxCount = stats.filteredTags[0]?.[1] || 1;
                const pct = (count / maxCount) * 100;
                const color = TOUCHSTONE_PALETTE[hashStr(tag) % TOUCHSTONE_PALETTE.length];
                return (
                  <div key={tag} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "#999", width: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0, textAlign: "right" }}>{tag}</span>
                    <div style={{ flex: 1, background: "#0a0a14", borderRadius: 4, height: 14, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color + "88", borderRadius: 4, minWidth: 2 }} />
                    </div>
                    <span style={{ color: color, fontWeight: 600, fontSize: 11, minWidth: 28, textAlign: "right", flexShrink: 0 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {tagMergeResult && tagMergeResult.length > 0 && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#0a1a0a", border: "1px solid #51cf6633", borderRadius: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#51cf66", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Merged {tagMergeResult.length} tag group{tagMergeResult.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={onDismissMergeResult}
                  style={{ background: "none", border: "1px solid #333", color: "#666", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}
                >
                  dismiss
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {tagMergeResult.map((desc, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#aaa", fontFamily: "'JetBrains Mono', monospace" }}>
                    {desc}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
function calculateStats(topics, matches, touchstonesRaw, transcripts) {
  const touchstones = Array.isArray(touchstonesRaw)
    ? touchstonesRaw
    : [...(touchstonesRaw?.confirmed || []), ...(touchstonesRaw?.possible || [])];
  const similarityData = topics.length > 1 ? getSimilarityStats(topics) : null;

  // Tag distribution — all tags, sorted by count
  const tagDistribution = {};
  topics.forEach((t) => {
    t.tags?.forEach((tag) => {
      tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
    });
  });
  const filteredTags = Object.entries(tagDistribution).filter(([, c]) => c >= 2).sort(([, a], [, b]) => b - a);

  // Relationship distribution
  const relationshipDistribution = {};
  matches.forEach((m) => {
    relationshipDistribution[m.relationship] = (relationshipDistribution[m.relationship] || 0) + 1;
  });

  // Metrics
  const bitsWithMatches = new Set(matches.flatMap((m) => [m.sourceId, m.targetId])).size;
  const isolatedBits = topics.length - bitsWithMatches;
  const connectionDensity = topics.length > 0 ? (bitsWithMatches / topics.length) * 100 : 0;

  const mergePotential = (similarityData?.similarityDistribution?.veryHigh || 0) > 0
    ? (similarityData.similarityDistribution.veryHigh / topics.length) * 100 : 0;

  const positionCoverageCount = topics.filter((t) => t.textPosition).length;
  const coverage = topics.length > 0 ? (positionCoverageCount / topics.length) * 100 : 0;

  const touchstoneInstances = touchstones.reduce((sum, ts) => sum + ts.frequency, 0);
  const touchstoneRate = topics.length > 0 ? (touchstoneInstances / topics.length) * 100 : 0;

  // Total material duration — sum of actual audio durations from transcripts
  let totalMaterialDuration = 0;
  (transcripts || []).forEach((tr) => {
    if (tr.duration_seconds) {
      totalMaterialDuration += tr.duration_seconds;
    }
  });

  // Build bit → touchstone map
  const bitToTouchstone = new Map();
  const tsById = new Map();
  touchstones.forEach((ts) => {
    tsById.set(ts.id, ts);
    (ts.instances || []).forEach((inst) => {
      bitToTouchstone.set(inst.bitId, ts.id);
    });
  });

  // Directed transitions between consecutive touchstones across all sources
  const transitions = new Map();
  let transcriptsWithTouchstones = 0;

  const sourceFiles = [...new Set(topics.map((t) => t.sourceFile))];
  sourceFiles.forEach((source) => {
    const trBits = topics
      .filter((t) => t.sourceFile === source)
      .sort((a, b) => (a.textPosition?.startChar ?? 0) - (b.textPosition?.startChar ?? 0));

    if (trBits.length === 0) return;

    const tsSequence = [];
    trBits.forEach((bit) => {
      const tsId = bitToTouchstone.get(bit.id);
      if (tsId) tsSequence.push(tsId);
    });

    if (tsSequence.length === 0) return;
    transcriptsWithTouchstones++;

    for (let i = 0; i < tsSequence.length - 1; i++) {
      const fromId = tsSequence[i];
      const toId = tsSequence[i + 1];
      if (fromId === toId) continue;
      const transKey = `${fromId}→${toId}`;
      transitions.set(transKey, (transitions.get(transKey) || 0) + 1);
    }
  });

  // Common transitions (top 25)
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
    .slice(0, 25);

  return {
    totalBits: topics.length,
    totalMatches: matches.length,
    totalTouchstones: touchstones.length,
    filteredTags,
    relationshipDistribution,
    avgSimilarity: similarityData?.avgSimilarityPerBit || 0,
    bitsWithMatches,
    isolatedBits,
    connectionDensity,
    mergePotential,
    coverage,
    touchstoneRate,
    totalMaterialDuration,
    commonTransitions,
  };
}
