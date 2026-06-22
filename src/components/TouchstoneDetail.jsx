import { useState, useEffect } from "react";
import { callOllama } from "../utils/ollama";
import { TouchstonePicker } from "./TouchstonePicker";
import { TouchstoneIdealText } from "./TouchstoneIdealText";
import { KeywordBadge, StyledFilename, RELATIONSHIP_OPTIONS, COMMUNION_STATUS_CONFIG, pctColor } from "./touchstoneShared";
import { useTouchstoneLLM } from "../hooks/useTouchstoneLLM";

export 
function TouchstoneDetail({ touchstone, bits, allTouchstones, onSelectBit, onBack, onGenerateTitle, onRenameTouchstone, onRemoveInstance, onRemoveTouchstone, onConfirmTouchstone, onRestoreTouchstone, onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, mergeTargets, processing, autoOpenMerge, onConsumeAutoOpenMerge, autoOpenRelate, onConsumeAutoOpenRelate, onUpdateTouchstoneEdits, onCommuneTouchstone, onPruneTouchstone, onToggleCoreBit, onSynthesizeTouchstone, onSaintInstance, onRelateTouchstone, onUnrelateTouchstone, onNavigateToTouchstone, notes, onGoToNote, universalCorrections, selectedModel, onGenerateTags }) {
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
  const [keywordDraft, setKeywordDraft] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
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

  const {
    copyPromptOpen, setCopyPromptOpen,
    copyFeedback,
    pasteResponseType, setPasteResponseType,
    pasteText, setPasteText,
    sendingTo,
    llmResponse, setLlmResponse,
    sendPromptType, setSendPromptType,
    buildAndCopyPrompt,
    handlePasteSubmit,
    sendToProvider,
  } = useTouchstoneLLM({ touchstone, bits, instances, userReasons, rejectedReasons, notes, applyCorrections, onUpdateTouchstoneEdits });

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
      const systemPrompt = "Name this recurring comedy bit based on these performances of the SAME joke. Provide a descriptive 5-8 word title that captures the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'The Witness Protection Line at the DMV'";
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
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && titleDraft.trim()) {
                    onUpdateTouchstoneEdits?.(touchstone.id, { name: titleDraft.trim(), keyword: keywordDraft.trim(), manualName: true });
                    setEditingTitle(false);
                  } else if (e.key === "Escape") setEditingTitle(false);
                }}
                placeholder="keyword"
                style={{ width: 100, padding: "6px 10px", background: "#0a0a14", border: "1px solid #4ecdc444", borderRadius: 4, color: "#4ecdc4", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}
              />
              <span style={{ color: "#555" }}>—</span>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && titleDraft.trim()) {
                    onUpdateTouchstoneEdits?.(touchstone.id, { name: titleDraft.trim(), keyword: keywordDraft.trim(), manualName: true });
                    setEditingTitle(false);
                  } else if (e.key === "Escape") setEditingTitle(false);
                }}
                autoFocus
                placeholder="title"
                style={{ flex: 1, padding: "6px 10px", background: "#0a0a14", border: "1px solid #c4b5fd44", borderRadius: 4, color: "#eee", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
              />
              <button onClick={() => {
                if (titleDraft.trim()) {
                  onUpdateTouchstoneEdits?.(touchstone.id, { name: titleDraft.trim(), keyword: keywordDraft.trim(), manualName: true });
                  setEditingTitle(false);
                }
              }}
                style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Save</button>
              <button onClick={() => setEditingTitle(false)}
                style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
            </div>
          ) : (
            <h2
              onClick={() => {
                setKeywordDraft(touchstone.keyword || "");
                setTitleDraft(touchstone.name || "");
                setEditingTitle(true);
              }}
              title="Click to edit title"
              style={{ fontSize: 24, fontWeight: 700, color: "#eee", margin: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            >
              <KeywordBadge keyword={touchstone.keyword} />
              <span>{touchstone.name}</span>
              {touchstone.manualName && <span style={{ fontSize: 10, color: "#c4b5fd", marginLeft: 8, fontWeight: 400 }}>edited</span>}
            </h2>
          )}
          <span style={{ background: pctColor(avgPct), color: "#000", padding: "4px 10px", borderRadius: 6, fontWeight: 700, fontSize: 13 }}>{avgPct}%</span>
          <span style={{ fontSize: 11, color: touchstone.category === "confirmed" ? "#51cf66" : touchstone.category === "rejected" ? "#666" : "#ffa94d", fontWeight: 600, textTransform: "uppercase" }}>
            {touchstone.category === "confirmed" ? "Confirmed" : touchstone.category === "rejected" ? "Rejected" : "Possible"}
          </span>
          {renamePending?.loading && <span style={{ fontSize: 11, color: "#555" }}>generating...</span>}
        </div>

        {/* Tags */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {(touchstone.themeTags || []).map(tag => (
            <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#4ecdc412", color: "#4ecdc4", border: "1px solid #4ecdc420", fontWeight: 600 }}>
              {tag}
              <button onClick={() => {
                const newTags = (touchstone.themeTags || []).filter(t => t !== tag);
                onUpdateTouchstoneEdits?.(touchstone.id, { themeTags: newTags });
              }} style={{ background: "none", border: "none", color: "#4ecdc466", cursor: "pointer", padding: 0, fontSize: 10, lineHeight: 1 }}>x</button>
            </span>
          ))}
          <input
            type="text"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTagInput.trim()) {
                const tag = newTagInput.trim().toLowerCase();
                if (!(touchstone.themeTags || []).includes(tag)) {
                  onUpdateTouchstoneEdits?.(touchstone.id, { themeTags: [...(touchstone.themeTags || []), tag] });
                }
                setNewTagInput("");
              }
            }}
            placeholder="+ add tag"
            style={{ width: 80, padding: "2px 6px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#4ecdc4", fontSize: 10, fontFamily: "inherit" }}
          />
          {onGenerateTags && (
            <button onClick={() => onGenerateTags(touchstone.id)} disabled={processing}
              title="Auto-generate tags using Gemini Thinking"
              style={{ background: "none", border: "1px solid #4ecdc433", color: processing ? "#555" : "#4ecdc4", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: processing ? "default" : "pointer", fontWeight: 600 }}>
              AI Tag
            </button>
          )}
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
          <TouchstonePicker
            accentColor="#c4b5fd"
            header="Merge this touchstone's bits into an existing one. The LLM will verify each bit belongs."
            targets={mergeTargets.filter((t) => t.id !== touchstone.id)}
            search={mergeSearch}
            setSearch={setMergeSearch}
            disabled={processing}
            result={mergeResult}
            onSelect={async (target) => {
              if (!window.confirm(`Merge "${touchstone.name}" into "${target.name}"? The LLM will verify each bit.`)) return;
              setMergeOpen(false);
              try {
                const result = await onMergeTouchstone(touchstone.id, target.id);
                setMergeResult(result);
                if (result && (result.accepted > 0 || result.alreadyMerged)) onBack();
              } catch (err) {
                console.error("[MergePicker] Error:", err);
              }
            }}
          />
        )}

        {/* Relate picker */}
        {relateOpen && onRelateTouchstone && (
          <TouchstonePicker
            accentColor="#e599f7"
            header="Link a touchstone that often appears adjacent in setlists / performance flows."
            targets={allTouchstones.filter((t) => t.id !== touchstone.id && !(touchstone.relatedTouchstoneIds || []).includes(t.id) && t.category !== "rejected")}
            search={relateSearch}
            setSearch={setRelateSearch}
            onSelect={(target) => {
              onRelateTouchstone(touchstone.id, target.id);
              setRelateOpen(false);
            }}
          />
        )}

        {renamePending && !renamePending.loading && renamePending.suggested != null && (
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="text" value={renamePending.suggested} onChange={(e) => setRenamePending((p) => ({ ...p, suggested: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); else if (e.key === "Escape") setRenamePending(null); }} autoFocus style={{ flex: 1, padding: "6px 10px", background: "#0a0a14", border: "1px solid #c4b5fd44", borderRadius: 4, color: "#c4b5fd", fontSize: 14, fontFamily: "inherit" }} />
            <button onClick={confirmRename} style={{ background: "#51cf6622", border: "1px solid #51cf6644", color: "#51cf66", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>OK</button>
            <button onClick={() => setRenamePending(null)} style={{ background: "none", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
          </div>
        )}

      </div>

      <TouchstoneIdealText touchstone={touchstone} onUpdateTouchstoneEdits={onUpdateTouchstoneEdits} />

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
                    <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
                      <KeywordBadge keyword={rt.keyword} />
                      {rt.name}
                    </span>
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
                  <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600, flex: 1, wordBreak: "break-word" }}>
                    {note.title || "Untitled"}
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
                  <div style={{ fontSize: 11, color: "#999", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {note.text}
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
                      onUpdateInstanceRelationship?.(touchstone.id, instance.bitId, e.target.value);
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
