import { useState } from "react";

export function ExportTab({
  topics,
  exportVault,
  exportMarkdownZip,
  exportSingleMd,
  syncToVault,
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await syncToVault();
      setSyncResult({ ok: true, written: data.written, errors: data.errors || [] });
    } catch (e) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: 22,
        fontWeight: 700,
        marginBottom: 20,
        color: "#eee",
      }}>
        Export to Obsidian
      </h2>

      <div className="card" style={{ cursor: "default", borderLeft: "3px solid #51cf66" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Sync to Vault</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Write all generated files directly to <code style={{ color: "#74c0fc" }}>~/ownCloud/Comedy/</code>. Updates Jokes/, Touchstones/, Performance Flows/, and the MOC.
        </p>
        <button className="btn btn-primary" onClick={handleSync} disabled={topics.length === 0 || syncing}>
          {syncing ? "Syncing..." : "Sync to Vault"}
        </button>
        {syncResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: syncResult.ok ? "#51cf66" : "#ff6b6b" }}>
            {syncResult.ok
              ? `Wrote ${syncResult.written} files.${syncResult.errors.length > 0 ? ` ${syncResult.errors.length} errors.` : ""}`
              : `Error: ${syncResult.error}`}
          </div>
        )}
      </div>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>JSON Vault Export</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Downloads a structured JSON file containing all markdown files, wikilinks, and tags.
        </p>
        <button className="btn btn-secondary" onClick={exportVault} disabled={topics.length === 0}>
          Download JSON Vault
        </button>
      </div>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Combined Markdown</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Single .md file with all topics, tags, and links. Good for quick review or import.
        </p>
        <button className="btn btn-secondary" onClick={exportSingleMd} disabled={topics.length === 0}>
          Download Combined .md
        </button>
      </div>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Individual Files</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Downloads each topic as a separate .md file. Your browser may ask permission for multiple downloads.
        </p>
        <button className="btn btn-secondary" onClick={exportMarkdownZip} disabled={topics.length === 0}>
          Download All .md Files
        </button>
      </div>

      <div style={{
        marginTop: 20,
        padding: 16,
        background: "#12121f",
        borderRadius: 10,
        border: "1px solid #1e1e30",
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#ffa94d", marginBottom: 8 }}>
          Obsidian Setup Tips
        </div>
        <div style={{ fontSize: 12, color: "#777", lineHeight: 1.7 }}>
          Each exported bit becomes a note with <code style={{ color: "#74c0fc" }}>[[wikilinks]]</code> to matched bits and touchstones. For the best graph experience, enable the core <strong style={{ color: "#bbb" }}>Graph View</strong> plugin and install <strong style={{ color: "#bbb" }}>Dataview</strong> for querying by tag/property. Connection types (same_bit, evolved, callback, related) and confidence scores are included in each note's links section.
        </div>
      </div>
    </div>
  );
}
