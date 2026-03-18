import { useState, useMemo, useEffect } from "react";

const RELATIONSHIP_OPTIONS = ["same_bit", "evolved", "related", "callback", "tag-on"];
const EXCLUSIVE_RELATIONSHIPS = new Set(["same_bit", "evolved"]);

/**
 * TouchstonePanel - Display and explore touchstones (recurring jokes across transcripts)
 */
export function TouchstonePanel({
  touchstones, bits, matches, onSelectBit, onHunt, onRectifyOverlaps, huntProgress, processing,
  onGenerateTitle, onRenameTouchstone, onRemoveInstance, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone, onCreateTouchstone,
  onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, onUpdateTouchstoneEdits,
  onCommuneTouchstone, onSynthesizeTouchstone, onMassTouchstoneCommunion, onSaintInstance,
  initialTouchstoneId, onConsumeInitialTouchstone,
}) {
  const [selectedTouchstoneId, setSelectedTouchstoneId] = useState(null);
  const [autoOpenMerge, setAutoOpenMerge] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState(null); // bit to seed new touchstone
  const [touchstoneFilter, setTouchstoneFilter] = useState("");
  const [newTouchstoneName, setNewTouchstoneName] = useState("");

  // Navigate to a specific touchstone from external (e.g. DetailPanel)
  useEffect(() => {
    if (!initialTouchstoneId) return;
    setSelectedTouchstoneId(initialTouchstoneId);
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
        onUpdateTouchstoneEdits={onUpdateTouchstoneEdits}
        onCommuneTouchstone={onCommuneTouchstone}
        onSynthesizeTouchstone={onSynthesizeTouchstone}
        onSaintInstance={onSaintInstance}
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
        {onMassTouchstoneCommunion && (confirmed.length + possible.length + rejected.length) > 0 && (
          <button onClick={onMassTouchstoneCommunion} disabled={processing} style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#c4b5fd",
            border: "1px solid #c4b5fd40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            {processing ? "Communing..." : `Commune (${confirmed.length + possible.length + rejected.length})`}
          </button>
        )}
      </div>

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
        const q = touchstoneFilter.trim().toLowerCase();
        const filterList = (list) => q ? list.filter((t) => t.name.toLowerCase().includes(q)) : list;
        const fConfirmed = filterList(confirmed);
        const fPossible = filterList(possible);
        const fRejected = filterList(rejected);

        return (
          <>
            {fConfirmed.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#51cf66", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Confirmed Touchstones ({fConfirmed.length})
                </h3>
                {fConfirmed.map((touchstone) => (
                  <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRemove={onRemoveTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onCommune={onCommuneTouchstone} onSynthesize={onSynthesizeTouchstone} processing={processing} />
                ))}
              </div>
            )}

            {fPossible.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#ffa94d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Possible Matches ({fPossible.length})
                </h3>
                {fPossible.map((touchstone) => (
                  <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRemove={onRemoveTouchstone} onConfirm={onConfirmTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onCommune={onCommuneTouchstone} onSynthesize={onSynthesizeTouchstone} processing={processing} />
                ))}
              </div>
            )}

            {fRejected.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                  Rejected ({fRejected.length})
                </h3>
                {fRejected.map((touchstone) => (
                  <TouchstoneCard key={touchstone.id} touchstone={touchstone} bits={bits} onClick={() => setSelectedTouchstoneId(touchstone.id)} onRestore={onRestoreTouchstone} onMerge={onMergeTouchstone ? (id) => { setSelectedTouchstoneId(id); setAutoOpenMerge(true); } : null} onCommune={onCommuneTouchstone} onSynthesize={onSynthesizeTouchstone} processing={processing} />
                ))}
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
                <span style={{ marginLeft: 8, fontSize: 10, color: "#666" }}>{bit.sourceFile}</span>
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
  const status = instance.communionStatus || (typeof instance.communionScore === 'number' ? (instance.communionScore >= 70 ? 'blessed' : 'damned') : null);
  if (!status) return null;
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

function TouchstoneCard({ touchstone, onClick, onRemove, onConfirm, onRestore, onMerge, onCommune, onSynthesize, processing, bits }) {
  const instances = touchstone.instances || [];
  const sourceCount = new Set(instances.map((i) => i.sourceFile)).size;
  const instanceCount = instances.length;
  const sameBitCount = instances.filter((i) => i.relationship === "same_bit").length;
  const evolvedCount = instances.filter((i) => i.relationship === "evolved").length;

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

  const saintedCount = instances.filter((i) => i.communionStatus === 'sainted').length;
  const blessedCount = instances.filter((i) => i.communionStatus === 'blessed').length;
  const damnedCount = instances.filter((i) => i.communionStatus === 'damned').length;
  const hasCommunionData = saintedCount + blessedCount + damnedCount > 0;

  const borderColor = isConfirmed ? "#51cf66" : isRejected ? "#444" : "#ffa94d";
  const matchColor = pctColor(avgPct);
  const cardBtn = (bg, border, color, extra) => ({
    background: bg, border: `1px solid ${border}`, color, borderRadius: 4,
    padding: "3px 8px", fontSize: 10, cursor: extra?.disabled ? "default" : "pointer",
    fontWeight: 600, opacity: extra?.disabled ? 0.4 : 1, ...extra,
  });

  const topReason = touchstone.matchInfo?.reasons?.[0];

  return (
    <div className="card" onClick={onClick} style={{ cursor: "pointer", borderLeft: `3px solid ${borderColor}`, opacity: isRejected ? 0.6 : 1, padding: "12px 14px" }}>
      <div style={{ display: "flex", gap: 14 }}>
        {/* Left column: content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{ fontWeight: 700, color: "#eee", fontSize: 14, lineHeight: 1.3, marginBottom: 4 }}>
            {touchstone.name}
            {touchstone.manualName && <span style={{ fontSize: 9, color: "#c4b5fd", marginLeft: 6, fontWeight: 400 }}>edited</span>}
          </div>

          {/* Summary — skip stale instance-count summaries from old data */}
          {touchstone.summary && !/^\d+ instances?\s/.test(touchstone.summary) && (
            <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4, marginBottom: 4 }}>
              {touchstone.summary}
            </div>
          )}

          {/* Why matched */}
          {topReason && (
            <div style={{ fontSize: 11, color: "#777", fontStyle: "italic", lineHeight: 1.4, marginBottom: 4 }}>
              {topReason}
            </div>
          )}

          {/* Ideal text preview */}
          {touchstone.idealText && (
            <div style={{ marginTop: 4, padding: "8px 10px", background: "#0a0a14", borderRadius: 5, border: "1px solid #1a1a2a", fontSize: 11, color: "#999", lineHeight: 1.5, maxHeight: 104, overflow: "hidden", position: "relative" }}>
              <span style={{ fontSize: 9, color: touchstone.manualIdealText ? "#c4b5fd" : "#74c0fc", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {touchstone.manualIdealText ? "Edited" : "Synth"}{" \u2014 "}
              </span>
              {touchstone.idealText.slice(0, 400)}{touchstone.idealText.length > 400 ? "..." : ""}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 20, background: "linear-gradient(transparent, #12121e)" }} />
            </div>
          )}

          {/* Communion badges */}
          {hasCommunionData && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
              {saintedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.sainted.bg} color={COMMUNION_STATUS_CONFIG.sainted.color}>{COMMUNION_STATUS_CONFIG.sainted.icon} {saintedCount} sainted</Badge>}
              {blessedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.blessed.bg} color={COMMUNION_STATUS_CONFIG.blessed.color}>{COMMUNION_STATUS_CONFIG.blessed.icon} {blessedCount} blessed</Badge>}
              {damnedCount > 0 && <Badge bg={COMMUNION_STATUS_CONFIG.damned.bg} color={COMMUNION_STATUS_CONFIG.damned.color}>{COMMUNION_STATUS_CONFIG.damned.icon} {damnedCount} damned</Badge>}
            </div>
          )}
        </div>

        {/* Right column: stats + actions */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 110 }}>
          <div style={{ background: matchColor, color: "#000", padding: "3px 10px", borderRadius: 5, fontWeight: 700, fontSize: 13 }}>
            {avgPct}%
          </div>
          {avgDuration && <div style={{ fontSize: 10, color: "#74c0fc" }}>{formatDuration(avgDuration)}</div>}
          <div style={{ fontSize: 10, color: "#666" }}>
            {sameBitCount > 0 && <span style={{ color: "#51cf66" }}>{sameBitCount} same</span>}
            {sameBitCount > 0 && evolvedCount > 0 && " \u00B7 "}
            {evolvedCount > 0 && <span style={{ color: "#ffa94d" }}>{evolvedCount} evolved</span>}
          </div>

          {/* Action buttons — 2x2 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 2, width: "100%" }}>
            {onConfirm && (
              <button onClick={(e) => { e.stopPropagation(); onConfirm(touchstone.id); }}
                style={cardBtn("#51cf6611", "#51cf6633", "#51cf66")}>Confirm</button>
            )}
            {onRestore && (
              <button onClick={(e) => { e.stopPropagation(); onRestore(touchstone.id); }}
                style={cardBtn("#4ecdc411", "#4ecdc433", "#4ecdc4")}>Restore</button>
            )}
            {onCommune && (
              <button onClick={(e) => { e.stopPropagation(); if (!processing) onCommune(touchstone.id); }}
                style={cardBtn("#c4b5fd11", "#c4b5fd33", "#c4b5fd", { disabled: processing })}>Commune</button>
            )}
            {onSynthesize && (
              <button onClick={(e) => { e.stopPropagation(); if (!processing && !touchstone.manualIdealText) onSynthesize(touchstone.id); }}
                style={cardBtn("#74c0fc11", "#74c0fc33", "#74c0fc", { disabled: processing || touchstone.manualIdealText })}
                title={touchstone.manualIdealText ? "Ideal text is manually edited" : ""}>
                {touchstone.idealText ? "Re-synth" : "Synth"}
              </button>
            )}
            {onMerge && (
              <button onClick={(e) => { e.stopPropagation(); onMerge(touchstone.id); }}
                style={cardBtn("#ffa94d11", "#ffa94d33", "#ffa94d")}>Merge</button>
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

function TouchstoneDetail({ touchstone, bits, allTouchstones, onSelectBit, onBack, onGenerateTitle, onRenameTouchstone, onRemoveInstance, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone, onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, mergeTargets, processing, autoOpenMerge, onConsumeAutoOpenMerge, onUpdateTouchstoneEdits, onCommuneTouchstone, onSynthesizeTouchstone, onSaintInstance }) {
  const [renamePending, setRenamePending] = useState(null);
  const [expandedInstances, setExpandedInstances] = useState(new Set(touchstone.instances.map((i) => i.bitId)));
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResult, setMergeResult] = useState(null); // {accepted, rejected}
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [newCorrFrom, setNewCorrFrom] = useState("");
  const [newCorrTo, setNewCorrTo] = useState("");
  const [newReason, setNewReason] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingIdealText, setEditingIdealText] = useState(false);
  const [idealTextDraft, setIdealTextDraft] = useState("");
  const isConfirmed = touchstone.category === "confirmed";
  const isPossible = touchstone.category === "possible";
  const instances = touchstone.instances || [];
  const avgPct = instances.length >= 2
    ? Math.round(instances.reduce((sum, i) => sum + (i.confidence || 0), 0) / instances.length * 100)
    : touchstone.matchInfo?.avgMatchPercentage || 0;

  const corrections = touchstone.corrections || [];
  const userReasons = touchstone.userReasons || [];
  const rejectedReasons = touchstone.rejectedReasons || [];

  // Apply word corrections to displayed text
  const applyCorrections = (text) => {
    if (!text || corrections.length === 0) return text;
    let result = text;
    for (const c of corrections) {
      result = result.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), c.to);
    }
    return result;
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
    const updatedUserReasons = [...userReasons, reason];
    const updatedReasons = [reason, ...(touchstone.matchInfo?.reasons || [])].slice(0, 5);
    onUpdateTouchstoneEdits?.(touchstone.id, { userReasons: updatedUserReasons, reasons: updatedReasons });
    setNewReason("");
  };

  const removeReason = (reason, idx) => {
    // If it's a user reason, remove from userReasons
    const isUser = userReasons.includes(reason);
    const updatedUserReasons = isUser ? userReasons.filter((r) => r !== reason) : userReasons;
    // Add to rejectedReasons so it won't come back on refresh
    const updatedRejected = isUser ? rejectedReasons : [...rejectedReasons, reason];
    const updatedReasons = (touchstone.matchInfo?.reasons || []).filter((_, i) => i !== idx);
    onUpdateTouchstoneEdits?.(touchstone.id, {
      userReasons: updatedUserReasons,
      rejectedReasons: updatedRejected,
      reasons: updatedReasons,
    });
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

  const handleAutoRename = async () => {
    const instanceBits = touchstone.instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return;
    const combinedText = instanceBits.map((b, idx) => `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${b.fullText}`).join("\n\n---\n\n");
    setRenamePending({ loading: true, suggested: null });
    try {
      const res = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.5:9b",
          messages: [
            { role: "system", content: "Name this recurring comedy bit based on these performances of the SAME joke. Use the format: '[3-5 word title] or, [5-8 word title]' — the first title is a punchy shorthand, the second is more descriptive. Include the literal text 'or,' between them. Focus on the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'DMV Nightmare or, The Witness Protection Line at the DMV'" },
            { role: "user", content: `${instanceBits.length} performances of the same bit:\n\n${combinedText}` },
          ],
          stream: false,
          think: false,
          options: { num_predict: 64, num_ctx: 4096 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();
      let title = (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
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

        {/* Action buttons — separated from title */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {onGenerateTitle && !renamePending && !editingTitle && (
            <button onClick={handleAutoRename} style={{ background: "none", border: "1px solid #333", color: "#c4b5fd", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {touchstone.manualName ? "AI Rename" : "Rename"}
            </button>
          )}
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
          {onMergeTouchstone && mergeTargets && mergeTargets.length > 0 && (
            <button onClick={() => { setMergeOpen(!mergeOpen); setMergeSearch(""); setMergeResult(null); }}
              style={{ background: mergeOpen ? "#c4b5fd22" : "none", border: "1px solid #ffa94d44", color: "#ffa94d", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {mergeOpen ? "Cancel merge" : "Merge into..."}
            </button>
          )}
          {onRemoveTouchstone && (
            <button onClick={() => onRemoveTouchstone(touchstone.id)}
              style={{ background: "#ff6b6b11", border: "1px solid #ff6b6b33", color: "#ff6b6b", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Reject
            </button>
          )}
        </div>

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
              {mergeTargets
                .filter((t) => t.id !== touchstone.id && (!mergeSearch.trim() || t.name.toLowerCase().includes(mergeSearch.toLowerCase())))
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

        {renamePending && !renamePending.loading && renamePending.suggested != null && (
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="text" value={renamePending.suggested} onChange={(e) => setRenamePending((p) => ({ ...p, suggested: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); else if (e.key === "Escape") setRenamePending(null); }} autoFocus style={{ flex: 1, padding: "6px 10px", background: "#0a0a14", border: "1px solid #c4b5fd44", borderRadius: 4, color: "#c4b5fd", fontSize: 14, fontFamily: "inherit" }} />
            <button onClick={confirmRename} style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>OK</button>
            <button onClick={() => setRenamePending(null)} style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
          </div>
        )}

        {touchstone.summary && !/^\d+ instances?\s/.test(touchstone.summary) && (
          <p style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>{touchstone.summary}</p>
        )}
      </div>

      {/* Ideal Text */}
      {(touchstone.idealText || onSynthesizeTouchstone) && (
        <div className="card" style={{ cursor: "default", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#74c0fc", textTransform: "uppercase", letterSpacing: 1 }}>
              Ideal Text
              {touchstone.manualIdealText && <span style={{ color: "#c4b5fd", marginLeft: 6, fontWeight: 400, textTransform: "none" }}>(manually edited)</span>}
              {touchstone.idealText && !touchstone.manualIdealText && <span style={{ color: "#666", marginLeft: 6, fontWeight: 400, textTransform: "none" }}>(synthesized)</span>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {touchstone.idealText && !editingIdealText && (
                <button
                  onClick={() => { setIdealTextDraft(touchstone.idealText); setEditingIdealText(true); }}
                  style={{ background: "none", border: "1px solid #333", color: "#c4b5fd", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}
                >
                  Edit
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
                style={{ width: "100%", minHeight: 200, padding: 12, background: "#0a0a14", borderRadius: 6, border: "1px solid #c4b5fd44", fontSize: 12, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => {
                    onUpdateTouchstoneEdits?.(touchstone.id, { idealText: idealTextDraft, manualIdealText: true, idealTextNotes: "Manually edited" });
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
                <div style={{ fontSize: 11, color: "#666", fontStyle: "italic", marginTop: 8, lineHeight: 1.5 }}>
                  {touchstone.idealTextNotes}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>No ideal text yet. Use Synthesize to generate one.</div>
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
            {(touchstone.matchInfo?.reasons || []).slice(0, 5).map((reason, idx) => {
              const isUser = userReasons.includes(reason);
              return (
                <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0" }}>
                  <div style={{ flex: 1, fontSize: 11, color: isUser ? "#ffa94d" : "#aaa", fontStyle: "italic", lineHeight: 1.5 }}>
                    {isUser && <span style={{ fontSize: 9, color: "#ffa94d", fontWeight: 600, marginRight: 4, fontStyle: "normal" }}>USER</span>}
                    {reason}
                  </div>
                  {onUpdateTouchstoneEdits && (
                    <button
                      onClick={() => removeReason(reason, idx)}
                      title={isUser ? "Remove your reason" : "Remove this reason (won't come back on refresh)"}
                      style={{ background: "none", border: "none", color: "#ff6b6b", fontSize: 12, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              );
            })}
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
            {/* Show rejected reasons so user can un-reject */}
            {rejectedReasons.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Rejected reasons (too broad/loose):</div>
                {rejectedReasons.map((reason, idx) => (
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

      {/* Instances */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Instances ({touchstone.instances.length})
        </div>

        {touchstone.instances.map((instance) => {
          const bit = bits.find((b) => b.id === instance.bitId);
          if (!bit) return null;
          const isExpanded = expandedInstances.has(instance.bitId);

          const relColor = { same_bit: "#51cf66", evolved: "#ffa94d", related: "#4ecdc4", callback: "#cc5de8", "tag-on": "#74c0fc" }[instance.relationship] || "#888";

          return (
            <div key={instance.bitId} className="card" style={{ marginBottom: 8, cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "#ddd", fontSize: 13, marginBottom: 4 }}>
                    #{instance.instanceNumber} — {applyCorrections(instance.title)}
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{instance.sourceFile}</div>
                  {bit.summary && <div style={{ fontSize: 11, color: "#777", lineHeight: 1.4, marginBottom: 4 }}>{applyCorrections(bit.summary)}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 8, alignItems: "flex-end" }}>
                  {/* Editable relationship */}
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
                  {instance.confidence > 0 && <span style={{ fontSize: 10, color: "#666" }}>{Math.round(instance.confidence * 100)}%</span>}
                  <CommunionStatusBadge instance={instance} />
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => toggleExpand(instance.bitId)} style={{ background: isExpanded ? "#252538" : "none", border: "1px solid #252538", color: isExpanded ? "#4ecdc4" : "#888", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>
                      {isExpanded ? "Hide" : "Text"}
                    </button>
                    {onGoToMix && (
                      <button onClick={() => onGoToMix(bit)} style={{ background: "none", border: "1px solid #252538", color: "#ffa94d", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>Mix</button>
                    )}
                    <button onClick={() => onSelectBit(bit)} style={{ background: "none", border: "1px solid #252538", color: "#888", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>Detail</button>
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
                    {onRemoveInstance && touchstone.instances.length > 1 && (
                      <button
                        onClick={() => { if (window.confirm(`Remove "${instance.title}" from this touchstone?`)) onRemoveInstance(touchstone.id, instance.bitId); }}
                        style={{ background: "#ff6b6b11", border: "1px solid #ff6b6b33", color: "#ff6b6b", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
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
