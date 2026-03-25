import { useState } from "react";

export function ExportTab({
  topics,
  exportVault,
  exportMarkdownZip,
  exportSingleMd,
  syncToVault,
  undoVaultSync,
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [undoing, setUndoing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await syncToVault();
      setSyncResult({ ok: true, written: data.written, errors: data.errors || [], hasBackup: data.hasBackup });
    } catch (e) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const data = await undoVaultSync();
      setSyncResult({ ok: true, undone: true, restored: data.restored, removed: data.removed });
    } catch (e) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 className="section-heading">Export to Obsidian</h2>

      <div className="card card-static" style={{ borderLeft: "3px solid #51cf66" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Sync to Vault</div>
        <p className="settings-description" style={{ lineHeight: 1.5 }}>
          Write all generated files directly to <code style={{ color: "#74c0fc" }}>~/ownCloud/Comedy/</code>. Updates Jokes/, Touchstones/, Performance Flows/, and the MOC.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={handleSync} disabled={topics.length === 0 || syncing || undoing}>
            {syncing ? "Syncing..." : "Sync to Vault"}
          </button>
          {syncResult?.ok && !syncResult.undone && (
            <button
              className="btn btn-secondary"
              onClick={handleUndo}
              disabled={undoing}
              title="Restore vault files to their state before the last sync"
            >
              {undoing ? "Undoing..." : "Undo"}
            </button>
          )}
        </div>
        {syncResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: syncResult.ok ? "#51cf66" : "#ff6b6b" }}>
            {syncResult.ok
              ? syncResult.undone
                ? `Undo complete: ${syncResult.restored} restored, ${syncResult.removed} new files removed.`
                : `Wrote ${syncResult.written} files.${syncResult.errors.length > 0 ? ` ${syncResult.errors.length} errors.` : ""}`
              : `Error: ${syncResult.error}`}
          </div>
        )}
      </div>

      <div className="card card-static">
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Combined Markdown</div>
        <p className="settings-description" style={{ lineHeight: 1.5 }}>
          Single .md file with all topics, tags, and links. Good for quick review or import.
        </p>
        <button className="btn btn-secondary" onClick={exportSingleMd} disabled={topics.length === 0}>
          Download Combined .md
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
