export function UploadTab({
  transcripts,
  topics,
  processing,
  selectedModel,
  fileInput,
  handleFiles,
  parseAll,
  parseUnparsed,
  setShouldStop,
  abortControllerRef,
  onGoToMix,
}) {
  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.md,.text"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        className="upload-zone"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#ff6b6b"; }}
        onDragLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a40"; }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.style.borderColor = "#2a2a40";
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>{"🎤"}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#bbb" }}>
          Drop transcript files here
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          .txt or .md files — comedy transcripts, set lists, writing notes
        </div>
      </div>

      {transcripts.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>
              Loaded Files
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              {(() => {
                const unparsedCount = transcripts.filter((tr) => !topics.some((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)).length;
                return unparsedCount > 0 && unparsedCount < transcripts.length ? (
                  <button
                    className="btn btn-primary"
                    onClick={parseUnparsed}
                    disabled={processing}
                    style={{ background: "#4ecdc4", color: "#000" }}
                  >
                    {processing ? "Parsing..." : `Process ${unparsedCount} Unparsed`}
                  </button>
                ) : null;
              })()}
              <button
                className="btn btn-primary"
                onClick={() => parseAll()}
                disabled={processing}
              >
                {processing ? "Parsing..." : `Parse All with ${selectedModel}`}
              </button>
              {processing && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShouldStop(true);
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                    }
                  }}
                  style={{ background: "#ff6b6b", color: "#fff" }}
                >
                  {"⏹"} Stop
                </button>
              )}
            </div>
          </div>
          {transcripts.map((tr) => {
            const parsed = topics.filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id);
            return (
              <div
                key={tr.id}
                className="card"
                style={{ cursor: parsed.length > 0 ? "pointer" : "default" }}
                onClick={() => { if (parsed.length > 0 && onGoToMix) onGoToMix(tr); }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "#ddd" }}>{tr.name}</span>
                    <span style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: "#666",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {tr.text.length.toLocaleString()} chars
                    </span>
                  </div>
                  <div>
                    {parsed.length > 0 ? (
                      <span style={{ fontSize: 12, color: "#4ecdc4" }}>
                        {"✓"} {parsed.length} bits extracted &rarr; Mix
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "#555" }}>Not parsed yet</span>
                    )}
                  </div>
                </div>
                <div style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#555",
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {tr.text.substring(0, 120)}...
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
