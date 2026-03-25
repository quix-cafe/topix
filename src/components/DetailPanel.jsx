import { useState } from "react";
import { BoundaryAdjuster } from "./BoundaryAdjuster";
import { BitEditor } from "./BitEditor";
import { BitJoiner } from "./BitJoiner";
import { getBitTouchstones } from "../utils/touchstoneDetector";
import { searchTouchstones } from "../utils/touchstoneSearch";
import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";

export function DetailPanel({
  selectedTopic,
  selectedTranscript,
  transcripts,
  adjustingBit,
  editingMode,
  touchstones,
  topics,
  setSelectedTopic,
  setAdjustingBit,
  setEditingMode,
  setActiveTab,
  onGoToMix,
  onGoToTouchstone,
  handleBoundaryChange,
  handleSplitBit,
  handleJoinBits,
  getMatchesForTopic,
  onAddToTouchstone,
  onRemoveFromTouchstone,
  onBaptize,
  onRename,
  onReparseTags,
  onCommuneBit,
  onDeleteBit,
  onApproveGap,
  onCreateTouchstone,
}) {
  const [addToTouchstoneOpen, setAddToTouchstoneOpen] = useState(false);
  const [touchstoneSearch, setTouchstoneSearch] = useState("");
  const [addedFeedback, setAddedFeedback] = useState(null);
  const [baptizing, setBaptizing] = useState(false);
  const [communing, setCommuning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  if (!selectedTopic) return null;

  // Resolve transcript from the bit's source, falling back to the tab-level selectedTranscript
  const resolvedTranscript =
    selectedTranscript ||
    (transcripts || []).find(
      (tr) => tr.id === selectedTopic.transcriptId || tr.name === selectedTopic.sourceFile
    ) ||
    null;

  const allTouchstones = Array.isArray(touchstones)
    ? touchstones
    : [...(touchstones?.confirmed || []), ...(touchstones?.possible || []), ...(touchstones?.rejected || [])];
  const topicTouchstones = getBitTouchstones(selectedTopic.id, allTouchstones);

  // Estimated delivery from bitFlow
  const estimatedDelivery = selectedTopic.bitFlow?.analysis?.estimatedDeliveryTime;

  return (
    <div className="detail-panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "0 0 12px", borderBottom: "1px solid #1a1a2a", flexShrink: 0, position: "sticky", top: 0, background: "inherit", zIndex: 1 }}>
        <div style={{ flex: 1 }}>
          {renaming ? (
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) {
                  onRename?.(selectedTopic.id, renameValue.trim());
                  setRenaming(false);
                } else if (e.key === "Escape") {
                  setRenaming(false);
                }
              }}
              onBlur={() => {
                if (renameValue.trim() && renameValue.trim() !== selectedTopic.title) {
                  onRename?.(selectedTopic.id, renameValue.trim());
                }
                setRenaming(false);
              }}
              autoFocus
              style={{
                fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: "#eee",
                background: "#0d0d16", border: "1px solid #2a2a40", borderRadius: 6,
                padding: "4px 8px", width: "100%", boxSizing: "border-box",
              }}
            />
          ) : (
            <h2
              onClick={() => { if (onRename) { setRenameValue(selectedTopic.title || ""); setRenaming(true); } }}
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 20,
                fontWeight: 700,
                color: "#eee",
                cursor: onRename ? "text" : undefined,
              }}
              title={onRename ? "Click to rename" : undefined}
            >
              {selectedTopic.title}
            </h2>
          )}
        </div>
        <button
          onClick={() => setSelectedTopic(null)}
          style={{
            background: "none",
            border: "none",
            color: "#666",
            fontSize: 20,
            cursor: "pointer",
            marginLeft: 12,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 16 }}>

      {/* Edit buttons - only show when not in editing mode and transcript is available */}
      {!adjustingBit && editingMode !== "split" && editingMode !== "join" && selectedTopic.textPosition && resolvedTranscript && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          <button
            onClick={() => setAdjustingBit(selectedTopic)}
            style={{ padding: "4px 8px", background: "#ffa94d18", color: "#ffa94d", border: "1px solid #ffa94d44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
          >Adjust</button>
          <button
            onClick={() => setEditingMode("split")}
            style={{ padding: "4px 8px", background: "#74c0fc18", color: "#74c0fc", border: "1px solid #74c0fc44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
          >Split</button>
          {onGoToMix && (
            <button
              onClick={() => {
                const tr = (transcripts || []).find(
                  (t) => t.id === selectedTopic.transcriptId || t.name === selectedTopic.sourceFile
                );
                if (tr) onGoToMix(tr, selectedTopic.id);
              }}
              style={{ padding: "4px 8px", background: "#4ecdc418", color: "#4ecdc4", border: "1px solid #4ecdc444", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
            >Mix</button>
          )}
          {onBaptize && selectedTopic.fullText?.trim() && (
            <button
              onClick={async () => {
                setBaptizing(true);
                try { await onBaptize(selectedTopic.id); } finally { setBaptizing(false); }
              }}
              disabled={baptizing}
              style={{ padding: "4px 8px", background: baptizing ? "#33333380" : "#da77f218", color: baptizing ? "#888" : "#da77f2", border: `1px solid ${baptizing ? "#33333380" : "#da77f244"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: baptizing ? "not-allowed" : "pointer" }}
            >{baptizing ? "Baptizing..." : "Baptize"}</button>
          )}
          {onCommuneBit && selectedTopic.fullText?.trim() && getMatchesForTopic(selectedTopic.id).length > 0 && (
            <button
              onClick={async () => {
                setCommuning(true);
                try { await onCommuneBit(selectedTopic.id); } finally { setCommuning(false); }
              }}
              disabled={communing}
              style={{ padding: "4px 8px", background: communing ? "#33333380" : "#339af018", color: communing ? "#888" : "#339af0", border: `1px solid ${communing ? "#33333380" : "#339af044"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: communing ? "not-allowed" : "pointer" }}
            >{communing ? "Communing..." : `Commune (${getMatchesForTopic(selectedTopic.id).length})`}</button>
          )}
          {onDeleteBit && (
            <button
              onClick={() => {
                if (!window.confirm(`Delete "${selectedTopic.title}"? This cannot be undone.`)) return;
                // Approve the gap left behind
                if (onApproveGap && selectedTopic.textPosition && selectedTopic.sourceFile) {
                  const gapKey = `${selectedTopic.sourceFile}:${selectedTopic.textPosition.startChar}-${selectedTopic.textPosition.endChar}`;
                  onApproveGap(gapKey);
                }
                onDeleteBit(selectedTopic.id);
                setSelectedTopic(null);
              }}
              style={{ padding: "4px 8px", background: "#ff6b6b18", color: "#ff6b6b", border: "1px solid #ff6b6b44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
            >Delete</button>
          )}
        </div>
      )}

      {/* View in Mix — standalone for bits without textPosition */}
      {!adjustingBit && editingMode !== "split" && editingMode !== "join" && !selectedTopic.textPosition && onGoToMix && resolvedTranscript && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => {
              const tr = (transcripts || []).find(
                (t) => t.id === selectedTopic.transcriptId || t.name === selectedTopic.sourceFile
              );
              if (tr) onGoToMix(tr, selectedTopic.id);
            }}
            style={{
              width: "100%", padding: "10px", background: "#4ecdc418", color: "#4ecdc4",
              border: "1px solid #4ecdc444", borderRadius: "8px", fontWeight: 600, fontSize: "12px", cursor: "pointer",
            }}
          >
            View in Mix
          </button>
        </div>
      )}

      {/* No transcript warning — skip for note-promoted bits */}
      {!adjustingBit && editingMode !== "split" && editingMode !== "join" && selectedTopic.textPosition && !resolvedTranscript && !(selectedTopic.sourceFile || "").startsWith("note:") && (
        <div style={{ padding: 10, background: "#2a1f1f", border: "1px solid #3a2020", borderRadius: 8, fontSize: 11, color: "#ff8888", marginBottom: 16 }}>
          Transcript not loaded — adjust/split/join unavailable.
        </div>
      )}

      {/* Show editors in sidebar when active */}
      {adjustingBit && resolvedTranscript && (
        <BoundaryAdjuster
          transcript={resolvedTranscript}
          bit={adjustingBit}
          onSave={handleBoundaryChange.bind(null, adjustingBit.id)}
          onCancel={() => setAdjustingBit(null)}
        />
      )}

      {editingMode === "split" && resolvedTranscript && (
        <BitEditor
          transcript={resolvedTranscript}
          bit={selectedTopic}
          onSplitComplete={(newBits) => {
            handleSplitBit(selectedTopic.id, newBits);
            setEditingMode(null);
          }}
          onCancel={() => setEditingMode(null)}
        />
      )}

      {editingMode === "join" && resolvedTranscript && (
        <BitJoiner
          transcript={resolvedTranscript}
          bits={topics}
          onJoinComplete={(selectedBits, joinedBit) => {
            handleJoinBits(selectedBits, joinedBit);
            setEditingMode(null);
          }}
          onCancel={() => setEditingMode(null)}
        />
      )}

      {/* Source filename */}
      <div style={{ marginBottom: 4, fontSize: 11 }}>
        {(() => {
          const sf = selectedTopic.sourceFile || "";
          if (sf.startsWith("note:")) {
            const noteSource = sf.replace("note:", "");
            return (
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ background: "#312e81", color: "#a5b4fc", padding: "1px 4px", borderRadius: 3, fontWeight: 700, fontSize: 10 }}>NOTE</span>
                <span style={{ color: "#aaa", marginLeft: 4 }}>{noteSource}</span>
              </span>
            );
          }
          const parsed = parseFilenameClient(sf);
          const rc = ratingColor(parsed.rating);
          return (
            <span
              style={{ cursor: onGoToMix ? "pointer" : undefined, fontFamily: "'JetBrains Mono', monospace" }}
              onClick={() => {
                if (!onGoToMix) return;
                const tr = (transcripts || []).find((t) => t.id === selectedTopic.transcriptId || t.name === selectedTopic.sourceFile);
                if (tr) onGoToMix(tr, selectedTopic.id);
              }}
              title={onGoToMix ? "Open in Mix view" : undefined}
            >
              {parsed.rating && <span style={{ background: rc.bg, color: rc.fg, padding: "1px 4px", borderRadius: 3, fontWeight: 700, fontSize: 10, ...RATING_FONT }}>{parsed.rating}</span>}
              <span style={{ color: "#aaa", marginLeft: parsed.rating ? 4 : 0 }}>{parsed.title}</span>
              {parsed.duration && <span style={{ color: "#74c0fc", marginLeft: 4, fontSize: 10 }}>{parsed.duration}</span>}
            </span>
          );
        })()}
      </div>
      {/* Position + duration */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>
        {selectedTopic.textPosition && !(selectedTopic.sourceFile || "").startsWith("note:") && (
          <span>
            chars {selectedTopic.textPosition.startChar}-{selectedTopic.textPosition.endChar}
            ({selectedTopic.textPosition.endChar - selectedTopic.textPosition.startChar}ch)
          </span>
        )}
        {(() => {
          const words = (selectedTopic.fullText || "").split(/\s+/).filter(Boolean).length;
          if (words < 5) return null;
          const secs = Math.round((words / 200) * 60);
          const mm = String(Math.floor(secs / 60)).padStart(2, "0");
          const ss = String(secs % 60).padStart(2, "0");
          return <span style={{ color: "#4ecdc4" }}>~{mm}:{ss}</span>;
        })()}
        {estimatedDelivery && (
          <span style={{ color: "#4ecdc4" }}>~{estimatedDelivery}s delivery</span>
        )}
      </div>

      {/* Note metadata for promoted bits */}
      {(selectedTopic.sourceFile || "").startsWith("note:") && (
        <div style={{ marginBottom: 16, padding: 8, background: "#1e1b3a", border: "1px solid #312e81", borderRadius: 6, fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#a5b4fc" }}>Promoted from note</span>
          {selectedTopic.noteDate && <span style={{ color: "#94a3b8" }}>{selectedTopic.noteDate}</span>}
          {selectedTopic.noteGeneration && (
            <span style={{ color: selectedTopic.noteGeneration === "g2" ? "#60a5fa" : "#94a3b8", border: "1px solid #555", padding: "0 4px", borderRadius: 4 }}>
              {selectedTopic.noteGeneration}
            </span>
          )}
          {selectedTopic.noteCategory && (
            <span style={{ color: "#fbbf24", border: "1px solid #854d0e", padding: "0 4px", borderRadius: 4 }}>
              {selectedTopic.noteCategory}
            </span>
          )}
        </div>
      )}

      {/* Touchstone info — existing touchstones this bit belongs to */}
      {topicTouchstones.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            Touchstones
          </div>
          {topicTouchstones.map((ts) => (
            <div
              key={ts.id}
              className="card"
              style={{ padding: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div
                  style={{ flex: 1, cursor: "pointer" }}
                  onClick={() => onGoToTouchstone ? onGoToTouchstone(ts.id) : setActiveTab("touchstones")}
                >
                  <div style={{ fontWeight: 600, color: "#51cf66", fontSize: 12 }}>
                    {ts.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    Instance #{selectedTopic.instanceNumber || "?"} of {ts.frequency}
                  </div>
                </div>
                {onRemoveFromTouchstone && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromTouchstone(selectedTopic.id, ts.id);
                    }}
                    title="Remove from this touchstone"
                    style={{
                      background: "none", border: "1px solid #ff6b6b33", color: "#ff6b6b88",
                      borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer",
                      marginLeft: 8, flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ff6b6b"; e.currentTarget.style.borderColor = "#ff6b6b66"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#ff6b6b88"; e.currentTarget.style.borderColor = "#ff6b6b33"; }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add to Touchstone / Create Touchstone buttons */}
      {(() => {
        const currentTsIds = new Set(topicTouchstones.map((ts) => ts.id));
        const possibleTs = allTouchstones.filter((ts) => {
          if (currentTsIds.has(ts.id)) return false;
          if (ts.bitIds.includes(selectedTopic.id)) return false;
          if (ts.category === "rejected") return false;
          return true;
        });

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: addToTouchstoneOpen ? 8 : 0 }}>
              {possibleTs.length > 0 && onAddToTouchstone && (
                <button
                  onClick={() => { setAddToTouchstoneOpen(!addToTouchstoneOpen); setTouchstoneSearch(""); }}
                  style={{
                    flex: 1, padding: "8px", background: addToTouchstoneOpen ? "#4ecdc418" : "#4ecdc410", color: "#4ecdc4",
                    border: "1px solid #4ecdc433", borderRadius: 8, fontWeight: 600, fontSize: 11, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#4ecdc420"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = addToTouchstoneOpen ? "#4ecdc418" : "#4ecdc410"; }}
                >
                  {addToTouchstoneOpen ? "Cancel" : `Add to Touchstone (${possibleTs.length})`}
                </button>
              )}
              {onCreateTouchstone && (
                <button
                  onClick={() => {
                    const name = selectedTopic.title || "Untitled";
                    onCreateTouchstone(name, selectedTopic.id);
                  }}
                  style={{
                    flex: 1, padding: "8px", background: "#51cf6610", color: "#51cf66",
                    border: "1px solid #51cf6633", borderRadius: 8, fontWeight: 600, fontSize: 11, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#51cf6620"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#51cf6610"; }}
                >
                  Create Touchstone
                </button>
              )}
            </div>
            {addToTouchstoneOpen && (
              <div style={{ padding: 10, background: "#0d0d16", borderRadius: 8, border: "1px solid #1a1a2a" }}>
                <input
                  type="text"
                  value={touchstoneSearch}
                  onChange={(e) => setTouchstoneSearch(e.target.value)}
                  placeholder="Search touchstones..."
                  autoFocus
                  style={{ width: "100%", padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 11, fontFamily: "inherit", marginBottom: 6, boxSizing: "border-box" }}
                />
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {searchTouchstones(possibleTs, touchstoneSearch)
                    .map((ts) => (
                      <div
                        key={ts.id}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #1a1a2a", fontSize: 11, cursor: "pointer" }}
                        onClick={() => {
                          onAddToTouchstone(selectedTopic.id, ts.id);
                          setAddedFeedback(ts.name);
                          setAddToTouchstoneOpen(false);
                          setTimeout(() => setAddedFeedback(null), 3000);
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a2a"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ts.name}</div>
                          <div style={{ fontSize: 10, color: ts.category === "confirmed" ? "#51cf66" : "#ffa94d" }}>
                            {ts.category} · {ts.frequency} instances
                          </div>
                        </div>
                        <span style={{ color: "#51cf66", fontSize: 10, fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                          Add
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {addedFeedback && (
        <div style={{ marginBottom: 12, padding: 8, background: "#51cf6618", border: "1px solid #51cf6633", borderRadius: 6, fontSize: 11, color: "#51cf66" }}>
          Added to "{addedFeedback}"
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Summary
        </div>
        <p style={{ fontSize: 13, color: "#bbb", lineHeight: 1.6 }}>{selectedTopic.summary}</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Full Text
        </div>
        <div style={{
          fontSize: 12, color: "#999", lineHeight: 1.7,
          fontFamily: "'JetBrains Mono', monospace",
          background: "#0a0a14", padding: 12, borderRadius: 8,
          border: "1px solid #1a1a2a", maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap",
        }}>
          {selectedTopic.fullText}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>
            Tags {(selectedTopic.tags || []).length > 0 && `(${selectedTopic.tags.length})`}
          </div>
          {onReparseTags && (
            <button
              onClick={() => onReparseTags(selectedTopic.id)}
              title="Re-generate tags via LLM (useful if too many tags accumulated)"
              style={{ background: "none", border: "1px solid #333", color: "#c4b5fd", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}
            >
              Reparse
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {(selectedTopic.tags || []).map((tag, i) => (
            <span key={`${tag}-${i}`} className="tag-pill" style={{
              background: "#ff6b6b10", color: "#ff8888", border: "1px solid #ff6b6b20",
            }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Keywords
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {(selectedTopic.keywords || []).map((kw) => (
            <span key={kw} className="tag-pill" style={{
              background: "#ffa94d10", color: "#ffa94d", border: "1px solid #ffa94d20",
            }}>
              {kw}
            </span>
          ))}
        </div>
      </div>

      {getMatchesForTopic(selectedTopic.id).length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Connections
          </div>
          {getMatchesForTopic(selectedTopic.id).map((m) => (
            <div
              key={m.id}
              className="card"
              onClick={() => setSelectedTopic(m.other)}
              style={{ padding: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "#ddd", fontSize: 13 }}>{m.other.title}</span>
                <span className="match-badge" style={{
                  background:
                    m.relationship === "same_bit" ? "#ff6b6b18" :
                    m.relationship === "evolved" ? "#ffa94d18" :
                    m.relationship === "callback" ? "#74c0fc18" : "#55555518",
                  color:
                    m.relationship === "same_bit" ? "#ff6b6b" :
                    m.relationship === "evolved" ? "#ffa94d" :
                    m.relationship === "callback" ? "#74c0fc" : "#888",
                }}>
                  {m.relationship} · {Math.round(m.confidence * 100)}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                from {m.other.sourceFile}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ minHeight: 350, flexShrink: 0, pointerEvents: "none" }}>&nbsp;</div>
      </div>
    </div>
  );
}
