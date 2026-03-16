import { useMemo } from "react";
import { getSimilarityStats } from "../utils/similaritySearch";

const WORDS_PER_MINUTE = 150;

function formatDurationMinSec(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * AnalyticsDashboard - Comprehensive statistics and insights
 */
export function AnalyticsDashboard({ topics, matches, touchstones, rootBits, transcripts }) {
  const stats = useMemo(() => calculateStats(topics, matches, touchstones, rootBits, transcripts), [
    topics,
    matches,
    touchstones,
    rootBits,
    transcripts,
  ]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      {/* Overview Cards */}
      <StatCard label="Total Bits" value={stats.totalBits} color="#ff6b6b" icon="📝" />
      <StatCard label="Connections" value={stats.totalMatches} color="#4ecdc4" icon="🔗" />
      <StatCard label="Touchstones" value={stats.totalTouchstones} color="#51cf66" icon="🔄" />
      <StatCard label="Root Bits" value={stats.totalRootBits} color="#ffa94d" icon="🌳" />
      {stats.totalMaterialDuration > 0 && (
        <StatCard label="Total Material" value={formatDurationMinSec(stats.totalMaterialDuration)} color="#74c0fc" icon="⏱" />
      )}

      {/* Detailed Stats */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#12121f",
          border: "1px solid #1e1e30",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
          Bit Distribution
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <DistribItem label="Top Tags" items={stats.topTags} limit={10} />
          <DistribItem label="Sources" items={stats.sourceDistribution} />
        </div>
      </div>

      {/* Transcript Durations */}
      {stats.transcriptDurations.length > 0 && (
        <div
          style={{
            gridColumn: "1 / -1",
            background: "#12121f",
            border: "1px solid #1e1e30",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
            Transcript Durations
          </h3>
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

      {/* Similarity Statistics */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#12121f",
          border: "1px solid #1e1e30",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
          Similarity Analysis
        </h3>

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
              <div
                style={{
                  flex: stats.similarityDist.veryHigh,
                  background: "#ff6b6b",
                  borderRadius: 4,
                  minWidth: 4,
                }}
                title={`Very High: ${stats.similarityDist.veryHigh}`}
              />
              <div
                style={{
                  flex: stats.similarityDist.high,
                  background: "#ffa94d",
                  borderRadius: 4,
                  minWidth: 4,
                }}
                title={`High: ${stats.similarityDist.high}`}
              />
              <div
                style={{
                  flex: stats.similarityDist.medium,
                  background: "#74c0fc",
                  borderRadius: 4,
                  minWidth: 4,
                }}
                title={`Medium: ${stats.similarityDist.medium}`}
              />
              <div
                style={{
                  flex: stats.similarityDist.low,
                  background: "#51cf66",
                  borderRadius: 4,
                  minWidth: 4,
                }}
                title={`Low: ${stats.similarityDist.low}`}
              />
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#666",
                marginTop: 6,
                display: "flex",
                gap: 12,
              }}
            >
              <span>{"Very High (>0.8)"}</span>
              <span>High (0.6-0.8)</span>
              <span>Medium (0.4-0.6)</span>
              <span>{"Low (<0.4)"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Stats */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#12121f",
          border: "1px solid #1e1e30",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
          Connection Analysis
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {Object.entries(stats.relationshipDistribution).map(([relationship, count]) => (
            <div key={relationship} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4, textTransform: "capitalize" }}>
                {relationship.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#4ecdc4" }}>
                {count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Set Flow — Transition Pairs */}
      {stats.commonTransitions.length > 0 && (
        <div
          style={{
            gridColumn: "1 / -1",
            background: "#12121f",
            border: "1px solid #1e1e30",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
            Set Flow
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.commonTransitions.map((t, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 10px", background: "#0a0a14", borderRadius: 6 }}>
                <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.fromName}</span>
                <span style={{ color: "#ffa94d", flexShrink: 0 }}>&rarr;</span>
                <span style={{ color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.toName}</span>
                <span style={{ color: "#74c0fc", fontWeight: 600, flexShrink: 0 }}>{t.count}x</span>
                <span style={{ color: "#666", fontSize: 10, flexShrink: 0 }}>({t.percentage}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Set Position */}
      {stats.setPositions.length > 0 && (
        <div
          style={{
            gridColumn: "1 / -1",
            background: "#12121f",
            border: "1px solid #1e1e30",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
            Set Position
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.setPositions.map((sp) => {
              const posColor = sp.avgPosition < 0.3 ? "#51cf66" : sp.avgPosition > 0.7 ? "#ffa94d" : "#4ecdc4";
              const posLabel = sp.avgPosition < 0.3 ? "Opener" : sp.avgPosition > 0.7 ? "Closer" : "Mid-set";
              return (
                <div key={sp.id} style={{ fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{sp.name}</span>
                    <span style={{ color: posColor, fontWeight: 600, fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{posLabel}</span>
                  </div>
                  <div style={{ background: "#0a0a14", borderRadius: 4, height: 8, overflow: "hidden", position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${Math.max(0, sp.avgPosition * 100 - 2)}%`,
                        width: "4%",
                        minWidth: 6,
                        height: "100%",
                        background: posColor,
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Health Indicators */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#12121f",
          border: "1px solid #1e1e30",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
          Vault Health
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <HealthMetric
            label="Connection Density"
            value={stats.connectionDensity}
            description="% of bits with matches"
          />
          <HealthMetric
            label="Merge Potential"
            value={stats.mergePotential}
            description="% of bits could be merged"
          />
          <HealthMetric
            label="Coverage"
            value={stats.coverage}
            description="% bits in positions/analysis"
          />
          <HealthMetric
            label="Touchstone Rate"
            value={stats.touchstoneRate}
            description="% of bits are recurring"
          />
        </div>
      </div>

      {/* Insights */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#12121f",
          border: "1px solid #1e1e30",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 12, letterSpacing: 1 }}>
          Insights
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stats.insights.map((insight, idx) => (
            <div
              key={idx}
              style={{
                padding: "8px 12px",
                background: "#0a0a14",
                borderRadius: 6,
                borderLeft: "3px solid #4ecdc4",
                fontSize: 12,
                color: "#bbb",
              }}
            >
              {insight}
            </div>
          ))}
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
    <div
      style={{
        background: "#12121f",
        border: "1px solid #1e1e30",
        borderRadius: "10px",
        padding: "16px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
    </div>
  );
}

/**
 * DistribItem - Distribution category
 */
function DistribItem({ label, items, limit = 3 }) {
  const sorted = Object.entries(items)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

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
  const getColor = (v) => {
    if (v >= 75) return "#51cf66";
    if (v >= 50) return "#ffa94d";
    return "#ff6b6b";
  };

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, background: "#0a0a14", borderRadius: 4, height: 8, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${value}%`,
              background: getColor(value),
              transition: "all 0.3s",
            }}
          />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: getColor(value), minWidth: 30 }}>
          {Math.round(value)}%
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#666" }}>{description}</div>
    </div>
  );
}

/**
 * Calculate all statistics
 */
function calculateStats(topics, matches, touchstonesRaw, rootBits, transcripts) {
  const touchstones = Array.isArray(touchstonesRaw) ? touchstonesRaw : [...(touchstonesRaw?.confirmed || []), ...(touchstonesRaw?.possible || [])];
  const similarityData = topics.length > 1 ? getSimilarityStats(topics) : null;

  // Tag distribution
  const tagDistribution = {};
  topics.forEach((t) => {
    t.tags?.forEach((tag) => {
      tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
    });
  });
  const topTags = Object.fromEntries(
    Object.entries(tagDistribution).sort(([, a], [, b]) => b - a)
  );

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

  const similarityDist = similarityData?.similarityDistribution || {
    veryHigh: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

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
  const transcriptDurations = (transcripts || []).map((tr) => {
    const trBits = topics.filter((t) => t.transcriptId === tr.id || t.sourceFile === tr.name);
    const duration = trBits.reduce((sum, b) => sum + (bitDurations.get(b.id) || 0), 0);
    return { name: tr.name, duration, bitCount: trBits.length };
  }).filter((td) => td.duration > 0).sort((a, b) => b.duration - a.duration);

  // Build bit → touchstone map
  const bitToTouchstone = new Map();
  const tsById = new Map();
  touchstones.forEach((ts) => {
    tsById.set(ts.id, ts);
    (ts.instances || []).forEach((inst) => {
      bitToTouchstone.set(inst.bitId, ts.id);
    });
  });

  // Co-occurrence & transition analytics
  const coOccurrence = new Map(); // "tsA|tsB" → count (sorted pair key)
  const transitions = new Map();  // "tsA→tsB" → count (directed)
  const positionAccum = new Map(); // tsId → {sum, count}
  let transcriptsWithTouchstones = 0;

  // For each transcript, get ordered sequence of touchstones
  const transcriptNames = new Set((transcripts || []).map((tr) => tr.name));
  const sourceFiles = [...new Set(topics.map((t) => t.sourceFile))];
  const allSources = [...new Set([...transcriptNames, ...sourceFiles])];

  allSources.forEach((source) => {
    const trBits = topics
      .filter((t) => t.sourceFile === source)
      .sort((a, b) => {
        const aStart = a.textPosition?.startChar ?? 0;
        const bStart = b.textPosition?.startChar ?? 0;
        return aStart - bStart;
      });

    // Map to touchstone sequence (skip bits with no touchstone)
    const tsSequence = [];
    trBits.forEach((bit, bitIdx) => {
      const tsId = bitToTouchstone.get(bit.id);
      if (tsId) {
        tsSequence.push({ tsId, normalizedPos: trBits.length > 1 ? bitIdx / (trBits.length - 1) : 0.5 });
      }
    });

    if (tsSequence.length === 0) return;
    transcriptsWithTouchstones++;

    // Accumulate set positions
    tsSequence.forEach(({ tsId, normalizedPos }) => {
      const acc = positionAccum.get(tsId) || { sum: 0, count: 0 };
      acc.sum += normalizedPos;
      acc.count++;
      positionAccum.set(tsId, acc);
    });

    // Unique touchstone IDs in this transcript for co-occurrence
    const uniqueTsIds = [...new Set(tsSequence.map((s) => s.tsId))];
    for (let i = 0; i < uniqueTsIds.length; i++) {
      for (let j = i + 1; j < uniqueTsIds.length; j++) {
        const pairKey = [uniqueTsIds[i], uniqueTsIds[j]].sort().join('|');
        coOccurrence.set(pairKey, (coOccurrence.get(pairKey) || 0) + 1);
      }
    }

    // Directed transitions between consecutive touchstones
    for (let i = 0; i < tsSequence.length - 1; i++) {
      const fromId = tsSequence[i].tsId;
      const toId = tsSequence[i + 1].tsId;
      if (fromId === toId) continue; // skip self-transitions
      const transKey = `${fromId}→${toId}`;
      transitions.set(transKey, (transitions.get(transKey) || 0) + 1);
    }
  });

  // Build sorted common transitions (top 10)
  const commonTransitions = [...transitions.entries()]
    .map(([key, count]) => {
      const [fromId, toId] = key.split('→');
      const fromTs = tsById.get(fromId);
      const toTs = tsById.get(toId);
      return {
        fromName: fromTs?.name || fromId,
        toName: toTs?.name || toId,
        count,
        percentage: transcriptsWithTouchstones > 0 ? Math.round((count / transcriptsWithTouchstones) * 100) : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Build set positions
  const setPositions = [...positionAccum.entries()]
    .map(([tsId, acc]) => {
      const ts = tsById.get(tsId);
      return {
        id: tsId,
        name: ts?.name || tsId,
        avgPosition: acc.count > 0 ? acc.sum / acc.count : 0.5,
        appearances: acc.count,
      };
    })
    .sort((a, b) => a.avgPosition - b.avgPosition);

  // Generate insights
  const insights = generateInsights({
    totalBits: topics.length,
    connectionDensity,
    mergePotential,
    coverage,
    touchstoneRate,
    totalTouchstones: touchstones.length,
    totalRootBits: rootBits.length,
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
    setPositions,
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

  return insights.length > 0 ? insights : ["📊 Vault statistics are nominal. Keep building!"];
}
