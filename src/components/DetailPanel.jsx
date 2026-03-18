import { useState } from "react";
import { BoundaryAdjuster } from "./BoundaryAdjuster";
import { BitEditor } from "./BitEditor";
import { BitJoiner } from "./BitJoiner";
import { getBitTouchstones } from "../utils/touchstoneDetector";

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
    <div className="detail-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 20,
            fontWeight: 700,
            color: "#eee",
            flex: 1,
          }}>
            {selectedTopic.title}
          </h2>
          {onBaptize && selectedTopic.fullText?.trim() && !baptizing && (
            <button
              onClick={async () => {
                setBaptizing(true);
                try { await onBaptize(selectedTopic.id); } finally { setBaptizing(false); }
              }}
              title="Generate new title"
              style={{
                background: "none", border: "1px solid #333", color: "#888",
                borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#da77f2"; e.currentTarget.style.borderColor = "#da77f244"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#333"; }}
            >
              Rename
            </button>
          )}
          {baptizing && (
            <span style={{ fontSize: 10, color: "#da77f2", flexShrink: 0 }}>Renaming...</span>
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

      {/* Edit buttons - only show when not in editing mode and transcript is available */}
      {!adjustingBit && editingMode !== "split" && editingMode !== "join" && selectedTopic.textPosition && resolvedTranscript && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          <button
            onClick={() => setAdjustingBit(selectedTopic)}
            style={{ padding: "6px 10px", background: "#ffa94d18", color: "#ffa94d", border: "1px solid #ffa94d44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
          >Adjust</button>
          <button
            onClick={() => setEditingMode("split")}
            style={{ padding: "6px 10px", background: "#74c0fc18", color: "#74c0fc", border: "1px solid #74c0fc44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
          >Split</button>
          <button
            onClick={() => setEditingMode("join")}
            style={{ padding: "6px 10px", background: "#51cf6618", color: "#51cf66", border: "1px solid #51cf6644", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
          >Join</button>
          {onGoToMix && (
            <button
              onClick={() => {
                const tr = (transcripts || []).find(
                  (t) => t.id === selectedTopic.transcriptId || t.name === selectedTopic.sourceFile
                );
                if (tr) onGoToMix(tr, selectedTopic.id);
              }}
              style={{ padding: "6px 10px", background: "#4ecdc418", color: "#4ecdc4", border: "1px solid #4ecdc444", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
            >Mix</button>
          )}
          {onBaptize && selectedTopic.fullText?.trim() && (
            <button
              onClick={async () => {
                setBaptizing(true);
                try { await onBaptize(selectedTopic.id); } finally { setBaptizing(false); }
              }}
              disabled={baptizing}
              style={{ padding: "6px 10px", background: baptizing ? "#33333380" : "#da77f218", color: baptizing ? "#888" : "#da77f2", border: `1px solid ${baptizing ? "#33333380" : "#da77f244"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: baptizing ? "not-allowed" : "pointer" }}
            >{baptizing ? "Baptizing..." : "Baptize"}</button>
          )}
          {onCommuneBit && selectedTopic.fullText?.trim() && getMatchesForTopic(selectedTopic.id).length > 0 && (
            <button
              onClick={async () => {
                setCommuning(true);
                try { await onCommuneBit(selectedTopic.id); } finally { setCommuning(false); }
              }}
              disabled={communing}
              style={{ padding: "6px 10px", background: communing ? "#33333380" : "#74c0fc18", color: communing ? "#888" : "#74c0fc", border: `1px solid ${communing ? "#33333380" : "#74c0fc44"}`, borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: communing ? "not-allowed" : "pointer" }}
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
              style={{ padding: "6px 10px", background: "#ff6b6b18", color: "#ff6b6b", border: "1px solid #ff6b6b44", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: "pointer" }}
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

      {/* No transcript warning */}
      {!adjustingBit && editingMode !== "split" && editingMode !== "join" && selectedTopic.textPosition && !resolvedTranscript && (
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

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <span
            className="tag-pill"
            style={{ background: "#1a1a2a", color: "#888", border: "1px solid #252538", cursor: onGoToMix ? "pointer" : undefined }}
            onClick={() => {
              if (!onGoToMix) return;
              const tr = (transcripts || []).find(
                (t) => t.id === selectedTopic.transcriptId || t.name === selectedTopic.sourceFile
              );
              if (tr) onGoToMix(tr, selectedTopic.id);
            }}
            title={onGoToMix ? "Open in Mix view" : undefined}
          >
            {selectedTopic.sourceFile}
          </span>
          {estimatedDelivery && (
            <span style={{ fontSize: 10, color: "#4ecdc4" }}>
              ~{estimatedDelivery}s delivery
            </span>
          )}
        </div>
      </div>

      {/* Position info */}
      {selectedTopic.textPosition && (
        <div style={{ marginBottom: 16, padding: "10px", background: "#1a1a2a", borderRadius: "8px", fontSize: "11px" }}>
          <div style={{ color: "#666", marginBottom: 4 }}>Position</div>
          <div style={{ color: "#4ecdc4", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
            {selectedTopic.textPosition.startChar} - {selectedTopic.textPosition.endChar}
            <span style={{ color: "#888", marginLeft: 8 }}>
              ({selectedTopic.textPosition.endChar - selectedTopic.textPosition.startChar} chars)
            </span>
          </div>
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

      {/* Create Touchstone from this bit */}
      {onCreateTouchstone && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => {
              const name = selectedTopic.title || "Untitled";
              onCreateTouchstone(name, selectedTopic.id);
            }}
            style={{
              width: "100%", padding: "10px", background: "#51cf6610", color: "#51cf66",
              border: "1px solid #51cf6633", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#51cf6620"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#51cf6610"; }}
          >
            Create Touchstone
          </button>
        </div>
      )}

      {/* Possible touchstones — ones this bit could belong to but doesn't yet */}
      {(() => {
        const currentTsIds = new Set(topicTouchstones.map((ts) => ts.id));
        const possibleTs = allTouchstones.filter((ts) => {
          if (currentTsIds.has(ts.id)) return false;
          if (ts.bitIds.includes(selectedTopic.id)) return false;
          return true;
        });
        if (possibleTs.length === 0 && !onAddToTouchstone) return null;

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>
                Add to Touchstone
              </div>
              {possibleTs.length > 0 && (
                <button
                  onClick={() => { setAddToTouchstoneOpen(!addToTouchstoneOpen); setTouchstoneSearch(""); }}
                  style={{ background: "none", border: "1px solid #333", color: addToTouchstoneOpen ? "#4ecdc4" : "#888", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}
                >
                  {addToTouchstoneOpen ? "Cancel" : `Browse (${possibleTs.length})`}
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
                  style={{ width: "100%", padding: "6px 10px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 11, fontFamily: "inherit", marginBottom: 6, boxSizing: "border-box" }}
                />
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {possibleTs
                    .filter((ts) => !touchstoneSearch.trim() || ts.name.toLowerCase().includes(touchstoneSearch.toLowerCase()))
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
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Tags
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {(selectedTopic.tags || []).map((tag) => (
            <span key={tag} className="tag-pill" style={{
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
    </div>
  );
}
