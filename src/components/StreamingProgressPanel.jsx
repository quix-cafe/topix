export function StreamingProgressPanel({ progress, foundBits, processing, status, huntProgress, onDismiss }) {
  // Show panel whenever ANY LLM process is active
  const hasActivity = progress || processing || huntProgress;
  if (!hasActivity) return null;

  // Determine the active process type for header color/label
  const isStreaming = !!progress;
  const isHunting = !!huntProgress && !huntProgress.status?.startsWith("Done");

  const accentColor = isStreaming ? "#ffa94d" : isHunting ? "#da77f2" : "#4ecdc4";
  const processLabel = isStreaming ? "PARSING"
    : isHunting ? "HUNTING TOUCHSTONES"
    : "PROCESSING";

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      background: "#0a0a14",
      borderTop: `3px solid ${accentColor}`,
      maxHeight: "350px",
      overflowY: "auto",
      padding: "16px 32px",
      zIndex: isHunting ? 1001 : 50,
      boxShadow: `0 -8px 24px ${accentColor}26`,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "inline-block",
            width: 10, height: 10,
            borderRadius: "50%",
            background: accentColor,
            animation: "pulse 1s infinite",
            boxShadow: `0 0 8px ${accentColor}cc`,
          }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: accentColor, textTransform: "uppercase", letterSpacing: 1.5 }}>
            {processLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#666", fontWeight: 600 }}>
          {progress && <span>{progress.currentBit} bits found</span>}
          {huntProgress && <span>{huntProgress.found} matches found</span>}
          {onDismiss && (
            <button
              onClick={onDismiss}
              title="Dismiss"
              style={{
                background: "none", border: "1px solid #333", color: "#888",
                borderRadius: 4, padding: "2px 8px", fontSize: 12, cursor: "pointer",
                lineHeight: 1, fontWeight: 700,
              }}
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Progress bar — parsing */}
      {progress && progress.totalBits > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 8, background: "#1a1a2a", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(progress.currentBit / progress.totalBits) * 100}%`,
                background: `linear-gradient(90deg, ${accentColor}, #ff6b6b)`,
                transition: "width 0.2s",
              }} />
            </div>
            <span style={{ fontSize: 11, color: accentColor, fontWeight: 700, minWidth: 40 }}>
              {Math.round((progress.currentBit / progress.totalBits) * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Progress bar — hunt */}
      {huntProgress && huntProgress.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 8, background: "#1a1a2a", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(huntProgress.current / huntProgress.total) * 100}%`,
                background: `linear-gradient(90deg, #da77f2, #be4bdb)`,
                transition: "width 0.2s",
              }} />
            </div>
            <span style={{ fontSize: 11, color: "#da77f2", fontWeight: 700, minWidth: 60 }}>
              {huntProgress.current}/{huntProgress.total}
            </span>
          </div>
        </div>
      )}

      {/* Status line — always shown when there's a status */}
      {status && (
        <div style={{
          marginBottom: 12,
          padding: "10px 14px",
          background: "#12121f",
          borderRadius: "8px",
          borderLeft: `4px solid ${accentColor}`,
          fontSize: 11,
          color: accentColor,
          lineHeight: 1.4,
        }}>
          {status}
        </div>
      )}

      {/* Streamed text output — parsing only */}
      {progress && progress.streamedText && (
        <div style={{
          marginBottom: 12,
          padding: "12px 14px",
          background: "#12121f",
          borderRadius: "8px",
          borderLeft: "4px solid #4ecdc4",
          fontSize: 11,
          color: "#4ecdc4",
          fontFamily: "'JetBrains Mono', monospace",
          maxHeight: "150px",
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.4,
          boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
        }}>
          <div style={{ marginBottom: 8, color: "#666", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>
            Ollama Output:
          </div>
          {progress.streamedText.substring(Math.max(0, progress.streamedText.length - 800))}
        </div>
      )}

      {/* Hunt status detail */}
      {huntProgress && huntProgress.status && (
        <div style={{
          marginBottom: 12,
          padding: "10px 12px",
          background: "#12121f",
          borderRadius: "6px",
          borderLeft: "3px solid #da77f2",
          fontSize: 10,
          color: "#da77f2",
        }}>
          {huntProgress.status}
        </div>
      )}

      {/* Hunt LLM prompt/response */}
      {huntProgress && huntProgress.lastPrompt && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            padding: "10px 12px",
            background: "#12121f",
            borderRadius: "6px",
            borderLeft: "3px solid #da77f2",
            fontSize: 10,
            maxHeight: 200,
            overflowY: "auto",
          }}>
            <div style={{ color: "#da77f2", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
              <span>LLM Prompt</span>
              <span style={{ color: "#666", fontWeight: 400 }}>Batch {huntProgress.current}/{huntProgress.total}</span>
            </div>
            <pre style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#aaa",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              lineHeight: 1.4,
            }}>{huntProgress.lastPrompt}</pre>
          </div>
          {huntProgress.lastResponse && (
            <div style={{
              marginTop: 6,
              padding: "10px 12px",
              background: "#12121f",
              borderRadius: "6px",
              borderLeft: "3px solid #4ecdc4",
              fontSize: 10,
              maxHeight: 200,
              overflowY: "auto",
            }}>
              <div style={{ color: "#4ecdc4", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>
                LLM Response
              </div>
              <pre style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#aaa",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                lineHeight: 1.4,
              }}>{huntProgress.lastResponse}</pre>
            </div>
          )}
        </div>
      )}

      {/* Hunt matches found */}
      {huntProgress && huntProgress.recentMatches && huntProgress.recentMatches.length > 0 && (
        <div style={{
          marginBottom: 12,
          padding: "10px 12px",
          background: "#12121f",
          borderRadius: "6px",
          borderLeft: "3px solid #51cf66",
          fontSize: 10,
          maxHeight: 180,
          overflowY: "auto",
        }}>
          <div style={{ color: "#666", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>
            Matches Found ({huntProgress.recentMatches.length}):
          </div>
          {huntProgress.recentMatches.map((m, idx) => (
            <div key={idx} style={{ paddingLeft: 8, marginBottom: 6, borderBottom: "1px solid #1a1a2a", paddingBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#ddd", fontWeight: 600 }}>
                  "{m.sourceTitle}" ↔ "{m.candidateTitle}"
                </span>
                <span style={{
                  color: m.relationship === "same_bit" ? "#ff6b6b" : "#ffa94d",
                  fontWeight: 700,
                  marginLeft: 8,
                  flexShrink: 0,
                }}>
                  {m.percentage}% {m.relationship}
                </span>
              </div>
              {m.reason && (
                <div style={{ color: "#888", marginTop: 2, fontStyle: "italic" }}>
                  {m.reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent found bits */}
      {foundBits && foundBits.length > 0 && (
        <div style={{
          marginTop: 8,
          padding: "10px 12px",
          background: "#12121f",
          borderRadius: "6px",
          borderLeft: "3px solid #51cf66",
          fontSize: 10,
        }}>
          <div style={{ color: "#666", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>
            Found Bits:
          </div>
          {foundBits.slice(-5).map((bit, idx) => (
            <div key={idx} style={{ paddingLeft: 12, marginBottom: 4, color: "#51cf66" }}>
              <span style={{ fontWeight: 700 }}>{bit.title}</span>
              {bit.tags && <span style={{ color: "#888", marginLeft: 8 }}>({bit.tags.slice(0, 2).join(", ")})</span>}
            </div>
          ))}
        </div>
      )}

      {/* Waiting indicator — only when streaming with no output yet */}
      {progress && !progress.streamedText && (
        <div style={{
          padding: "12px 14px",
          background: "#12121f",
          borderRadius: "6px",
          borderLeft: "3px solid #888",
          fontSize: 11,
          color: "#999",
          fontStyle: "italic",
        }}>
          Waiting for streaming output from Ollama...
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
