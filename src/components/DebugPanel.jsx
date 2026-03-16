import { useState } from "react";

export function DebugPanel({ log, onClear }) {
  const [selected, setSelected] = useState(log.length > 0 ? log[log.length - 1].id : null);
  const entry = log.find((e) => e.id === selected) || log[log.length - 1];

  if (log.length === 0) {
    return (
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#090910", borderTop: "2px solid #51cf66",
        padding: "12px 16px", fontSize: 11, color: "#555",
        fontFamily: "'JetBrains Mono', monospace",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ color: "#51cf66", fontWeight: 700 }}>DEBUG</span>
        <span>Waiting for Ollama calls...</span>
        <button onClick={onClear} style={{ marginLeft: "auto", background: "none", border: "1px solid #333", color: "#555", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>close</button>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#090910", borderTop: "2px solid #51cf66",
      maxHeight: "40vh", display: "flex", flexDirection: "column",
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, zIndex: 1000,
    }}>
      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid #1a1a2a", flexShrink: 0 }}>
        <span style={{ color: "#51cf66", fontWeight: 700, marginRight: 4 }}>DEBUG</span>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", flex: 1 }}>
          {log.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              style={{
                padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10,
                background: selected === e.id ? (e.type === "prompt" ? "#1a2a3a" : "#1a2a1a") : "#111",
                border: `1px solid ${selected === e.id ? (e.type === "prompt" ? "#4ecdc4" : "#51cf66") : "#222"}`,
                color: selected === e.id ? (e.type === "prompt" ? "#4ecdc4" : "#51cf66") : "#555",
                whiteSpace: "nowrap",
              }}
            >
              {e.type === "prompt" ? "▶ prompt" : "◀ response"}
              {e.timedOut ? " (frozen)" : ""}
              <span style={{ color: "#444", marginLeft: 4 }}>
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onClear}
          style={{ background: "none", border: "1px solid #333", color: "#555", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, flexShrink: 0 }}
        >
          clear
        </button>
      </div>

      {/* Content */}
      {entry && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {entry.type === "prompt" ? (
            <>
              <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", borderRight: "1px solid #1a1a2a" }}>
                <div style={{ color: "#555", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>System Prompt · {entry.model}</div>
                <pre style={{ margin: 0, color: "#4ecdc4", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{entry.system}</pre>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
                <div style={{ color: "#555", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>User Message</div>
                <pre style={{ margin: 0, color: "#a8d8a8", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{entry.userMsg}</pre>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
              <div style={{ color: "#555", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>
                Raw Response · {entry.model}{entry.timedOut ? " · FROZEN/TIMEOUT" : ""}
              </div>
              <pre style={{ margin: 0, color: "#51cf66", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{entry.rawText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
