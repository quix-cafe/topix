export function DedupTab({
  dedupResults,
  dedupRunning,
  processing,
  topics,
  selectedModel,
  runDedup,
  mergeDedupPair,
  dismissDedupPair,
}) {
  const pendingResults = dedupResults.filter((r) => r.status === "pending");
  const mergedResults = dedupResults.filter((r) => r.status === "merged");
  const dismissedResults = dedupResults.filter((r) => r.status === "dismissed");
  const sourceFiles = [...new Set((topics || []).map((b) => b.sourceFile))];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 22, fontWeight: 700, color: "#eee", margin: 0,
        }}>
          Duplicate Detection
        </h2>
        <button
          className="btn btn-primary"
          onClick={runDedup}
          disabled={dedupRunning || processing || topics.length < 2}
          style={{ opacity: (dedupRunning || processing || topics.length < 2) ? 0.4 : 1 }}
        >
          {dedupRunning ? "Scanning..." : "Run Dedup Scan"}
        </button>
      </div>

      <p style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
        Uses {selectedModel} to compare bits and find duplicates — same joke parsed multiple times,
        accidentally split bits, or overlapping text selections. Works within and across transcripts.
      </p>

      {/* Pre-scan info */}
      {dedupResults.length === 0 && !dedupRunning && (
        <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{"🔍"}</div>
          {topics.length < 2 ? (
            <div>
              <div style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>Need at least 2 bits to check for duplicates.</div>
              <div style={{ fontSize: 12, color: "#666" }}>
                Upload and parse transcripts first.
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>
                Ready to scan {topics.length} bits across {sourceFiles.length} transcript{sourceFiles.length !== 1 ? "s" : ""}.
              </div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
                {sourceFiles.map((f) => {
                  const count = topics.filter((t) => t.sourceFile === f).length;
                  return `${f} (${count} bits)`;
                }).join(" / ")}
              </div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 12 }}>
                Click "Run Dedup Scan" to have {selectedModel} compare all bits for duplicates.
                Bits are sent in batches of 25 to stay within context limits.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Running indicator */}
      {dedupRunning && (
        <div style={{ textAlign: "center", padding: 40, color: "#ffa94d" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "pulse 1s infinite" }}>{"⏳"}</div>
          <div style={{ marginBottom: 8 }}>
            Scanning {topics.length} bits with {selectedModel}...
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {Math.ceil(topics.length / 25)} batch{Math.ceil(topics.length / 25) !== 1 ? "es" : ""} to process.
            Check the status bar for progress.
          </div>
        </div>
      )}

      {/* Results */}
      {dedupResults.length > 0 && (
        <div>
          {/* Summary bar */}
          <div style={{
            marginBottom: 16, padding: "10px 14px", background: "#0d0d16",
            borderRadius: 8, display: "flex", gap: 16, fontSize: 12, color: "#888",
          }}>
            <span style={{ color: pendingResults.length > 0 ? "#ffa94d" : "#666" }}>
              {pendingResults.length} pending
            </span>
            <span style={{ color: mergedResults.length > 0 ? "#51cf66" : "#666" }}>
              {mergedResults.length} merged
            </span>
            <span style={{ color: dismissedResults.length > 0 ? "#888" : "#666" }}>
              {dismissedResults.length} dismissed
            </span>
            <span style={{ color: "#555" }}>
              {dedupResults.length} total pairs found
            </span>
          </div>

          {/* Pending results */}
          {pendingResults.map((result) => (
            <div key={result.id} className="card" style={{
              cursor: "default",
              borderLeft: `4px solid ${result.confidence > 0.8 ? "#ff6b6b" : result.confidence > 0.6 ? "#ffa94d" : "#4ecdc4"}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {Math.round(result.confidence * 100)}% confidence
                </div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  {result.bitA.sourceFile === result.bitB.sourceFile
                    ? `Same transcript: ${result.bitA.sourceFile}`
                    : `Cross-transcript`}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, padding: 10, background: "#0a0a14", borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#eee", marginBottom: 4 }}>{result.bitA.title}</div>
                  <div style={{ color: "#777", fontSize: 11, marginBottom: 4 }}>{result.bitA.sourceFile}</div>
                  <div style={{ color: "#999", lineHeight: 1.4, maxHeight: 80, overflow: "hidden" }}>
                    {(result.bitA.fullText || result.bitA.summary || "").substring(0, 200)}
                    {(result.bitA.fullText || "").length > 200 ? "..." : ""}
                  </div>
                </div>
                <div style={{ flex: 1, padding: 10, background: "#0a0a14", borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#eee", marginBottom: 4 }}>{result.bitB.title}</div>
                  <div style={{ color: "#777", fontSize: 11, marginBottom: 4 }}>{result.bitB.sourceFile}</div>
                  <div style={{ color: "#999", lineHeight: 1.4, maxHeight: 80, overflow: "hidden" }}>
                    {(result.bitB.fullText || result.bitB.summary || "").substring(0, 200)}
                    {(result.bitB.fullText || "").length > 200 ? "..." : ""}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginBottom: 10 }}>
                {result.reason || "Detected as potential duplicate"}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: "4px 12px" }}
                  onClick={() => mergeDedupPair(result, result.bitA.id)}
                  title={`Keep "${result.bitA.title}", remove "${result.bitB.title}"`}
                >
                  Keep A
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: "4px 12px" }}
                  onClick={() => mergeDedupPair(result, result.bitB.id)}
                  title={`Keep "${result.bitB.title}", remove "${result.bitA.title}"`}
                >
                  Keep B
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: "4px 12px" }}
                  onClick={() => dismissDedupPair(result.id)}
                >
                  Not a duplicate
                </button>
              </div>
            </div>
          ))}

          {/* Show merged/dismissed results */}
          {(mergedResults.length > 0 || dismissedResults.length > 0) && (
            <div style={{ marginTop: 16, padding: 12, background: "#0d0d16", borderRadius: 8, fontSize: 11, color: "#555" }}>
              <div style={{ fontWeight: 600, color: "#666", marginBottom: 6 }}>
                Resolved ({mergedResults.length + dismissedResults.length})
              </div>
              {dedupResults.filter((r) => r.status !== "pending").map((r) => (
                <div key={r.id} style={{ marginBottom: 4 }}>
                  <span style={{ color: r.status === "merged" ? "#51cf66" : "#666" }}>
                    {r.status === "merged" ? "Merged" : "Dismissed"}:
                  </span>
                  {" "}{r.bitA.title} / {r.bitB.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
