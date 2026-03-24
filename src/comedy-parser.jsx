import { useReducer, useRef, useCallback, useEffect, useState } from "react";
import { uid, getAvailableModels, callOllama } from "./utils/ollama";
import { SYSTEM_MERGE_TAGS } from "./utils/prompts";
import { validateAllBits } from "./utils/textContinuityValidator";
import { TouchstonePanel } from "./components/TouchstonePanel";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { getDB, saveVaultState, loadVaultState, getDatabaseStats } from "./utils/database";
import { EmbeddingStore, setEmbedPaused, isEmbedPaused } from "./utils/embeddings";
import { OpQueue } from "./utils/opQueue";
import { NetworkGraph } from "./components/NetworkGraph";
import { DebugPanel } from "./components/DebugPanel";
import { StreamingProgressPanel } from "./components/StreamingProgressPanel";
import { PlayTab } from "./components/PlayTab";
import { DatabaseTab } from "./components/DatabaseTab";

import { TranscriptTab } from "./components/TranscriptTab";
import { ExportTab } from "./components/ExportTab";
import { ValidationTab } from "./components/ValidationTab";
import { DetailPanel } from "./components/DetailPanel";

import { useHashRouter } from "./hooks/useHashRouter";
import { useTouchstoneDetection } from "./hooks/useTouchstoneDetection";
import { useMatchRevalidation } from "./hooks/useMatchRevalidation";
import { useHunting } from "./hooks/useHunting";
import { useBitOperations } from "./hooks/useBitOperations";
import { useBitManagement } from "./hooks/useBitManagement";
import { useCommunion } from "./hooks/useCommunion";
import { useParsing } from "./hooks/useParsing";
import { useTranscriptOps } from "./hooks/useTranscriptOps";
import { useTouchstoneHandlers } from "./hooks/useTouchstoneHandlers";
import { useNotes } from "./hooks/useNotes";
import NotesTab from "./components/NotesTab";
import LLMConfigPanel from "./components/LLMConfigPanel";


function ClearFiltersButton({ activeTab }) {
  const [hasFilters, setHasFilters] = useState(() => window.location.hash.includes("?"));
  useEffect(() => {
    const check = () => setHasFilters(window.location.hash.includes("?"));
    window.addEventListener("hashchange", check);
    window.addEventListener("popstate", check);
    // Poll briefly since replaceState doesn't fire events
    const id = setInterval(check, 500);
    return () => { window.removeEventListener("hashchange", check); window.removeEventListener("popstate", check); clearInterval(id); };
  }, []);
  return (
    <button
      onClick={() => {
        history.replaceState(null, "", `#/${activeTab || "play"}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
        setHasFilters(false);
      }}
      title="Clear all URL filters and reset to current tab"
      style={{
        padding: "5px 10px",
        background: hasFilters ? "#1a2a1b" : "#1a1a2a",
        border: `1px solid ${hasFilters ? "#6bff7f44" : "#2a2a40"}`,
        color: hasFilters ? "#7fff6b" : "#444",
        borderRadius: "6px",
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      ↺
    </button>
  );
}

const initialState = {
  transcripts: [],
  topics: [],
  matches: [],
  status: "",
  processing: false,
  activeTab: "play",
  selectedTopic: null,
  streamingProgress: null,
  foundBits: [],
  selectedTranscript: null,
  adjustingBit: null,
  validationResult: null,
  editingMode: null,
  touchstones: { confirmed: [], possible: [] },
  dbStats: null,
  lastSave: null,
  selectedModel: "qwen3.5:9b",
  availableModels: [],
  shouldStop: false,
  debugMode: false,
  debugLog: [],
  huntProgress: null,
  embeddingModel: "mxbai-embed-large",
  embeddingStatus: { cached: 0, total: 0 },
  notes: [],
  vaultReady: false,
  transcriptSortCol: "file",
  transcriptSortDir: "asc",
  tagMergeResult: null,
};


function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'UPDATE':
      return { ...state, [action.field]: action.fn(state[action.field]) };
    case 'MERGE':
      return { ...state, ...action.payload };
    case 'CLEAR_ALL':
      return {
        ...initialState,
        availableModels: state.availableModels,
        selectedModel: state.selectedModel,
        embeddingModel: state.embeddingModel,
      };
    default:
      return state;
  }
}

function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        position: "fixed", bottom: 80, right: 24, zIndex: 9998,
        width: 36, height: 36, borderRadius: "50%",
        background: "#1a1a2e", border: "1px solid #2a2a40",
        color: "#aaa", fontSize: 16, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        transition: "opacity 0.2s",
      }}
      title="Scroll to top"
    >
      ↑
    </button>
  );
}

export default function ComedyParser() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const opQueue = useRef(new OpQueue()).current;

  const {
    transcripts, topics, matches, status, processing,
    activeTab, selectedTopic, streamingProgress,
    foundBits, selectedTranscript, adjustingBit, validationResult,
    editingMode, touchstones, dbStats, lastSave,
    selectedModel, availableModels, shouldStop, debugMode,
    debugLog, huntProgress, embeddingModel, embeddingStatus, notes, vaultReady,
    tagMergeResult,
  } = state;

  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  // Router-aware setters — update state AND push browser history
  // (useHashRouter must be called before any useState that depends on it, and
  //  setTouchstoneInit is defined below — we hoist the declaration here via useRef workaround)
  const touchstoneInitSetter = useRef(null);
  const hashRouter = useHashRouter(dispatch, stateRef, vaultReady, (v) => touchstoneInitSetter.current?.(v));
  const { setActiveTab, setSelectedTopic, setSelectedTranscript } = hashRouter;
  const setAdjustingBit = useCallback((v) => dispatch({ type: 'SET', field: 'adjustingBit', value: v }), []);
  const setEditingMode = useCallback((v) => dispatch({ type: 'SET', field: 'editingMode', value: v }), []);
  const setShouldStop = useCallback((v) => dispatch({ type: 'SET', field: 'shouldStop', value: v }), []);

  const restoreFileInput = useRef(null);
  const abortControllerRef = useRef(null);
  const huntControllerRef = useRef(null);
  const matchBitLiveRef = useRef(null);
  const embeddingStore = useRef(new EmbeddingStore()).current;
  const miniPlayerRef = useRef(null);

  const [mixTranscriptInit, setMixTranscriptInit] = useState(null);
  const [mixBitInit, setMixBitInit] = useState(null);
  const [mixGapInit, setMixGapInit] = useState(null);
  const [touchstoneInit, setTouchstoneInit] = useState(null);
  touchstoneInitSetter.current = setTouchstoneInit;
  const [noteNav, setNoteNav] = useState(null); // {source, tag} for cross-tab note navigation
  const [playInitFile, setPlayInitFile] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);
  const [validationFilter, setValidationFilter] = useState("all");
  const [approvedGaps, setApprovedGaps] = useState(() => {
    try { return JSON.parse(localStorage.getItem("topix-approved-gaps") || "[]"); } catch { return []; }
  });

  const handleApproveGap = useCallback((gapKey) => {
    setApprovedGaps((prev) => {
      const next = prev.includes(gapKey) ? prev.filter(k => k !== gapKey) : [...prev, gapKey];
      try { localStorage.setItem("topix-approved-gaps", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const addDebugEntry = useCallback((entry) => {
    update('debugLog', (prev) => [...prev.slice(-19), { ...entry, id: uid(), timestamp: Date.now() }]);
  }, []);

  // Warn before closing tab
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Load saved data from database
  const loadSavedData = useCallback(async () => {
    try {
      const saved = await loadVaultState();
      if (saved.topics && saved.topics.length > 0) {
        let transcripts = saved.transcripts || [];
        let topics = saved.topics;
        const seenNames = new Map();
        const dupeIds = new Set();
        for (const tr of transcripts) {
          const prev = seenNames.get(tr.name);
          if (prev) {
            if (tr.playHash && !prev.playHash) {
              dupeIds.add(prev.id);
              seenNames.set(tr.name, tr);
            } else {
              dupeIds.add(tr.id);
            }
          } else {
            seenNames.set(tr.name, tr);
          }
        }
        if (dupeIds.size > 0) {
          console.log(`[Load] Removing ${dupeIds.size} duplicate transcripts`);
          const keptByName = new Map([...seenNames].map(([name, tr]) => [name, tr]));
          topics = topics.map((t) => {
            if (dupeIds.has(t.transcriptId)) {
              const kept = keptByName.get(t.sourceFile);
              return kept ? { ...t, transcriptId: kept.id } : t;
            }
            return t;
          });
          transcripts = transcripts.filter((t) => !dupeIds.has(t.id));
        }

        dispatch({ type: 'MERGE', payload: {
          topics,
          transcripts,
          matches: saved.matches || [],
          touchstones: saved.touchstones || { confirmed: [], possible: [] },
          notes: saved.notes || [],
        }});
      }
      set('vaultReady', true);
    } catch (err) {
      console.error("Error loading saved data:", err);
      set('vaultReady', true);
    }
  }, []);

  // Initialize database and load models on mount
  useEffect(() => {
    getDB().catch((err) => console.error("DB init error:", err));
    loadSavedData();

    getAvailableModels().then((models) => {
      set('availableModels', models);
      if (models.length > 0 && !models.includes("qwen3.5:9b")) {
        set('selectedModel', models[0]);
      }
    }).catch((err) => console.error("Error loading models:", err));

    embeddingStore.loadFromDB().then(() => {
      set('embeddingStatus', { cached: embeddingStore.size, total: 0 });
    }).catch((err) => console.warn("Embedding load error:", err));

    try {
      const interrupted = sessionStorage.getItem("topix-parsing");
      if (interrupted) {
        const info = JSON.parse(interrupted);
        sessionStorage.removeItem("topix-parsing");
        set('status', `⚠️ Parsing "${info.transcript}" was interrupted. Found bits were saved. You can re-parse to continue.`);
      }
    } catch {}
  }, []);

  // Auto-save vault state
  useEffect(() => {
    const timer = setTimeout(() => {
      saveVaultState({ topics, matches, transcripts, touchstones })
        .then(() => {
          set('lastSave', new Date());
          getDatabaseStats().then(stats => set('dbStats', stats)).catch(console.error);
        })
        .catch((err) => console.error("Auto-save error:", err));
    }, 5000);
    return () => clearTimeout(timer);
  }, [topics, matches, transcripts, touchstones]);

  // Pause background embedding queue while model operations are running
  useEffect(() => {
    setEmbedPaused(processing);
  }, [processing]);

  // Run validation whenever topics change
  useEffect(() => {
    if (topics.length > 0) {
      const result = validateAllBits(topics, transcripts);
      set('validationResult', result);
    }
  }, [topics, transcripts]);

  // ── Hooks ──────────────────────────────────────────────────────

  const { touchstoneNameCache, touchstoneNamingController } =
    useTouchstoneDetection({ dispatch, stateRef }, { topics, matches, processing });

  const ctx = {
    dispatch, stateRef, addDebugEntry, setShouldStop,
    embeddingStore, opQueue, abortControllerRef, huntControllerRef,
    touchstoneNamingController, touchstoneNameCache, restoreFileInput,
  };

  const { revalidateMatchesRef, debouncedRevalidate } = useMatchRevalidation(ctx);
  const { huntTouchstones, huntTranscript, matchBitLive } = useHunting(ctx);
  matchBitLiveRef.current = matchBitLive;

  const bitOps = useBitOperations(ctx, matchBitLiveRef, debouncedRevalidate);
  const bitMgmt = useBitManagement(ctx, matchBitLiveRef, setApprovedGaps, embeddingStore);
  const communion = useCommunion(ctx);
  const parsing = useParsing(ctx, matchBitLiveRef);
  const transcriptOps = useTranscriptOps(ctx, loadSavedData);
  const tsHandlers = useTouchstoneHandlers(ctx);
  const noteOps = useNotes(ctx);

  // Promote a note into a bit + confirmed touchstone (sainted)
  const handlePromoteNote = useCallback(async (noteId, touchstoneName) => {
    const note = stateRef.current.notes.find(n => n.id === noteId);
    if (!note) return;
    const bitId = uid();
    const bit = {
      id: bitId,
      title: touchstoneName || note.title || note.text.slice(0, 60),
      fullText: note.text,
      summary: note.text.slice(0, 200),
      sourceFile: `note:${note.source}`,
      transcriptId: null,
      tags: note.tags || [],
      textPosition: null,
      editHistory: [],
      timestamp: Date.now(),
      noteSource: note.source,
      noteDate: note.date || null,
      noteGeneration: note.generation || null,
      noteCategory: note.noteCategory || null,
      noteId: note.id,
    };
    const tsId = `touchstone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTouchstone = {
      id: tsId,
      name: touchstoneName || note.title || note.text.slice(0, 60),
      summary: `1 instance — from ${note.source} note`,
      bitIds: [bitId],
      instances: [{ bitId, sourceFile: bit.sourceFile, title: bit.title, instanceNumber: 1, confidence: 1, relationship: "same_bit", communionStatus: "sainted" }],
      firstAppearance: { transcriptId: null, bitId, sourceFile: bit.sourceFile },
      frequency: 1, crossTranscript: false, sourceCount: 1,
      tags: note.tags || [], commonWords: [],
      matchInfo: { totalMatches: 0, sameBitCount: 0, evolvedCount: 0, relatedCount: 0, callbackCount: 0, avgConfidence: 0, avgMatchPercentage: 0, reasons: [] },
      category: "confirmed", manual: true,
    };
    update('topics', prev => [...prev, bit]);
    update('touchstones', prev => ({
      confirmed: [...(prev.confirmed || []), newTouchstone],
      possible: prev.possible || [],
      rejected: prev.rejected || [],
    }));
    await noteOps.updateNote(noteId, { matchedTouchstoneId: tsId });
    const s = stateRef.current;
    saveVaultState({ topics: s.topics, matches: s.matches, transcripts: s.transcripts, touchstones: s.touchstones }).catch(console.error);
    return tsId;
  }, []);

  // ── Tag merge via LLM ─────────────────────────────────────────

  const onMergeTags = useCallback(async () => {
    const s = stateRef.current;
    const BATCH_SIZE = 100;

    // Collect all tags with counts
    const tagCounts = new Map();
    for (const t of s.topics) {
      for (const tag of (t.tags || [])) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const allTags = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (allTags.length === 0) { set('status', 'No tags to merge.'); return; }

    set('processing', true);
    const allMerges = [];
    const allDescriptions = [];

    // Split into batches
    const batches = [];
    for (let i = 0; i < allTags.length; i += BATCH_SIZE) {
      batches.push(allTags.slice(i, i + BATCH_SIZE));
    }

    try {
      // Pass 1: merge within each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        set('status', `Analyzing tags batch ${i + 1}/${batches.length} (${batch.length} tags)...`);
        const tagList = batch.map(([tag, count]) => `${tag} (${count})`).join(", ");
        const result = await callOllama(
          SYSTEM_MERGE_TAGS,
          `Here are the tags with usage counts:\n${tagList}`,
          () => {},
          s.selectedModel,
          s.debugMode ? addDebugEntry : null,
          null,
          { label: `merge-tags-batch-${i + 1}` }
        );
        const merges = Array.isArray(result) ? result.filter((m) => m.merge && m.into) : [];
        allMerges.push(...merges);
      }

      // Apply batch merges to get the surviving tag list
      const renameMap = new Map();
      for (const op of allMerges) {
        for (const oldTag of op.merge) {
          if (oldTag !== op.into) renameMap.set(oldTag, op.into);
        }
      }

      // Pass 2: cross-batch — if we had multiple batches, check survivors against each other
      if (batches.length > 1) {
        // Rebuild tag list after batch merges
        const survivingTags = new Map();
        for (const [tag, count] of allTags) {
          const resolved = renameMap.get(tag) || tag;
          survivingTags.set(resolved, (survivingTags.get(resolved) || 0) + count);
        }
        const crossList = [...survivingTags.entries()].sort((a, b) => b[1] - a[1]);

        // Run cross-batch in batches too if still large
        const crossBatches = [];
        for (let i = 0; i < crossList.length; i += BATCH_SIZE) {
          crossBatches.push(crossList.slice(i, i + BATCH_SIZE));
        }
        // But we also need overlap between batches to catch cross-batch dupes
        // Strategy: sliding window with overlap
        if (crossList.length > BATCH_SIZE) {
          const OVERLAP = 15;
          for (let i = 0; i < crossList.length; i += BATCH_SIZE - OVERLAP) {
            const window = crossList.slice(i, i + BATCH_SIZE);
            if (window.length < 5) break;
            set('status', `Cross-checking tags (window ${Math.floor(i / (BATCH_SIZE - OVERLAP)) + 1}, ${window.length} tags)...`);
            const tagList = window.map(([tag, count]) => `${tag} (${count})`).join(", ");
            const result = await callOllama(
              SYSTEM_MERGE_TAGS,
              `Here are the tags with usage counts:\n${tagList}`,
              () => {},
              s.selectedModel,
              s.debugMode ? addDebugEntry : null,
              null,
              { label: `merge-tags-cross-${i}` }
            );
            const merges = Array.isArray(result) ? result.filter((m) => m.merge && m.into) : [];
            for (const op of merges) {
              // Only add if this is a new merge not already captured
              for (const oldTag of op.merge) {
                if (oldTag !== op.into && !renameMap.has(oldTag)) {
                  renameMap.set(oldTag, op.into);
                  allMerges.push(op);
                }
              }
            }
          }
        } else if (crossList.length > 1) {
          set('status', `Cross-checking ${crossList.length} surviving tags...`);
          const tagList = crossList.map(([tag, count]) => `${tag} (${count})`).join(", ");
          const result = await callOllama(
            SYSTEM_MERGE_TAGS,
            `Here are the tags with usage counts:\n${tagList}`,
            () => {},
            s.selectedModel,
            s.debugMode ? addDebugEntry : null,
            null,
            { label: "merge-tags-cross" }
          );
          const merges = Array.isArray(result) ? result.filter((m) => m.merge && m.into) : [];
          for (const op of merges) {
            for (const oldTag of op.merge) {
              if (oldTag !== op.into && !renameMap.has(oldTag)) {
                renameMap.set(oldTag, op.into);
                allMerges.push(op);
              }
            }
          }
        }
      }

      if (allMerges.length === 0) {
        set('status', 'No tag merges recommended.');
        set('processing', false);
        return;
      }

      // Rebuild final rename map (resolving chains: a→b→c becomes a→c)
      const finalMap = new Map();
      for (const op of allMerges) {
        for (const oldTag of op.merge) {
          if (oldTag !== op.into) finalMap.set(oldTag, op.into);
        }
      }
      // Resolve chains
      for (const [from, to] of finalMap) {
        let resolved = to;
        let depth = 0;
        while (finalMap.has(resolved) && depth < 10) { resolved = finalMap.get(resolved); depth++; }
        if (resolved !== to) finalMap.set(from, resolved);
      }

      // Apply to all topics
      set('status', 'Applying tag merges...');
      update('topics', (prev) => prev.map((t) => {
        if (!t.tags || t.tags.length === 0) return t;
        const newTags = [...new Set(t.tags.map((tag) => finalMap.get(tag) || tag))];
        if (newTags.length === t.tags.length && newTags.every((tag, i) => tag === t.tags[i])) return t;
        return { ...t, tags: newTags };
      }));

      // Build verbose description
      const mergeGroups = new Map();
      for (const [from, to] of finalMap) {
        if (!mergeGroups.has(to)) mergeGroups.set(to, []);
        mergeGroups.get(to).push(from);
      }
      const descriptions = [...mergeGroups.entries()].map(([into, froms]) =>
        `${froms.join(", ")} → ${into}`
      );
      set('tagMergeResult', descriptions);
      set('status', `Merged ${finalMap.size} tag(s) into ${mergeGroups.size} group(s).`);
      set('processing', false);

      // Save
      setTimeout(async () => {
        const s2 = stateRef.current;
        try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }); } catch {}
      }, 100);
    } catch (err) {
      set('status', `Tag merge failed: ${err.message}`);
      set('processing', false);
    }
  }, []);

  // ── Helpers ────────────────────────────────────────────────────

  const getMatchesForTopic = (topicId) =>
    matches
      .filter((m) => m.sourceId === topicId || m.targetId === topicId)
      .filter((m) => (m.matchPercentage || (m.confidence || 0) * 100) >= 50)
      .map((m) => {
        const otherId = m.sourceId === topicId ? m.targetId : m.sourceId;
        const other = topics.find((t) => t.id === otherId);
        return { ...m, other };
      })
      .filter((m) => m.other)
      .sort((a, b) => (b.matchPercentage || b.confidence * 100) - (a.matchPercentage || a.confidence * 100));

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a14",
      color: "#d4d4e0",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    }}>

      {/* Header */}
      <div style={{
        padding: "16px 32px 0",
        borderBottom: "1px solid #1a1a2a",
      }}>
        {/* Row 1: Title + stats left, model + debug right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 28,
              fontWeight: 900,
              background: "linear-gradient(135deg, #ff6b6b, #ffa94d)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "-0.5px",
              margin: 0,
            }}>
              Bit Parser
            </h1>
            <span style={{ color: "#555", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
              {topics.length} bits · {(touchstones?.confirmed?.length || 0) + (touchstones?.possible?.length || 0)} touchstones · {matches.length} connections · {transcripts.length} files
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {processing && (
              <button
                onClick={transcriptOps.handleHardStop}
                title="Abort all active LLM calls and restart Ollama"
                style={{
                  padding: "5px 14px",
                  background: "#ff6b6b",
                  border: "1px solid #ff6b6b",
                  color: "#fff",
                  borderRadius: "6px",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  cursor: "pointer",
                  animation: "pulse 1.5s infinite",
                }}
              >
                STOP
              </button>
            )}
            <button
              onClick={() => update('debugMode', (v) => !v)}
              title="Toggle debug mode: shows prompts and raw responses"
              style={{
                padding: "5px 10px",
                background: debugMode ? "#1a2a1a" : "#1a1a2a",
                border: `1px solid ${debugMode ? "#51cf66" : "#2a2a40"}`,
                color: debugMode ? "#51cf66" : "#555",
                borderRadius: "6px",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {debugMode ? "DEBUG ON" : "DEBUG"}
            </button>
            <ClearFiltersButton activeTab={activeTab} />
          </div>
        </div>

        {/* Row 2: Info left, action buttons right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono', monospace" }}>
            {lastSave && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#51cf66" }} />
                Saved {lastSave.toLocaleTimeString()}
              </span>
            )}
            {dbStats && (
              <span title={`DB: ${JSON.stringify(dbStats)}`}>
                {Object.values(dbStats).reduce((a, b) => a + b, 0)} items in DB
              </span>
            )}
            {embeddingStatus.cached > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#8bc98b" }} />
                Embeddings: {embeddingStatus.cached}{embeddingStatus.total > 0 ? `/${embeddingStatus.total}` : ""} cached
              </span>
            )}
            {topics.length > 0 && !processing && (
              <button
                onClick={async () => {
                  try {
                    set('status', `Embedding ${topics.length} bits...`);
                    await embeddingStore.ensureEmbeddings(topics, embeddingModel, ({ done, total, status }) => {
                      set('embeddingStatus', { cached: done, total });
                      set('status', status);
                    });
                    set('embeddingStatus', { cached: embeddingStore.size, total: topics.length });
                    set('status', `Embedded ${topics.length} bits.`);
                  } catch (err) {
                    set('status', `Embedding failed: ${err.message}`);
                  }
                }}
                title="Pre-compute embeddings for all bits"
                style={{
                  background: "none",
                  border: "1px solid #2a3a2a",
                  color: "#8bc98b",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                }}
              >
                Embed All
              </button>
            )}
          </div>
          <input
            ref={restoreFileInput}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={transcriptOps.handleRestoreFile}
          />
        </div>

        {/* Row 3: Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {["play", "transcripts", "bits", "touchstones", "notes", "errors", "analytics", "graph", "settings"].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "settings" ? "\u2699" : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{
          padding: "8px 32px",
          background: "#12121f",
          borderBottom: "1px solid #1a1a2a",
          fontSize: 12,
          color: processing ? "#ffa94d" : "#4ecdc4",
          fontFamily: "'JetBrains Mono', monospace",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          {processing && (
            <span style={{
              display: "inline-block",
              width: 8, height: 8,
              borderRadius: "50%",
              background: "#ffa94d",
              animation: "pulse 1s infinite",
            }} />
          )}
          {status}
        </div>
      )}

      <div style={{ padding: activeTab === "play" ? "24px 32px 0" : "24px 32px", paddingBottom: activeTab === "play" ? 0 : ((streamingProgress || processing || huntProgress) && debugMode) ? "calc(60vh + 24px)" : (streamingProgress || processing || huntProgress) ? 370 : debugMode ? "calc(40vh + 24px)" : 24 }}>
        {/* PLAY TAB */}
        {activeTab === "play" && (
          <PlayTab
            transcripts={transcripts}
            topics={topics}
            processing={processing}
            selectedModel={selectedModel}
            parseAll={parsing.parseAll}
            parseUnparsed={parsing.parseUnparsed}
            setShouldStop={setShouldStop}
            abortControllerRef={abortControllerRef}
            onGoToMix={(tr) => { setMixTranscriptInit(tr); setSelectedTranscript(tr); setActiveTab("transcripts"); }}
            onSyncApply={transcriptOps.handleSyncApply}
            playInitFile={playInitFile}
            onConsumePlayInit={() => setPlayInitFile(null)}
            onNowPlaying={setNowPlaying}
            nowPlaying={nowPlaying}
            vaultReady={vaultReady}
          />
        )}

        {/* BITS TAB */}
        {activeTab === "bits" && (
          <DatabaseTab
            topics={topics}
            setSelectedTopic={setSelectedTopic}
            getMatchesForTopic={getMatchesForTopic}
            touchstones={touchstones}
          />
        )}

        {/* ANALYTICS TAB */}
        {activeTab === "analytics" && (
          <div>
            {topics.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
                Parse some transcripts to see analytics.
              </div>
            ) : (
              <AnalyticsDashboard
                topics={topics}
                matches={matches}
                touchstones={touchstones}
                transcripts={transcripts}
                onMergeTags={onMergeTags}
                processing={processing}
                tagMergeResult={tagMergeResult}
                onDismissMergeResult={() => set('tagMergeResult', null)}
              />
            )}
          </div>
        )}

        {/* GRAPH TAB */}
        {activeTab === "graph" && (
          <div>
            {topics.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🕸️</div>
                Parse some transcripts to see the connection graph.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <p style={{ fontSize: 12, color: "#555", margin: 0 }}>
                      Drag nodes to rearrange. Scroll to zoom. Colors = source files. Lines = matched bits.
                    </p>
                    {embeddingStatus.cached > 0 && (
                      <span style={{ fontSize: 10, color: "#8bc98b", fontFamily: "'JetBrains Mono', monospace" }}>
                        {embeddingStatus.cached} embeddings
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => {
                        const next = !isEmbedPaused();
                        setEmbedPaused(next);
                        set('status', next ? 'Embedding paused — graph settling' : 'Embedding resumed');
                      }}
                      style={{
                        padding: "6px 14px",
                        background: isEmbedPaused() ? "#ffa94d18" : "#1e1e30",
                        color: isEmbedPaused() ? "#ffa94d" : "#666",
                        border: `1px solid ${isEmbedPaused() ? "#ffa94d44" : "#2a2a40"}`,
                        borderRadius: "6px",
                        fontWeight: 600,
                        fontSize: "11px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isEmbedPaused() ? "Unfreeze" : "Freeze"}
                    </button>
                  </div>
                </div>
                <NetworkGraph topics={topics} matches={matches} />
              </>
            )}
          </div>
        )}

        {/* TOUCHSTONES TAB */}
        {activeTab === "touchstones" && (
          <div>
            <TouchstonePanel
              touchstones={touchstones}
              bits={topics}
              matches={matches}
              onSelectBit={(bit) => {
                setSelectedTopic(bit);
              }}
              onHunt={huntTouchstones}
              onRectifyOverlaps={transcriptOps.rectifyOverlaps}
              huntProgress={huntProgress}
              processing={processing}
              onGenerateTitle={bitOps.handleGenerateTitle}
              initialTouchstoneId={touchstoneInit}
              onConsumeInitialTouchstone={() => setTouchstoneInit(null)}
              onRenameTouchstone={tsHandlers.onRenameTouchstone}
              onRemoveTouchstone={tsHandlers.onRemoveTouchstone}
              onConfirmTouchstone={tsHandlers.onConfirmTouchstone}
              onRestoreTouchstone={tsHandlers.onRestoreTouchstone}
              onRemoveInstance={tsHandlers.onRemoveInstance}
              onCreateTouchstone={transcriptOps.handleCreateTouchstoneFromBit}
              onUpdateInstanceRelationship={tsHandlers.onUpdateInstanceRelationship}
              onMergeTouchstone={tsHandlers.onMergeTouchstone}
              onRefreshReasons={tsHandlers.onRefreshReasons}
              onUpdateTouchstoneEdits={tsHandlers.onUpdateTouchstoneEdits}
              onGoToMix={(bit) => {
                const tr = transcripts.find((t) => t.id === bit.transcriptId);
                if (tr) {
                  setMixTranscriptInit(tr);
                  setMixBitInit(bit.id);
                  setSelectedTranscript(tr);
                  setActiveTab("transcripts");
                }
              }}
              onCommuneTouchstone={communion.handleCommuneTouchstone}
              onSynthesizeTouchstone={communion.handleSynthesizeTouchstone}
              onMassTouchstoneCommunion={communion.handleMassTouchstoneCommunion}
              onSaintInstance={tsHandlers.onSaintInstance}
              notes={notes}
              onGoToNote={(note) => {
                const tag = (note.tags || [])[0] || null;
                setNoteNav({ source: note.source || "all", tag });
                setActiveTab("notes");
              }}
            />
          </div>
        )}

        {/* TRANSCRIPTS TAB */}
        {activeTab === "transcripts" && (
          <TranscriptTab
            transcripts={transcripts}
            topics={topics}
            touchstones={touchstones}
            matches={matches}
            selectedTranscript={selectedTranscript}            selectedTopic={selectedTopic}
            processing={processing}
            selectedModel={selectedModel}
            parseAll={parsing.parseAll}
            parseUnparsed={parsing.parseUnparsed}
            setShouldStop={setShouldStop}
            abortControllerRef={abortControllerRef}
            setSelectedTranscript={setSelectedTranscript}
            setSelectedTopic={setSelectedTopic}
            reParseTranscript={parsing.reParseTranscript}
            purgeTranscriptData={transcriptOps.purgeTranscriptData}
            removeTranscript={transcriptOps.removeTranscript}
            onHuntTranscript={huntTranscript}
            onJoinBits={bitOps.handleJoinBits}
            onSplitBit={bitOps.handleSplitBit}
            onTakeOverlap={bitOps.handleTakeOverlap}
            onDeleteBit={bitMgmt.handleDeleteBit}
            onScrollBoundary={bitOps.handleScrollBoundary}
            onGenerateTitle={bitOps.handleGenerateTitle}
            onConfirmRename={bitOps.handleConfirmRename}
            onAddPhantomBit={bitMgmt.handleAddPhantomBit}
            onReParseGap={bitMgmt.handleReParseGap}
            onViewBitDetail={setSelectedTopic}
            mixTranscriptInit={mixTranscriptInit}
            mixBitInit={mixBitInit}
            mixGapInit={mixGapInit}
            onConsumeMixInit={() => { setMixTranscriptInit(null); setMixBitInit(null); setMixGapInit(null); }}
            approvedGaps={approvedGaps}
            onApproveGap={handleApproveGap}
            onGoToPlay={(tr) => { setPlayInitFile(tr.name); setActiveTab("play"); }}
            sortCol={state.transcriptSortCol}
            sortDir={state.transcriptSortDir}
            onSortChange={(col, dir) => dispatch({ type: 'MERGE', payload: { transcriptSortCol: col, transcriptSortDir: dir } })}
          />
        )}

        {/* ERRORS TAB */}
        {activeTab === "errors" && (
          <ValidationTab
            topics={topics}
            transcripts={transcripts}
            touchstones={touchstones}
            matches={matches}
            filter={validationFilter}
            onFilterChange={setValidationFilter}
            onUpdateBitPosition={bitOps.handleBoundaryChange}
            onGoToMix={(tr, bitId, gapInfo) => { setMixTranscriptInit(tr); setMixBitInit(bitId || null); setMixGapInit(gapInfo || null); setSelectedTranscript(tr); setActiveTab("transcripts"); }}
            onSelectBit={setSelectedTopic}
            approvedGaps={approvedGaps}
            onApproveGap={handleApproveGap}
            onRevalidateBits={(bitIds) => {
              const s = stateRef.current;
              revalidateMatchesRef.current?.(bitIds, s.topics, s.matches);
            }}
            onJoinBits={bitOps.handleJoinBits}
            onReParseGap={bitMgmt.handleReParseGap}
            onDeleteBit={bitMgmt.handleDeleteBit}
          />
        )}

        {/* NOTES TAB */}
        {activeTab === "notes" && (
          <NotesTab
            notes={notes}
            touchstones={touchstones}
            topics={topics}
            embeddingStore={embeddingStore}
            embeddingModel={embeddingModel}
            onImportClickUp={noteOps.importClickUp}
            onImportKeep={noteOps.importKeep}
            onSyncJournals={noteOps.syncJournals}
            onClearImports={noteOps.clearImports}
            onRemoveNote={noteOps.removeNote}
            onUpdateSortOrders={noteOps.updateNoteSortOrders}
            onLoadListMeta={noteOps.loadListMeta}
            onUpdateListMeta={noteOps.updateListMeta}
            onUpdateNote={noteOps.updateNote}
            onRenameListTag={noteOps.renameListTag}
            onPromoteNote={handlePromoteNote}
            initialNoteNav={noteNav}
            onConsumeNoteNav={() => setNoteNav(null)}
          />
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div style={{ maxWidth: 700 }}>
            {/* Model Selection */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, color: "#eee" }}>Models</h2>
            <div className="card" style={{ cursor: "default", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              {availableModels.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>LLM Model</div>
                  <select
                    value={selectedModel}
                    onChange={(e) => set('selectedModel', e.target.value)}
                    style={{ background: "#1a1a2a", border: "1px solid #2a2a40", color: "#ccc", padding: "8px 12px", borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", minWidth: 200 }}
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
              {availableModels.filter(m => m.toLowerCase().includes("embed")).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Embedding Model</div>
                  <select
                    value={embeddingModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      if (newModel !== stateRef.current.embeddingModel) {
                        embeddingStore.clear();
                        set('embeddingStatus', { cached: 0, total: 0 });
                      }
                      set('embeddingModel', newModel);
                    }}
                    title="Embedding model for semantic search"
                    style={{ background: "#1a1a2a", border: "1px solid #2a3a2a", color: "#8bc98b", padding: "8px 12px", borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", minWidth: 200 }}
                  >
                    {availableModels.filter(m => m.toLowerCase().includes("embed")).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* API Keys */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, marginTop: 32, color: "#eee" }}>External LLMs</h2>
            <div className="card" style={{ cursor: "default" }}>
              <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
                Configure API keys for high-end models. Used by "Send to..." on touchstone details. Keys are stored server-side only.
              </p>
              <LLMConfigPanel />
            </div>

            {/* Match Maintenance */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, marginTop: 32, color: "#eee" }}>Match Maintenance</h2>
            <div className="card" style={{ cursor: "default" }}>
              <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
                Mass Communion re-evaluates every stored match via the LLM, removing false positives. Processes the most-matched bits first.
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={communion.handleMassCommunion}
                  disabled={processing || matches.length === 0}
                  style={{
                    padding: "8px 18px",
                    background: processing ? "#33333a" : "#74c0fc18",
                    color: processing ? "#666" : "#74c0fc",
                    border: `1px solid ${processing ? "#33333a" : "#74c0fc44"}`,
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: processing || matches.length === 0 ? "default" : "pointer",
                  }}
                >
                  {processing ? "Running..." : `Mass Communion (${matches.length} matches)`}
                </button>
                <span style={{ fontSize: 11, color: "#555" }}>
                  {topics.filter((t) => {
                    return matches.some((m) => m.sourceId === t.id || m.targetId === t.id);
                  }).length} bits with connections
                </span>
              </div>
            </div>

            {/* Data Management */}
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 20, marginTop: 32, color: "#eee" }}>Data Management</h2>
            <div className="card" style={{ cursor: "default" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "Backup", icon: "📥", onClick: transcriptOps.handleBackup, title: "Download a full database backup as JSON", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
                  { label: "Restore", icon: "📤", onClick: transcriptOps.handleRestore, title: "Restore database from a backup JSON file", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
                  { label: "Reset Touchstones", icon: "🔄", onClick: transcriptOps.handleResetTouchstones, title: "Clear all touchstones and matches for re-detection", bg: "#1a1a2a", border: "#2a2a40", color: "#ff6b6b" },
                  { label: "Reset Transcripts", icon: "🔄", onClick: transcriptOps.clearProcessedData, title: "Clear bits, matches, touchstones — keep transcripts", bg: "#1a2a3a", border: "#224466", color: "#74c0fc" },
                  { label: "Fresh DB", icon: "⚠️", onClick: transcriptOps.clearAllData, title: "Delete all data and start over", bg: "#3a1a1a", border: "#662222", color: "#ff6b6b" },
                ].map(({ label, icon, onClick, title, bg, border, color }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    title={title}
                    style={{
                      padding: "8px 14px", background: bg, border: `1px solid ${border}`, color,
                      borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                      cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { e.target.style.borderColor = color; e.target.style.filter = "brightness(1.3)"; }}
                    onMouseLeave={(e) => { e.target.style.borderColor = border; e.target.style.filter = "none"; }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export */}
            <div style={{ marginTop: 32 }} />
            <ExportTab
              topics={topics}
              exportVault={transcriptOps.exportVault}
              exportMarkdownZip={transcriptOps.exportMarkdownZip}
              exportSingleMd={transcriptOps.exportSingleMd}
              syncToVault={transcriptOps.syncToVault}
            />
          </div>
        )}
      </div>

      {/* Bottom panels — stack when both debug and hunt/streaming are active */}
      {(() => {
        const showProgress = !!(streamingProgress || processing || huntProgress);
        const showDebug = debugMode;
        const bothActive = showProgress && showDebug;

        if (bothActive) {
          return (
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1001,
              display: "flex", flexDirection: "column", height: "60vh", maxHeight: "60vh",
            }}>
              <div style={{ flex: "0 0 auto", maxHeight: "50%", overflow: "hidden" }}>
                <StreamingProgressPanel progress={streamingProgress} foundBits={foundBits} processing={processing} status={status} huntProgress={huntProgress} onDismiss={() => { set('huntProgress', null); set('streamingProgress', null); set('status', ''); }} docked />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <DebugPanel log={debugLog} onClear={() => { set('debugLog', []); set('debugMode', false); }} docked />
              </div>
            </div>
          );
        }

        return (
          <>
            {showProgress && !showDebug && <StreamingProgressPanel progress={streamingProgress} foundBits={foundBits} processing={processing} status={status} huntProgress={huntProgress} onDismiss={() => { set('huntProgress', null); set('streamingProgress', null); set('status', ''); }} />}
            {showDebug && !showProgress && <DebugPanel log={debugLog} onClear={() => { set('debugLog', []); set('debugMode', false); }} />}
          </>
        );
      })()}

      {/* Detail Panel */}
      <DetailPanel
        selectedTopic={selectedTopic}
        selectedTranscript={selectedTranscript}
        transcripts={transcripts}
        adjustingBit={adjustingBit}
        editingMode={editingMode}
        touchstones={touchstones}
        topics={topics}
        setSelectedTopic={setSelectedTopic}
        setAdjustingBit={setAdjustingBit}
        setEditingMode={setEditingMode}
        setActiveTab={setActiveTab}
        onGoToMix={(tr, bitId) => { setMixTranscriptInit(tr); setMixBitInit(bitId || null); setSelectedTranscript(tr); setActiveTab("transcripts"); setSelectedTopic(null); }}
        onGoToTouchstone={(touchstoneId) => { setTouchstoneInit(touchstoneId); hashRouter.navigateTo("touchstones", touchstoneId); setSelectedTopic(null); }}
        handleBoundaryChange={bitOps.handleBoundaryChange}
        handleSplitBit={bitOps.handleSplitBit}
        handleJoinBits={bitOps.handleJoinBits}
        getMatchesForTopic={getMatchesForTopic}
        onBaptize={bitOps.handleBaptizeBit}
        onRename={bitOps.handleConfirmRename}
        onReparseTags={bitOps.handleReparseTags}
        onCommuneBit={communion.handleCommuneBit}
        onDeleteBit={bitMgmt.handleDeleteBit}
        onApproveGap={handleApproveGap}
        onRemoveFromTouchstone={tsHandlers.onRemoveFromTouchstone}
        onCreateTouchstone={transcriptOps.handleCreateTouchstoneFromBit}
        onAddToTouchstone={tsHandlers.onAddToTouchstone}
      />

      {/* Mini audio player */}
      <ScrollToTop />
      {nowPlaying && (activeTab === "play" || audioIsPlaying) && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 9999,
          background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 12,
          padding: "12px 16px", width: 480,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {nowPlaying.title}
            </span>
            <button
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.currentTime = Math.max(0, miniPlayerRef.current.currentTime - 10); }}
              style={{ background: "#2a2a40", border: "1px solid #3a3a55", borderRadius: 6, color: "#aaa", fontSize: 11, padding: "2px 6px", cursor: "pointer", flexShrink: 0 }}
            >-10s</button>
            <button
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.currentTime = Math.min(miniPlayerRef.current.duration || 0, miniPlayerRef.current.currentTime + 10); }}
              style={{ background: "#2a2a40", border: "1px solid #3a3a55", borderRadius: 6, color: "#aaa", fontSize: 11, padding: "2px 6px", cursor: "pointer", flexShrink: 0 }}
            >+10s</button>
            {activeTab !== "play" && (
              <span
                onClick={() => setActiveTab("play")}
                style={{ fontSize: 10, color: "#74c0fc", cursor: "pointer", flexShrink: 0 }}
              >
                open
              </span>
            )}
            <span
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.pause(); setNowPlaying(null); setAudioIsPlaying(false); }}
              style={{ fontSize: 14, color: "#666", cursor: "pointer", flexShrink: 0, lineHeight: 1 }}
            >
              x
            </span>
          </div>
          <audio
            ref={miniPlayerRef}
            controls
            src={nowPlaying.url}
            style={{ width: "100%", height: 32 }}
            onPlay={() => setAudioIsPlaying(true)}
            onPause={() => setAudioIsPlaying(false)}
            onEnded={() => { setAudioIsPlaying(false); setNowPlaying(null); }}
          />
        </div>
      )}
    </div>
  );
}
