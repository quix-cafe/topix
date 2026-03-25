import { useCallback, useEffect, useRef } from "react";
import { detectTouchstones } from "../utils/touchstoneDetector";
import { assembleAndMergeTouchstones } from "../utils/touchstoneAssembler";
import { autoRelateTouchstones } from "../utils/flowRelations";

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

  useEffect(() => {
    if (processing) return;
    const debounceTimer = setTimeout(() => {
      if (topics.length >= 2) {
        // Skip re-detection if topics and matches haven't meaningfully changed
        const detectionKey = `${topics.length}:${matches.length}`;
        if (detectionKey === lastDetectionKey.current) return;
        lastDetectionKey.current = detectionKey;

        const detected = detectTouchstones(topics, matches, 2);
        const prev = stateRef.current.touchstones || {};
        const keyOf = (ts) => [...ts.bitIds].sort().join(",");

        const assembled = assembleAndMergeTouchstones({ detected, previousTouchstones: prev, topics, matches, findCachedName });
        // Carry over _unlinkedPairs from previous state
        assembled._unlinkedPairs = prev._unlinkedPairs || [];
        // Auto-relate touchstones that appear adjacent 3+ times in setlists
        const named = autoRelateTouchstones(assembled, topics);
        set('touchstones', named);

        const toName = named.possible.filter(ts => {
          if (ts.manualName) return false;
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
          const controller = touchstoneNamingController.current || new AbortController();
          if (!touchstoneNamingController.current) touchstoneNamingController.current = controller;

          (async () => {
            const model = stateRef.current.selectedModel;
            for (const ts of toName) {
              if (controller.signal.aborted) break;
              const tsKey = keyOf(ts);
              if (findCachedName(ts.bitIds) || namingInFlight.current.has(tsKey)) continue;
              namingInFlight.current.add(tsKey);

              try {
                const coreIds = ts.coreBitIds || ts.bitIds;
                const coreBits = coreIds.map(id => topics.find(t => t.id === id)).filter(Boolean);
                if (coreBits.length === 0) { namingInFlight.current.delete(tsKey); continue; }

                const coreTexts = coreBits.map(b => (b.fullText || "").substring(0, 600)).join("\n---\n");
                if (!coreTexts.trim()) { namingInFlight.current.delete(tsKey); continue; }

                set('status', `Naming touchstone: "${ts.name}"...`);

                const res = await fetch("http://localhost:11434/api/chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model,
                    messages: [
                      { role: "system", content: "Name this recurring comedy bit based on these performances of the SAME joke. Use the format: '[3-5 word title] or, [5-8 word title]' — the first title is a punchy shorthand, the second is more descriptive. Include the literal text 'or,' between them. Focus on the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'DMV Nightmare or, The Witness Protection Line at the DMV'" },
                      { role: "user", content: `${coreBits.length} performances of the same bit:\n\n${coreTexts}` },
                    ],
                    stream: false, think: false,
                    options: { num_predict: 64, num_ctx: 4096 },
                  }),
                  signal: controller.signal,
                });
                if (!res.ok) { namingInFlight.current.delete(tsKey); continue; }
                const data = await res.json();
                let name = (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
                if (!name || controller.signal.aborted) { namingInFlight.current.delete(tsKey); continue; }

                setCachedName(ts.bitIds, name);

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
                console.log(`[Touchstone] Auto-named "${ts.name}" → "${name}" (core: ${coreIds.length}/${ts.bitIds.length} bits)`);
              } catch (err) {
                if (err.name === "AbortError") { set('status', null); break; }
                console.warn(`[Touchstone] Auto-name failed:`, err.message);
              } finally {
                namingInFlight.current.delete(tsKey);
              }
            }
            set('status', null);
          })();
        }
      } else {
        set('touchstones', { confirmed: [], possible: [], rejected: [] });
      }
    }, 2000);
    return () => clearTimeout(debounceTimer);
  }, [topics, matches, processing]);

  return { touchstoneNameCache, touchstoneNamingController, namingInFlight, findCachedName, setCachedName };
}
