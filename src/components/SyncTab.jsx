import { useState, useCallback } from "react";

const SERVER_URL = "http://localhost:3001";

export function SyncTab({
  transcripts,
  topics,
  processing,
  selectedModel,
  parseAll,
  parseUnparsed,
  setShouldStop,
  abortControllerRef,
  onGoToMix,
  onSyncApply,
}) {
  const [syncing, setSyncing] = useState(false);
  const [diff, setDiff] = useState(null);
  const [applying, setApplying] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  const computeDiff = useCallback(async () => {
    setSyncing(true);
    setSyncStatus("Fetching transcript list from Play...");
    setDiff(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/transcripts`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const playEntries = await res.json();

      const playByHash = new Map(playEntries.map((e) => [e.hash, e]));
      const topixByHash = new Map();
      for (const tr of transcripts) {
        if (tr.playHash) topixByHash.set(tr.playHash, tr);
      }

      const toAdd = [];
      const toRename = [];
      const toDelete = [];
      const toLink = []; // existing transcripts matched by name, need playHash set
      let unchanged = 0;

      // Build name index for transcripts without playHash (legacy uploads)
      const unlinkedByName = new Map();
      for (const tr of transcripts) {
        if (!tr.playHash) unlinkedByName.set(tr.name, tr);
      }

      // Check what Play has
      for (const [hash, entry] of playByHash) {
        // Skip entries that don't have a transcript yet — they aren't "in Play" for sync purposes
        if (!entry.has_transcript) continue;

        const existing = topixByHash.get(hash);
        if (existing) {
          // Matched by hash
          if (existing.name !== entry.transcript_filename) {
            toRename.push({ entry, existing });
          } else {
            unchanged++;
          }
        } else {
          // Try matching unlinked transcripts by filename
          const unlinked = unlinkedByName.get(entry.transcript_filename);
          if (unlinked) {
            toLink.push({ entry, existing: unlinked });
            unlinkedByName.delete(entry.transcript_filename);
          } else {
            toAdd.push(entry);
          }
        }
      }

      // Check what Topix has that Play doesn't, or has been deleted on disk
      for (const tr of transcripts) {
        if (tr.playHash) {
          const entry = playByHash.get(tr.playHash);
          if (!entry) {
            // Hash missing from registry entirely
            toDelete.push(tr);
          } else if (!entry.has_transcript) {
            // Filesystem record exists but transcript is gone (clean delete or just md gone)
            toDelete.push(tr);
          }
        }
      }

      const totalPlayWithTranscripts = playEntries.filter((e) => e.has_transcript).length;
      const result = { toAdd, toRename, toDelete, toLink, unchanged, total: totalPlayWithTranscripts };
      setDiff(result);
      const parts = [];
      if (toAdd.length) parts.push(`${toAdd.length} new`);
      if (toLink.length) parts.push(`${toLink.length} linked`);
      if (toRename.length) parts.push(`${toRename.length} renamed`);
      if (toDelete.length) parts.push(`${toDelete.length} deleted`);
      if (unchanged) parts.push(`${unchanged} unchanged`);
      setSyncStatus(parts.length ? parts.join(", ") : "Everything up to date");
    } catch (err) {
      setSyncStatus(`Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [transcripts]);

  const applyChanges = useCallback(async () => {
    if (!diff) return;
    setApplying(true);
    setSyncStatus("Applying changes...");
    try {
      // Fetch text for new transcripts
      const addEntries = [];
      for (const entry of diff.toAdd) {
        const res = await fetch(`${SERVER_URL}/api/transcripts/${entry.hash}`);
        if (!res.ok) throw new Error(`Failed to fetch ${entry.transcript_filename}`);
        const data = await res.json();
        addEntries.push({
          hash: entry.hash,
          name: entry.transcript_filename,
          text: data.text,
        });
      }

      await onSyncApply({
        toAdd: addEntries,
        toRename: diff.toRename,
        toDelete: diff.toDelete,
        toLink: diff.toLink || [],
      });

      setDiff(null);
      setSyncStatus("Sync complete");
    } catch (err) {
      setSyncStatus(`Error applying: ${err.message}`);
    } finally {
      setApplying(false);
    }
  }, [diff, onSyncApply]);

  const hasChanges = diff && (diff.toAdd.length > 0 || diff.toRename.length > 0 || diff.toDelete.length > 0 || diff.toLink.length > 0);

  return (
    <div>
      {/* Sync controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          onClick={computeDiff}
          disabled={syncing || applying}
          style={{ background: "#6c5ce7", minWidth: 120 }}
        >
          {syncing ? "Syncing..." : "Sync with Play"}
        </button>
        {syncStatus && (
          <span style={{ fontSize: 13, color: "#888" }}>{syncStatus}</span>
        )}
      </div>

      {/* Diff preview */}
      {diff && hasChanges && (
        <div className="card" style={{ marginBottom: 20, border: "1px solid #333" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#bbb", margin: 0, textTransform: "uppercase", letterSpacing: 1 }}>
              Sync Preview
            </h3>
            <button
              className="btn btn-primary"
              onClick={applyChanges}
              disabled={applying}
              style={{ background: "#4ecdc4", color: "#000" }}
            >
              {applying ? "Applying..." : "Apply Changes"}
            </button>
          </div>

          {diff.toAdd.length > 0 && (
            <DiffSection label="New" color="#4ecdc4" items={diff.toAdd.map((e) => e.transcript_filename)} />
          )}
          {diff.toLink.length > 0 && (
            <DiffSection label="Linked" color="#a29bfe" items={diff.toLink.map((l) => l.existing.name)} />
          )}
          {diff.toRename.length > 0 && (
            <DiffSection
              label="Renamed"
              color="#ffd93d"
              items={diff.toRename.map((r) => `${r.existing.name} → ${r.entry.transcript_filename}`)}
            />
          )}
          {diff.toDelete.length > 0 && (
            <DiffSection label="Deleted" color="#ff6b6b" items={diff.toDelete.map((tr) => tr.name)} />
          )}
        </div>
      )}

      {/* Parse controls + file list (same as old UploadTab) */}
      {transcripts.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>
              Loaded Files
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              {(() => {
                const unparsedCount = transcripts.filter(
                  (tr) => !topics.some((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
                ).length;
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
          {[...transcripts].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((tr) => {
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

function DiffSection({ label, color, items }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer", fontSize: 13, color, fontWeight: 600, marginBottom: 4 }}
      >
        {expanded ? "▾" : "▸"} {label} ({items.length})
      </div>
      {expanded && (
        <div style={{ paddingLeft: 16 }}>
          {items.map((item, i) => (
            <div key={i} style={{ fontSize: 12, color: "#999", padding: "2px 0", fontFamily: "'JetBrains Mono', monospace" }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
