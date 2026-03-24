import { useCallback } from "react";
import { callOllama } from "../utils/ollama";
import { SYSTEM_PARSE_V2 } from "../utils/prompts";
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
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones });
    } catch (err) { console.error("Error saving split bits:", err); }

    const model = stateRef.current.selectedModel;
    for (const bit of bitsWithIds) {
      if (!bit.fullText?.trim()) continue;
      callOllama(SYSTEM_PARSE_V2, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, model, stateRef.current.debugMode ? addDebugEntry : null)
        .then((result) => {
          const parsed = Array.isArray(result) ? result[0] : result;
          if (!parsed) return;
          const updated = {
            ...bit,
            title: parsed.title || bit.title,
            summary: parsed.summary || bit.summary,
            tags: (parsed.tags && parsed.tags.length > 0) ? parsed.tags : bit.tags,
            keywords: (parsed.keywords && parsed.keywords.length > 0) ? parsed.keywords : bit.keywords,
            editHistory: [...(bit.editHistory || []), { timestamp: Date.now(), action: "split_baptize", details: { from: bit.title, to: parsed.title } }],
          };
          update('topics', (prev) => prev.map((t) => t.id === bit.id ? updated : t));
          const s2 = stateRef.current;
          saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }).catch(console.error);
        }).catch((err) => console.warn("[Split baptize] Failed:", err.message));
    }

    for (const bit of bitsWithIds) {
      if (!bit.fullText?.trim()) continue;
      const crossTranscript = updatedTopics.filter((b) => b.sourceFile !== bit.sourceFile && b.id !== bit.id);
      if (crossTranscript.length === 0) continue;
      matchBitLiveRef.current?.(bit, crossTranscript).catch((err) => { if (err.name !== "AbortError") console.error("[Split rematch] Error:", err); });
    }
  }, []);

  const handleJoinBits = useCallback(async (bitsToJoin, joinedBit) => {
    const s = stateRef.current;
    const { updatedTopics, updatedMatches, updatedTouchstones, completeBit } = prepareJoinUpdate(bitsToJoin, joinedBit, s.topics, s.matches, s.touchstones, s.selectedModel);

    for (const b of bitsToJoin) embeddingStore.invalidate(b.id);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, touchstones: updatedTouchstones, editingMode: null, selectedTopic: null } });

    try {
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: s.transcripts, touchstones: updatedTouchstones });
    } catch (err) { console.error("Error saving joined bits:", err); }

    if (completeBit.fullText?.trim()) {
      const crossTranscript = updatedTopics.filter((b) => b.sourceFile !== completeBit.sourceFile && b.id !== completeBit.id);
      if (crossTranscript.length > 0) {
        matchBitLiveRef.current?.(completeBit, crossTranscript).catch((err) => { if (err.name !== "AbortError") console.error("[Join rematch] Error:", err); });
      }
    }
  }, []);

  const handleBoundaryChange = useCallback(async (bitId, newPosition) => {
    const s = stateRef.current;
    const { updatedTopics } = applyBoundaryChange(bitId, newPosition, s.topics, s.transcripts);
    embeddingStore.invalidate(bitId);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics, adjustingBit: null } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving boundary change:", err); }
    debouncedRevalidate([bitId]);
  }, [debouncedRevalidate]);

  const handleTakeOverlap = useCallback(async (takerId, conflictingUpdates) => {
    const s = stateRef.current;
    const { updatedTopics, shrunkIds } = applyTakeOverlap(takerId, conflictingUpdates, s.topics, s.transcripts);
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving take overlap:", err); }
    debouncedRevalidate(shrunkIds);
  }, [debouncedRevalidate]);

  const handleScrollBoundary = useCallback(async (bitId, nextBitId, direction) => {
    const s = stateRef.current;
    const result = applyScrollBoundary(bitId, nextBitId, direction, s.topics, s.transcripts);
    if (!result) return;
    const { updatedTopics, changedBitIds } = result;
    dispatch({ type: 'MERGE', payload: { topics: updatedTopics } });
    try {
      await saveVaultState({ topics: updatedTopics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones });
    } catch (err) { console.error("Error saving boundary scroll:", err); }
    debouncedRevalidate(changedBitIds);
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

    set('status', `Baptizing "${bit.title}"...`);
    try {
      const result = await callOllama(SYSTEM_PARSE_V2, `Parse this comedy transcript excerpt:\n\n${bit.fullText}`, () => {}, s.selectedModel, s.debugMode ? addDebugEntry : null);
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
        matchBitLiveRef.current?.(updatedBit, stateRef.current.topics.map((t) => t.id === bitId ? updatedBit : t));
        const s2 = stateRef.current;
        await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones });
        set('status', `Baptized "${updatedBit.title}"`);
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
