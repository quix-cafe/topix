import { useCallback, useEffect, useRef } from "react";

const VALID_TABS = new Set(["play", "transcripts", "bits", "tags", "touchstones", "validation", "analytics", "graph", "settings"]);

function parseHash(hash) {
  const clean = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = clean.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const params = new URLSearchParams(queryPart || "");

  const tab = VALID_TABS.has(segments[0]) ? segments[0] : "play";
  const subId = segments[1] ? decodeURIComponent(segments[1]) : null;
  const bitId = params.get("bit") || null;

  return { tab, subId, bitId };
}

function buildHash(tab, subId, bitId) {
  let hash = `#/${tab || "play"}`;
  if (subId) hash += `/${encodeURIComponent(subId)}`;
  if (bitId) hash += `?bit=${bitId}`;
  return hash;
}

// Sentinel to distinguish "not set" from "set to null"
const UNSET = Symbol("unset");

/**
 * Hash-based router for tab navigation, transcript/touchstone deep links, and bit detail overlay.
 */
export function useHashRouter(dispatch, stateRef, vaultReady, setTouchstoneInit) {
  const suppressPush = useRef(false);
  const pushScheduled = useRef(false);

  // Pending state — accumulates values from synchronous setter calls within one microtask
  const pending = useRef({ tab: UNSET, transcript: UNSET, bitId: UNSET });

  // Resolve pending + current state into a hash
  const resolveHash = () => {
    const s = stateRef.current;
    const tab = pending.current.tab !== UNSET ? pending.current.tab : (s.activeTab || "play");

    let subId = null;
    if (tab === "transcripts") {
      const tr = pending.current.transcript !== UNSET ? pending.current.transcript : s.selectedTranscript;
      if (tr) subId = tr.name;
    }

    const bitId = pending.current.bitId !== UNSET
      ? pending.current.bitId
      : (s.selectedTopic?.id || null);

    return buildHash(tab, subId, bitId);
  };

  // Coalesce multiple synchronous setter calls into one pushState
  const schedulePush = useCallback(() => {
    if (suppressPush.current || pushScheduled.current) return;
    pushScheduled.current = true;
    queueMicrotask(() => {
      pushScheduled.current = false;
      if (suppressPush.current) return;
      const newHash = resolveHash();
      // Reset pending
      pending.current = { tab: UNSET, transcript: UNSET, bitId: UNSET };
      if (window.location.hash !== newHash) {
        history.pushState(null, "", newHash);
      }
    });
  }, []);

  // Resolve hash into state dispatches
  const applyHash = useCallback((hash) => {
    const { tab, subId, bitId } = parseHash(hash);
    const s = stateRef.current;

    if (tab !== s.activeTab) {
      dispatch({ type: "SET", field: "activeTab", value: tab });
    }

    // Resolve transcript by name
    if (tab === "transcripts" && subId) {
      const tr = s.transcripts.find((t) => t.name === subId);
      if (tr && tr.id !== s.selectedTranscript?.id) {
        dispatch({ type: "SET", field: "selectedTranscript", value: tr });
      }
    } else if (tab === "transcripts" && !subId && s.selectedTranscript) {
      dispatch({ type: "SET", field: "selectedTranscript", value: null });
    }

    // Resolve touchstone sub-ID (scroll-to)
    if (tab === "touchstones" && subId) {
      setTouchstoneInit?.(subId);
    }

    // Resolve bit detail overlay
    if (bitId) {
      const bit = s.topics.find((t) => t.id === bitId);
      if (bit && bit.id !== s.selectedTopic?.id) {
        dispatch({ type: "SET", field: "selectedTopic", value: bit });
      }
    } else if (!bitId && s.selectedTopic) {
      dispatch({ type: "SET", field: "selectedTopic", value: null });
    }

    return { tab, subId, bitId };
  }, [dispatch, setTouchstoneInit]);

  // ── Router-aware setters ───────────────────────────────────────

  const setActiveTab = useCallback((v) => {
    dispatch({ type: "SET", field: "activeTab", value: v });
    pending.current.tab = v;
    // Clear transcript sub-ID when leaving transcripts tab
    if (v !== "transcripts") {
      pending.current.transcript = null;
    }
    schedulePush();
  }, [dispatch, schedulePush]);

  const setSelectedTopic = useCallback((v) => {
    dispatch({ type: "SET", field: "selectedTopic", value: v });
    pending.current.bitId = v?.id || null;
    schedulePush();
  }, [dispatch, schedulePush]);

  const setSelectedTranscript = useCallback((v) => {
    dispatch({ type: "SET", field: "selectedTranscript", value: v });
    pending.current.transcript = v;
    schedulePush();
  }, [dispatch, schedulePush]);

  // Explicit navigation with sub-ID (e.g. go to specific touchstone)
  const navigateTo = useCallback((tab, subId = null) => {
    dispatch({ type: "SET", field: "activeTab", value: tab });
    if (!suppressPush.current) {
      const bitId = pending.current.bitId !== UNSET
        ? pending.current.bitId
        : (stateRef.current.selectedTopic?.id || null);
      const newHash = buildHash(tab, subId, bitId);
      // Reset pending since we're pushing explicitly
      pending.current = { tab: UNSET, transcript: UNSET, bitId: UNSET };
      pushScheduled.current = false;
      if (window.location.hash !== newHash) {
        history.pushState(null, "", newHash);
      }
    }
  }, [dispatch]);

  // ── Event listeners ────────────────────────────────────────────

  // Back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      suppressPush.current = true;
      applyHash(window.location.hash);
      suppressPush.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyHash]);

  // Apply URL on initial load (after data is available)
  useEffect(() => {
    if (!vaultReady) return;
    const hash = window.location.hash;
    if (hash && hash !== "#/" && hash !== "#/play") {
      suppressPush.current = true;
      applyHash(hash);
      suppressPush.current = false;
    } else {
      // No meaningful hash — set from current state without adding history entry
      const s = stateRef.current;
      const tab = s.activeTab || "play";
      let subId = null;
      if (tab === "transcripts" && s.selectedTranscript) subId = s.selectedTranscript.name;
      history.replaceState(null, "", buildHash(tab, subId, s.selectedTopic?.id || null));
    }
  }, [vaultReady]);

  return {
    setActiveTab,
    setSelectedTopic,
    setSelectedTranscript,
    navigateTo,
  };
}
