import { useCallback, useEffect, useRef } from "react";
import { detectTouchstones } from "../utils/touchstoneDetector";
import { assembleAndMergeTouchstones } from "../utils/touchstoneAssembler";
import { autoRelateTouchstones } from "../utils/flowRelations";
import { autoNameTouchstones } from "../utils/touchstoneNaming";

export function useTouchstoneDetection(ctx, { topics, matches, processing }) {
  const { dispatch, stateRef } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const touchstoneNameCache = useRef(new Map());
  const touchstoneNamingController = useRef(null);
  const namingInFlight = useRef(new Set());
  const lastDetectionKey = useRef("");

  const findCachedName = useCallback((bitIds) => {
    const idSet = new Set(bitIds);
    const exactKey = [...bitIds].sort().join(",");
    if (touchstoneNameCache.current.has(exactKey)) return touchstoneNameCache.current.get(exactKey);
    let bestName = null, bestOverlap = 0;
    for (const [key, name] of touchstoneNameCache.current.entries()) {
      const cachedIds = key.split(",");
      const overlap = cachedIds.filter(id => idSet.has(id)).length;
      const overlapRatio = overlap / Math.max(idSet.size, cachedIds.length);
      if (overlapRatio >= 0.5 && overlap > bestOverlap) { bestOverlap = overlap; bestName = name; }
    }
    return bestName;
  }, []);

  const setCachedName = useCallback((bitIds, name) => {
    const key = [...bitIds].sort().join(",");
    touchstoneNameCache.current.set(key, name);
  }, []);

  const runDetection = useCallback(() => {
    const s = stateRef.current;
    if (!s.topics || s.topics.length < 2) return;
    const keyOf = (ts) => [...ts.bitIds].sort().join(",");

    const detected = detectTouchstones(s.topics, s.matches || [], 2);
    const prev = s.touchstones || {};
    const assembled = assembleAndMergeTouchstones({ detected, previousTouchstones: prev, topics: s.topics, matches: s.matches || [], findCachedName });
    assembled._unlinkedPairs = prev._unlinkedPairs || [];
    const result = autoRelateTouchstones(assembled, s.topics);
    set('touchstones', result);
    lastDetectionKey.current = `${s.topics.length}:${(s.matches || []).length}`;
    set('status', `Re-detected touchstones: ${(result.confirmed || []).length} confirmed, ${(result.possible || []).length} possible`);

    // Auto-name unnamed possibles
    const toName = result.possible.filter(ts => {
      if (ts.manualName) return false;
      const key = keyOf(ts);
      if (namingInFlight.current.has(key)) return false;
      if (!ts.autoNamed && !findCachedName(ts.bitIds)) return true;
      return false;
    });
    if (toName.length > 0) {
      if (touchstoneNamingController.current) touchstoneNamingController.current.abort();
      const controller = new AbortController();
      touchstoneNamingController.current = controller;
      autoNameTouchstones({
        toName, topics: s.topics, model: s.selectedModel, signal: controller.signal,
        namingInFlight: namingInFlight.current, findCachedName, setCachedName, keyOf,
        onName: (tsKey, name, ts) => {
          update('touchstones', (prev) => {
            const rename = (list) => list.map(t => {
              if (t.manualName || t.category === "confirmed") return t;
              const tKey = keyOf(t);
              if (tKey === tsKey) return { ...t, name, autoNamed: true, lastNamedBitCount: t.bitIds.length };
              const tSet = new Set(t.bitIds);
              const overlap = ts.bitIds.filter(id => tSet.has(id)).length;
              if (overlap >= Math.ceil(ts.bitIds.length * 0.5) && !findCachedName(t.bitIds)) {
                return { ...t, name, autoNamed: true, lastNamedBitCount: t.bitIds.length };
              }
              return t;
            });
            return { confirmed: prev.confirmed || [], possible: rename(prev.possible || []), rejected: rename(prev.rejected || []) };
          });
        },
        onStatus: (msg) => set('status', msg),
      });
    }
  }, [findCachedName, setCachedName]);

  useEffect(() => {
    if (processing) return;

    const debounceTimer = setTimeout(() => {
      if (topics.length < 2) {
        set('touchstones', { confirmed: [], possible: [], rejected: [] });
        return;
      }

      // Skip re-detection if topics and matches haven't meaningfully changed
      const detectionKey = `${topics.length}:${matches.length}`;
      if (detectionKey === lastDetectionKey.current) return;
      lastDetectionKey.current = detectionKey;

      const keyOf = (ts) => [...ts.bitIds].sort().join(",");

      // ── Detection + assembly ──
      const detected = detectTouchstones(topics, matches, 2);
      const prev = stateRef.current.touchstones || {};
      const assembled = assembleAndMergeTouchstones({ detected, previousTouchstones: prev, topics, matches, findCachedName });
      assembled._unlinkedPairs = prev._unlinkedPairs || [];
      const named = autoRelateTouchstones(assembled, topics);
      set('touchstones', named);

      // ── Auto-naming ──
      const splitJoinCooldown = stateRef.current.lastSplitJoinTime && (Date.now() - stateRef.current.lastSplitJoinTime < 30000);

      const toName = named.possible.filter(ts => {
        if (ts.manualName || splitJoinCooldown) return false;
        const key = keyOf(ts);
        if (namingInFlight.current.has(key)) return false;
        if (!ts.autoNamed && !findCachedName(ts.bitIds)) return true;
        if (ts.autoNamed && ts.lastNamedBitCount) {
          const growth = (ts.bitIds.length - ts.lastNamedBitCount) / ts.lastNamedBitCount;
          if (growth >= 0.25) return true;
        }
        return false;
      });

      if (toName.length > 0) {
        // Abort any previous naming run, start fresh
        if (touchstoneNamingController.current) {
          touchstoneNamingController.current.abort();
        }
        const controller = new AbortController();
        touchstoneNamingController.current = controller;

        autoNameTouchstones({
          toName,
          topics,
          model: stateRef.current.selectedModel,
          signal: controller.signal,
          namingInFlight: namingInFlight.current,
          findCachedName,
          setCachedName,
          keyOf,
          onName: (tsKey, name, ts) => {
            update('touchstones', (prev) => {
              const rename = (list) => list.map(t => {
                if (t.manualName || t.category === "confirmed") return t;
                const tKey = keyOf(t);
                if (tKey === tsKey) return { ...t, name, autoNamed: true, lastNamedBitCount: t.bitIds.length };
                const tSet = new Set(t.bitIds);
                const overlap = ts.bitIds.filter(id => tSet.has(id)).length;
                if (overlap >= Math.ceil(ts.bitIds.length * 0.5) && !findCachedName(t.bitIds)) {
                  return { ...t, name, autoNamed: true, lastNamedBitCount: t.bitIds.length };
                }
                return t;
              });
              return { confirmed: prev.confirmed || [], possible: rename(prev.possible || []), rejected: rename(prev.rejected || []) };
            });
          },
          onStatus: (msg) => set('status', msg),
        });
      }
    }, 2000);

    return () => {
      clearTimeout(debounceTimer);
      // Abort in-flight naming when dependencies change or component unmounts
      if (touchstoneNamingController.current) {
        touchstoneNamingController.current.abort();
        touchstoneNamingController.current = null;
      }
    };
  }, [topics, matches, processing]);

  return { touchstoneNameCache, touchstoneNamingController, namingInFlight, findCachedName, setCachedName, runDetection };
}
