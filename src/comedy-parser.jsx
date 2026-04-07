import { useReducer, useRef, useCallback, useEffect, useState } from "react";
import { uid, getAvailableModels, callOllama } from "./utils/ollama";
import { SYSTEM_MERGE_TAGS } from "./utils/prompts";
import { validateAllBits } from "./utils/textContinuityValidator";
import { TouchstonePanel } from "./components/TouchstonePanel";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { getDB, saveVaultState, loadVaultState, getDatabaseStats } from "./utils/database";
import { EmbeddingStore, setEmbedPaused, isEmbedPaused, embedBatch, cosineSimilarity } from "./utils/embeddings";
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
      className={`clear-filters-btn ${hasFilters ? "active" : "inactive"}`}
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
  universalCorrections: [],
};


// Preserve _unlinkedPairs when touchstones are replaced
function preserveUnlinkedPairs(state, field, newValue) {
  if (field === 'touchstones' && newValue && !newValue._unlinkedPairs && state.touchstones?._unlinkedPairs) {
    return { ...newValue, _unlinkedPairs: state.touchstones._unlinkedPairs };
  }
  return newValue;
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: preserveUnlinkedPairs(state, action.field, action.value) };
    case 'UPDATE':
      return { ...state, [action.field]: preserveUnlinkedPairs(state, action.field, action.fn(state[action.field])) };
    case 'MERGE':
      if (action.payload.touchstones) {
        action.payload.touchstones = preserveUnlinkedPairs(state, 'touchstones', action.payload.touchstones);
      }
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
      className="scroll-to-top"
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
  const [validationBatchFixing, setValidationBatchFixing] = useState(null);
  const [validationBatchProgress, setValidationBatchProgress] = useState(null);
  const validationBatchStopRef = useRef(false);
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
          universalCorrections: saved.universalCorrections || [],
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
      saveVaultState({ topics, matches, transcripts, touchstones, universalCorrections: state.universalCorrections })
        .then(() => {
          set('lastSave', new Date());
          getDatabaseStats().then(stats => set('dbStats', stats)).catch(console.error);
        })
        .catch((err) => console.error("Auto-save error:", err));
    }, 5000);
    return () => clearTimeout(timer);
  }, [topics, matches, transcripts, touchstones, state.universalCorrections]);

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

  const { touchstoneNameCache, touchstoneNamingController, runDetection, reasonRefreshQueue } =
    useTouchstoneDetection({ dispatch, stateRef }, { topics, matches, processing });

  const ctx = {
    dispatch, stateRef, addDebugEntry, setShouldStop,
    embeddingStore, opQueue, abortControllerRef, huntControllerRef,
    touchstoneNamingController, touchstoneNameCache, restoreFileInput,
  };

  const { revalidateMatchesRef, debouncedRevalidate } = useMatchRevalidation(ctx);
  const { huntTouchstones, huntTranscript, matchBitLive, absorbAllUnmatched } = useHunting(ctx);
  matchBitLiveRef.current = matchBitLive;

  const bitOps = useBitOperations(ctx, matchBitLiveRef, debouncedRevalidate);
  const bitMgmt = useBitManagement(ctx, matchBitLiveRef, setApprovedGaps, embeddingStore);
  const communion = useCommunion(ctx);
  const parsing = useParsing(ctx, matchBitLiveRef);
  const transcriptOps = useTranscriptOps(ctx, loadSavedData);
  const tsHandlers = useTouchstoneHandlers(ctx);
  const noteOps = useNotes(ctx);

  const removeOrphanTranscripts = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:3001/api/transcripts");
      if (!res.ok) return;
      const playFiles = await res.json();
      const playNames = new Set(playFiles.filter((e) => e.has_transcript).map((e) => e.transcript_filename));
      const playHashes = new Set(playFiles.map((e) => e.hash));
      const s = stateRef.current;
      const orphans = s.transcripts.filter((tr) => {
        if (tr.playHash && playHashes.has(tr.playHash)) return false;
        if (playNames.has(tr.name)) return false;
        return true;
      });
      if (orphans.length === 0) { dispatch({ type: 'SET', field: 'status', value: 'No orphaned transcripts found.' }); return; }
      if (!window.confirm(`Remove ${orphans.length} orphaned transcript${orphans.length !== 1 ? 's' : ''} not matched to any play file?\n\n${orphans.map((t) => t.name).join('\n')}`)) return;
      const orphanIds = new Set(orphans.map((t) => t.id));
      const orphanNames = new Set(orphans.map((t) => t.name));
      const bitsToRemove = new Set(s.topics.filter((t) => orphanIds.has(t.transcriptId) || orphanNames.has(t.sourceFile)).map((t) => t.id));
      const updatedTopics = s.topics.filter((t) => !bitsToRemove.has(t.id));
      const updatedMatches = s.matches.filter((m) => !bitsToRemove.has(m.sourceId) && !bitsToRemove.has(m.targetId));
      const updatedTranscripts = s.transcripts.filter((t) => !orphanIds.has(t.id));
      dispatch({ type: 'MERGE', payload: { topics: updatedTopics, matches: updatedMatches, transcripts: updatedTranscripts } });
      await saveVaultState({ topics: updatedTopics, matches: updatedMatches, transcripts: updatedTranscripts, touchstones: s.touchstones });
      dispatch({ type: 'SET', field: 'status', value: `Removed ${orphans.length} orphaned transcript${orphans.length !== 1 ? 's' : ''} and ${bitsToRemove.size} bits.` });
    } catch (err) { dispatch({ type: 'SET', field: 'status', value: `Error removing orphans: ${err.message}` }); }
  }, []);

  // Auto-refresh reasons for touchstones with 25%+ content growth
  const reasonRefreshRunning = useRef(false);
  useEffect(() => {
    if (processing || reasonRefreshRunning.current || reasonRefreshQueue.current.length === 0) return;
    const queue = reasonRefreshQueue.current.splice(0);
    reasonRefreshRunning.current = true;
    (async () => {
      for (const id of queue) {
        try { await tsHandlers.onRefreshReasons(id); } catch (e) { console.warn("[AutoRefreshReasons]", e); }
      }
      reasonRefreshRunning.current = false;
    })();
  }, [touchstones, processing]);

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

    // Collect all tags with counts
    const tagCounts = new Map();
    for (const t of s.topics) {
      for (const tag of (t.tags || [])) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const allTags = [...tagCounts.entries()];
    if (allTags.length === 0) { set('status', 'No tags to merge.'); return; }

    set('processing', true);

    try {
      // Step 1: Embed all unique tags for semantic clustering
      const tagNames = allTags.map(([tag]) => tag);
      set('status', `Embedding ${tagNames.length} tags for semantic clustering...`);
      const vectors = await embedBatch(tagNames, s.embeddingModel || "mxbai-embed-large", ({ textsDone, textsTotal }) => {
        set('status', `Embedding tags: ${textsDone}/${textsTotal}...`);
      });

      // Step 2: Cluster tags by cosine similarity (greedy single-linkage)
      const SIM_THRESHOLD = 0.7;
      const assigned = new Set();
      const clusters = []; // Array of arrays of indices

      for (let i = 0; i < tagNames.length; i++) {
        if (assigned.has(i)) continue;
        const cluster = [i];
        assigned.add(i);
        for (let j = i + 1; j < tagNames.length; j++) {
          if (assigned.has(j)) continue;
          // Check similarity to any member of this cluster
          const sim = cluster.some(ci => cosineSimilarity(vectors[ci], vectors[j]) >= SIM_THRESHOLD);
          if (sim) {
            cluster.push(j);
            assigned.add(j);
          }
        }
        if (cluster.length >= 2) {
          clusters.push(cluster);
        }
      }

      if (clusters.length === 0) {
        set('status', 'No semantically similar tags found — nothing to merge.');
        set('processing', false);
        return;
      }

      set('status', `Found ${clusters.length} tag clusters. Asking LLM to evaluate merges...`);

      // Step 3: Send each cluster to the LLM for merge decisions
      const allMerges = [];
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        const clusterTags = cluster.map(idx => [tagNames[idx], tagCounts.get(tagNames[idx])]);
        set('status', `Evaluating cluster ${i + 1}/${clusters.length} (${clusterTags.length} tags)...`);
        const tagList = clusterTags.map(([tag, count]) => `${tag} (${count})`).join(", ");
        const result = await callOllama(
          SYSTEM_MERGE_TAGS,
          `Here are the tags with usage counts:\n${tagList}`,
          () => {},
          s.selectedModel,
          s.debugMode ? addDebugEntry : null,
          null,
          { label: `merge-tags-cluster-${i + 1}` }
        );
        const merges = Array.isArray(result) ? result.filter((m) => m.merge && m.into) : [];
        allMerges.push(...merges);
      }

      if (allMerges.length === 0) {
        set('status', 'No tag merges recommended.');
        set('processing', false);
        return;
      }

      // Build final rename map (resolving chains: a→b→c becomes a→c)
      const finalMap = new Map();
      for (const op of allMerges) {
        for (const oldTag of op.merge) {
          if (oldTag !== op.into) finalMap.set(oldTag, op.into);
        }
      }
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
    <div className="app-root">

      {/* Header */}
      <div className="app-header">
        {/* Row 1: Title + stats left, model + debug right */}
        <div className="header-row">
          <div className="header-left">
            <h1 className="app-title">Bit Parser</h1>
            <span className="header-stats">
              {topics.length} bits · {(touchstones?.confirmed?.length || 0) + (touchstones?.possible?.length || 0)} touchstones · {matches.length} connections · {transcripts.length} files
            </span>
          </div>
          <div className="header-right">
            {processing && (
              <button
                onClick={transcriptOps.handleHardStop}
                title="Abort all active LLM calls and restart Ollama"
                className="stop-btn"
              >
                STOP
              </button>
            )}
            <button
              onClick={() => update('debugMode', (v) => !v)}
              title="Toggle debug mode: shows prompts and raw responses"
              className={`debug-btn ${debugMode ? "on" : "off"}`}
            >
              {debugMode ? "DEBUG ON" : "DEBUG"}
            </button>
            <ClearFiltersButton activeTab={activeTab} />
          </div>
        </div>

        {/* Row 2: Info left, action buttons right */}
        <div className="header-row">
          <div className="info-bar">
            {lastSave && (
              <span className="indicator">
                <span className="status-dot green" />
                Saved {lastSave.toLocaleTimeString()}
              </span>
            )}
            {dbStats && (
              <span title={`DB: ${JSON.stringify(dbStats)}`}>
                {Object.values(dbStats).reduce((a, b) => a + b, 0)} items in DB
              </span>
            )}
            {embeddingStatus.cached > 0 && (
              <span className="indicator">
                <span className="status-dot green-light" />
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
                className="embed-all-btn"
              >
                Embed All
              </button>
            )}
          </div>
          <input
            ref={restoreFileInput}
            type="file"
            accept=".json"
            className="hidden"
            onChange={transcriptOps.handleRestoreFile}
          />
        </div>

        {/* Row 3: Tabs */}
        <div className="tab-row">
          {["play", "transcripts", "bits", "touchstones", "notes", "analytics", "graph", "errors", "settings"].map((tab) => (
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
        <div className={`status-bar ${processing ? "busy" : "idle"}`}>
          {processing && <span className="pulse-dot" />}
          {status}
        </div>
      )}

      <div className={`content-area ${activeTab === "play" ? "play" : ""}`} style={{ paddingBottom: activeTab === "play" ? 0 : ((streamingProgress || processing || huntProgress) && debugMode) ? "calc(60vh + 24px)" : (streamingProgress || processing || huntProgress) ? 370 : debugMode ? "calc(40vh + 24px)" : 24 }}>
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
            onSyncJournals={noteOps.syncJournals}
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
              <div className="empty-state">Parse some transcripts to see analytics.</div>
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
              <div className="empty-state">
                <div className="empty-state-icon">🕸️</div>
                Parse some transcripts to see the connection graph.
              </div>
            ) : (
              <>
                <div className="graph-header">
                  <div className="graph-instructions">
                    <p>Drag nodes to rearrange. Scroll to zoom. Colors = source files. Lines = matched bits.</p>
                    {embeddingStatus.cached > 0 && (
                      <span className="graph-embed-count">{embeddingStatus.cached} embeddings</span>
                    )}
                  </div>
                  <div className="header-right">
                    <button
                      onClick={() => {
                        const next = !isEmbedPaused();
                        setEmbedPaused(next);
                        set('status', next ? 'Embedding paused — graph settling' : 'Embedding resumed');
                      }}
                      className={`freeze-btn ${isEmbedPaused() ? "on" : "off"}`}
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
            batchFixing={validationBatchFixing}
            setBatchFixing={setValidationBatchFixing}
            batchProgress={validationBatchProgress}
            setBatchProgress={setValidationBatchProgress}
            batchStopRef={validationBatchStopRef}
            universalCorrections={state.universalCorrections || []}
            onUpdateUniversalCorrections={(corrections) => {
              set('universalCorrections', corrections);
              saveVaultState({ topics, matches, transcripts, touchstones, universalCorrections: corrections }).catch(console.error);
            }}
          />
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
              onPruneTouchstone={communion.handlePruneTouchstone}
              onMassPrune={communion.handleMassPrune}
              onRecalcScores={communion.handleRecalcScores}
              onSaintInstance={tsHandlers.onSaintInstance}
              onToggleCoreBit={tsHandlers.onToggleCoreBit}
              onRelateTouchstone={tsHandlers.onRelateTouchstone}
              onUnrelateTouchstone={tsHandlers.onUnrelateTouchstone}
              onAutoRelateAll={tsHandlers.onAutoRelateAll}
              onRejectCoreless={tsHandlers.onRejectCoreless}
              onRedetect={runDetection}
              notes={notes}
              onGoToNote={(note) => {
                const tag = (note.tags || [])[0] || null;
                setNoteNav({ source: note.source || "all", tag });
                setActiveTab("notes");
              }}
              universalCorrections={state.universalCorrections}
              selectedModel={selectedModel}
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
            onImportParsedJSON={transcriptOps.importParsedJSON}
            purgeTranscriptData={transcriptOps.purgeTranscriptData}
            removeTranscript={transcriptOps.removeTranscript}
            onHuntTranscript={huntTranscript}
            onAbsorbUnmatched={absorbAllUnmatched}
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
            onGoToPlay={(tr) => { setPlayInitFile(tr.playHash || tr.name); setActiveTab("play"); }}
            onRemoveOrphans={removeOrphanTranscripts}
            sortCol={state.transcriptSortCol}
            sortDir={state.transcriptSortDir}
            onSortChange={(col, dir) => dispatch({ type: 'MERGE', payload: { transcriptSortCol: col, transcriptSortDir: dir } })}
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
          <div className="settings-container">
            {/* Model Selection */}
            <h2 className="section-heading">Models</h2>
            <div className="card card-static card-flex">
              {availableModels.length > 0 && (
                <div>
                  <div className="field-label">LLM Model</div>
                  <select
                    value={selectedModel}
                    onChange={(e) => set('selectedModel', e.target.value)}
                    className="dark-select"
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
              {availableModels.filter(m => m.toLowerCase().includes("embed")).length > 0 && (
                <div>
                  <div className="field-label">Embedding Model</div>
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
                    className="dark-select embed"
                  >
                    {availableModels.filter(m => m.toLowerCase().includes("embed")).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* API Keys */}
            <h2 className="section-heading mt">External LLMs</h2>
            <div className="card card-static">
              <p className="settings-description">
                Configure API keys for high-end models. Used by "Send to..." on touchstone details. Keys are stored server-side only.
              </p>
              <LLMConfigPanel />
            </div>

            {/* Match Maintenance */}
            <h2 className="section-heading mt">Match Maintenance</h2>
            <div className="card card-static">
              <p className="settings-description">
                Mass Communion re-evaluates every stored match via the LLM, removing false positives. Processes the most-matched bits first.
              </p>
              <div className="action-row">
                <button
                  onClick={communion.handleMassCommunion}
                  disabled={processing || matches.length === 0}
                  className={`mass-communion-btn ${processing || matches.length === 0 ? "disabled" : "enabled"}`}
                >
                  {processing ? "Running..." : `Mass Communion (${matches.length} matches)`}
                </button>
                <span className="connection-count">
                  {topics.filter((t) => {
                    return matches.some((m) => m.sourceId === t.id || m.targetId === t.id);
                  }).length} bits with connections
                </span>
              </div>
            </div>

            {/* Data Management */}
            <h2 className="section-heading mt">Data Management</h2>
            <div className="card card-static">
              <div className="data-btn-row">
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
                    className="data-btn"
                    style={{ background: bg, border: `1px solid ${border}`, color }}
                    onMouseEnter={(e) => { e.target.style.borderColor = color; }}
                    onMouseLeave={(e) => { e.target.style.borderColor = border; }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export */}
            <div className="export-spacer" />
            <ExportTab
              topics={topics}
              exportVault={transcriptOps.exportVault}
              exportMarkdownZip={transcriptOps.exportMarkdownZip}
              exportSingleMd={transcriptOps.exportSingleMd}
              syncToVault={transcriptOps.syncToVault}
              undoVaultSync={transcriptOps.undoVaultSync}
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
            <div className="bottom-panels-stacked">
              <div className="bottom-panel-top">
                <StreamingProgressPanel progress={streamingProgress} foundBits={foundBits} processing={processing} status={status} huntProgress={huntProgress} onDismiss={() => { set('huntProgress', null); set('streamingProgress', null); set('status', ''); }} docked />
              </div>
              <div className="bottom-panel-bottom">
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
        onRecalcBitConnections={communion.handleRecalcBitConnections}
      />

      {/* Mini audio player */}
      <ScrollToTop />
      {nowPlaying && (activeTab === "play" || audioIsPlaying) && (
        <div className="mini-player">
          <div className="mini-player-header">
            <span className="mini-player-title">{nowPlaying.title}</span>
            <button
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.currentTime = Math.max(0, miniPlayerRef.current.currentTime - 10); }}
              className="skip-btn"
            >-10s</button>
            <button
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.currentTime = Math.min(miniPlayerRef.current.duration || 0, miniPlayerRef.current.currentTime + 10); }}
              className="skip-btn"
            >+10s</button>
            {activeTab !== "play" && (
              <span onClick={() => setActiveTab("play")} className="mini-player-link">open</span>
            )}
            <span
              onClick={() => { if (miniPlayerRef.current) miniPlayerRef.current.pause(); setNowPlaying(null); setAudioIsPlaying(false); }}
              className="mini-player-close"
            >
              x
            </span>
          </div>
          <audio
            ref={miniPlayerRef}
            controls
            src={nowPlaying.url}
            onPlay={() => setAudioIsPlaying(true)}
            onPause={() => setAudioIsPlaying(false)}
            onEnded={() => { setAudioIsPlaying(false); setNowPlaying(null); }}
          />
        </div>
      )}
    </div>
  );
}
