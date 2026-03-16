/**
 * ValidationPanel - React component for displaying validation results
 */
export function ValidationPanel({ validationResult }) {
  if (!validationResult) return null;

  const { valid, issues, summary } = validationResult;

  return (
    <div
      style={{
        background: valid ? "#12121f" : "#2a1f1f",
        border: `1px solid ${valid ? "#1e1e30" : "#3a2020"}`,
        borderRadius: "10px",
        padding: "16px",
        marginBottom: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>{valid ? "✓" : "⚠"}</span>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: valid ? "#4ecdc4" : "#ff6b6b",
          }}
        >
          {valid ? "All bits valid" : `${issues.length} validation issues found`}
        </span>
      </div>

      {summary && (
        <div
          style={{
            fontSize: 12,
            color: "#888",
            marginBottom: valid ? 0 : 12,
          }}
        >
          {summary.total} bits: {summary.valid} valid, {summary.invalid} invalid
        </div>
      )}

      {!valid && issues.length > 0 && (
        <div style={{ fontSize: 11 }}>
          <div style={{ marginBottom: 8, color: "#ff8888" }}>Issues:</div>
          {issues.slice(0, 5).map((issue, idx) => (
            <div
              key={idx}
              style={{
                padding: "6px 8px",
                background: "#1a0a0a",
                borderRadius: "4px",
                marginBottom: 4,
                borderLeft: "2px solid #ff6b6b",
              }}
            >
              <div style={{ fontWeight: 600, color: "#ff8888" }}>
                {issue.bitTitle || "Unknown"}
              </div>
              <div style={{ color: "#999", marginTop: 2 }}>
                {issue.error}
              </div>
            </div>
          ))}
          {issues.length > 5 && (
            <div style={{ color: "#666", marginTop: 8 }}>
              ...and {issues.length - 5} more issues
            </div>
          )}
        </div>
      )}
    </div>
  );
}
