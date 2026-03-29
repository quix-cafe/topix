import { useState, useMemo, useEffect } from "react";
import { useHashParam } from "../hooks/useHashParam";
import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";
import { SYSTEM_SYNTHESIZE_TOUCHSTONE, SYSTEM_TOUCHSTONE_COMMUNE, SYSTEM_TOUCHSTONE_VERIFY } from "../utils/prompts";
import { searchTouchstones } from "../utils/touchstoneSearch";
import { callOllama, onQueueChange, getQueueSnapshot, cancelPendingGenerations } from "../utils/ollama";


function StyledFilename({ sourceFile, style }) {
  const p = parseFilenameClient(sourceFile || "");
  const rc = ratingColor(p.rating);
  return (
    <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", ...style }}>
      {p.rating && <span style={{ padding: "1px 3px", borderRadius: 2, background: rc.bg, color: rc.fg, fontWeight: 700, ...RATING_FONT }}>{p.rating}</span>}
      <span style={{ color: "#666", marginLeft: p.rating ? 3 : 0 }}>{p.title}</span>
      {p.duration && <span style={{ color: "#74c0fc", marginLeft: 3 }}>{p.duration}</span>}
    </span>
  );
}

const RELATIONSHIP_OPTIONS = ["same_bit", "evolved", "related", "callback", "tag-on"];
const EXCLUSIVE_RELATIONSHIPS = new Set(["same_bit", "evolved"]);

function LLMQueueStatus() {
  const [queue, setQueue] = useState(getQueueSnapshot);
  useEffect(() => onQueueChange(setQueue), []);
  if (queue.total === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#0a0a14", borderRadius: 5, border: "1px solid #1a1a2a", fontSize: 10, color: "#888" }}>
      <span style={{ color: "#ffa94d", fontWeight: 600 }}>
        {queue.active ? queue.active.label : "waiting"}
      </span>
      {queue.pending.length > 0 && (
        <span style={{ color: "#666" }}>+ {queue.pending.length} queued</span>
      )}
      {queue.pending.length > 0 && (
        <button onClick={cancelPendingGenerations} style={{ background: "none", border: "1px solid #ff6b6b33", color: "#ff6b6b", padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontSize: 9 }}>
          cancel
        </button>
      )}
    </div>
  );
}

/**
 * TouchstonePanel - Display and explore touchstones (recurring jokes across transcripts)
 */

export function TouchstonePanel({
  touchstones, bits, matches, notes, onSelectBit, onHunt, onRectifyOverlaps, huntProgress, processing,
  onGenerateTitle, onRenameTouchstone, onRemoveInstance, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone, onCreateTouchstone,
  onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, onUpdateTouchstoneEdits,
  onCommuneTouchstone, onSynthesizeTouchstone, onMassTouchstoneCommunion, onPruneTouchstone, onMassPrune, onRecalcScores, onSaintInstance, onToggleCoreBit,
  onRelateTouchstone, onUnrelateTouchstone, onAutoRelateAll, onRejectCoreless, onRedetect,
  initialTouchstoneId, onConsumeInitialTouchstone, onGoToNote,
  universalCorrections,
  selectedModel,
}) {
  const [selectedTouchstoneId, setSelectedTouchstoneIdRaw] = useHashParam("tsid", "");
  const setSelectedTouchstoneId = (id) => { setSelectedTouchstoneIdRaw(id || ""); if (id) window.scrollTo(0, 0); };
  const [autoOpenMerge, setAutoOpenMerge] = useState(false);
  const [autoOpenRelate, setAutoOpenRelate] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState(null); // bit to seed new touchstone
  const [touchstoneFilter, setTouchstoneFilter] = useHashParam("tf", "");
  const [newTouchstoneName, setNewTouchstoneName] = useState("");

  // Navigate to a specific touchstone from external (e.g. DetailPanel)
  useEffect(() => {
    if (!initialTouchstoneId) return;
    setSelectedTouchstoneIdRaw(initialTouchstoneId);
    window.scrollTo(0, 0);
    onConsumeInitialTouchstone?.();
  }, [initialTouchstoneId]);

  const sortByInstances = (list) => [...list].sort((a, b) => (b.instances?.length || 0) - (a.instances?.length || 0));
  const confirmed = useMemo(() => sortByInstances(touchstones?.confirmed || []), [touchstones?.confirmed]);
  const possible = useMemo(() => sortByInstances(touchstones?.possible || []), [touchstones?.possible]);
  const rejected = useMemo(() => touchstones?.rejected || [], [touchstones?.rejected]);
  const allTouchstones = useMemo(() => [...confirmed, ...possible, ...rejected], [confirmed, possible, rejected]);

  // Look up selected touchstone from live data
  const selectedTouchstone = selectedTouchstoneId
    ? allTouchstones.find((t) => t.id === selectedTouchstoneId) || null
    : null;

  if (!selectedTouchstone && !creatingFrom && confirmed.length === 0 && possible.length === 0 && rejected.length === 0) {
    const matchCount = (matches || []).length;
    const sameBitCount = (matches || []).filter((m) => m.relationship === "same_bit").length;
    const transcriptCount = new Set((bits || []).map((b) => b.sourceFile)).size;

    return (
      <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{"🔄"}</div>
        <div style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>No recurring touchstones detected yet.</div>

        {transcriptCount >= 2 && onHunt && (
          <HuntButton onHunt={onHunt} huntProgress={huntProgress} processing={processing} />
        )}
        {(bits || []).length > 0 && <CreateTouchstoneFromBit bits={bits} onCreateTouchstone={onCreateTouchstone} />}
      </div>
    );
  }

  // Create new touchstone flow
  if (creatingFrom) {
    return (
      <div>
        <button onClick={() => { setCreatingFrom(null); setNewTouchstoneName(""); }} style={{ background: "none", border: "none", color: "#ffa94d", fontSize: 14, cursor: "pointer", marginBottom: 16, fontWeight: 600 }}>
          &larr; Cancel
        </button>
        <h3 style={{ color: "#eee", marginBottom: 12 }}>Create Touchstone from "{creatingFrom.title}"</h3>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          This creates a new touchstone seeded with this bit. Future matching will find other instances across transcripts.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={newTouchstoneName}
            onChange={(e) => setNewTouchstoneName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTouchstoneName.trim()) {
                onCreateTouchstone(newTouchstoneName.trim(), creatingFrom.id);
                setCreatingFrom(null);
                setNewTouchstoneName("");
              }
            }}
            placeholder="Touchstone name (e.g. the punchline or topic)"
            autoFocus
            style={{ flex: 1, padding: "8px 12px", background: "#0a0a14", border: "1px solid #333", borderRadius: 6, color: "#ddd", fontSize: 13, fontFamily: "inherit" }}
          />
          <button
            onClick={() => {
              if (newTouchstoneName.trim()) {
                onCreateTouchstone(newTouchstoneName.trim(), creatingFrom.id);
                setCreatingFrom(null);
                setNewTouchstoneName("");
              }
            }}
            disabled={!newTouchstoneName.trim()}
            style={{ padding: "8px 16px", background: newTouchstoneName.trim() ? "#51cf66" : "#333", color: newTouchstoneName.trim() ? "#000" : "#666", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: newTouchstoneName.trim() ? "pointer" : "default" }}
          >
            Create
          </button>
        </div>
        {creatingFrom.fullText && (
          <div style={{ padding: 12, background: "#0a0a14", borderRadius: 6, border: "1px solid #1a1a2a", fontSize: 12, color: "#bbb", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto" }}>
            {creatingFrom.fullText}
          </div>
        )}
      </div>
    );
  }

  if (selectedTouchstone) {
    return (
      <TouchstoneDetail
        key={selectedTouchstone.id}
        touchstone={selectedTouchstone}
        bits={bits}
        allTouchstones={allTouchstones}
        onSelectBit={onSelectBit}
        onBack={() => setSelectedTouchstoneId(null)}
        onGenerateTitle={onGenerateTitle}
        onRenameTouchstone={onRenameTouchstone}
        onRemoveInstance={onRemoveInstance}
        onRemoveTouchstone={onRemoveTouchstone ? (id) => { onRemoveTouchstone(id); setSelectedTouchstoneId(null); } : null}
        onConfirmTouchstone={onConfirmTouchstone && selectedTouchstone?.category === "possible" ? (id) => { onConfirmTouchstone(id); } : null}
        onRestoreTouchstone={onRestoreTouchstone && selectedTouchstone?.category === "rejected" ? (id) => { onRestoreTouchstone(id); setSelectedTouchstoneId(null); } : null}
        onUpdateInstanceRelationship={onUpdateInstanceRelationship}
        onGoToMix={onGoToMix}
        onMergeTouchstone={onMergeTouchstone}
        onRefreshReasons={onRefreshReasons}
        mergeTargets={allTouchstones.filter((t) => t.id !== selectedTouchstoneId && t.category !== "rejected")}
        processing={processing}
        autoOpenMerge={autoOpenMerge}
        onConsumeAutoOpenMerge={() => setAutoOpenMerge(false)}
        autoOpenRelate={autoOpenRelate}
        onConsumeAutoOpenRelate={() => setAutoOpenRelate(false)}
        onUpdateTouchstoneEdits={onUpdateTouchstoneEdits}
        onCommuneTouchstone={onCommuneTouchstone}
        onPruneTouchstone={onPruneTouchstone}
        onToggleCoreBit={onToggleCoreBit}
        onSynthesizeTouchstone={onSynthesizeTouchstone}
        onSaintInstance={onSaintInstance}
        onRelateTouchstone={onRelateTouchstone}
        onUnrelateTouchstone={onUnrelateTouchstone}
        onNavigateToTouchstone={(id) => { setSelectedTouchstoneId(id); }}
        notes={notes}
        onGoToNote={onGoToNote}
        universalCorrections={universalCorrections}
        selectedModel={selectedModel}
      />
    );
  }

  return (
    <div>
      {/* Hunt / Rectify / Commune — single row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {onHunt && (
          <button onClick={onHunt} disabled={processing} style={{
            padding: "6px 14px", background: processing ? "#33333a" : "#4ecdc4", color: processing ? "#888" : "#000",
            border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: processing ? "default" : "pointer",
          }}>
            {processing && huntProgress && huntProgress.current < huntProgress.total
              ? `Hunting... ${huntProgress.current}/${huntProgress.total}`
              : "Hunt"}
          </button>
        )}
        {onRectifyOverlaps && possible.length > 0 && (
          <button onClick={onRectifyOverlaps} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ffa94d",
            border: "1px solid #ffa94d40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Rectify
          </button>
        )}
        {onRecalcScores && (
          <button onClick={onRecalcScores} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ffd43b",
            border: "1px solid #ffd43b40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}
            title="Cap inflated LLM match scores using actual text similarity — instant, no LLM calls">
            Recalc Scores
          </button>
        )}
        {onMassPrune && (confirmed.length + possible.length + rejected.length) > 0 && (
          <button onClick={onMassPrune} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ff6b6b",
            border: "1px solid #ff6b6b40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Prune All
          </button>
        )}
        {onMassTouchstoneCommunion && (confirmed.length + possible.length + rejected.length) > 0 && (
          <button onClick={onMassTouchstoneCommunion} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#c4b5fd",
            border: "1px solid #c4b5fd40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            {processing ? "Communing..." : `Commune (${confirmed.length + possible.length + rejected.length})`}
          </button>
        )}
        {onAutoRelateAll && (confirmed.length + possible.length) >= 2 && (
          <button onClick={() => {
            const changed = onAutoRelateAll();
            if (!changed) alert("No new flow relations found (need 3+ adjacent appearances across setlists).");
          }} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#e599f7",
            border: "1px solid #e599f740", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Auto-Relate
          </button>
        )}
        {onRejectCoreless && (confirmed.length + possible.length) > 0 && (
          <button onClick={() => {
            const count = onRejectCoreless();
            if (!count) alert("All touchstones have core or sainted bits.");
          }} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ff6b6b",
            border: "1px solid #ff6b6b40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Reject Coreless
          </button>
        )}
        {onRedetect && (
          <button onClick={onRedetect} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#74c0fc",
            border: "1px solid #74c0fc40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Re-detect
          </button>
        )}
      </div>

      {/* LLM Queue Status */}
      <LLMQueueStatus />

      {/* Hunt progress bar */}
      {huntProgress && huntProgress.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ background: "#0a0a14", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ height: "100%", borderRadius: 4, transition: "width 0.3s", width: `${(huntProgress.current / huntProgress.total) * 100}%`, background: huntProgress.current === huntProgress.total ? "#51cf66" : "#4ecdc4" }} />
          </div>
          <div style={{ fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{huntProgress.status}</span>
            {huntProgress.found > 0 && <span style={{ color: "#4ecdc4", fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>{huntProgress.found} found</span>}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#888", padding: "10px 14px", background: "#0d0d16", borderRadius: 8, flex: 1 }}>
          <span>{confirmed.length + possible.length} touchstone{confirmed.length + possible.length !== 1 ? "s" : ""}</span>
          <span style={{ color: "#51cf66" }}>{confirmed.length} confirmed</span>
          <span style={{ color: "#ffa94d" }}>{possible.length} possible</span>
          {rejected.length > 0 && <span style={{ color: "#666" }}>{rejected.length} rejected</span>}
          <span>{(bits || []).length} total bits</span>
        </div>
      </div>

      {/* Search filter */}
      <div style={{ marginBottom: 16, position: "relative" }}>
        <input
          type="text"
          value={touchstoneFilter}
          onChange={(e) => setTouchstoneFilter(e.target.value)}
          placeholder="Filter touchstones..."
          style={{
            width: "100%", padding: "8px 12px", paddingRight: 32, background: "#0d0d16", border: "1px solid #1e1e30",
            borderRadius: 8, color: "#ddd", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
        {touchstoneFilter && (
          <button
            onClick={() => setTouchstoneFilter("")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
          >
            x
          </button>
        )}
      </div>

      {(() => {
        const q = touchstoneFilter.trim();
        const filterList = (list) => q ? searchTouchstones(list, q) : list;
        const fConfirmed = filterList(confirmed);
        const fPossible = filterList(possible);
        const fRejected = q ? [] : rejected;

        return (
          <>
            {fConfirmed.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: "#51cf66", textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>
                    Confirmed Touchstones ({fConfirmed.length})
                  </h3>
                  {fPossible.length > 0 && (
                    <button
                      onClick={() => document.getElementById("touchstone-possible-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      style={{ background: "none", border: "none", color: "#ffa94d", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600 }}
                    >
                      {fPossible.length} possible ↓
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {fConfirmed.map((touchstone) => (
                    <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} notes={notes} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRemove={onRemoveTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onRelate={onRelateTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenRelate(true); } : null} processing={processing} allTouchstones={allTouchstones} />
                  ))}
                </div>
              </div>
            )}

            {fPossible.length > 0 && (
              <div id="touchstone-possible-section" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#ffa94d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Possible Matches ({fPossible.length})
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {fPossible.map((touchstone) => (
                    <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} notes={notes} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRemove={onRemoveTouchstone} onConfirm={onConfirmTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onRelate={onRelateTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenRelate(true); } : null} processing={processing} allTouchstones={allTouchstones} />
                  ))}
                </div>
              </div>
            )}

            {fRejected.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Rejected ({fRejected.length})
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {fRejected.map((touchstone) => (
                    <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} notes={notes} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRestore={onRestoreTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onRelate={onRelateTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenRelate(true); } : null} processing={processing} allTouchstones={allTouchstones} />
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

/** Mini picker to select a bit for new touchstone creation */
function CreateTouchstoneFromBit({ bits, onSelect, onCreateTouchstone }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleSelect = (bit) => {
    if (onSelect) {
      onSelect(bit);
    } else if (onCreateTouchstone) {
      // Direct create with bit title
      onCreateTouchstone(bit.title, bit.id);
    }
    setOpen(false);
    setSearch("");
  };

  const filtered = search.trim()
    ? bits.filter((b) => (b.title + " " + (b.tags || []).join(" ") + " " + (b.keywords || []).join(" ")).toLowerCase().includes(search.toLowerCase()))
    : bits.slice(0, 20);

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: "none", border: "1px solid #333", color: "#c4b5fd", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
      >
        {open ? "Cancel" : "+ New Touchstone from Bit"}
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: 12, background: "#0d0d16", borderRadius: 8, border: "1px solid #1a1a2a" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bits..."
            autoFocus
            style={{ width: "100%", padding: "6px 10px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
          />
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {filtered.map((bit) => (
              <div
                key={bit.id}
                onClick={() => handleSelect(bit)}
                style={{ padding: "6px 8px", cursor: "pointer", fontSize: 12, color: "#bbb", borderBottom: "1px solid #1a1a2a" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a2a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontWeight: 600, color: "#ddd" }}>{bit.title}</span>
                <StyledFilename sourceFile={bit.sourceFile} style={{ marginLeft: 8 }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const COMMUNION_STATUS_CONFIG = {
  sainted: { label: "Sainted", color: "#f5c218", bg: "#f5c21818", border: "#f5c21833", icon: "✦" },
  blessed: { label: "Blessed", color: "#51cf66", bg: "#51cf6618", border: "#51cf6633", icon: "✓" },
  purgatory: { label: "Purgatory", color: "#888", bg: "#88888818", border: "#88888833", icon: "◌" },
  damned: { label: "Damned", color: "#ff6b6b", bg: "#ff6b6b18", border: "#ff6b6b33", icon: "⚠" },
};



function CommunionStatusBadge({ instance }) {
  const status = instance.communionStatus || (typeof instance.communionScore === 'number' ? (instance.communionScore >= 70 ? 'blessed' : 'damned') : 'purgatory');
  const cfg = COMMUNION_STATUS_CONFIG[status] || COMMUNION_STATUS_CONFIG.purgatory;
  return (
    <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {cfg.icon} {cfg.label}{typeof instance.communionScore === 'number' ? ` ${instance.communionScore}%` : ''}
    </span>
  );
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `~${mins}:${String(secs).padStart(2, '0')}` : `~${secs}s`;
}

const WORDS_PER_MINUTE = 150;

function pctColor(pct) {
  if (pct >= 90) return "#51cf66";
  if (pct >= 80) return "#8bc98b";
  if (pct >= 70) return "#ffa94d";
  if (pct >= 60) return "#e8a44c";
  if (pct >= 50) return "#ff8c42";
  if (pct >= 40) return "#ff6b6b";
  return "#cc5555";
}

function TouchstoneCard({ touchstone, onClick, onRemove, onConfirm, onRestore, onMerge, onRelate, processing, bits, notes, allTouchstones }) {
  const instances = touchstone.instances || [];
  const sourceCount = new Set(instances.map((i) => { const b = bits.find(b => b.id === i.bitId); return b?.sourceFile || i.sourceFile; })).size;
  const instanceCount = instances.length;
  const sameBitCount = instances.filter((i) => i.relationship === "same_bit").length;
  const evolvedCount = instances.filter((i) => i.relationship === "evolved").length;
  const noteCount = (notes || []).filter(n => n.matchedTouchstoneId === touchstone.id).length;

  const avgDuration = useMemo(() => {
    if (!bits || instances.length === 0) return null;
    const durations = instances.map((inst) => {
      const bit = bits.find((b) => b.id === inst.bitId);
      if (!bit?.fullText) return 0;
      return (bit.fullText.split(/\s+/).length / WORDS_PER_MINUTE) * 60;
    }).filter((d) => d > 0);
    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [instances, bits]);

  const isConfirmed = touchstone.category === "confirmed";
  const isRejected = touchstone.category === "rejected";
  const avgPct = instances.length >= 2
    ? Math.round(instances.reduce((sum, i) => sum + (i.confidence || 0), 0) / instances.length * 100)
    : touchstone.matchInfo?.avgMatchPercentage || 0;

  const hasCore = (touchstone.coreBitIds || []).length > 0;
  const hasSainted = instances.some((i) => i.communionStatus === 'sainted');
  const saintedCount = instances.filter((i) => i.communionStatus === 'sainted').length;
  const blessedCount = instances.filter((i) => i.communionStatus === 'blessed').length;
  const damnedCount = instances.filter((i) => i.communionStatus === 'damned').length;
  const purgatoryCount = instances.filter((i) => {
    const status = i.communionStatus || (typeof i.communionScore === 'number' ? (i.communionScore >= 70 ? 'blessed' : 'damned') : 'purgatory');
    return status === 'purgatory';
  }).length;
  const hasCommunionData = instances.length > 0;

  const borderColor = isConfirmed ? "#51cf66" : isRejected ? "#444" : "#ffa94d";
  const matchColor = pctColor(avgPct);
  const cardBtn = (bg, border, color, extra) => ({
    background: bg, border: `1px solid ${border}`, color, borderRadius: 4,
    padding: "3px 8px", fontSize: 10, cursor: extra?.disabled ? "default" : "pointer",
    fontWeight: 600, opacity: extra?.disabled ? 0.4 : 1, ...extra,
  });

  return (
    <div className="card" onClick={onClick} style={{ cursor: "pointer", borderLeft: `3px solid ${borderColor}`, opacity: isRejected ? 0.6 : 1, padding: "12px 14px" }}>
      <div style={{ display: "flex", gap: 14 }}>
        {/* Left column: content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{ fontWeight: 700, color: "#eee", fontSize: 14, lineHeight: 1.3, marginBottom: 4 }}>
            {touchstone.name}
            {touchstone.manualName && <span style={{ fontSize: 9, color: "#c4b5fd", marginLeft: 6, fontWeight: 400 }}>edited</span>}
            {!isRejected && !hasCore && !hasSainted && <span title="No core bit — may drift" style={{ fontSize: 9, color: "#ff6b6b", marginLeft: 6, fontWeight: 600 }}>no core</span>}
          </div>

          {/* Ideal text preview */}
          {touchstone.idealText ? (
            <div style={{ marginTop: 4, marginBottom: 4, padding: "8px 10px", background: "#0a0a14", borderRadius: 5, border: "1px solid #1a1a2a", fontSize: 11, color: "#999", lineHeight: 1.5, maxHeight: 104, overflow: "hidden", position: "relative" }}>
              <span style={{ fontSize: 9, color: touchstone.manualIdealText ? "#c4b5fd" : "#74c0fc", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {touchstone.manualIdealText ? "Edited" : "Synth"}{" \u2014 "}
              </span>
              {touchstone.idealText.slice(0, 400)}{touchstone.idealText.length > 400 ? "..." : ""}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 20, background: "linear-gradient(transparent, #12121e)" }} />
            </div>
          ) : touchstone.matchInfo?.reasons?.[0] ? (
            <div style={{ fontSize: 11, color: "#777", fontStyle: "italic", lineHeight: 1.4, marginBottom: 4 }}>
              {touchstone.matchInfo.reasons[0]}
            </div>
          ) : null}

          {/* Communion badges */}
          {hasCommunionData && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
              {saintedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.sainted.bg} color={COMMUNION_STATUS_CONFIG.sainted.color}>{COMMUNION_STATUS_CONFIG.sainted.icon} {saintedCount} sainted</Badge>}
              {blessedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.blessed.bg} color={COMMUNION_STATUS_CONFIG.blessed.color}>{COMMUNION_STATUS_CONFIG.blessed.icon} {blessedCount} blessed</Badge>}
              {purgatoryCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.purgatory.bg} color={COMMUNION_STATUS_CONFIG.purgatory.color}>{COMMUNION_STATUS_CONFIG.purgatory.icon} {purgatoryCount} purgatory</Badge>}
              {damnedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.damned.bg} color={COMMUNION_STATUS_CONFIG.damned.color}>{COMMUNION_STATUS_CONFIG.damned.icon} {damnedCount} damned</Badge>}
            </div>
          )}
        </div>

        {/* Right column: stats + actions */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 72 }}>
          {/* Rating — top right */}
          <div style={{ background: matchColor, color: "#000", padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 12 }}>
            {avgPct}%
          </div>
          {/* Time estimate */}
          {avgDuration && <span style={{ fontSize: 9, color: "#74c0fc" }}>{formatDuration(avgDuration)}</span>}
          {/* Bit counts */}
          <div style={{ fontSize: 9, color: "#666" }}>
            {sameBitCount > 0 && <span style={{ color: "#51cf66" }}>{sameBitCount} same</span>}
            {sameBitCount > 0 && evolvedCount > 0 && " · "}
            {evolvedCount > 0 && <span style={{ color: "#ffa94d" }}>{evolvedCount} evolved</span>}
          </div>
          {(noteCount > 0 || (touchstone.relatedTouchstoneIds || []).length > 0) && (
            <div style={{ fontSize: 9, color: "#666" }}>
              {noteCount > 0 && <span style={{ color: "#c4b5fd" }}>{noteCount} note{noteCount !== 1 ? "s" : ""}</span>}
              {noteCount > 0 && (touchstone.relatedTouchstoneIds || []).length > 0 && " · "}
              {(touchstone.relatedTouchstoneIds || []).length > 0 && <span style={{ color: "#e599f7" }}>{(touchstone.relatedTouchstoneIds || []).length} flow</span>}
            </div>
          )}

          {/* Action buttons — single column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2, width: "100%" }}>
            {onConfirm && (
              <button onClick={(e) => { e.stopPropagation(); onConfirm(touchstone.id); }}
                style={cardBtn("#51cf6611", "#51cf6633", "#51cf66")}>Confirm</button>
            )}
            {onRestore && (
              <button onClick={(e) => { e.stopPropagation(); onRestore(touchstone.id); }}
                style={cardBtn("#4ecdc411", "#4ecdc433", "#4ecdc4")}>Restore</button>
            )}
            {onMerge && (
              <button onClick={(e) => { e.stopPropagation(); onMerge(touchstone.id); }}
                style={cardBtn("#ffa94d11", "#ffa94d33", "#ffa94d")}>Merge</button>
            )}
            {onRelate && (
              <button onClick={(e) => { e.stopPropagation(); onRelate(touchstone.id); }}
                style={cardBtn("#e599f711", "#e599f733", "#e599f7")}>Relate</button>
            )}
            {onRemove && (
              <button onClick={(e) => { e.stopPropagation(); onRemove(touchstone.id); }}
                style={cardBtn("#ff6b6b11", "#ff6b6b33", "#ff6b6b")}>Reject</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ bg, color, children }) {
  return <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: bg, color }}>{children}</span>;
}

function TouchstoneDetail({ touchstone, bits, allTouchstones, onSelectBit, onBack, onGenerateTitle, onRenameTouchstone, onRemoveInstance, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone, onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, mergeTargets, processing, autoOpenMerge, onConsumeAutoOpenMerge, autoOpenRelate, onConsumeAutoOpenRelate, onUpdateTouchstoneEdits, onCommuneTouchstone, onPruneTouchstone, onToggleCoreBit, onSynthesizeTouchstone, onSaintInstance, onRelateTouchstone, onUnrelateTouchstone, onNavigateToTouchstone, notes, onGoToNote, universalCorrections, selectedModel }) {
  const [renamePending, setRenamePending] = useState(null);
  const [expandedInstances, setExpandedInstances] = useState(new Set(touchstone.instances.map((i) => i.bitId)));
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResult, setMergeResult] = useState(null); // {accepted, rejected}
  const [relateOpen, setRelateOpen] = useState(false);
  const [relateSearch, setRelateSearch] = useState("");
  const [flowNeighborsOpen, setFlowNeighborsOpen] = useState(false);
  const [rejectedReasonsOpen, setRejectedReasonsOpen] = useState(false);
  const [matchedNotesOpen, setMatchedNotesOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [newCorrFrom, setNewCorrFrom] = useState("");
  const [newCorrTo, setNewCorrTo] = useState("");
  const [newReason, setNewReason] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingIdealText, setEditingIdealText] = useState(false);
  const [idealTextDraft, setIdealTextDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [copyPromptOpen, setCopyPromptOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [pasteResponseType, setPasteResponseType] = useState(null); // "pick"|"synthesize"|"commune"|"why_matched"
  const [pasteText, setPasteText] = useState("");
  const [sendingTo, setSendingTo] = useState(null); // "gemini"|"claude"|"ollama-high"
  const [llmResponse, setLlmResponse] = useState(null); // { provider, type, text }
  const [sendPromptType, setSendPromptType] = useState(null); // which prompt type submenu is open
  const isConfirmed = touchstone.category === "confirmed";
  const isPossible = touchstone.category === "possible";
  const instances = touchstone.instances || [];
  const avgPct = instances.length >= 2
    ? Math.round(instances.reduce((sum, i) => sum + (i.confidence || 0), 0) / instances.length * 100)
    : touchstone.matchInfo?.avgMatchPercentage || 0;

  const corrections = touchstone.corrections || [];
  const userReasons = touchstone.userReasons || [];
  const rejectedReasons = touchstone.rejectedReasons || [];

  // Apply word corrections to displayed text (touchstone-specific + universal)
  const applyCorrections = (text) => {
    if (!text) return text;
    let result = text;
    // Touchstone-specific corrections first
    for (const c of corrections) {
      result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to);
    }
    // Universal corrections (skip those already covered by touchstone corrections)
    const tsFromSet = new Set(corrections.map(c => c.from.toLowerCase()));
    for (const c of universalCorrections || []) {
      if (tsFromSet.has(c.from.toLowerCase())) continue;
      try {
        const pattern = c.pattern ? c.from : c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(pattern, 'gi'), c.to);
      } catch {}
    }
    return result;
  };

  const buildPrompt = (type) => {
    const instanceBits = instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return null;

    let system, user;
    if (type === "synthesize") {
      const instanceTexts = instanceBits.map((b, idx) =>
        `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${applyCorrections(b.fullText || b.summary)}`
      ).join('\n\n---\n\n');
      system = SYSTEM_SYNTHESIZE_TOUCHSTONE;
      user = `TOUCHSTONE: "${touchstone.name}"\n\n${instanceBits.length} performance${instanceBits.length > 1 ? 's' : ''} of the same bit:\n\n${instanceTexts}`;
    } else if (type === "commune") {
      const userCriteria = touchstone.userReasons || [];
      const generatedCriteria = touchstone.matchInfo?.reasons || [];
      const allBitTexts = instanceBits.map((b) => {
        const hasUserCriteria = userCriteria.length > 0;
        const criteriaBlock = hasUserCriteria
          ? `USER CRITERIA (high-confidence signals from the comedian):\n${userCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}\n\nGENERATED CRITERIA (auto-generated):\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`
          : `GENERATED CRITERIA:\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`;
        return `TOUCHSTONE: "${touchstone.name}"\n\n${criteriaBlock}\n\nBIT TO EVALUATE:\nTitle: ${b.title}\nSource: ${b.sourceFile}\nFull text: ${applyCorrections(b.fullText || b.summary)}`;
      }).join('\n\n========================================\n\n');
      system = SYSTEM_TOUCHSTONE_COMMUNE;
      user = allBitTexts;
    } else if (type === "why_matched") {
      const anchorBit = instanceBits[0];
      const candidateBits = instanceBits.slice(1);
      const anchorText = `EXISTING 1 (from "${anchorBit.sourceFile}"):\nTitle: ${applyCorrections(anchorBit.title)}\n${applyCorrections(anchorBit.fullText || anchorBit.summary)}`;
      const candidateText = candidateBits.map((b, i) => `CANDIDATE ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorrections(b.title)}\n${applyCorrections(b.fullText || b.summary)}`).join('\n\n');
      const userReasonsBlock = userReasons.length > 0
        ? `\n\n--- USER-CONFIRMED REASONING ---\n${userReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
      const rejectedBlock = rejectedReasons.length > 0
        ? `\n\n--- REJECTED REASONING ---\n${rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
      system = SYSTEM_TOUCHSTONE_VERIFY;
      user = `TOUCHSTONE: "${touchstone.name}"\n\n--- GROUP (1 anchor instance) ---\n${anchorText}${userReasonsBlock}${rejectedBlock}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) ---\n${candidateText}`;
    }
    return { system, user };
  };

  const buildAndCopyPrompt = async (type) => {
    const prompt = buildPrompt(type);
    if (!prompt) return;
    const fullPrompt = `SYSTEM:\n${prompt.system}\n\n---\n\nUSER:\n${prompt.user}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopyFeedback(type);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch { /* fallback */ }
    setCopyPromptOpen(false);
  };

  const tryParseJSON = (text) => {
    const cleaned = text.replace(/```json\s?|```/g, "").trim();
    const attempts = [cleaned];
    // Try extracting first { ... } or [ ... ] block
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) attempts.push(objMatch[0]);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) attempts.push(arrMatch[0]);

    for (const raw of attempts) {
      try { return JSON.parse(raw); } catch {}
      // Fix unescaped newlines/tabs inside JSON string values
      try {
        const fixed = raw.replace(/"(?:[^"\\]|\\.)*"/g, (m) =>
          m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
        );
        return JSON.parse(fixed);
      } catch {}
    }

    // Fix unescaped inner quotes in group_reasoning strings from Gemini
    // e.g. "- The comedian says "hello" to the audience" → escaped inner quotes
    for (const raw of attempts) {
      try {
        // Replace inner unescaped quotes: find string values and escape quotes that aren't at boundaries
        const fixed = raw.replace(/:\s*"([\s\S]*?)"\s*([,\]\}])/g, (match, inner, after) => {
          // If it parses fine already, skip
          try { JSON.parse(`{"k":"${inner}"}`); return match; } catch {}
          // Escape unescaped inner quotes (not preceded by backslash)
          const escaped = inner
            .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
            .replace(/(?<!\\)"/g, '\\"');
          return `: "${escaped}"${after}`;
        });
        const result = JSON.parse(fixed);
        if (result) return result;
      } catch {}
    }

    // Last resort: extract fields manually for synthesize responses
    // Handles cases where inner quotes break JSON parsing
    const idealMatch = cleaned.match(/"idealText"\s*:\s*"([\s\S]*?)"\s*,\s*"notes"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/);
    if (idealMatch) {
      return { idealText: idealMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), notes: idealMatch[2].replace(/\\n/g, "\n").replace(/\\"/g, '"') };
    }
    // Try splitting on known field boundaries
    const idealIdx = cleaned.indexOf('"idealText"');
    const notesIdx = cleaned.indexOf('"notes"');
    if (idealIdx !== -1 && notesIdx !== -1) {
      try {
        const between = cleaned.substring(idealIdx, notesIdx);
        const valMatch = between.match(/"idealText"\s*:\s*"([\s\S]*)"\s*,?\s*$/);
        const notesRest = cleaned.substring(notesIdx);
        const notesMatch = notesRest.match(/"notes"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
        if (valMatch && notesMatch) {
          return { idealText: valMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), notes: notesMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') };
        }
      } catch {}
    }
    return null;
  };

  const applyParsedResponse = (responseText, type, source) => {
    const parsed = tryParseJSON(responseText);

    if (type === "synthesize") {
      const idealText = parsed?.idealText || parsed?.ideal_text || responseText;
      const notes = parsed?.notes || "";
      setLlmResponse({ provider: source, type, text: idealText, parsed: true });
      const versions = [...(touchstone.idealTextVersions || [])];
      versions.push({ idealText, notes, model: source, source: source === "paste" ? "paste" : "send-to", date: new Date().toISOString() });
      onUpdateTouchstoneEdits?.(touchstone.id, { idealTextVersions: versions });

    } else if (type === "commune") {
      if (parsed && typeof parsed.generated_criteria_score === "number") {
        const userScore = typeof parsed.user_criteria_score === "number" ? parsed.user_criteria_score : null;
        const genScore = parsed.generated_criteria_score;
        const hasUserCriteria = userScore !== null;
        const finalScore = hasUserCriteria ? Math.round(userScore * 0.51 + genScore * 0.49) : genScore;
        const status = finalScore >= 70 ? "blessed" : finalScore >= 40 ? "damned" : "removed";
        const communionResult = {
          provider: source,
          userScore,
          generatedScore: genScore,
          finalScore,
          status,
          reasoning: parsed.reasoning || "",
          date: new Date().toISOString(),
        };
        const prevResults = [...(touchstone.highEndCommunionResults || [])];
        prevResults.push(communionResult);
        onUpdateTouchstoneEdits?.(touchstone.id, { highEndCommunionResults: prevResults });
        setLlmResponse({ provider: source, type, text: `Score: ${finalScore} (user: ${userScore ?? "n/a"}, gen: ${genScore}) → ${status}\n\n${parsed.reasoning || ""}`, parsed: true, communionResult });
      } else {
        setLlmResponse({ provider: source, type, text: responseText });
      }

    } else if (type === "why_matched") {
      const hasReasoning = parsed && (Array.isArray(parsed.group_reasoning) ? parsed.group_reasoning.length > 0 : !!parsed.group_reasoning);
      const hasCandidates = parsed && Array.isArray(parsed.candidates) && parsed.candidates.length > 0;
      if (parsed && (hasReasoning || hasCandidates)) {
        const reasoning = hasReasoning
          ? (Array.isArray(parsed.group_reasoning) ? parsed.group_reasoning : [parsed.group_reasoning])
          : [];
        const rejectedSet = new Set((rejectedReasons || []).map((r) => r.toLowerCase().trim()));
        const llmReasons = reasoning.filter((r) => !rejectedSet.has(r.toLowerCase().trim())).slice(0, 5);
        const finalReasons = llmReasons.slice(0, 6);

        const instanceBits = instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
        const anchorBit = instanceBits[0];
        const candidateBits = instanceBits.slice(1);
        const candidateScores = new Map();
        for (const c of (parsed.candidates || [])) {
          if (typeof c.candidate === 'number' && typeof c.confidence === 'number') {
            const idx = c.candidate - 1;
            if (idx >= 0 && idx < candidateBits.length) {
              candidateScores.set(candidateBits[idx].id, { confidence: c.confidence, relationship: c.relationship || 'same_bit' });
            }
          }
        }

        const updatedInstances = instances.map((inst) => {
          if (inst.bitId === anchorBit?.id) return { ...inst, confidence: 1, relationship: 'same_bit' };
          const score = candidateScores.get(inst.bitId);
          if (!score) return inst;
          return { ...inst, confidence: score.confidence, relationship: score.relationship };
        });
        const avgConf = updatedInstances.length > 0 ? updatedInstances.reduce((s, i) => s + (i.confidence || 0), 0) / updatedInstances.length : 0;

        const verifyResult = { provider: source, candidates: parsed.candidates || [], group_reasoning: reasoning, date: new Date().toISOString() };
        const prevVerify = [...(touchstone.highEndVerifyResults || [])];
        prevVerify.push(verifyResult);
        onUpdateTouchstoneEdits?.(touchstone.id, {
          reasons: finalReasons.length > 0 ? finalReasons : undefined,
          highEndVerifyResults: prevVerify,
          instances: updatedInstances,
          matchInfo: {
            ...(touchstone.matchInfo || {}),
            reasons: finalReasons.length > 0 ? finalReasons : touchstone.matchInfo?.reasons || [],
            totalMatches: updatedInstances.length,
            sameBitCount: updatedInstances.filter((i) => i.relationship === "same_bit").length,
            evolvedCount: updatedInstances.filter((i) => i.relationship === "evolved").length,
            avgConfidence: avgConf,
            avgMatchPercentage: Math.round(avgConf * 100),
          },
        });

        const lines = [`Group reasoning (${source}):`];
        reasoning.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
        if (parsed.candidates) {
          lines.push("", "Candidates:");
          parsed.candidates.forEach((c) => {
            lines.push(`  #${c.candidate}: ${c.accepted ? "✓" : "✗"} ${c.relationship} (${Math.round(c.confidence * 100)}%)`);
          });
        }
        setLlmResponse({ provider: source, type, text: lines.join("\n"), parsed: true, verifyResult: parsed });
      } else {
        setLlmResponse({ provider: source, type, text: responseText });
      }
    } else {
      setLlmResponse({ provider: source, type, text: responseText });
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim() || !pasteResponseType || pasteResponseType === "pick") return;
    applyParsedResponse(pasteText.trim(), pasteResponseType, "paste");
    setPasteResponseType(null);
    setPasteText("");
  };

  const sendToProvider = async (providerId, type) => {
    const prompt = buildPrompt(type);
    if (!prompt) return;
    setSendingTo(providerId);
    setSendPromptType(null);
    setCopyPromptOpen(false);
    setLlmResponse(null);
    // Extract base provider and optional model variant (e.g. "gemini-pro" → provider:"gemini", gemini_model:"pro")
    const geminiMatch = providerId.match(/^gemini-(.+)$/);
    const provider = geminiMatch ? "gemini" : providerId;
    const gemini_model = geminiMatch ? geminiMatch[1] : undefined;
    try {
      const res = await fetch("/api/llm/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, system: prompt.system, user: prompt.user, ...(gemini_model && { gemini_model }) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "API call failed");
      const responseText = data.result;
      applyParsedResponse(responseText, type, provider);
    } catch (e) {
      setLlmResponse({ provider, type, text: `Error: ${e.message}` });
    }
    setSendingTo(null);
  };

  const addCorrection = () => {
    const from = newCorrFrom.trim();
    const to = newCorrTo.trim();
    if (!from || !to || from === to) return;
    onUpdateTouchstoneEdits?.(touchstone.id, { corrections: [...corrections, { from, to }] });
    setNewCorrFrom("");
    setNewCorrTo("");
  };

  const removeCorrection = (idx) => {
    onUpdateTouchstoneEdits?.(touchstone.id, { corrections: corrections.filter((_, i) => i !== idx) });
  };

  const addUserReason = () => {
    const reason = newReason.trim();
    if (!reason) return;
    if (userReasons.length >= 6) return;
    const updatedUserReasons = [...userReasons, reason];
    onUpdateTouchstoneEdits?.(touchstone.id, { userReasons: updatedUserReasons });
    setNewReason("");
  };

  const removeReason = (reason, llmIdx) => {
    const isUser = userReasons.includes(reason);
    if (isUser) {
      // Remove from userReasons only
      onUpdateTouchstoneEdits?.(touchstone.id, { userReasons: userReasons.filter((r) => r !== reason) });
    } else {
      // Remove LLM reason and add to rejectedReasons so it won't come back
      const updatedReasons = (touchstone.matchInfo?.reasons || []).filter((r) => r !== reason);
      onUpdateTouchstoneEdits?.(touchstone.id, { rejectedReasons: [...rejectedReasons, reason], reasons: updatedReasons });
    }
  };

  const unRejectReason = (reason) => {
    onUpdateTouchstoneEdits?.(touchstone.id, {
      rejectedReasons: rejectedReasons.filter((r) => r !== reason),
    });
  };

  useEffect(() => {
    if (autoOpenMerge) {
      setMergeOpen(true);
      onConsumeAutoOpenMerge?.();
    }
  }, [autoOpenMerge]);

  useEffect(() => {
    if (autoOpenRelate) {
      setRelateOpen(true);
      setRelateSearch("");
      onConsumeAutoOpenRelate?.();
    }
  }, [autoOpenRelate]);

  const handleAutoRename = async () => {
    const instanceBits = touchstone.instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return;
    const combinedText = instanceBits.map((b, idx) => `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${b.fullText}`).join("\n\n---\n\n");
    setRenamePending({ loading: true, suggested: null });
    try {
      const systemPrompt = "Name this recurring comedy bit based on these performances of the SAME joke. Use the format: '[3-5 word title] or, [5-8 word title]' — the first title is a punchy shorthand, the second is more descriptive. Include the literal text 'or,' between them. Focus on the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'DMV Nightmare or, The Witness Protection Line at the DMV'";
      const userContent = `${instanceBits.length} performances of the same bit:\n\n${combinedText}`;
      const result = await callOllama(systemPrompt, userContent, null, selectedModel || "qwen3.5:9b", null, null, {
        label: "touchstone-rename",
        priority: "normal",
        ollamaOptions: { num_predict: 64, num_ctx: 4096 },
        rawText: true,
      });
      // callOllama returns parsed JSON; for a plain-text response, it may be a string or throw.
      // Extract the title from whatever we get back.
      let title = (typeof result === "string" ? result : (result?.message?.content || JSON.stringify(result) || ""))
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/^["'\s]+|["'\s]+$/g, "")
        .trim();
      setRenamePending({ loading: false, suggested: title || "" });
    } catch (err) {
      console.error("[Touchstone Rename] Error:", err);
      setRenamePending(null);
    }
  };

  const confirmRename = () => {
    const title = renamePending?.suggested?.trim();
    if (title && onRenameTouchstone) onRenameTouchstone(touchstone.id, title);
    setRenamePending(null);
  };

  const toggleExpand = (bitId) => {
    setExpandedInstances((prev) => { const next = new Set(prev); if (next.has(bitId)) next.delete(bitId); else next.add(bitId); return next; });
  };

  // Check if a bit can be in this touchstone with a given relationship
  const canHaveRelationship = (bitId, rel) => {
    if (!EXCLUSIVE_RELATIONSHIPS.has(rel)) return true;
    // Check if this bit already has an exclusive relationship in ANOTHER touchstone
    for (const t of allTouchstones) {
      if (t.id === touchstone.id) continue;
      const inst = t.instances.find((i) => i.bitId === bitId);
      if (inst && EXCLUSIVE_RELATIONSHIPS.has(inst.relationship)) return false;
    }
    return true;
  };

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#ffa94d", fontSize: 14, cursor: "pointer", marginBottom: 16, fontWeight: 600 }}>
        &larr; Back to Touchstones
      </button>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          {editingTitle ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && titleDraft.trim()) {
                    onUpdateTouchstoneEdits?.(touchstone.id, { name: titleDraft.trim(), manualName: true });
                    setEditingTitle(false);
                  } else if (e.key === "Escape") setEditingTitle(false);
                }}
                autoFocus
                style={{ flex: 1, padding: "6px 10px", background: "#0a0a14", border: "1px solid #c4b5fd44", borderRadius: 4, color: "#eee", fontSize: 18, fontFamily: "'Playfair Display', serif", fontWeight: 700 }}
              />
              <button onClick={() => { if (titleDraft.trim()) { onUpdateTouchstoneEdits?.(touchstone.id, { name: titleDraft.trim(), manualName: true }); setEditingTitle(false); } }}
                style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Save</button>
              <button onClick={() => setEditingTitle(false)}
                style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
            </div>
          ) : (
            <h2
              onClick={() => { setTitleDraft(touchstone.name); setEditingTitle(true); }}
              title="Click to edit title"
              style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: "#eee", margin: 0, cursor: "pointer" }}
            >
              {touchstone.name}
              {touchstone.manualName && <span style={{ fontSize: 10, color: "#c4b5fd", marginLeft: 8, fontWeight: 400 }}>edited</span>}
            </h2>
          )}
          <span style={{ background: pctColor(avgPct), color: "#000", padding: "4px 10px", borderRadius: 6, fontWeight: 700, fontSize: 13 }}>{avgPct}%</span>
          <span style={{ fontSize: 11, color: touchstone.category === "confirmed" ? "#51cf66" : touchstone.category === "rejected" ? "#666" : "#ffa94d", fontWeight: 600, textTransform: "uppercase" }}>
            {touchstone.category === "confirmed" ? "Confirmed" : touchstone.category === "rejected" ? "Rejected" : "Possible"}
          </span>
          {renamePending?.loading && <span style={{ fontSize: 11, color: "#555" }}>generating...</span>}
        </div>

        {/* Action buttons — grouped by category */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          {/* — State changes — */}
          {onConfirmTouchstone && (
            <button onClick={() => onConfirmTouchstone(touchstone.id)}
              style={{ background: "#51cf6611", border: "1px solid #51cf6633", color: "#51cf66", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Confirm
            </button>
          )}
          {onRestoreTouchstone && (
            <button onClick={() => onRestoreTouchstone(touchstone.id)}
              style={{ background: "#4ecdc411", border: "1px solid #4ecdc433", color: "#4ecdc4", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Restore
            </button>
          )}
          {onRemoveTouchstone && (
            <button onClick={() => onRemoveTouchstone(touchstone.id)}
              style={{ background: "#ff6b6b11", border: "1px solid #ff6b6b33", color: "#ff6b6b", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Reject
            </button>
          )}

          <span style={{ width: 1, height: 16, background: "#333", margin: "0 2px" }} />

          {/* — Naming & organization — */}
          {onGenerateTitle && !renamePending && !editingTitle && (
            <button onClick={handleAutoRename} style={{ background: "#c4b5fd11", border: "1px solid #c4b5fd33", color: "#c4b5fd", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {touchstone.manualName ? "AI Rename" : "Rename"}
            </button>
          )}
          {onMergeTouchstone && mergeTargets && mergeTargets.length > 0 && (
            <button onClick={() => { setMergeOpen(!mergeOpen); setMergeSearch(""); setMergeResult(null); }}
              style={{ background: mergeOpen ? "#c4b5fd22" : "none", border: "1px solid #ffa94d44", color: "#ffa94d", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {mergeOpen ? "Cancel merge" : "Merge into..."}
            </button>
          )}
          {onRelateTouchstone && (
            <button onClick={() => { setRelateOpen(!relateOpen); setRelateSearch(""); }}
              style={{ background: relateOpen ? "#e599f722" : "none", border: "1px solid #e599f744", color: "#e599f7", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {relateOpen ? "Cancel relate" : "Relate..."}
            </button>
          )}

          <span style={{ width: 1, height: 16, background: "#333", margin: "0 2px" }} />

          {/* — LLM ops — */}
          {onPruneTouchstone && touchstone.bitIds.length > 2 && (
            <button onClick={() => onPruneTouchstone(touchstone.id)} disabled={processing}
              style={{ background: processing ? "none" : "#ff6b6b11", border: "1px solid #ff6b6b33", color: processing ? "#555" : "#ff6b6b", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: processing ? "default" : "pointer", fontWeight: 600 }}>
              Prune
            </button>
          )}
          {onCommuneTouchstone && (
            <button onClick={() => onCommuneTouchstone(touchstone.id)} disabled={processing}
              style={{ background: processing ? "none" : "#c4b5fd11", border: "1px solid #c4b5fd33", color: processing ? "#555" : "#c4b5fd", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: processing ? "default" : "pointer", fontWeight: 600 }}>
              Commune
            </button>
          )}
          {onSynthesizeTouchstone && (
            <button onClick={() => onSynthesizeTouchstone(touchstone.id)} disabled={processing || touchstone.manualIdealText}
              title={touchstone.manualIdealText ? "Ideal text is manually edited — unlock it first" : ""}
              style={{ background: processing || touchstone.manualIdealText ? "none" : "#74c0fc11", border: "1px solid #74c0fc33", color: processing || touchstone.manualIdealText ? "#555" : "#74c0fc", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: processing || touchstone.manualIdealText ? "default" : "pointer", fontWeight: 600 }}>
              {touchstone.manualIdealText ? "Synthesize (locked)" : touchstone.idealText ? "Re-synthesize" : "Synthesize"}
            </button>
          )}

          <span style={{ width: 1, height: 16, background: "#333", margin: "0 2px" }} />

          {/* — Clipboard & external — */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setCopyPromptOpen(!copyPromptOpen); setSendPromptType(null); setPasteResponseType(null); }}
              style={{ background: copyFeedback ? "#51cf6611" : "#c4b5fd11", border: `1px solid ${copyFeedback ? "#51cf6633" : "#c4b5fd33"}`, color: copyFeedback ? "#51cf66" : "#c4b5fd", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {copyFeedback ? "Copied!" : "Copy Prompt"}
            </button>
            {copyPromptOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 4, zIndex: 100, minWidth: 140 }}>
                <button onClick={() => buildAndCopyPrompt("synthesize")} style={{ display: "block", width: "100%", background: "none", border: "none", color: "#74c0fc", padding: "6px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                  onMouseEnter={(e) => e.target.style.background = "#74c0fc11"} onMouseLeave={(e) => e.target.style.background = "none"}>
                  Synthesize
                </button>
                <button onClick={() => buildAndCopyPrompt("commune")} style={{ display: "block", width: "100%", background: "none", border: "none", color: "#c4b5fd", padding: "6px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                  onMouseEnter={(e) => e.target.style.background = "#c4b5fd11"} onMouseLeave={(e) => e.target.style.background = "none"}>
                  Commune
                </button>
                <button onClick={() => buildAndCopyPrompt("why_matched")} disabled={instances.length < 2} style={{ display: "block", width: "100%", background: "none", border: "none", color: instances.length < 2 ? "#555" : "#ffa94d", padding: "6px 10px", fontSize: 11, cursor: instances.length < 2 ? "default" : "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                  onMouseEnter={(e) => { if (instances.length >= 2) e.target.style.background = "#ffa94d11"; }} onMouseLeave={(e) => e.target.style.background = "none"}>
                  Why Matched
                </button>
              </div>
            )}
          </div>
          {/* Paste Response */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setPasteResponseType(pasteResponseType ? null : "pick"); setCopyPromptOpen(false); setSendPromptType(null); }}
              style={{ background: pasteResponseType ? "#51cf6611" : "#c4b5fd11", border: `1px solid ${pasteResponseType ? "#51cf6633" : "#c4b5fd33"}`, color: pasteResponseType ? "#51cf66" : "#c4b5fd", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Paste Response
            </button>
            {pasteResponseType === "pick" && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 4, zIndex: 100, minWidth: 140 }}>
                <div style={{ fontSize: 10, color: "#555", padding: "4px 10px", borderBottom: "1px solid #252538", marginBottom: 4 }}>Parse response as:</div>
                {["synthesize", "commune", ...(instances.length >= 2 ? ["why_matched"] : [])].map((type) => (
                  <button key={type} onClick={() => { setPasteResponseType(type); setPasteText(""); }}
                    style={{ display: "block", width: "100%", background: "none", border: "none", color: type === "synthesize" ? "#74c0fc" : type === "commune" ? "#c4b5fd" : "#ffa94d", padding: "6px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                    onMouseEnter={(e) => e.target.style.background = "#ffffff08"} onMouseLeave={(e) => e.target.style.background = "none"}>
                    {type === "why_matched" ? "Why Matched" : type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            )}
            {pasteResponseType && pasteResponseType !== "pick" && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 8, zIndex: 100, minWidth: 320 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>
                  Paste <span style={{ color: pasteResponseType === "synthesize" ? "#74c0fc" : pasteResponseType === "commune" ? "#c4b5fd" : "#ffa94d", fontWeight: 600 }}>
                    {pasteResponseType === "why_matched" ? "Why Matched" : pasteResponseType.charAt(0).toUpperCase() + pasteResponseType.slice(1)}
                  </span> JSON response:
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='{"idealText": "...", "notes": "..."}'
                  style={{ width: "100%", minHeight: 120, background: "#0d0d16", border: "1px solid #333", borderRadius: 4, color: "#ccc", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: 8, resize: "vertical", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => { setPasteResponseType("pick"); setPasteText(""); }}
                    style={{ background: "none", border: "1px solid #333", color: "#666", borderRadius: 4, padding: "3px 10px", fontSize: 10, cursor: "pointer" }}>
                    Back
                  </button>
                  <button onClick={handlePasteSubmit} disabled={!pasteText.trim()}
                    style={{ background: pasteText.trim() ? "#51cf6622" : "none", border: `1px solid ${pasteText.trim() ? "#51cf6644" : "#333"}`, color: pasteText.trim() ? "#51cf66" : "#555", borderRadius: 4, padding: "3px 10px", fontSize: 10, cursor: pasteText.trim() ? "pointer" : "default", fontWeight: 600 }}>
                    Parse
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Send to... with model selection */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setSendPromptType(sendPromptType ? null : "pick"); setCopyPromptOpen(false); setPasteResponseType(null); }}
              disabled={!!sendingTo}
              style={{ background: sendingTo ? "#ffa94d11" : "none", border: "1px solid #333", color: sendingTo ? "#ffa94d" : "#aaa", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: sendingTo ? "wait" : "pointer", fontWeight: 600 }}>
              {sendingTo ? `Sending to ${sendingTo}...` : "Send to..."}
            </button>
            {sendPromptType === "pick" && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 4, zIndex: 100, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "#555", padding: "4px 10px", borderBottom: "1px solid #252538", marginBottom: 4 }}>Choose prompt, then provider</div>
                {["synthesize", "commune", ...(instances.length >= 2 ? ["why_matched"] : [])].map((type) => (
                  <button key={type} onClick={() => setSendPromptType(type)}
                    style={{ display: "block", width: "100%", background: "none", border: "none", color: type === "synthesize" ? "#74c0fc" : type === "commune" ? "#c4b5fd" : "#ffa94d", padding: "6px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                    onMouseEnter={(e) => e.target.style.background = "#ffffff08"} onMouseLeave={(e) => e.target.style.background = "none"}>
                    {type === "why_matched" ? "Why Matched" : type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            )}
            {sendPromptType && sendPromptType !== "pick" && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid #333", borderRadius: 6, padding: 4, zIndex: 100, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "#555", padding: "4px 10px", borderBottom: "1px solid #252538", marginBottom: 4 }}>
                  Send "{sendPromptType}" to:
                </div>
                {[
                  { id: "gemini", label: "Gemini", color: "#4285f4", variants: [
                    { id: "gemini-pro", label: "Pro", suffix: " Pro" },
                    { id: "gemini-thinking", label: "Thinking", suffix: " Thinking" },
                    { id: "gemini-flash", label: "Flash", suffix: " Flash" },
                  ]},
                  { id: "claude", label: "Claude Sonnet", color: "#c4946a" },
                  { id: "ollama-high", label: "Ollama (high-end)", color: "#51cf66" },
                ].map((provider) => provider.variants ? (
                  <div key={provider.id}>
                    <div style={{ fontSize: 10, color: provider.color, padding: "5px 10px", fontWeight: 600 }}>{provider.label}</div>
                    {provider.variants.map((v) => (
                      <button key={v.id} onClick={() => sendToProvider(v.id, sendPromptType)}
                        style={{ display: "block", width: "100%", background: "none", border: "none", color: provider.color, padding: "5px 10px 5px 20px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4 }}
                        onMouseEnter={(e) => e.target.style.background = provider.color + "11"} onMouseLeave={(e) => e.target.style.background = "none"}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button key={provider.id} onClick={() => sendToProvider(provider.id, sendPromptType)}
                    style={{ display: "block", width: "100%", background: "none", border: "none", color: provider.color, padding: "6px 10px", fontSize: 11, cursor: "pointer", textAlign: "left", borderRadius: 4, fontWeight: 600 }}
                    onMouseEnter={(e) => e.target.style.background = provider.color + "11"} onMouseLeave={(e) => e.target.style.background = "none"}>
                    {provider.label}
                  </button>
                ))}
                <button onClick={() => setSendPromptType("pick")}
                  style={{ display: "block", width: "100%", background: "none", border: "none", color: "#666", padding: "4px 10px", fontSize: 10, cursor: "pointer", textAlign: "left", borderRadius: 4, marginTop: 2 }}
                  onMouseEnter={(e) => e.target.style.background = "#ffffff08"} onMouseLeave={(e) => e.target.style.background = "none"}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>

        {/* LLM Response panel */}
        {llmResponse && (
          <div style={{ marginBottom: 12, padding: 12, background: "#0d0d16", borderRadius: 8, border: `1px solid ${llmResponse.parsed ? "#51cf6644" : "#333"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>
                Response from <span style={{ color: llmResponse.provider === "gemini" ? "#4285f4" : llmResponse.provider === "claude" ? "#c4946a" : "#51cf66" }}>{llmResponse.provider}</span>
                <span style={{ color: "#555" }}> ({llmResponse.type})</span>
                {llmResponse.parsed && <span style={{ color: "#51cf66", marginLeft: 6 }}>parsed</span>}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {llmResponse.type === "synthesize" && llmResponse.parsed && (
                  <button onClick={() => {
                    // Use this synthesis as the active ideal text
                    const versions = touchstone.idealTextVersions || [];
                    const latest = versions[versions.length - 1];
                    if (latest) {
                      onUpdateTouchstoneEdits?.(touchstone.id, { idealText: latest.idealText, idealTextNotes: latest.notes || "", manualIdealText: false });
                    }
                  }}
                    style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
                    Use as ideal text
                  </button>
                )}
                <button onClick={async () => {
                  try { await navigator.clipboard.writeText(llmResponse.text); } catch {}
                }}
                  style={{ background: "none", border: "1px solid #333", color: "#aaa", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>
                  Copy
                </button>
                <button onClick={() => setLlmResponse(null)}
                  style={{ background: "none", border: "1px solid #333", color: "#666", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#ccc", whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto", lineHeight: 1.5 }}>
              {llmResponse.text}
            </div>
          </div>
        )}

        {/* Merge picker */}
        {mergeOpen && (
          <div style={{ marginBottom: 12, padding: 12, background: "#0d0d16", borderRadius: 8, border: "1px solid #c4b5fd33" }}>
            <div style={{ fontSize: 11, color: "#c4b5fd", fontWeight: 600, marginBottom: 8 }}>
              Merge this touchstone's bits into an existing one. The LLM will verify each bit belongs.
            </div>
            <input
              type="text"
              value={mergeSearch}
              onChange={(e) => setMergeSearch(e.target.value)}
              placeholder="Search touchstones..."
              autoFocus
              style={{ width: "100%", padding: "6px 10px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
            />
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {searchTouchstones(mergeTargets.filter((t) => t.id !== touchstone.id), mergeSearch)
                .map((target) => (
                  <div
                    key={target.id}
                    onClick={async () => {
                      console.log("[MergePicker] Clicked target:", target.id, target.name, "processing:", processing);
                      if (processing) { console.warn("[MergePicker] Blocked by processing flag"); return; }
                      if (!window.confirm(`Merge "${touchstone.name}" into "${target.name}"? The LLM will verify each bit.`)) return;
                      console.log("[MergePicker] Confirmed, calling onMergeTouchstone...");
                      setMergeOpen(false);
                      try {
                        const result = await onMergeTouchstone(touchstone.id, target.id);
                        console.log("[MergePicker] Result:", result);
                        setMergeResult(result);
                        if (result && (result.accepted > 0 || result.alreadyMerged)) {
                          onBack();
                        }
                      } catch (err) {
                        console.error("[MergePicker] Error:", err);
                      }
                    }}
                    style={{ padding: "8px 10px", cursor: processing ? "default" : "pointer", fontSize: 12, color: "#bbb", borderBottom: "1px solid #1a1a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a2a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: "#ddd" }}>{target.name}</span>
                      <span style={{ marginLeft: 8, fontSize: 10, color: target.category === "confirmed" ? "#51cf66" : "#ffa94d" }}>
                        {target.category}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#666" }}>{target.instances.length} instances</span>
                  </div>
                ))}
            </div>
            {mergeResult && (
              <div style={{ marginTop: 8, fontSize: 11, color: mergeResult.accepted > 0 ? "#51cf66" : "#ff8888" }}>
                {mergeResult.accepted} accepted, {mergeResult.rejected} rejected by LLM.
              </div>
            )}
          </div>
        )}

        {/* Relate picker */}
        {relateOpen && onRelateTouchstone && (
          <div style={{ marginBottom: 12, padding: 12, background: "#0d0d16", borderRadius: 8, border: "1px solid #e599f733" }}>
            <div style={{ fontSize: 11, color: "#e599f7", fontWeight: 600, marginBottom: 8 }}>
              Link a touchstone that often appears adjacent in setlists / performance flows.
            </div>
            <input
              type="text"
              value={relateSearch}
              onChange={(e) => setRelateSearch(e.target.value)}
              placeholder="Search touchstones..."
              autoFocus
              style={{ width: "100%", padding: "6px 10px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
            />
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {searchTouchstones(
                allTouchstones.filter((t) => t.id !== touchstone.id && !(touchstone.relatedTouchstoneIds || []).includes(t.id) && t.category !== "rejected"),
                relateSearch
              ).map((target) => (
                  <div
                    key={target.id}
                    onClick={() => {
                      onRelateTouchstone(touchstone.id, target.id);
                      setRelateOpen(false);
                    }}
                    style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#bbb", borderBottom: "1px solid #1a1a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a2a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: "#ddd" }}>{target.name}</span>
                      <span style={{ marginLeft: 8, fontSize: 10, color: target.category === "confirmed" ? "#51cf66" : "#ffa94d" }}>
                        {target.category}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#666" }}>{target.instances.length} instances</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {renamePending && !renamePending.loading && renamePending.suggested != null && (
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="text" value={renamePending.suggested} onChange={(e) => setRenamePending((p) => ({ ...p, suggested: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); else if (e.key === "Escape") setRenamePending(null); }} autoFocus style={{ flex: 1, padding: "6px 10px", background: "#0a0a14", border: "1px solid #c4b5fd44", borderRadius: 4, color: "#c4b5fd", fontSize: 14, fontFamily: "inherit" }} />
            <button onClick={confirmRename} style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>OK</button>
            <button onClick={() => setRenamePending(null)} style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
          </div>
        )}

      </div>

      {/* Ideal Text + Notes (always paired) */}
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

      {/* Word Corrections */}
      {onUpdateTouchstoneEdits && (
        <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>
              Word Corrections {corrections.length > 0 && `(${corrections.length})`}
            </div>
            <button
              onClick={() => setCorrectionsOpen(!correctionsOpen)}
              style={{ background: "none", border: "1px solid #333", color: correctionsOpen ? "#4ecdc4" : "#888", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}
            >
              {correctionsOpen ? "Hide" : corrections.length > 0 ? "Edit" : "Add"}
            </button>
          </div>
          {corrections.length > 0 && !correctionsOpen && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {corrections.map((c, i) => (
                <span key={i} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#4ecdc418", color: "#4ecdc4" }}>
                  {c.from} &rarr; {c.to}
                </span>
              ))}
            </div>
          )}
          {correctionsOpen && (
            <div>
              {corrections.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11 }}>
                  <span style={{ color: "#ff8888", textDecoration: "line-through" }}>{c.from}</span>
                  <span style={{ color: "#555" }}>&rarr;</span>
                  <span style={{ color: "#51cf66" }}>{c.to}</span>
                  <button
                    onClick={() => removeCorrection(i)}
                    style={{ background: "none", border: "none", color: "#ff6b6b", fontSize: 12, cursor: "pointer", padding: "0 2px" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <input
                  type="text"
                  value={newCorrFrom}
                  onChange={(e) => setNewCorrFrom(e.target.value)}
                  placeholder="Wrong word"
                  style={{ flex: 1, padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ff8888", fontSize: 11, fontFamily: "inherit" }}
                />
                <span style={{ color: "#555", fontSize: 11, alignSelf: "center" }}>&rarr;</span>
                <input
                  type="text"
                  value={newCorrTo}
                  onChange={(e) => setNewCorrTo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addCorrection(); }}
                  placeholder="Correct word"
                  style={{ flex: 1, padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#51cf66", fontSize: 11, fontFamily: "inherit" }}
                />
                <button
                  onClick={addCorrection}
                  disabled={!newCorrFrom.trim() || !newCorrTo.trim()}
                  style={{ background: newCorrFrom.trim() && newCorrTo.trim() ? "#4ecdc422" : "none", border: "1px solid #4ecdc433", color: newCorrFrom.trim() && newCorrTo.trim() ? "#4ecdc4" : "#555", borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: newCorrFrom.trim() && newCorrTo.trim() ? "pointer" : "default", fontWeight: 600 }}
                >
                  Add
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
                Corrections are applied when sending text to the LLM and when displaying instance text.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Match details & reasoning */}
      <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
          {(() => {
            const liveSameBit = instances.filter((i) => i.relationship === "same_bit").length;
            const liveEvolved = instances.filter((i) => i.relationship === "evolved").length;
            const liveRelated = instances.filter((i) => i.relationship === "related").length;
            const liveCallback = instances.filter((i) => i.relationship === "callback").length;
            const hasDetails = liveSameBit > 0 || liveEvolved > 0 || liveRelated > 0 || liveCallback > 0;
            if (!hasDetails) return null;
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Match Details</div>
                <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6 }}>
                  {liveSameBit > 0 && <div>{liveSameBit} same-bit match{liveSameBit > 1 ? "es" : ""}</div>}
                  {liveEvolved > 0 && <div>{liveEvolved} evolved version{liveEvolved > 1 ? "s" : ""}</div>}
                  {liveRelated > 0 && <div>{liveRelated} related match{liveRelated > 1 ? "es" : ""}</div>}
                  {liveCallback > 0 && <div>{liveCallback} callback{liveCallback > 1 ? "s" : ""}</div>}
                </div>
              </>
            );
          })()}
          <div style={{ marginTop: instances.length > 0 ? 10 : 0, borderTop: instances.length > 0 ? "1px solid #1a1a2a" : "none", paddingTop: instances.length > 0 ? 8 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#888" }}>Why matched:</span>
              <div style={{ display: "flex", gap: 4 }}>
                {onRefreshReasons && touchstone.instances.length >= 2 && (
                  <button
                    onClick={() => onRefreshReasons(touchstone.id)}
                    disabled={processing}
                    style={{ background: "none", border: "1px solid #333", color: processing ? "#555" : "#c4b5fd", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: processing ? "default" : "pointer", fontWeight: 600 }}
                  >
                    Refresh
                  </button>
                )}
              </div>
            </div>
            {(() => {
              const llmReasons = (touchstone.matchInfo?.reasons || []).filter((r) => !userReasons.includes(r));
              const llmSlots = Math.max(0, 6 - userReasons.length);
              const displayLlm = llmReasons.slice(0, llmSlots);
              return (
                <>
                  {userReasons.map((reason, idx) => (
                    <div key={`u-${idx}`} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0" }}>
                      <div style={{ flex: 1, fontSize: 11, color: "#ffa94d", fontStyle: "italic", lineHeight: 1.5 }}>
                        <span style={{ fontSize: 9, color: "#ffa94d", fontWeight: 600, marginRight: 4, fontStyle: "normal" }}>USER</span>
                        {reason}
                      </div>
                      {onUpdateTouchstoneEdits && (
                        <button
                          onClick={() => removeReason(reason, -1)}
                          title="Remove your reason"
                          style={{ background: "none", border: "none", color: "#ff6b6b", fontSize: 12, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                  {displayLlm.map((reason, idx) => (
                    <div key={`l-${idx}`} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0" }}>
                      <div style={{ flex: 1, fontSize: 11, color: "#aaa", fontStyle: "italic", lineHeight: 1.5 }}>
                        {reason}
                      </div>
                      {onUpdateTouchstoneEdits && (
                        <button
                          onClick={() => removeReason(reason, idx)}
                          title="Remove this reason (won't come back on refresh)"
                          style={{ background: "none", border: "none", color: "#ff6b6b", fontSize: 12, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                </>
              );
            })()}
            {/* Add reason */}
            {onUpdateTouchstoneEdits && (
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <input
                  type="text"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addUserReason(); }}
                  placeholder="Add your own matching rationale..."
                  style={{ flex: 1, padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ffa94d", fontSize: 11, fontFamily: "inherit" }}
                />
                <button
                  onClick={addUserReason}
                  disabled={!newReason.trim()}
                  style={{ background: newReason.trim() ? "#ffa94d22" : "none", border: "1px solid #ffa94d33", color: newReason.trim() ? "#ffa94d" : "#555", borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: newReason.trim() ? "pointer" : "default", fontWeight: 600 }}
                >
                  Add
                </button>
              </div>
            )}
            {/* Show rejected reasons so user can un-reject — collapsed by default */}
            {rejectedReasons.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  onClick={() => setRejectedReasonsOpen(!rejectedReasonsOpen)}
                  style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <span>{rejectedReasonsOpen ? "▾" : "▸"}</span>
                  Rejected reasons ({rejectedReasons.length})
                </div>
                {rejectedReasonsOpen && rejectedReasons.map((reason, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "2px 0" }}>
                    <div style={{ flex: 1, fontSize: 10, color: "#555", fontStyle: "italic", lineHeight: 1.4, textDecoration: "line-through" }}>{reason}</div>
                    <button
                      onClick={() => unRejectReason(reason)}
                      title="Allow this reason to be regenerated"
                      style={{ background: "none", border: "none", color: "#4ecdc4", fontSize: 10, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
                    >
                      undo
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      {/* Flow Neighbors (collapsed) */}
      {(() => {
        const relatedIds = touchstone.relatedTouchstoneIds || [];
        if (relatedIds.length === 0) return null;
        const relatedTs = relatedIds.map(id => allTouchstones.find(t => t.id === id)).filter(Boolean);
        if (relatedTs.length === 0) return null;
        return (
          <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
            <div
              onClick={() => setFlowNeighborsOpen(!flowNeighborsOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "#e599f7", textTransform: "uppercase", letterSpacing: 1 }}>
                Flow Neighbors ({relatedTs.length})
              </div>
              <span style={{ fontSize: 10, color: "#666" }}>{flowNeighborsOpen ? "▾" : "▸"}</span>
            </div>
            {flowNeighborsOpen && (
              <div style={{ marginTop: 8 }}>
                {relatedTs.map(rt => (
                  <div
                    key={rt.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "#0a0a14", borderRadius: 5, border: "1px solid #1a1a2a", marginBottom: 4, cursor: "pointer", transition: "border-color 0.15s" }}
                    onClick={() => onNavigateToTouchstone?.(rt.id)}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#e599f7"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a2a"; }}
                  >
                    <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rt.name}</span>
                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: rt.category === "confirmed" ? "#51cf6618" : "#ffa94d18", color: rt.category === "confirmed" ? "#51cf66" : "#ffa94d" }}>
                      {rt.category}
                    </span>
                    {onUnrelateTouchstone && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUnrelateTouchstone(touchstone.id, rt.id); }}
                        title="Unlink flow neighbor"
                        style={{ background: "none", border: "none", color: "#ff6b6b", fontSize: 12, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Matched notes (collapsed) */}
      {(() => {
        const matchedNotes = (notes || []).filter(n => n.matchedTouchstoneId === touchstone.id);
        if (matchedNotes.length === 0) return null;
        return (
          <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
            <div
              onClick={() => setMatchedNotesOpen(!matchedNotesOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>
                Notes ({matchedNotes.length})
              </div>
              <span style={{ fontSize: 10, color: "#666" }}>{matchedNotesOpen ? "▾" : "▸"}</span>
            </div>
            {matchedNotesOpen && matchedNotes.map(note => (
              <div
                key={note.id}
                onClick={() => onGoToNote?.(note)}
                style={{
                  padding: "6px 10px",
                  background: "#0a0a14",
                  borderRadius: 5,
                  border: "1px solid #1a1a2a",
                  marginBottom: 4,
                  cursor: onGoToNote ? "pointer" : "default",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#da77f2"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a2a"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {note.title || note.text?.substring(0, 60) || "Untitled"}
                  </span>
                  {(note.tags || []).length > 0 && (
                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#da77f218", color: "#da77f2", border: "1px solid #da77f233", flexShrink: 0 }}>
                      {note.tags[0]}
                    </span>
                  )}
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#1a1a2a", color: "#888", flexShrink: 0 }}>
                    {note.source}
                  </span>
                  {note.matchScore != null && (
                    <span style={{ fontSize: 9, color: "#6ee7b7", flexShrink: 0 }}>
                      {Math.round(note.matchScore * 100)}%
                    </span>
                  )}
                </div>
                {note.text && (
                  <div style={{ fontSize: 11, color: "#777", marginTop: 3, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {note.text.substring(0, 120)}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Instances */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Instances ({touchstone.instances.length})
        </div>

        {[...touchstone.instances].sort((a, b) => {
          const aCore = (touchstone.coreBitIds || []).includes(a.bitId) ? 1 : 0;
          const bCore = (touchstone.coreBitIds || []).includes(b.bitId) ? 1 : 0;
          return bCore - aCore;
        }).map((instance) => {
          const bit = bits.find((b) => b.id === instance.bitId);
          if (!bit) return null;
          const isExpanded = expandedInstances.has(instance.bitId);
          const isCore = (touchstone.coreBitIds || []).includes(instance.bitId);

          const relColor = { same_bit: "#51cf66", evolved: "#ffa94d", related: "#4ecdc4", callback: "#cc5de8", "tag-on": "#74c0fc" }[instance.relationship] || "#888";

          return (
            <div key={instance.bitId} className="card" style={{ marginBottom: 8, cursor: "default", borderLeft: isCore ? "3px solid #ffd43b" : "3px solid transparent" }}>
              {/* Top row: action buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button onClick={() => onSelectBit(bit)} style={{ background: "#4ecdc418", border: "1px solid #4ecdc444", color: "#4ecdc4", borderRadius: 4, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Detail</button>
                  {onGoToMix && (
                    <button onClick={() => onGoToMix(bit)} style={{ background: "#ffa94d18", border: "1px solid #ffa94d44", color: "#ffa94d", borderRadius: 4, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Mix</button>
                  )}
                  <button onClick={() => toggleExpand(instance.bitId)} style={{ background: isExpanded ? "#252538" : "none", border: "1px solid #252538", color: isExpanded ? "#4ecdc4" : "#888", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                    {isExpanded ? "Hide" : "Text"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {/* Relationship selector */}
                  <select
                    value={instance.relationship || "matched"}
                    onChange={(e) => {
                      const newRel = e.target.value;
                      if (EXCLUSIVE_RELATIONSHIPS.has(newRel) && !canHaveRelationship(instance.bitId, newRel)) {
                        alert("This bit already has a same-bit/evolved relationship in another touchstone.");
                        return;
                      }
                      onUpdateInstanceRelationship?.(touchstone.id, instance.bitId, newRel);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: `${relColor}18`, color: relColor, border: `1px solid ${relColor}44`,
                      borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer", fontWeight: 600,
                      appearance: "auto",
                    }}
                  >
                    {RELATIONSHIP_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt.replace("_", " ")}</option>
                    ))}
                  </select>
                  {/* Communion status selector */}
                  {onSaintInstance && (() => {
                    const cs = instance.communionStatus || 'purgatory';
                    const cfg = COMMUNION_STATUS_CONFIG[cs] || COMMUNION_STATUS_CONFIG.purgatory;
                    return (
                      <select
                        value={cs}
                        onChange={(e) => onSaintInstance(touchstone.id, instance.bitId, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: `${cfg.bg}`, color: cfg.color, border: `1px solid ${cfg.border}`,
                          borderRadius: 4, padding: "2px 4px", fontSize: 10, cursor: "pointer", fontWeight: 600,
                          appearance: "auto",
                        }}
                      >
                        {Object.entries(COMMUNION_STATUS_CONFIG).map(([key, val]) => (
                          <option key={key} value={key}>{val.icon} {val.label}</option>
                        ))}
                      </select>
                    );
                  })()}
                  {(instance.matchPercentage || instance.confidence) > 0 && <span style={{ fontSize: 10, color: "#666" }}>{Math.round(instance.matchPercentage || (instance.confidence * 100))}%</span>}
                  {onRemoveInstance && touchstone.instances.length > 1 && (
                    <button
                      onClick={() => { if (window.confirm(`Remove "${bit.title}" from this touchstone?`)) onRemoveInstance(touchstone.id, instance.bitId); }}
                      style={{ background: "#ff6b6b11", border: "1px solid #ff6b6b33", color: "#ff6b6b", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>
              {/* Content */}
              <div>
                <div style={{ fontWeight: 600, color: "#ddd", fontSize: 13, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>#{instance.instanceNumber} — {applyCorrections(bit.title)}</span>
                  {onToggleCoreBit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleCoreBit(touchstone.id, instance.bitId); }}
                      title={isCore ? "Remove from core bits" : "Mark as core bit (anchor for prune/commune)"}
                      style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: isCore ? "#ffd43b22" : "none", color: isCore ? "#ffd43b" : "#555", border: `1px solid ${isCore ? "#ffd43b44" : "#333"}`, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer" }}
                    >
                      Core
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, marginBottom: 4 }}><StyledFilename sourceFile={bit.sourceFile} /></div>
                {bit.summary && <div style={{ fontSize: 11, color: "#777", lineHeight: 1.4, marginBottom: 4 }}>{applyCorrections(bit.summary)}</div>}
              </div>

              {isExpanded && bit.fullText && (
                <div style={{ marginTop: 10, padding: 12, background: "#0a0a14", borderRadius: 6, border: "1px solid #1a1a2a", fontSize: 12, color: "#bbb", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 400, overflowY: "auto", userSelect: "text" }}>
                  {applyCorrections(bit.fullText)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HuntButton({ onHunt, huntProgress, processing }) {
  const isHunting = processing && huntProgress && huntProgress.current < huntProgress.total;
  const isDone = huntProgress && huntProgress.current === huntProgress.total && huntProgress.total > 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={onHunt} disabled={processing} style={{ width: "100%", padding: "6px 12px", background: processing ? "#33333a" : "#4ecdc4", color: processing ? "#888" : "#000", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: processing ? "default" : "pointer", transition: "all 0.2s" }}>
        {isHunting ? `Hunting... ${huntProgress.current}/${huntProgress.total}` : "Hunt for Touchstones"}
      </button>
      {huntProgress && (
        <div style={{ marginTop: 8 }}>
          {huntProgress.total > 0 && (
            <div style={{ background: "#0a0a14", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ height: "100%", borderRadius: 4, transition: "width 0.3s", width: `${(huntProgress.current / huntProgress.total) * 100}%`, background: isDone ? "#51cf66" : "#4ecdc4" }} />
            </div>
          )}
          <div style={{ fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isDone ? "#51cf66" : "#888" }}>{huntProgress.status}</span>
            {huntProgress.found > 0 && <span style={{ color: "#4ecdc4", fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>{huntProgress.found} found</span>}
          </div>

          {/* Current query — what's being compared right now */}
          {isHunting && huntProgress.lastPrompt && (
            <div style={{
              marginTop: 8,
              padding: "8px 10px",
              background: "#0a0a14",
              borderRadius: 6,
              borderLeft: "3px solid #da77f2",
              fontSize: 10,
              color: "#da77f2",
              maxHeight: 80,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", marginBottom: 4, color: "#888", fontSize: 9 }}>
                Currently Comparing (Batch {huntProgress.current}/{huntProgress.total})
              </div>
              {(() => {
                // Extract source title and candidate titles from the prompt
                const sourceMatch = huntProgress.lastPrompt.match(/^SOURCE BIT:\nTitle: (.+)/m);
                const candidateMatches = [...huntProgress.lastPrompt.matchAll(/^CANDIDATE \d+:\nTitle: (.+)/gm)];
                const sourceTitle = sourceMatch ? sourceMatch[1] : "?";
                const candTitles = candidateMatches.map(m => m[1]);
                return (
                  <>
                    <div style={{ color: "#ddd", fontWeight: 600 }}>"{sourceTitle}"</div>
                    <div style={{ color: "#999", marginTop: 2 }}>
                      vs {candTitles.length} candidate{candTitles.length !== 1 ? "s" : ""}: {candTitles.map((t, i) => (
                        <span key={i}>{i > 0 ? ", " : ""}"{t}"</span>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* LLM response for current batch */}
          {huntProgress.lastResponse && (
            <div style={{
              marginTop: 6,
              padding: "8px 10px",
              background: "#0a0a14",
              borderRadius: 6,
              borderLeft: "3px solid #4ecdc4",
              fontSize: 10,
              maxHeight: 100,
              overflowY: "auto",
            }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", marginBottom: 4, color: "#888", fontSize: 9 }}>
                LLM Response
              </div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#aaa", fontFamily: "'JetBrains Mono', monospace", fontSize: 9, lineHeight: 1.3 }}>
                {huntProgress.lastResponse}
              </pre>
            </div>
          )}

          {/* Matches found so far */}
          {huntProgress.recentMatches && huntProgress.recentMatches.length > 0 && (
            <div style={{
              marginTop: 6,
              padding: "8px 10px",
              background: "#0a0a14",
              borderRadius: 6,
              borderLeft: "3px solid #51cf66",
              fontSize: 10,
              maxHeight: 200,
              overflowY: "auto",
            }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", marginBottom: 4, color: "#888", fontSize: 9 }}>
                Matches Found ({huntProgress.recentMatches.length})
              </div>
              {huntProgress.recentMatches.map((m, idx) => (
                <div key={idx} style={{ marginBottom: 4, paddingBottom: 4, borderBottom: "1px solid #1a1a2a" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#ddd", fontWeight: 600 }}>
                      "{m.sourceTitle}" ↔ "{m.candidateTitle}"
                    </span>
                    <span style={{
                      color: m.relationship === "same_bit" ? "#ff6b6b" : "#ffa94d",
                      fontWeight: 700,
                      marginLeft: 8,
                      flexShrink: 0,
                    }}>
                      {m.percentage}% {m.relationship}
                    </span>
                  </div>
                  {m.reason && (
                    <div style={{ color: "#888", marginTop: 1, fontStyle: "italic", fontSize: 9 }}>
                      {m.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="card" style={{ flex: 1, padding: 12, textAlign: "center", cursor: "default" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
    </div>
  );
}
