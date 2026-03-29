import { useCallback } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_PARSE_V3 } from "../utils/prompts";
import { saveVaultState } from "../utils/database";
import { prepareSplitUpdate, prepareJoinUpdate, applyBoundaryChange, applyTakeOverlap, applyScrollBoundary } from "../utils/bitOperations";

export function useBitOperations(ctx, matchBitLiveRef, debouncedRevalidate) {
  const { dispatch, stateRef, addDebugEntry, embeddingStore } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const handleSplitBit = useCallback(async (bitId, newBits) => {
    const s = stateRef.current;
    const { updatedTopics, updatedMatches, updatedTouchstones, bitsWithIds } = prepareSplitUpdate(bitId, newBits, s.topics, s.matches, s.touchstones);

    embeddingStore.invalidate(bitId);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null, lastSplitJoinTime: Date.now() } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones });
    } catch (err) { console.error("Error saving split bits:", err); }

    // Delay baptism 60s to allow user adjustments (deleting unwanted split bits, etc.)
    const bitIds = bitsWithIds.map(b => b.id);
    set('status', `Split into ${bitsWithIds.length} bits — will baptize in 60s (delete unwanted bits first)`);
    await new Promise(resolve => setTimeout(resolve, 60000));

    // Baptize each split bit that still exists, then match with fresh metadata
    const model = stateRef.current.selectedModel;
    const survivingBits = bitsWithIds.filter(b => stateRef.current.topics.some(t => t.id === b.id));
    if (survivingBits.length === 0) { set('status', 'Split bits were all removed — skipping baptism'); return; }
    set('status', `Baptizing ${survivingBits.length} split bit(s)...`);

    for (const bit of survivingBits) {
      if (!bit.fullText?.trim()) continue;
      // Re-check existence (user may delete during loop)
      if (!stateRef.current.topics.some(t => t.id === bit.id)) continue;
      set('status', `Baptizing split bit "${bit.title}"...`);
      try {
        const result = await callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const parsed = Array.isArray(result) ? result[0] : result;
        if (parsed) {
          const updated = {
            ...bit,
            title: parsed.title || bit.title,
            summary: parsed.summary || bit.summary,
            tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : [],
            keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : [],
            parsedWithModel: model,
            editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "split_baptize", details: { from: bit.title, to: parsed.title } }],
          };
          Object.assign(bit, updated); // update in-place for matching below
          update('topics', (prev) => prev.map((t) => t.id === bit.id ? updated : t));
        }
      } catch (err) { console.warn("[Split baptize] Failed:", err.message); }
    }
    const s2 = stateRef.current;
    await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);

    for (const bit of survivingBits) {
      if (!bit.fullText?.trim()) continue;
      if (!stateRef.current.topics.some(t => t.id === bit.id)) continue;
      set('status', `Matching split bit "${bit.title}"...`);
      const currentTopics = stateRef.current.topics;
      await matchBitLiveRef.current?.(bit, currentTopics).catch((err) => { if (err.name !== "AbortError") console.error("[Split rematch] Error:", err); });
    }
    set('status', `Split complete — ${survivingBits.length} bit(s) baptized and matched`);
  }, []);

  const handleJoinBits = useCallback(async (bitsToJoin, joinedBit) => {
    const s = stateRef.current;
    const { updatedTopics, updatedMatches, updatedTouchstones, completeBit } = prepareJoinUpdate(bitsToJoin, joinedBit, s.topics, s.matches, s.touchstones, s.selectedModel);

    for (const b of bitsToJoin) embeddingStore.invalidate(b.id);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null, lastSplitJoinTime: Date.now() } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones });
    } catch (err) { console.error("Error saving joined bits:", err); }

    if (completeBit.fullText?.trim()) {
      // Baptize joined bit before matching so metadata is fresh
      set('status', `Baptizing joined bit "${completeBit.title}"...`);
      try {
        const model = stateRef.current.selectedModel;
        const result = await callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${completeBit.fullText}`, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null);
        const parsed = Array.isArray(result) ? result[0] : result;
        if (parsed) {
          const updated = {
            ...completeBit,
            title: parsed.title || completeBit.title,
            summary: parsed.summary || completeBit.summary,
            tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : [],
            keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : [],
            parsedWithModel: model,
            editHistory: [...(completeBit.editHistory || []), { timestamp: Date.now(), action: "join_baptize", details: { from: completeBit.title, to: parsed.title } }],
          };
          Object.assign(completeBit, updated);
          update('topics', (prev) => prev.map((t) => t.id === completeBit.id ? updated : t));
          const s2 = stateRef.current;
          await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
        }
      } catch (err) { console.warn("[Join baptize] Failed:", err.message); }

      set('status', `Matching joined bit "${completeBit.title}"...`);
      const currentTopics = stateRef.current.topics;
      await matchBitLiveRef.current?.(completeBit, currentTopics).catch((err) => { if (err.name !== "AbortError") console.error("[Join rematch] Error:", err); });
      set('status', `Join complete — bit baptized and matched`);
    }
  }, []);

  const handleBoundaryChange = useCallback(async (bitId, newPosition) => {
    const s = stateRef.current;
    const { updatedTopics } = applyBoundaryChange(bitId, newPosition, s.topics, s.transcripts);
    // Clear stale tags/keywords — text changed, old metadata no longer valid
    const clearedTopics = updatedTopics.map((t) => t.id === bitId ? { ...t, tags: [], keywords: [] } : t);
    embeddingStore.invalidate(bitId);
    dispatch({ type: 'MERGE', payload: { topics: clearedTopics, adjustingBit: null } });
    try {
      await saveVaultState({ topics: clearedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving boundary change:", err); }
    debouncedRevalidate([bitId]);
    // Re-parse to regenerate tags/keywords for the changed bit
    const changedBit = clearedTopics.find((t) => t.id === bitId);
    if (changedBit?.fullText?.trim()) {
      callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${changedBit.fullText}`, () => {}, stateRef.current.selectedModel, stateRef.current.debugMode ? addDebugEntry : null)
        .then((result) => {
          const parsed = Array.isArray(result) ? result[0] : result;
          if (!parsed) return;
          update('topics', (prev) => prev.map((t) => t.id === bitId ? { ...t, tags: parsed.tags || [], keywords: parsed.keywords || [] } : t));
          const s2 = stateRef.current;
          saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
        }).catch((err) => console.warn("[Boundary re-parse] Failed:", err.message));
    }
  }, [debouncedRevalidate]);

  const handleTakeOverlap = useCallback(async (takerId, conflictingUpdates) => {
    const s = stateRef.current;
    const { updatedTopics, shrunkIds } = applyTakeOverlap(takerId, conflictingUpdates, s.topics, s.transcripts);
    // Clear stale tags/keywords on all affected bits
    const affectedIds = new Set([takerId, ...shrunkIds]);
    const clearedTopics = updatedTopics.map((t) => affectedIds.has(t.id) ? { ...t, tags: [], keywords: [] } : t);
    dispatch({ type: 'MERGE', payload: { topics: clearedTopics } });
    try {
      await saveVaultState({ topics: clearedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving take overlap:", err); }
    debouncedRevalidate(shrunkIds);
    // Re-parse affected bits to regenerate tags/keywords
    for (const id of affectedIds) {
      const bit = clearedTopics.find((t) => t.id === id);
      if (!bit?.fullText?.trim()) continue;
      callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, stateRef.current.selectedModel, stateRef.current.debugMode ? addDebugEntry : null)
        .then((result) => {
          const parsed = Array.isArray(result) ? result[0] : result;
          if (!parsed) return;
          update('topics', (prev) => prev.map((t) => t.id === id ? { ...t, tags: parsed.tags || [], keywords: parsed.keywords || [] } : t));
          const s2 = stateRef.current;
          saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
        }).catch((err) => console.warn("[Overlap re-parse] Failed:", err.message));
    }
  }, [debouncedRevalidate]);

  const handleScrollBoundary = useCallback(async (bitId, nextBitId, direction) => {
    const s = stateRef.current;
    const result = applyScrollBoundary(bitId, nextBitId, direction, s.topics, s.transcripts);
    if (!result) return;
    const { updatedTopics, changedBitIds } = result;
    // Clear stale tags/keywords on all changed bits
    const changedSet = new Set(changedBitIds);
    const clearedTopics = updatedTopics.map((t) => changedSet.has(t.id) ? { ...t, tags: [], keywords: [] } : t);
    dispatch({ type: 'MERGE', payload: { topics: clearedTopics } });
    try {
      await saveVaultState({ topics: clearedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving boundary scroll:", err); }
    debouncedRevalidate(changedBitIds);
    // Re-parse changed bits to regenerate tags/keywords
    for (const id of changedBitIds) {
      const bit = clearedTopics.find((t) => t.id === id);
      if (!bit?.fullText?.trim()) continue;
      callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, stateRef.current.selectedModel, stateRef.current.debugMode ? addDebugEntry : null)
        .then((result) => {
          const parsed = Array.isArray(result) ? result[0] : result;
          if (!parsed) return;
          update('topics', (prev) => prev.map((t) => t.id === id ? { ...t, tags: parsed.tags || [], keywords: parsed.keywords || [] } : t));
          const s2 = stateRef.current;
          saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
        }).catch((err) => console.warn("[Scroll re-parse] Failed:", err.message));
    }
  }, [debouncedRevalidate]);

  const handleGenerateTitle = useCallback(async (fullText) => {
    const model = stateRef.current.selectedModel;
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a comedy writing assistant for a comedian named Kai (she/her). Given a comedy bit transcript (which may include multiple versions of the same joke from different performances), generate a short, punchy title (3-6 words max). Focus on the TOPIC or PUNCHLINE rather than the setup — what is the joke fundamentally about? What makes it land? Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping." },
          { role: "user", content: fullText },
        ],
        stream: false,
        think: false,
        options: { num_predict: 64, num_ctx: 4096 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();
    return (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  }, []);

  const handleConfirmRename = useCallback(async (bitId, newTitle) => {
    const s = stateRef.current;
    const updatedTopics = s.topics.map((t) =>
      t.id === bitId
        ? { ...t, title: newTitle, editHistory: [...(t.editHistory || []), { timestamp: Date.now(), action: "autorename", details: { from: t.title, to: newTitle } }] }
        : t
    );
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
    await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
  }, []);

  const handleBaptizeBit = useCallback(async (bitId) => {
    const s = stateRef.current;
    const bit = s.topics.find((t) => t.id === bitId);
    if (!bit || !bit.fullText?.trim()) return;

    set('status', `Baptizing "${bit.title}" — parsing...`);
    try {
      const result = await callOllama(SYSTEM_PARSE_V3, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, s.selectedModel, s.debugMode ? addDebugEntry : null);
      const parsed = Array.isArray(result) ? result[0] : result;
      if (parsed) {
        const updatedBit = {
          ...bit,
          title: parsed.title || bit.title,
          summary: parsed.summary || bit.summary,
          tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : bit.tags,
          keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : bit.keywords,
          editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "baptize", details: { from: bit.title, to: parsed.title } }],
        };
        update('topics', (prev) => prev.map((t) => t.id === bitId ? updatedBit : t));
        set('selectedTopic', updatedBit);
        set('status', `Baptizing "${updatedBit.title}" — finding matches...`);
        const updatedTopics = stateRef.current.topics.map((t) => t.id === bitId ? updatedBit : t);
        const crossTranscript = updatedTopics.filter((b) => b.sourceFile !== updatedBit.sourceFile);
        set('status', `Baptizing "${updatedBit.title}" — matching against ${crossTranscript.length} cross-transcript bits...`);
        await matchBitLiveRef.current?.(updatedBit, updatedTopics);
        const s2 = stateRef.current;
        const newMatches = s2.matches.filter((m) => m.sourceId === bitId || m.targetId === bitId);
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones });
        set('status', `Baptized "${updatedBit.title}" — ${newMatches.length} match(es) found`);
      }
    } catch (err) {
      set('status', `Baptize failed: ${err.message}`);
    }
  }, []);

  const handleReparseTags = useCallback(async (bitId) => {
    const s = stateRef.current;
    const bit = s.topics.find((t) => t.id === bitId);
    if (!bit || !bit.fullText?.trim()) return;

    set('status', `Reparsing tags for "${bit.title}"...`);
    try {
      const prompt = `Categorize this comedy bit with 3-8 concise tags. Tags should describe: comedy style (observational, self-deprecating, dark, etc.), topic (dating, work, family, etc.), and technique (act-out, callback, crowd-work, etc.). Return ONLY a JSON object: {"tags": ["tag1", "tag2", ...]}\n\nTitle: ${bit.title}\n\n${bit.fullText}`;
      const result = await callOllama("You are a comedy tagging assistant. Return valid JSON only.", prompt, () => {}, s.selectedModel, s.debugMode ? addDebugEntry : null);
      const parsed = Array.isArray(result) ? result[0] : result;
      const newTags = (parsed?.tags || []).map((t) => String(t).replace(/\s+/g, "-").toLowerCase()).filter(Boolean);
      if (newTags.length > 0) {
        const updatedBit = {
          ...bit,
          tags: newTags,
          editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "reparse-tags", details: { from: bit.tags, to: newTags } }],
        };
        update('topics', (prev) => prev.map((t) => t.id === bitId ? updatedBit : t));
        set('selectedTopic', updatedBit);
        const s2 = stateRef.current;
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones });
        set('status', `Reparsed tags: ${newTags.length} tags (was ${bit.tags?.length || 0})`);
      } else {
        set('status', 'Tag reparse returned no tags');
      }
    } catch (err) {
      set('status', `Tag reparse failed: ${err.message}`);
    }
  }, []);

  return {
    handleSplitBit, handleJoinBits, handleBoundaryChange,
    handleTakeOverlap, handleScrollBoundary,
    handleGenerateTitle, handleConfirmRename, handleBaptizeBit, handleReparseTags,
  };
}
