import { useState } from "react";

export function ExportTab({
  topics,
  exportVault,
  exportMarkdownZip,
  exportSingleMd,
  previewVaultSync,
  syncToVault,
  undoVaultSync,
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await previewVaultSync();
      setPreview({ ok: true, ...data });
    } catch (e) {
      setPreview({ ok: false, error: e.message });
    } finally {
      setPreviewing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setPreview(null);
    try {
      const data = await syncToVault();
      setSyncResult({ ok: true, written: data.written, errors: data.errors || [], hasBackup: data.hasBackup, pulled: data.pulled || 0, conflicts: data.conflicts || 0 });
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
          Two-way sync with <code style={{ color: "#74c0fc" }}>~/ownCloud/Comedy/</code> — writes <code style={{ color: "#74c0fc" }}>Jokes/</code> (one per touchstone) and <code style={{ color: "#74c0fc" }}>Sets/</code> (one per set), and pulls any title/text/tag edits you made in Obsidian back into topix first. Conflicts resolve in Obsidian's favor.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={handlePreview} disabled={topics.length === 0 || previewing || syncing || undoing} title="See which files would be created or changed, without writing anything">
            {previewing ? "Checking..." : "Preview"}
          </button>
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
        {preview && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            {!preview.ok ? (
              <div style={{ color: "#ff6b6b" }}>Preview failed: {preview.error}</div>
            ) : (preview.pulled === 0 && (preview.created + preview.modified) === 0) ? (
              <div style={{ color: "#888" }}>Vault is up to date — no changes ({preview.unchanged} files unchanged).</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Pulling edits in from Obsidian */}
                {preview.pulled > 0 && (
                  <div style={{ padding: 10, background: "#0d0d16", borderRadius: 8, border: "1px solid #2a2440" }}>
                    <div style={{ color: "#c4b5fd", fontWeight: 600, marginBottom: 6 }}>
                      ↓ Pulling {preview.pulled} edit{preview.pulled !== 1 ? "s" : ""} from Obsidian
                      {preview.conflicts > 0 && (
                        <span style={{ color: "#ffa94d", fontWeight: 400 }}> · {preview.conflicts} conflict{preview.conflicts !== 1 ? "s" : ""} → Obsidian</span>
                      )}
                    </div>
                    {(preview.pulledItems || []).slice(0, 6).map((it) => (
                      <div key={it.id} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8, padding: "1px 0" }}>
                        <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                        <span style={{ color: it.conflict ? "#ffa94d" : "#777", flexShrink: 0 }}>
                          {it.fields.join(", ")}{it.conflict ? " ⚠" : ""}
                        </span>
                      </div>
                    ))}
                    {(preview.pulledItems || []).length > 6 && (
                      <div style={{ fontSize: 11, color: "#666" }}>+{preview.pulledItems.length - 6} more</div>
                    )}
                  </div>
                )}

                {/* Writing files out to the vault */}
                {(preview.created + preview.modified) > 0 ? (
                  <div style={{ padding: 10, background: "#0d0d16", borderRadius: 8, border: "1px solid #1a1a2a" }}>
                    <div style={{ color: "#888", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>↑ Writing to vault</div>
                    <div style={{ display: "flex", gap: 14, marginBottom: Object.keys(preview.folders || {}).length ? 8 : 0 }}>
                      <span style={{ color: "#51cf66", fontWeight: 600 }}>+{preview.created} new</span>
                      <span style={{ color: "#ffa94d", fontWeight: 600 }}>~{preview.modified} changed</span>
                      <span style={{ color: "#666" }}>{preview.unchanged} unchanged</span>
                    </div>
                    {Object.entries(preview.folders || {}).map(([folder, c]) => (
                      <div key={folder} style={{ fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                        <span style={{ color: "#aaa" }}>{folder}</span>
                        <span>
                          {c.created > 0 && <span style={{ color: "#51cf66" }}>+{c.created} </span>}
                          {c.modified > 0 && <span style={{ color: "#ffa94d" }}>~{c.modified}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : preview.pulled > 0 ? (
                  <div style={{ color: "#777", fontSize: 11 }}>No new file changes to write back ({preview.unchanged} unchanged).</div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: syncResult.ok ? "#51cf66" : "#ff6b6b" }}>
            {syncResult.ok
              ? syncResult.undone
                ? `Undo complete: ${syncResult.restored} restored, ${syncResult.removed} new files removed.`
                : `Wrote ${syncResult.written} files.${syncResult.pulled > 0 ? ` Pulled ${syncResult.pulled} edit${syncResult.pulled !== 1 ? "s" : ""} from Obsidian${syncResult.conflicts > 0 ? ` (${syncResult.conflicts} conflict${syncResult.conflicts !== 1 ? "s" : ""} resolved in Obsidian's favor)` : ""}.` : ""}${syncResult.errors.length > 0 ? ` ${syncResult.errors.length} errors.` : ""}`
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
          Each touchstone becomes a joke note in <code style={{ color: "#74c0fc" }}>Jokes/</code> with <code style={{ color: "#74c0fc" }}>[[wikilinks]]</code> to related jokes and the sets it appears in. Each set becomes an ordered list in <code style={{ color: "#74c0fc" }}>Sets/</code> linking its jokes. For the best graph experience, enable the core <strong style={{ color: "#bbb" }}>Graph View</strong> plugin and install <strong style={{ color: "#bbb" }}>Dataview</strong> for querying by tag/property.
        </div>
      </div>
    </div>
  );
}
