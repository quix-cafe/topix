import { useCallback } from "react";
import { extractCompleteJsonObjects } from "../utils/jsonParser";
import { SYSTEM_DEFINE_MASTER_TAGS } from "../utils/prompts";
import { setEmbedPaused, isEmbedPaused, embedBatch, cosineSimilarity, getEmbedQueueDepth, isEmbedRunning } from "../utils/embeddings";
import { saveVaultState } from "../utils/database";

// Lexical normalizer for Phase 1 pre-pass: lowercase, strip punctuation/whitespace,
// simple suffix stemming. Returns a comparison key, not a display tag.
function normalizeTagKey(tag) {
  let s = (tag || "").toLowerCase().trim().replace(/[\s\-_.,'"`/\\]/g, "");
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("es") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && s.length > 3) s = s.slice(0, -1);
  return s;
}

export function useTagMerge(ctx) {
  const { dispatch, stateRef } = ctx;
  const set = (field, value) => dispatch({ type: 'SET', field, value });
  const update = (field, fn) => dispatch({ type: 'UPDATE', field, fn });

  const onMergeTags = useCallback(async () => {
    const s = stateRef.current;

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
      // ── Phase 1: Lexical pre-pass ──────────────────────────────────
      set('status', `Phase 1: lexical pre-pass on ${allTags.length} tags...`);
      const lexBuckets = new Map();
      for (const [tag, count] of allTags) {
        const k = normalizeTagKey(tag);
        if (!k) continue;
        if (!lexBuckets.has(k)) lexBuckets.set(k, []);
        lexBuckets.get(k).push([tag, count]);
      }

      const lexicalProposals = [];
      const lexicalMap = new Map();
      const survivorCounts = new Map();
      for (const [, members] of lexBuckets) {
        members.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
        const canonical = members[0][0];
        let total = 0;
        for (const [tag, count] of members) {
          total += count;
          if (tag !== canonical) {
            lexicalMap.set(tag, canonical);
            lexicalProposals.push({ from: tag, to: canonical, source: "lexical" });
          }
        }
        survivorCounts.set(canonical, total);
      }

      const survivors = [...survivorCounts.entries()];
      survivors.sort((a, b) => b[1] - a[1]);

      // ── Phase 2: Top-down master list via gemini-thinking ──────────
      const TOP_N = 150;
      const topTags = survivors.slice(0, TOP_N);
      set('status', `Phase 2: asking gemini-thinking to define master list from top ${topTags.length} tags...`);
      const topListMsg = `Here are the comedian's most-used tags with usage counts:\n${topTags.map(([t, c]) => `${t} (${c})`).join(", ")}`;
      const masterRes = await fetch("/api/llm/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gemini", gemini_model: "thinking", system: SYSTEM_DEFINE_MASTER_TAGS, user: topListMsg }),
      });
      const masterData = await masterRes.json();
      if (!masterRes.ok) throw new Error(masterData.error || "Gemini master-list call failed");

      let parsed;
      try { parsed = JSON.parse(masterData.result); }
      catch {
        const ex = extractCompleteJsonObjects(masterData.result);
        parsed = Array.isArray(ex) ? ex[0] : ex;
      }
      const masterList = Array.isArray(parsed?.canonical) ? parsed.canonical
        : Array.isArray(parsed) ? parsed
        : [];
      if (masterList.length === 0) throw new Error("Gemini returned no canonical master tags");

      const masterUniq = [...new Set(masterList.map((t) => String(t).trim()).filter(Boolean))];
      const masterKeyToCanonical = new Map();
      for (const m of masterUniq) masterKeyToCanonical.set(normalizeTagKey(m), m);

      // ── Phase 3: Embed master list + survivors, assign each survivor to nearest master ──
      const ASSIGN_THRESHOLD = 0.78;
      const survivorTags = survivors.map(([t]) => t);
      console.log(`[TagMerge] Phase 3 starting: ${masterUniq.length} masters × ${survivorTags.length} survivors`);

      if (isEmbedPaused()) {
        console.warn("[TagMerge] Embedding queue is paused — auto-resuming for tag merge");
        set('status', "Embedding queue was paused — auto-resuming for tag merge...");
        setEmbedPaused(false);
        await new Promise(r => setTimeout(r, 100));
      }

      const runEmbedWithWatchdog = async (label, items) => {
        const t0 = performance.now();
        let lastProgressAt = performance.now();
        let lastDone = 0;
        let totalKnown = items.length;
        let watchdogActive = true;

        const queueDepth = getEmbedQueueDepth();
        if (queueDepth > 0 || isEmbedRunning()) {
          set('status', `${label}: waiting for embed queue (${queueDepth} task${queueDepth !== 1 ? "s" : ""} ahead${isEmbedRunning() ? " + 1 running" : ""})...`);
        } else {
          set('status', `${label}: embedding ${items.length} tag${items.length !== 1 ? "s" : ""} (starting)...`);
        }

        const watchdog = setInterval(() => {
          if (!watchdogActive) return;
          const stalledMs = performance.now() - lastProgressAt;
          if (stalledMs > 5000) {
            const qd = getEmbedQueueDepth();
            const running = isEmbedRunning();
            const paused = isEmbedPaused();
            const stalledSec = Math.round(stalledMs / 1000);
            set('status', `${label}: ${lastDone}/${totalKnown} — no progress for ${stalledSec}s${paused ? " · PAUSED" : ""}${qd > 0 ? ` · queue=${qd}` : ""}${running ? " · embed running" : ""}`);
            console.warn(`[TagMerge] ${label} stalled ${stalledSec}s — paused=${paused}, queueDepth=${qd}, running=${running}, lastDone=${lastDone}/${totalKnown}`);
          }
        }, 2000);

        try {
          const vectors = await embedBatch(items, s.embeddingModel || "mxbai-embed-large", ({ textsDone, textsTotal }) => {
            lastProgressAt = performance.now();
            lastDone = textsDone;
            totalKnown = textsTotal;
            set('status', `${label}: ${textsDone}/${textsTotal} (${Math.round((textsDone / textsTotal) * 100)}%)`);
          });
          console.log(`[TagMerge] ${label} done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
          return vectors;
        } finally {
          watchdogActive = false;
          clearInterval(watchdog);
        }
      };

      const masterVectors = await runEmbedWithWatchdog("Phase 3a (masters)", masterUniq);
      const survivorVectors = await runEmbedWithWatchdog("Phase 3b (survivors)", survivorTags);

      set('status', `Phase 3c: assigning ${survivorTags.length} survivors to nearest master...`);
      const assignT0 = performance.now();
      const masterProposals = [];
      const masterMap = new Map();
      let unchanged = 0;
      let exactMatches = 0;
      let assigned = 0;
      let belowThreshold = 0;
      const PROGRESS_EVERY = Math.max(1, Math.floor(survivorTags.length / 50));

      for (let i = 0; i < survivorTags.length; i++) {
        const tag = survivorTags[i];
        const tagKey = normalizeTagKey(tag);
        const directMaster = masterKeyToCanonical.get(tagKey);
        if (directMaster) {
          if (directMaster !== tag) {
            masterProposals.push({ from: tag, to: directMaster, source: "master-exact", score: 1 });
            masterMap.set(tag, directMaster);
            exactMatches++;
          } else {
            unchanged++;
          }
        } else {
          let best = -Infinity, bestIdx = -1;
          for (let j = 0; j < masterVectors.length; j++) {
            const sim = cosineSimilarity(survivorVectors[i], masterVectors[j]);
            if (sim > best) { best = sim; bestIdx = j; }
          }
          if (bestIdx >= 0 && best >= ASSIGN_THRESHOLD) {
            const target = masterUniq[bestIdx];
            if (target !== tag) {
              masterProposals.push({ from: tag, to: target, source: "master", score: best });
              masterMap.set(tag, target);
              assigned++;
            } else {
              unchanged++;
            }
          } else {
            belowThreshold++;
            unchanged++;
          }
        }

        if ((i + 1) % PROGRESS_EVERY === 0 || i === survivorTags.length - 1) {
          set('status', `Phase 3c: assigning ${i + 1}/${survivorTags.length} (${Math.round(((i + 1) / survivorTags.length) * 100)}%) — ${assigned} assigned, ${exactMatches} exact, ${belowThreshold} below threshold`);
          await new Promise(r => setTimeout(r, 0));
        }
      }
      console.log(`[TagMerge] Assignment done in ${((performance.now() - assignT0) / 1000).toFixed(1)}s — assigned=${assigned}, exact=${exactMatches}, unchanged=${unchanged}, belowThreshold=${belowThreshold}`);

      // ── Combine: lexical + master, resolve chains ─────────────────
      const finalMap = new Map(lexicalMap);
      for (const [from, to] of masterMap) finalMap.set(from, to);
      for (const [from, to] of finalMap) {
        let resolved = to, depth = 0;
        while (finalMap.has(resolved) && depth < 10) { resolved = finalMap.get(resolved); depth++; }
        if (resolved !== to) finalMap.set(from, resolved);
      }

      const proposals = [];
      for (const p of lexicalProposals) {
        const finalTo = finalMap.get(p.from) || p.to;
        proposals.push({ ...p, to: finalTo });
      }
      for (const p of masterProposals) {
        const finalTo = finalMap.get(p.from) || p.to;
        proposals.push({ ...p, to: finalTo });
      }

      if (proposals.length === 0) {
        set('status', 'Pipeline complete — no merges proposed.');
        set('processing', false);
        return;
      }

      set('tagMergePreview', { proposals, unchanged, masterCount: masterUniq.length });
      set('status', `Proposed ${proposals.length} merge(s) across ${new Set(proposals.map(p => p.to)).size} canonical tag(s). Review and confirm.`);
      set('processing', false);
    } catch (err) {
      set('status', `Tag merge failed: ${err.message}`);
      set('processing', false);
    }
  }, []);

  const onConfirmMergePreview = useCallback(async () => {
    const s = stateRef.current;
    const preview = s.tagMergePreview;
    if (!preview || !preview.proposals?.length) return;

    set('processing', true);
    set('status', 'Applying tag merges...');

    const finalMap = new Map();
    for (const p of preview.proposals) finalMap.set(p.from, p.to);

    update('topics', (prev) => prev.map((t) => {
      if (!t.tags || t.tags.length === 0) return t;
      const newTags = [...new Set(t.tags.map((tag) => finalMap.get(tag) || tag))];
      if (newTags.length === t.tags.length && newTags.every((tag, i) => tag === t.tags[i])) return t;
      return { ...t, tags: newTags };
    }));

    const mergeGroups = new Map();
    for (const [from, to] of finalMap) {
      if (!mergeGroups.has(to)) mergeGroups.set(to, []);
      mergeGroups.get(to).push(from);
    }
    const descriptions = [...mergeGroups.entries()].map(([into, froms]) => `${froms.join(", ")} → ${into}`);
    set('tagMergeResult', descriptions);
    set('tagMergePreview', null);
    set('status', `Merged ${finalMap.size} tag(s) into ${mergeGroups.size} group(s).`);
    set('processing', false);

    setTimeout(async () => {
      const s2 = stateRef.current;
      try { await saveVaultState({ topics: s2.topics, matches: s2.matches, transcripts: s2.transcripts, touchstones: s2.touchstones }); } catch {}
    }, 100);
  }, []);

  const onCancelMergePreview = useCallback(() => {
    set('tagMergePreview', null);
    set('status', 'Tag merge canceled.');
  }, []);

  return { onMergeTags, onConfirmMergePreview, onCancelMergePreview };
}
