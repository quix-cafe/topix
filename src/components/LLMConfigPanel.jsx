import { useState, useEffect } from "react";

const INPUT_STYLE = {
  background: "#0f172a",
  border: "1px solid #2a2a40",
  color: "#ccc",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "'DM Sans', sans-serif",
  width: "100%",
  boxSizing: "border-box",
};

const LABEL_STYLE = {
  fontSize: 11,
  color: "#888",
  marginBottom: 4,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1,
};

export default function LLMConfigPanel() {
  const [geminiKey, setGeminiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [ollamaHighModel, setOllamaHighModel] = useState("");
  const [ollamaModels, setOllamaModels] = useState([]);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/llm/config")
      .then((r) => r.json())
      .then((data) => {
        setGeminiKey(data.geminiKey || "");
        setClaudeKey(data.claudeKey || "");
        setOllamaHighModel(data.ollamaHighModel || "");
        setLoaded(true);
      })
      .catch(() => setStatus("Failed to load config"));

    fetch("http://localhost:11434/api/tags")
      .then((r) => r.json())
      .then((data) => {
        const models = (data.models || []).map((m) => m.name);
        // Add passthru providers (Claude/Gemini via web UI)
        models.push("claude", "gemini");
        setOllamaModels(models);
      })
      .catch(() => setOllamaModels(["claude", "gemini"]));
  }, []);

  const save = async () => {
    setStatus("Saving...");
    try {
      const res = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiKey, claudeKey, ollamaHighModel }),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus("Saved");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  };

  if (!loaded) return <div style={{ fontSize: 12, color: "#555" }}>Loading config...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={LABEL_STYLE}>Gemini API Key</div>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="AIza..."
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <div style={LABEL_STYLE}>Claude API Key</div>
          <input
            type="password"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            placeholder="sk-ant-..."
            style={INPUT_STYLE}
          />
        </div>
      </div>
      <div>
        <div style={LABEL_STYLE}>Ollama High-End Model</div>
        <div style={{ display: "flex", gap: 8 }}>
          {ollamaModels.length > 0 ? (
            <select
              value={ollamaHighModel}
              onChange={(e) => setOllamaHighModel(e.target.value)}
              style={{ ...INPUT_STYLE, width: "auto", minWidth: 250, cursor: "pointer" }}
            >
              <option value="">None</option>
              {ollamaModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={ollamaHighModel}
              onChange={(e) => setOllamaHighModel(e.target.value)}
              placeholder="e.g. llama3.3:70b"
              style={{ ...INPUT_STYLE, maxWidth: 300 }}
            />
          )}
        </div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
          A larger model than your default for high-quality prompts (e.g. 70b+ parameter models)
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={save}
          style={{
            padding: "8px 18px", background: "#51cf6618", border: "1px solid #51cf6644",
            color: "#51cf66", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={async () => {
            setStatus("Restarting passthru server...");
            try {
              const res = await fetch("/api/passthru/restart", { method: "POST" });
              const data = await res.json();
              if (data.status === "restarted") {
                setStatus("Passthru server restarted");
              } else if (data.status === "started_but_not_healthy") {
                setStatus("Passthru started but not yet healthy — check logs");
              } else {
                setStatus(`Passthru: ${data.error || "unknown error"}`);
              }
              setTimeout(() => setStatus(""), 4000);
            } catch (e) {
              setStatus(`Restart failed: ${e.message}`);
            }
          }}
          style={{
            padding: "8px 18px", background: "#ffa94d12", border: "1px solid #ffa94d44",
            color: "#ffa94d", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer",
          }}
        >
          Restart Passthru Server
        </button>
        {status && <span style={{ fontSize: 12, color: status.startsWith("Error") || status.startsWith("Restart failed") ? "#ff6b6b" : "#51cf66" }}>{status}</span>}
      </div>
    </div>
  );
}
