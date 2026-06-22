import { useState } from "react";

export function TouchstoneIdealText({ touchstone, onUpdateTouchstoneEdits }) {
  const [editingIdealText, setEditingIdealText] = useState(false);
  const [idealTextDraft, setIdealTextDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);

  return (
    <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#74c0fc", textTransform: "uppercase", letterSpacing: 1 }}>
          Ideal Text
          {touchstone.manualIdealText && <span style={{ color: "#c4b5fd", marginLeft: 6, fontWeight: 400, textTransform: "none" }}>(manually edited)</span>}
          {touchstone.idealText && !touchstone.manualIdealText && <span style={{ color: "#666", marginLeft: 6, fontWeight: 400, textTransform: "none" }}>(synthesized)</span>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {!editingIdealText && (
            <button
              onClick={() => { setIdealTextDraft(touchstone.idealText || ""); setNotesDraft(touchstone.idealTextNotes || ""); setEditingIdealText(true); }}
              style={{ background: "none", border: "1px solid #333", color: "#c4b5fd", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}
            >
              Edit
            </button>
          )}
          {(touchstone.idealTextVersions || []).length > 0 && (
            <button
              onClick={() => setVersionsOpen(!versionsOpen)}
              style={{ background: "none", border: "1px solid #333", color: versionsOpen ? "#74c0fc" : "#666", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}
            >
              Versions ({(touchstone.idealTextVersions || []).length})
            </button>
          )}
        </div>
      </div>
      {editingIdealText ? (
        <div>
          <textarea
            value={idealTextDraft}
            onChange={(e) => setIdealTextDraft(e.target.value)}
            autoFocus
            placeholder="Write or paste the ideal version of this bit..."
            style={{ width: "100%", minHeight: 200, padding: 12, background: "#0a0a14", borderRadius: 6, border: "1px solid #c4b5fd44", fontSize: 12, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 10, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 10, marginBottom: 4 }}>Notes</div>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Notes about this version (what you changed, why, which elements chosen)..."
            style={{ width: "100%", minHeight: 50, padding: 8, background: "#0a0a14", borderRadius: 4, border: "1px solid #333", fontSize: 11, color: "#aaa", lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={() => {
                const versions = [...(touchstone.idealTextVersions || [])];
                const manualIdx = versions.findIndex(v => v.source === "manual");
                const manualVersion = { idealText: idealTextDraft, notes: notesDraft, model: "manual", source: "manual", date: new Date().toISOString() };
                if (manualIdx >= 0) { versions[manualIdx] = manualVersion; } else { versions.push(manualVersion); }
                onUpdateTouchstoneEdits?.(touchstone.id, { idealText: idealTextDraft, idealTextNotes: notesDraft, manualIdealText: true, idealTextVersions: versions });
                setEditingIdealText(false);
              }}
              style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
            >
              Save
            </button>
            <button
              onClick={() => setEditingIdealText(false)}
              style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
            >
              Cancel
            </button>
            {touchstone.manualIdealText && (
              <button
                onClick={() => {
                  onUpdateTouchstoneEdits?.(touchstone.id, { manualIdealText: false });
                  setEditingIdealText(false);
                }}
                style={{ background: "none", border: "1px solid #ffa94d33", color: "#ffa94d", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600, marginLeft: "auto" }}
                title="Allow synthesis to overwrite this text"
              >
                Unlock for synthesis
              </button>
            )}
          </div>
        </div>
      ) : touchstone.idealText ? (
        <>
          <div style={{ padding: 12, background: "#0a0a14", borderRadius: 6, border: "1px solid #1a1a2a", fontSize: 12, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", maxHeight: 500, overflowY: "auto", userSelect: "text" }}>
            {touchstone.idealText}
          </div>
          {touchstone.idealTextNotes && (
            <div
              onClick={() => { setIdealTextDraft(touchstone.idealText || ""); setNotesDraft(touchstone.idealTextNotes); setEditingIdealText(true); }}
              style={{ fontSize: 11, color: "#666", fontStyle: "italic", marginTop: 8, lineHeight: 1.5, cursor: "pointer" }}
              title="Click to edit"
            >
              {touchstone.idealTextNotes}
            </div>
          )}
          {!touchstone.idealTextNotes && (
            <button
              onClick={() => { setIdealTextDraft(touchstone.idealText || ""); setNotesDraft(""); setEditingIdealText(true); }}
              style={{ background: "none", border: "none", color: "#444", fontSize: 10, cursor: "pointer", fontStyle: "italic", padding: 0, marginTop: 6 }}
            >
              + add notes
            </button>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>No ideal text yet. Click Edit to write one, or use Synthesize to generate one.</div>
      )}

      {/* Version History */}
      {versionsOpen && (touchstone.idealTextVersions || []).length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid #1a1a2a", paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Version History</div>
          {[...(touchstone.idealTextVersions || [])].reverse().map((v, idx) => {
            const sourceColor = v.source === "manual" ? "#c4b5fd" : v.model === "gemini" ? "#4285f4" : v.model === "claude" ? "#c4946a" : "#51cf66";
            const sourceLabel = v.source === "manual" ? "Manual edit" : v.source === "send-to" ? `Send to ${v.model}` : `Synthesis (${v.model})`;
            const isActive = touchstone.idealText === v.idealText && touchstone.idealTextNotes === (v.notes || "");
            return (
              <div key={idx} style={{ marginBottom: 10, padding: 10, background: "#0a0a14", borderRadius: 6, border: `1px solid ${isActive ? "#51cf6644" : "#1a1a2a"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: sourceColor }}>
                    {sourceLabel}
                    {isActive && <span style={{ color: "#51cf66", marginLeft: 6, fontWeight: 400 }}>active</span>}
                  </span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#555" }}>{v.date ? new Date(v.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    {!isActive && (
                      <button
                        onClick={() => {
                          onUpdateTouchstoneEdits?.(touchstone.id, { idealText: v.idealText, idealTextNotes: v.notes || "", manualIdealText: v.source === "manual" });
                        }}
                        style={{ background: "none", border: "1px solid #333", color: "#74c0fc", borderRadius: 4, padding: "1px 6px", fontSize: 9, cursor: "pointer", fontWeight: 600 }}
                      >
                        Use this
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const allVersions = [...(touchstone.idealTextVersions || [])];
                        const realIdx = allVersions.length - 1 - idx;
                        allVersions.splice(realIdx, 1);
                        const edits = { idealTextVersions: allVersions };
                        if (isActive && allVersions.length > 0) {
                          const last = allVersions[allVersions.length - 1];
                          edits.idealText = last.idealText;
                          edits.idealTextNotes = last.notes || "";
                          edits.manualIdealText = last.source === "manual";
                        } else if (isActive) {
                          edits.idealText = "";
                          edits.idealTextNotes = "";
                          edits.manualIdealText = false;
                        }
                        onUpdateTouchstoneEdits?.(touchstone.id, edits);
                      }}
                      style={{ background: "none", border: "1px solid #ff6b6b33", color: "#ff6b6b", borderRadius: 4, padding: "1px 6px", fontSize: 9, cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                  {v.idealText}
                </div>
                {v.notes && <div style={{ fontSize: 10, color: "#555", fontStyle: "italic", marginTop: 4 }}>{v.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
