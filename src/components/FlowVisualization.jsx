import { useState } from "react";
import { getPatternDescription } from "../utils/bitFlowAnalyzer";

/**
 * FlowVisualization - Display the comedic structure and pacing of a bit
 */
export function FlowVisualization({ flow }) {
  const [hoveredStage, setHoveredStage] = useState(null);

  if (!flow || !flow.stages || flow.stages.length === 0) {
    return (
      <div style={{ padding: 16, background: "#12121f", borderRadius: 8, color: "#666", fontSize: 12 }}>
        No flow analysis available
      </div>
    );
  }

  const stageColors = {
    setup: { bg: "#74c0fc", text: "#0077be" },
    escalation: { bg: "#ffa94d", text: "#cc7a00" },
    punchline: { bg: "#ff6b6b", text: "#cc2222" },
    tag: { bg: "#51cf66", text: "#0a6b0a" },
    callback: { bg: "#b197fc", text: "#6c19b8" },
    misdirect: { bg: "#f472b6", text: "#ae1f5c" },
    other: { bg: "#888", text: "#444" },
  };

  const getStageColor = (type) => stageColors[type] || stageColors.other;

  // Calculate proportional widths
  const totalChars = flow.stages.reduce((sum, s) => sum + (s.endChar - s.startChar), 0);

  return (
    <div
      style={{
        background: "#12121f",
        border: "1px solid #1e1e30",
        borderRadius: "10px",
        padding: "16px",
        marginBottom: "16px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Comedic Structure
        </div>

        {/* Pattern info */}
        <div
          style={{
            padding: "8px 12px",
            background: "#0a0a14",
            borderRadius: "8px",
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: "#ddd", fontSize: 12 }}>
              {flow.pattern}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
              {getPatternDescription(flow.pattern)}
            </div>
          </div>
          <div
            style={{
              background: "#1a1a2a",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: 11,
              fontWeight: 600,
              color: "#4ecdc4",
            }}
          >
            {flow.rhythm}
          </div>
        </div>

        {/* Timeline visualization */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 2, height: "40px", marginBottom: 8 }}>
            {flow.stages.map((stage, idx) => {
              const width = ((stage.endChar - stage.startChar) / totalChars) * 100;
              const color = getStageColor(stage.type);
              const isHovered = hoveredStage === idx;

              return (
                <div
                  key={idx}
                  onMouseEnter={() => setHoveredStage(idx)}
                  onMouseLeave={() => setHoveredStage(null)}
                  style={{
                    flex: width > 0 ? width : "1",
                    background: color.bg,
                    borderRadius: "6px",
                    cursor: "pointer",
                    opacity: isHovered ? 1 : 0.8,
                    transition: "all 0.15s",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  title={`${stage.type}: ${stage.text.substring(0, 50)}...`}
                >
                  {width > 15 && (
                    <div
                      style={{
                        padding: "4px 6px",
                        fontSize: "10px",
                        fontWeight: 600,
                        color: color.text,
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {stage.type}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hover preview */}
          {hoveredStage !== null && (
            <div
              style={{
                padding: "8px 12px",
                background: "#0a0a14",
                borderRadius: "6px",
                borderLeft: `3px solid ${getStageColor(flow.stages[hoveredStage].type).bg}`,
                fontSize: "11px",
              }}
            >
              <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 4 }}>
                {flow.stages[hoveredStage].type.toUpperCase()} ({hoveredStage + 1}/{flow.stages.length})
              </div>
              <div style={{ color: "#999", lineHeight: 1.4 }}>
                {flow.stages[hoveredStage].text}
              </div>
              <div style={{ color: "#666", fontSize: "10px", marginTop: 4 }}>
                Confidence: {Math.round(flow.stages[hoveredStage].confidence * 100)}%
              </div>
            </div>
          )}
        </div>

        {/* Stage breakdown */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8 }}>
            Breakdown
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {flow.stages.map((stage, idx) => (
              <div
                key={idx}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: getStageColor(stage.type).bg + "20",
                  border: `1px solid ${getStageColor(stage.type).bg}`,
                  borderRadius: "6px",
                  fontSize: "10px",
                  color: getStageColor(stage.type).bg,
                }}
              >
                <span style={{ fontWeight: 600 }}>{idx + 1}</span>
                <span>{stage.type}</span>
                <span style={{ opacity: 0.7 }}>
                  {((stage.endChar - stage.startChar) / totalChars * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analysis info */}
      {flow.analysis && (
        <div
          style={{
            padding: "10px 12px",
            background: "#0a0a14",
            borderRadius: "8px",
            fontSize: "11px",
            borderLeft: "3px solid #4ecdc4",
          }}
        >
          <div style={{ color: "#888", marginBottom: 6 }}>Analysis</div>
          <div style={{ color: "#999" }}>
            {flow.analysis.hasMisdirect && <div>• Contains misdirection</div>}
            {flow.analysis.hasCallback && <div>• Includes callbacks</div>}
            {flow.analysis.isMultiPart && <div>• Multi-part structure (5+ stages)</div>}
            {flow.analysis.estimatedDeliveryTime && (
              <div>• Estimated delivery: ~{flow.analysis.estimatedDeliveryTime} seconds</div>
            )}
          </div>
        </div>
      )}

      {/* Callbacks info */}
      {flow.callbacks && flow.callbacks.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#1a1a2a",
            borderRadius: "8px",
            fontSize: "11px",
            borderLeft: "3px solid #b197fc",
          }}
        >
          <div style={{ color: "#888", marginBottom: 6 }}>Callbacks ({flow.callbacks.length})</div>
          <div style={{ color: "#999" }}>
            {flow.callbacks.map((cb, idx) => (
              <div key={idx} style={{ marginBottom: 2 }}>
                • {cb}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
