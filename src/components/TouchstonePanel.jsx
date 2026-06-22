import { useState, useMemo, useEffect, useRef } from "react";
import { useHashParam } from "../hooks/useHashParam";
import { searchTouchstones } from "../utils/touchstoneSearch";
import { onQueueChange, getQueueSnapshot, cancelPendingGenerations } from "../utils/ollama";
import { KeywordBadge, StyledFilename, RELATIONSHIP_OPTIONS, COMMUNION_STATUS_CONFIG, pctColor } from "./touchstoneShared";
import { TouchstoneDetail } from "./TouchstoneDetail";


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
  onRelateTouchstone, onUnrelateTouchstone, onAutoRelateAll, onRejectCoreless, onRedetect, onAbsorbUnmatched,
  onGenerateTags, onGenerateAllTags, onModernizeTitles,
  initialTouchstoneId, onConsumeInitialTouchstone, onGoToNote,
  universalCorrections,
  selectedModel,
}) {
  const [selectedTouchstoneId, setSelectedTouchstoneIdRaw] = useHashParam("tsid", "", { pushHistory: true });
  const savedScrollY = useRef(0);
  const prevTouchstoneId = useRef(selectedTouchstoneId);
  const setSelectedTouchstoneId = (id) => {
    if (id) {
      savedScrollY.current = window.scrollY;
      setSelectedTouchstoneIdRaw(id);
      window.scrollTo(0, 0);
    } else {
      setSelectedTouchstoneIdRaw("");
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY.current));
    }
  };

  // Restore scroll when navigating back via browser back button (popstate updates value directly)
  useEffect(() => {
    if (prevTouchstoneId.current && !selectedTouchstoneId) {
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY.current));
    }
    prevTouchstoneId.current = selectedTouchstoneId;
  }, [selectedTouchstoneId]);

  const [autoOpenMerge, setAutoOpenMerge] = useState(false);
  const [autoOpenRelate, setAutoOpenRelate] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState(null); // bit to seed new touchstone
  const [touchstoneFilter, setTouchstoneFilter] = useHashParam("tf", "");
  const [selectedTag, setSelectedTag] = useHashParam("tt", "");
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

  // Build tag cloud from confirmed + possible touchstones
  const tagCloud = useMemo(() => {
    const counts = new Map();
    for (const ts of [...confirmed, ...possible]) {
      for (const tag of (ts.themeTags || [])) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()].filter(([, count]) => count > 2).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }, [confirmed, possible]);

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
        {(bits || []).length > 0 && <CreateTouchstoneFromBit bits={bits} onCreateTouchstone={onCreateTouchstone} allTouchstones={allTouchstones} />}
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
        onGenerateTags={onGenerateTags}
      />
    );
  }

  return (
    <div>
      {/* Hunt / Rectify / Commune — single row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {onHunt && (
          <button onClick={onHunt} disabled={processing} title="Scan all bits across transcripts for matching jokes and group them into touchstones" style={{
            padding: "6px 14px", background: processing ? "#33333a" : "#4ecdc4", color: processing ? "#888" : "#000",
            border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: processing ? "default" : "pointer",
          }}>
            {processing && huntProgress && huntProgress.current < huntProgress.total
              ? `Hunting... ${huntProgress.current}/${huntProgress.total}`
              : "Hunt"}
          </button>
        )}
        {onRectifyOverlaps && possible.length > 0 && (
          <button onClick={onRectifyOverlaps} disabled={processing} title="Resolve overlapping touchstones — merge groups that share bits, keeping the strongest matches" style={{
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
          <button onClick={onMassPrune} disabled={processing} title="LLM-verify every instance in every touchstone — remove bits that don't actually match the group's joke" style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ff6b6b",
            border: "1px solid #ff6b6b40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Prune All
          </button>
        )}
        {onMassTouchstoneCommunion && (confirmed.length + possible.length + rejected.length) > 0 && (
          <button onClick={onMassTouchstoneCommunion} disabled={processing} title="LLM-score every instance against its touchstone's criteria — classify each as sainted, blessed, purgatory, or damned" style={{
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
          }} disabled={processing} title="Link touchstones that frequently appear adjacent in setlists — finds flow neighbors automatically" style={{
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
          }} disabled={processing} title="Reject all touchstones that have no core or sainted bits — these lack a verified anchor and may be unreliable" style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#ff6b6b",
            border: "1px solid #ff6b6b40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Reject Coreless
          </button>
        )}
        {onAbsorbUnmatched && (
          <button onClick={() => {
            const count = onAbsorbUnmatched();
            if (!count) alert("No unmatched bits to absorb — all strong matches already in touchstones.");
          }} disabled={processing} title="Absorb orphan bits into touchstones they strongly match (85%+ single match, or 90%+ to 2+ members of same touchstone)" style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#63e6be",
            border: "1px solid #63e6be40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Absorb
          </button>
        )}
        {onGenerateAllTags && (confirmed.length + possible.length) > 0 && (
          <button onClick={async () => {
            const count = await onGenerateAllTags();
            if (!count) alert("All touchstones already have tags.");
          }} disabled={processing} title="Auto-generate thematic tags for all untagged touchstones using Gemini Thinking" style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#4ecdc4",
            border: "1px solid #4ecdc440", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Auto Tag
          </button>
        )}
        {onRedetect && (
          <button onClick={onRedetect} disabled={processing} title="Re-run touchstone detection from scratch using current matches — rebuilds all possible groupings" style={{
            padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#74c0fc",
            border: "1px solid #74c0fc40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
          }}>
            Re-detect
          </button>
        )}
        {onModernizeTitles && (() => {
          const autoCount = [...confirmed, ...possible, ...rejected].filter(t => t.name && !t.manualName).length;
          if (autoCount === 0) return null;
          return (
            <button
              onClick={async () => {
                if (!confirm(`Modernize ${autoCount} auto-generated title${autoCount !== 1 ? "s" : ""} via gemini-flash? This will not affect manually-edited titles.`)) return;
                await onModernizeTitles();
              }}
              disabled={processing}
              title="One-time: rename every auto-generated title (skips manually-edited ones) via gemini-flash, using ideal text + why-matched reasons. New titles will not show as 'edited'."
              style={{
                padding: "6px 12px", background: processing ? "#33333a" : "#1e1e30", color: processing ? "#666" : "#c4b5fd",
                border: "1px solid #c4b5fd40", borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: processing ? "default" : "pointer",
              }}>
              Modernize Titles ({autoCount})
            </button>
          );
        })()}
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
        const tagFilter = (list) => selectedTag ? list.filter(ts => (ts.themeTags || []).includes(selectedTag)) : list;
        const filterList = (list) => {
          const tagged = tagFilter(list);
          return q ? searchTouchstones(tagged, q) : tagged;
        };
        const fConfirmed = filterList(confirmed);
        const fPossible = filterList(possible);
        const fRejected = q || selectedTag ? [] : rejected;

        // Compute total duration of displayed touchstones
        const displayedTs = [...fConfirmed, ...fPossible];
        const totalDurationSecs = displayedTs.reduce((sum, ts) => {
          if (ts.idealText) {
            return sum + (ts.idealText.trim().split(/\s+/).length / WORDS_PER_MINUTE) * 60;
          }
          const instanceBits = (ts.instances || []).map(i => (bits || []).find(b => b.id === i.bitId)).filter(Boolean);
          const durations = instanceBits.map(b => b.fullText ? (b.fullText.split(/\s+/).length / WORDS_PER_MINUTE) * 60 : 0).filter(d => d > 0);
          if (durations.length === 0) return sum;
          return sum + durations.reduce((a, b) => a + b, 0) / durations.length;
        }, 0);
        const isFiltered = q || !!selectedTag;

        return (
          <>
            {/* Stats bar with duration */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#888", padding: "10px 14px", background: "#0d0d16", borderRadius: 8, flex: 1, flexWrap: "wrap" }}>
                <span>{confirmed.length + possible.length} touchstone{confirmed.length + possible.length !== 1 ? "s" : ""}</span>
                <span style={{ color: "#51cf66" }}>{confirmed.length} confirmed</span>
                <span style={{ color: "#ffa94d" }}>{possible.length} possible</span>
                {rejected.length > 0 && <span style={{ color: "#666" }}>{rejected.length} rejected</span>}
                <span>{(bits || []).length} total bits</span>
                {totalDurationSecs > 0 && (
                  <span style={{ color: "#74c0fc", fontWeight: 600 }}>
                    {formatDuration(totalDurationSecs)}{isFiltered ? ` (${displayedTs.length} shown)` : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Tag cloud */}
            {tagCloud.length > 0 && (
              <div style={{ marginBottom: 16, padding: "8px 14px", background: "#0d0d16", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {tagCloud.map(({ tag, count }) => {
                      const active = selectedTag === tag;
                      return (
                        <button
                          key={tag}
                          onClick={() => setSelectedTag(active ? "" : tag)}
                          style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                            background: active ? "#4ecdc422" : "#1a1a2a",
                            color: active ? "#4ecdc4" : "#888",
                            border: `1px solid ${active ? "#4ecdc444" : "#252538"}`,
                          }}
                        >
                          {tag} <span style={{ color: active ? "#4ecdc488" : "#555", fontWeight: 400 }}>{count}</span>
                        </button>
                      );
                    })}
                    {selectedTag && (
                      <button
                        onClick={() => setSelectedTag("")}
                        style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", background: "none", color: "#ff6b6b", border: "1px solid #ff6b6b33" }}
                      >
                        clear
                      </button>
                    )}
                </div>
              </div>
            )}

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
function CreateTouchstoneFromBit({ bits, onSelect, onCreateTouchstone, allTouchstones }) {
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
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "#ddd" }}>{bit.title}</span>
                  <StyledFilename sourceFile={bit.sourceFile} />
                  {(allTouchstones || []).filter(t => t.bitIds?.includes(bit.id)).map(t => (
                    <span key={t.id} style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                      background: t.category === "confirmed" ? "#51cf6618" : t.category === "rejected" ? "#44444418" : "#ffa94d18",
                      color: t.category === "confirmed" ? "#51cf66" : t.category === "rejected" ? "#666" : "#ffa94d",
                    }}>
                      {t.keyword ? `${t.keyword} · ` : ""}{t.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

function TouchstoneCard({ touchstone, onClick, onRemove, onConfirm, onRestore, onMerge, onRelate, processing, bits, notes, allTouchstones }) {
  const instances = touchstone.instances || [];
  const sourceCount = new Set(instances.map((i) => { const b = bits.find(b => b.id === i.bitId); return b?.sourceFile || i.sourceFile; })).size;
  const instanceCount = instances.length;
  const sameBitCount = instances.filter((i) => i.relationship === "same_bit").length;
  const evolvedCount = instances.filter((i) => i.relationship === "evolved").length;
  const noteCount = (notes || []).filter(n => n.matchedTouchstoneId === touchstone.id).length;

  const avgDuration = useMemo(() => {
    // Prefer idealText (the synthesized "best version") for duration
    if (touchstone.idealText) {
      const words = touchstone.idealText.trim().split(/\s+/).length;
      return (words / WORDS_PER_MINUTE) * 60;
    }
    // Fall back to average across instance fullTexts
    if (!bits || instances.length === 0) return null;
    const durations = instances.map((inst) => {
      const bit = bits.find((b) => b.id === inst.bitId);
      if (!bit?.fullText) return 0;
      return (bit.fullText.split(/\s+/).length / WORDS_PER_MINUTE) * 60;
    }).filter((d) => d > 0);
    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [touchstone.idealText, instances, bits]);

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
          <div style={{ fontWeight: 700, color: "#eee", fontSize: 14, lineHeight: 1.3, marginBottom: 4, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
            <KeywordBadge keyword={touchstone.keyword} />
            <span>{touchstone.name}</span>
            {touchstone.manualName && <span style={{ fontSize: 9, color: "#c4b5fd", marginLeft: 6, fontWeight: 400 }}>edited</span>}
            {!isRejected && !hasCore && !hasSainted && <span title="No core bit — may drift" style={{ fontSize: 9, color: "#ff6b6b", marginLeft: 6, fontWeight: 600 }}>no core</span>}
          </div>
          {/* Tags */}
          {(touchstone.themeTags || []).length > 0 && (
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4 }}>
              {touchstone.themeTags.map(tag => (
                <span key={tag} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#4ecdc412", color: "#4ecdc4", border: "1px solid #4ecdc420", fontWeight: 600 }}>{tag}</span>
              ))}
            </div>
          )}

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
