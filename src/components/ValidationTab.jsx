import { useState, useMemo, useRef } from "react";
import { validateAllBits, autoCorrectPosition } from "../utils/textContinuityValidator";
import { SYSTEM_PARSE_V3 } from "../utils/prompts";
import { extractCompleteJsonObjects } from "../utils/jsonParser";

/**
 * ValidationTab - Shows all bit validation issues with rectification UI
 */
export function ValidationTab({
  topics,
  transcripts,
  touchstones,
  matches,
  filter,
  onFilterChange,
  onUpdateBitPosition,
  onGoToMix,
  onSelectBit,
  approvedGaps,
  onApproveGap,
  onRevalidateBits,
  onJoinBits,
  onReParseGap,
  onImportGapBits,
  onDeleteBit,
  batchFixing,
  setBatchFixing,
  batchProgress,
  setBatchProgress,
  batchStopRef,
  universalCorrections = [],
  onUpdateUniversalCorrections,
}) {
  const [expandedIssue, setExpandedIssue] = useState(null);
  const [autoFixing, setAutoFixing] = useState(null);
  const [newCorrFrom, setNewCorrFrom] = useState("");
  const [newCorrTo, setNewCorrTo] = useState("");
  const [newCorrPattern, setNewCorrPattern] = useState(false);
  const [gapGeminiModel, setGapGeminiModel] = useState("thinking");
  const setFilter = onFilterChange;

  // Build transcript map
  const transcriptMap = useMemo(() => {
    const map = {};
    transcripts.forEach((tr) => {
      map[tr.name] = tr;
      map[tr.id] = tr;
    });
    return map;
  }, [transcripts]);

  // Run validation
  const validation = useMemo(
    () => validateAllBits(topics, transcripts),
    [topics, transcripts]
  );

  // Detect significant gaps in transcript coverage
  const gapIssues = useMemo(() => {
    const MIN_GAP_CHARS = 100; // Only show gaps >= 100 chars
    const gaps = [];
    const approvedSet = new Set(approvedGaps || []);
    for (const tr of transcripts) {
      const trBits = topics
        .filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
        .filter((t) => t.textPosition && t.textPosition.endChar > t.textPosition.startChar)
        .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);
      if (trBits.length === 0) continue;
      const cleanText = tr.text.replace(/\n/g, " ");
      // Leading gap
      const firstStart = trBits[0].textPosition.startChar;
      if (firstStart >= MIN_GAP_CHARS) {
        const gapKey = `${tr.name}:0-${firstStart}`;
        gaps.push({
          bitId: null, bitTitle: `Gap in "${tr.name}"`, source: tr.name,
          error: `Uncovered gap: chars 0-${firstStart} (${firstStart} chars)`,
          severity: firstStart, type: "gap", gapStart: 0, gapEnd: firstStart,
          gapKey, approved: approvedSet.has(gapKey),
          gapPreview: cleanText.substring(0, Math.min(firstStart, 600)),
        });
      }
      // Inter-bit gaps
      for (let i = 0; i < trBits.length - 1; i++) {
        const gapStart = trBits[i].textPosition.endChar;
        const gapEnd = trBits[i + 1].textPosition.startChar;
        const gapSize = gapEnd - gapStart;
        if (gapSize >= MIN_GAP_CHARS) {
          const gapKey = `${tr.name}:${gapStart}-${gapEnd}`;
          gaps.push({
            bitId: trBits[i].id, bitTitle: `Gap after "${trBits[i].title}"`, source: tr.name,
            error: `Uncovered gap: chars ${gapStart}-${gapEnd} (${gapSize} chars)`,
            severity: gapSize, type: "gap", gapStart, gapEnd,
            gapKey, approved: approvedSet.has(gapKey),
            gapPreview: cleanText.substring(gapStart, Math.min(gapEnd, gapStart + 600)),
          });
        }
      }
      // Trailing gap
      const lastEnd = trBits[trBits.length - 1].textPosition.endChar;
      const trailingSize = cleanText.length - lastEnd;
      if (trailingSize >= MIN_GAP_CHARS) {
        const gapKey = `${tr.name}:${lastEnd}-${cleanText.length}`;
        gaps.push({
          bitId: null, bitTitle: `Gap at end of "${tr.name}"`, source: tr.name,
          error: `Uncovered gap: chars ${lastEnd}-${cleanText.length} (${trailingSize} chars)`,
          severity: trailingSize, type: "gap", gapStart: lastEnd, gapEnd: cleanText.length,
          gapKey, approved: approvedSet.has(gapKey),
          gapPreview: cleanText.substring(lastEnd, Math.min(cleanText.length, lastEnd + 600)),
        });
      }
    }
    return gaps;
  }, [topics, transcripts, approvedGaps]);

  // Detect adjacent bits in the same transcript that belong to the same touchstone
  const joinSuggestions = useMemo(() => {
    const allTs = [
      ...(touchstones?.confirmed || []),
      ...(touchstones?.possible || []),
    ];
    if (allTs.length === 0) return [];

    // Build bitId → touchstone(s) lookup
    const bitToTouchstones = new Map();
    for (const ts of allTs) {
      for (const bitId of ts.bitIds || []) {
        if (!bitToTouchstones.has(bitId)) bitToTouchstones.set(bitId, []);
        bitToTouchstones.get(bitId).push(ts);
      }
    }

    const suggestions = [];

    for (const tr of transcripts) {
      // Get bits for this transcript, sorted by position
      const trBits = topics
        .filter((t) => t.sourceFile === tr.name || t.transcriptId === tr.id)
        .filter((t) => t.textPosition && t.textPosition.startChar != null)
        .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);

      if (trBits.length < 2) continue;

      // For each touchstone, find runs of adjacent bits
      const touchstoneRuns = new Map(); // tsId → array of bit indices in trBits

      for (let i = 0; i < trBits.length; i++) {
        const bitTs = bitToTouchstones.get(trBits[i].id) || [];
        for (const ts of bitTs) {
          if (!touchstoneRuns.has(ts.id)) touchstoneRuns.set(ts.id, []);
          touchstoneRuns.get(ts.id).push(i);
        }
      }

      for (const [tsId, indices] of touchstoneRuns) {
        if (indices.length < 2) continue;
        const ts = allTs.find((t) => t.id === tsId);

        // Find runs of consecutive indices (adjacent in transcript order)
        let runStart = 0;
        for (let i = 1; i <= indices.length; i++) {
          if (i < indices.length && indices[i] === indices[i - 1] + 1) continue;
          // End of a run: indices[runStart..i-1]
          const runLen = i - runStart;
          if (runLen >= 2) {
            const runBits = [];
            for (let j = runStart; j < i; j++) {
              runBits.push(trBits[indices[j]]);
            }
            const titles = runBits.map((b) => `"${b.title}"`).join(", ");
            suggestions.push({
              bitId: runBits[0].id,
              bitTitle: `Join ${runLen} adjacent bits`,
              source: tr.name,
              error: `${runLen} adjacent bits all match touchstone "${ts.name || ts.manualName || "unnamed"}": ${titles}`,
              severity: runLen * 100,
              type: "join",
              joinBitIds: runBits.map((b) => b.id),
              touchstoneName: ts.name || ts.manualName || "unnamed",
              touchstoneId: tsId,
            });
          }
          runStart = i;
        }
      }
    }

    return suggestions;
  }, [topics, transcripts, touchstones]);

  // Collect all word corrections from touchstones for the transcription category
  const transcriptionIssues = useMemo(() => {
    const allTs = [
      ...(touchstones?.confirmed || []),
      ...(touchstones?.possible || []),
      ...(touchstones?.rejected || []),
    ];
    const corrections = [];
    const universalSet = new Set(universalCorrections.map(c => `${c.from}→${c.to}`));

    for (const ts of allTs) {
      for (const c of ts.corrections || []) {
        corrections.push({
          type: "transcription",
          bitId: null,
          bitTitle: `"${c.from}" → "${c.to}"`,
          source: ts.name || "unnamed",
          error: `Touchstone "${ts.name || 'unnamed'}" corrects "${c.from}" → "${c.to}"`,
          severity: 10,
          correctionFrom: c.from,
          correctionTo: c.to,
          touchstoneId: ts.id,
          touchstoneName: ts.name || "unnamed",
          isUniversal: universalSet.has(`${c.from}→${c.to}`),
        });
      }
    }

    // Add universal corrections not already represented by a touchstone
    for (const c of universalCorrections) {
      const key = `${c.from}→${c.to}`;
      if (!corrections.some(cr => `${cr.correctionFrom}→${cr.correctionTo}` === key)) {
        corrections.push({
          type: "transcription",
          bitId: null,
          bitTitle: `"${c.from}" → "${c.to}"`,
          source: "universal",
          error: `Universal correction: "${c.from}" → "${c.to}"${c.pattern ? " (pattern)" : ""}`,
          severity: 10,
          correctionFrom: c.from,
          correctionTo: c.to,
          touchstoneId: null,
          touchstoneName: null,
          isUniversal: true,
          isPattern: !!c.pattern,
        });
      }
    }

    // Deduplicate by from→to
    const seen = new Map();
    for (const c of corrections) {
      const key = `${c.correctionFrom}→${c.correctionTo}`;
      if (!seen.has(key)) {
        seen.set(key, { ...c, touchstoneNames: [c.touchstoneName].filter(Boolean) });
      } else {
        const existing = seen.get(key);
        if (c.touchstoneName && !existing.touchstoneNames.includes(c.touchstoneName)) {
          existing.touchstoneNames.push(c.touchstoneName);
        }
        if (c.isUniversal) existing.isUniversal = true;
      }
    }

    return [...seen.values()];
  }, [touchstones, universalCorrections]);

  // Categorize issues (excluding trivial ones <= 10 chars)
  const categorized = useMemo(() => {
    const cats = { overlap: [], mismatch: [], missing: [], bounds: [], gap: [], join: [], transcription: [] };
    (validation.issues || []).filter((issue) => (issue.severity || 0) > 10).forEach((issue) => {
      if (issue.error.includes("Overlaps with")) cats.overlap.push(issue);
      else if (issue.error.includes("mismatch") || issue.error.includes("similarity")) cats.mismatch.push(issue);
      else if (issue.error.includes("not found") || issue.error.includes("No position")) cats.missing.push(issue);
      else cats.bounds.push(issue);
    });
    cats.gap = gapIssues.filter((g) => !g.approved);
    cats.join = joinSuggestions;
    cats.transcription = transcriptionIssues;
    return cats;
  }, [validation, gapIssues, joinSuggestions, transcriptionIssues]);

  const allIssues = useMemo(() => {
    const base = (validation.issues || []).filter((issue) => (issue.severity || 0) > 10);
    const unapprovedGaps = gapIssues.filter((g) => !g.approved);
    return [...base, ...unapprovedGaps, ...joinSuggestions, ...transcriptionIssues];
  }, [validation, gapIssues, joinSuggestions, transcriptionIssues]);

  const filteredIssues = (filter === "all"
    ? allIssues
    : categorized[filter] || [])
    .sort((a, b) => (b.severity || 0) - (a.severity || 0));

  const [lastFixResult, setLastFixResult] = useState(null); // {bitId, result: "fixed"|"no_match"|"no_transcript"|"no_bit"}

  const handleAutoFix = async (issue) => {
    const bit = topics.find((t) => t.id === issue.bitId);
    if (!bit) { setLastFixResult({ bitId: issue.bitId, result: "no_bit" }); return; }

    const transcript = transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId];
    if (!transcript) { setLastFixResult({ bitId: issue.bitId, result: "no_transcript" }); return; }

    setAutoFixing(issue.bitId);
    try {
      const cleanText = transcript.text.replace(/\n/g, " ");
      const found = findTextPosition(bit.fullText, cleanText, bit.textPosition);

      if (found) {
        await onUpdateBitPosition(issue.bitId, { startChar: found.startChar, endChar: found.endChar });
        setLastFixResult({ bitId: issue.bitId, result: "fixed", method: found.method });
      } else {
        setLastFixResult({ bitId: issue.bitId, result: "no_match" });
      }
    } catch (err) {
      console.error("[AutoFix] Error:", err);
      setLastFixResult({ bitId: issue.bitId, result: "error" });
    }
    setAutoFixing(null);
  };

  // Smart position finder: tries multiple strategies to locate stored text in transcript.
  // The stored fullText is authoritative — we just need to find where it lives.
  const findTextPosition = (storedText, transcriptText, currentPos) => {
    const needle = storedText.trim();
    if (!needle) return null;

    // 1. Exact match
    const exact = transcriptText.indexOf(needle);
    if (exact !== -1) return { startChar: exact, endChar: exact + needle.length, method: "exact" };

    // 2. Whitespace-normalized match (collapse runs of whitespace to single space)
    const normalize = (s) => s.replace(/\s+/g, " ").trim();
    const normNeedle = normalize(needle);
    const normHaystack = normalize(transcriptText);
    const normPos = normHaystack.indexOf(normNeedle);
    if (normPos !== -1) {
      // Map normalized position back to original position
      let origIdx = 0, normIdx = 0;
      while (normIdx < normPos && origIdx < transcriptText.length) {
        if (/\s/.test(transcriptText[origIdx])) {
          while (origIdx < transcriptText.length && /\s/.test(transcriptText[origIdx])) origIdx++;
          normIdx++; // normalized has single space
        } else {
          origIdx++;
          normIdx++;
        }
      }
      const startChar = origIdx;
      // Now walk through the needle length in the original
      let needleNormIdx = 0;
      while (needleNormIdx < normNeedle.length && origIdx < transcriptText.length) {
        if (/\s/.test(transcriptText[origIdx])) {
          while (origIdx < transcriptText.length && /\s/.test(transcriptText[origIdx])) origIdx++;
          needleNormIdx++;
        } else {
          origIdx++;
          needleNormIdx++;
        }
      }
      return { startChar, endChar: origIdx, method: "whitespace-normalized" };
    }

    // 3. Anchor search: find a distinctive chunk from the stored text, then expand
    //    Use a ~80 char substring from 20% into the text (avoids noisy edges)
    const anchorLen = Math.min(80, Math.floor(needle.length * 0.4));
    if (anchorLen >= 30) {
      const anchorStart = Math.floor(needle.length * 0.2);
      const anchor = needle.substring(anchorStart, anchorStart + anchorLen);
      const anchorPos = transcriptText.indexOf(anchor);
      if (anchorPos !== -1) {
        // Found anchor — estimate full bit boundaries
        const estStart = Math.max(0, anchorPos - anchorStart);
        const estEnd = Math.min(transcriptText.length, estStart + needle.length);
        return { startChar: estStart, endChar: estEnd, method: "anchor" };
      }
      // Try normalized anchor
      const normAnchor = normalize(anchor);
      const normAnchorPos = normHaystack.indexOf(normAnchor);
      if (normAnchorPos !== -1) {
        // Map back to original
        let origI = 0, normI = 0;
        while (normI < normAnchorPos && origI < transcriptText.length) {
          if (/\s/.test(transcriptText[origI])) {
            while (origI < transcriptText.length && /\s/.test(transcriptText[origI])) origI++;
            normI++;
          } else { origI++; normI++; }
        }
        const estStart = Math.max(0, origI - anchorStart);
        const estEnd = Math.min(transcriptText.length, estStart + needle.length);
        return { startChar: estStart, endChar: estEnd, method: "anchor-normalized" };
      }
    }

    // 4. Neighborhood search: if we have a current position, search ±500 chars around it
    //    using word-level matching to find best alignment
    if (currentPos && currentPos.startChar != null) {
      const searchStart = Math.max(0, currentPos.startChar - 500);
      const searchEnd = Math.min(transcriptText.length, currentPos.endChar + 500);
      const neighborhood = transcriptText.substring(searchStart, searchEnd);

      const needleWords = needle.toLowerCase().match(/\b\w{2,}\b/g) || [];
      if (needleWords.length >= 3) {
        // Sliding window: find the window of ~needle.length chars with best word overlap
        const windowSize = needle.length;
        let bestScore = 0, bestOffset = 0;
        const step = Math.max(1, Math.floor(windowSize / 20));
        for (let off = 0; off <= neighborhood.length - Math.floor(windowSize * 0.5); off += step) {
          const window = neighborhood.substring(off, off + windowSize);
          const windowWords = window.toLowerCase().match(/\b\w{2,}\b/g) || [];
          const windowSet = new Set(windowWords);
          const overlap = needleWords.filter((w) => windowSet.has(w)).length;
          const score = overlap / needleWords.length;
          if (score > bestScore) { bestScore = score; bestOffset = off; }
        }
        if (bestScore >= 0.7) {
          const startChar = searchStart + bestOffset;
          const endChar = Math.min(transcriptText.length, startChar + needle.length);
          return { startChar, endChar, method: `neighborhood (${Math.round(bestScore * 100)}% words)` };
        }
      }
    }

    return null;
  };

  // Batch fix: mismatch — stored text is correct, find its exact position in transcript
  const handleBatchFixMismatch = async () => {
    const issues = categorized.mismatch;
    if (issues.length === 0) return;
    batchStopRef.current = false;
    setBatchFixing("mismatch");
    setBatchProgress({ done: 0, total: issues.length, fixed: 0, skipped: 0 });
    let fixed = 0, skipped = 0;
    for (let i = 0; i < issues.length; i++) {
      if (batchStopRef.current) break;
      const issue = issues[i];
      const bit = topics.find((t) => t.id === issue.bitId);
      if (!bit?.fullText) { skipped++; setBatchProgress({ done: i + 1, total: issues.length, fixed, skipped }); continue; }
      const transcript = transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId];
      if (!transcript) { skipped++; setBatchProgress({ done: i + 1, total: issues.length, fixed, skipped }); continue; }
      const cleanText = transcript.text.replace(/\n/g, " ");
      const found = findTextPosition(bit.fullText, cleanText, bit.textPosition);
      if (found) {
        await onUpdateBitPosition(issue.bitId, { startChar: found.startChar, endChar: found.endChar });
        fixed++;
      } else {
        skipped++;
      }
      setBatchProgress({ done: i + 1, total: issues.length, fixed, skipped });
    }
    setBatchFixing(null);
    setBatchProgress(null);
  };

  // Batch fix: gaps — re-parse each gap region
  const handleBatchFixGaps = async () => {
    const issues = categorized.gap;
    if (issues.length === 0 || !onReParseGap) return;
    batchStopRef.current = false;
    setBatchFixing("gap");
    setBatchProgress({ done: 0, total: issues.length });
    for (let i = 0; i < issues.length; i++) {
      if (batchStopRef.current) break;
      const issue = issues[i];
      const transcript = transcriptMap[issue.source];
      if (!transcript) continue;
      const cleanText = transcript.text.replace(/\n/g, " ");
      const gapText = cleanText.substring(issue.gapStart, issue.gapEnd);
      await onReParseGap(gapText, issue.gapStart, issue.gapEnd, transcript.name, transcript.id);
      setBatchProgress({ done: i + 1, total: issues.length });
    }
    setBatchFixing(null);
    setBatchProgress(null);
  };

  // Batch fix: gaps via external LLM (Gemini/Claude)
  const handleBatchFixGapsExternal = async (provider, geminiModel) => {
    const issues = categorized.gap;
    if (issues.length === 0 || !onImportGapBits) return;
    batchStopRef.current = false;
    setBatchFixing("gap");
    setBatchProgress({ done: 0, total: issues.length });
    for (let i = 0; i < issues.length; i++) {
      if (batchStopRef.current) break;
      const issue = issues[i];
      const transcript = transcriptMap[issue.source];
      if (!transcript) continue;
      const cleanText = transcript.text.replace(/\n/g, " ");
      const gapText = cleanText.substring(issue.gapStart, issue.gapEnd);
      try {
        const res = await fetch("/api/llm/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            system: SYSTEM_PARSE_V3,
            user: `Parse this comedy transcript excerpt:\n\n${gapText}`,
            ...(geminiModel && { gemini_model: geminiModel }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "API call failed");
        let parsed;
        try { parsed = JSON.parse(data.result); } catch { parsed = extractCompleteJsonObjects(data.result); }
        if (Array.isArray(parsed) && parsed.length > 0) {
          await onImportGapBits(parsed, issue.gapStart, issue.gapEnd, transcript.name, transcript.id);
        }
      } catch (e) {
        console.error(`[BatchGapExternal] Error on gap ${i + 1}:`, e.message);
      }
      setBatchProgress({ done: i + 1, total: issues.length });
    }
    setBatchFixing(null);
    setBatchProgress(null);
  };

  // Batch fix: joins — auto-join each group of adjacent bits
  const handleBatchFixJoins = async () => {
    const issues = categorized.join;
    if (issues.length === 0 || !onJoinBits) return;
    batchStopRef.current = false;
    setBatchFixing("join");
    setBatchProgress({ done: 0, total: issues.length });
    for (let i = 0; i < issues.length; i++) {
      if (batchStopRef.current) break;
      const issue = issues[i];
      const bitsToJoin = issue.joinBitIds.map((id) => topics.find((t) => t.id === id)).filter(Boolean);
      if (bitsToJoin.length < 2) { setBatchProgress({ done: i + 1, total: issues.length }); continue; }
      bitsToJoin.sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));
      const transcript = transcriptMap[bitsToJoin[0].sourceFile] || transcriptMap[bitsToJoin[0].transcriptId];
      const cleanText = transcript ? transcript.text.replace(/\n/g, " ") : "";
      const startChar = bitsToJoin[0].textPosition?.startChar || 0;
      const endChar = bitsToJoin[bitsToJoin.length - 1].textPosition?.endChar || 0;
      const joinedBit = {
        title: bitsToJoin[0].title,
        fullText: cleanText ? cleanText.substring(startChar, endChar) : bitsToJoin.map((b) => b.fullText).join(" "),
        summary: bitsToJoin[0].summary,
        tags: [...new Set(bitsToJoin.flatMap((b) => b.tags || []))],
        keywords: [...new Set(bitsToJoin.flatMap((b) => b.keywords || []))],
        textPosition: { startChar, endChar },
        sourceFile: bitsToJoin[0].sourceFile,
        transcriptId: bitsToJoin[0].transcriptId,
        editHistory: [{ timestamp: Date.now(), action: "join", details: { joined: bitsToJoin.map((b) => b.id) } }],
      };
      await onJoinBits(bitsToJoin, joinedBit);
      setBatchProgress({ done: i + 1, total: issues.length });
    }
    setBatchFixing(null);
    setBatchProgress(null);
  };

  // Batch fix: overlaps — find large double-parsed bits trampling smaller ones, delete the large one
  const handleBatchFixOverlaps = async () => {
    const issues = categorized.overlap;
    if (issues.length === 0 || !onDeleteBit) return;
    batchStopRef.current = false;
    setBatchFixing("overlap");

    const bitsToDelete = new Set();
    for (const issue of issues) {
      const bitA = topics.find((t) => t.id === issue.bitId);
      const bitB = topics.find((t) => t.id === issue.overlappingBitId);
      if (!bitA || !bitB) continue;
      if (bitsToDelete.has(bitA.id) || bitsToDelete.has(bitB.id)) continue;

      const startA = bitA.textPosition?.startChar || 0;
      const endA = bitA.textPosition?.endChar || 0;
      const startB = bitB.textPosition?.startChar || 0;
      const endB = bitB.textPosition?.endChar || 0;
      const sizeA = endA - startA;
      const sizeB = endB - startB;
      const overlapStart = Math.max(startA, startB);
      const overlapEnd = Math.min(endA, endB);
      const overlapSize = Math.max(0, overlapEnd - overlapStart);
      const smallerSize = Math.min(sizeA, sizeB);

      // If overlap covers >50% of the smaller bit, delete the larger (likely double-parse)
      if (smallerSize > 0 && overlapSize / smallerSize > 0.5) {
        bitsToDelete.add(sizeA >= sizeB ? bitA.id : bitB.id);
      }
    }

    setBatchProgress({ done: 0, total: bitsToDelete.size });
    let done = 0;
    for (const bitId of bitsToDelete) {
      if (batchStopRef.current) break;
      await onDeleteBit(bitId);
      done++;
      setBatchProgress({ done, total: bitsToDelete.size });
    }

    setBatchFixing(null);
    setBatchProgress(null);
  };

  const categoryColors = {
    overlap: { bg: "#ff6b6b", label: "Overlap" },
    mismatch: { bg: "#ffa94d", label: "Text Mismatch" },
    missing: { bg: "#a78bfa", label: "Missing Data" },
    bounds: { bg: "#74c0fc", label: "Bounds Error" },
    gap: { bg: "#c4b5fd", label: "Gap" },
    join: { bg: "#4ecdc4", label: "Join" },
    transcription: { bg: "#f783ac", label: "Transcription" },
  };

  const batchFixLabels = {
    mismatch: "Fix All Mismatches",
    gap: "Re-parse All Gaps",
    join: "Join All",
    overlap: "Fix Overlaps",
  };

  const getIssueCategory = (issue) => {
    if (issue.type === "transcription") return "transcription";
    if (issue.type === "join") return "join";
    if (issue.type === "gap") return "gap";
    if (issue.error.includes("Overlaps with")) return "overlap";
    if (issue.error.includes("mismatch") || issue.error.includes("similarity")) return "mismatch";
    if (issue.error.includes("not found") || issue.error.includes("No position")) return "missing";
    return "bounds";
  };

  if (topics.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#444" }}>
        No bits to validate. Parse some transcripts first.
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 0",
        borderBottom: "1px solid #1e1e30",
        marginBottom: 16,
      }}>
        <div style={{
          fontSize: 24,
          color: filteredIssues.length === 0 ? "#4ecdc4" : "#ff6b6b",
        }}>
          {filteredIssues.length === 0 ? "\u2713" : "\u26A0"}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: filteredIssues.length === 0 ? "#4ecdc4" : "#ff6b6b" }}>
            {filteredIssues.length === 0
              ? "All bits valid"
              : `${filteredIssues.length} issue${filteredIssues.length !== 1 ? "s" : ""} found`}
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {validation.summary.total} bits total across {transcripts.length} transcript{transcripts.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Category counts */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.entries(categoryColors).map(([key, { bg, label }]) => {
            const count = categorized[key].length;
            if (count === 0) return null;
            return (
              <div
                key={key}
                onClick={() => setFilter(filter === key ? "all" : key)}
                style={{
                  padding: "4px 10px",
                  background: filter === key ? bg : `${bg}20`,
                  color: filter === key ? "#000" : bg,
                  borderRadius: "12px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {count} {label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Batch fix button for filtered category */}
      {filter !== "all" && batchFixLabels[filter] && filteredIssues.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => {
              if (batchFixing) return;
              if (filter === "mismatch") handleBatchFixMismatch();
              else if (filter === "gap") handleBatchFixGaps();
              else if (filter === "join") handleBatchFixJoins();
              else if (filter === "overlap") handleBatchFixOverlaps();
            }}
            disabled={!!batchFixing}
            style={{
              padding: "8px 16px",
              background: batchFixing === filter ? "#33333a" : `${categoryColors[filter]?.bg || "#888"}22`,
              border: `1px solid ${categoryColors[filter]?.bg || "#888"}44`,
              color: batchFixing === filter ? "#666" : categoryColors[filter]?.bg || "#888",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: batchFixing ? "default" : "pointer",
            }}
          >
            {batchFixing === filter
              ? batchProgress
                ? `${batchProgress.done}/${batchProgress.total}${batchProgress.fixed != null ? ` (${batchProgress.fixed} fixed` + (batchProgress.skipped ? `, ${batchProgress.skipped} skipped` : "") + `)` : ""}...`
                : "Working..."
              : `${batchFixLabels[filter]} (${filteredIssues.length})`}
          </button>
          {batchFixing && (
            <button
              onClick={() => { batchStopRef.current = true; }}
              style={{
                padding: "8px 16px",
                background: "#ff6b6b",
                border: "none",
                color: "#fff",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Stop
            </button>
          )}
          {filter === "overlap" && !batchFixing && (
            <span style={{ fontSize: 10, color: "#888" }}>
              Deletes large double-parsed bits that overlap 2+ smaller bits
            </span>
          )}
          {filter === "gap" && !batchFixing && onImportGapBits && (
            <>
              <span style={{ fontSize: 10, color: "#555" }}>or</span>
              <select
                value={gapGeminiModel}
                onChange={(e) => setGapGeminiModel(e.target.value)}
                style={{ background: "#0d0d16", border: "1px solid #333", borderRadius: 4, color: "#4285f4", fontSize: 11, padding: "4px 6px", fontWeight: 600 }}
              >
                <option value="thinking">Gemini Thinking</option>
                <option value="pro">Gemini Pro</option>
                <option value="flash">Gemini Flash</option>
                <option value="claude">Claude Sonnet</option>
              </select>
              <button
                onClick={() => {
                  if (batchFixing) return;
                  const provider = gapGeminiModel === "claude" ? "claude" : "gemini";
                  const model = gapGeminiModel === "claude" ? undefined : gapGeminiModel;
                  handleBatchFixGapsExternal(provider, model);
                }}
                style={{
                  padding: "8px 16px",
                  background: gapGeminiModel === "claude" ? "#c4946a22" : "#4285f422",
                  border: `1px solid ${gapGeminiModel === "claude" ? "#c4946a44" : "#4285f444"}`,
                  color: gapGeminiModel === "claude" ? "#c4946a" : "#4285f4",
                  borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}
              >
                Send to {gapGeminiModel === "claude" ? "Claude" : `Gemini ${gapGeminiModel.charAt(0).toUpperCase() + gapGeminiModel.slice(1)}`} ({filteredIssues.length})
              </button>
            </>
          )}
          {filter === "gap" && !batchFixing && !onImportGapBits && (
            <span style={{ fontSize: 10, color: "#888" }}>
              Re-parses each gap region with the LLM
            </span>
          )}
          {filter === "mismatch" && !batchFixing && (
            <span style={{ fontSize: 10, color: "#888" }}>
              Finds exact position of stored text in transcript (skips fuzzy matches)
            </span>
          )}
        </div>
      )}

      {/* Add new universal correction (transcription filter only) */}
      {filter === "transcription" && onUpdateUniversalCorrections && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", padding: "10px 14px",
          background: "#12121f", border: "1px solid #1e1e30", borderRadius: 8, marginBottom: 12,
        }}>
          <span style={{ fontSize: 10, color: "#f783ac", fontWeight: 600, flexShrink: 0 }}>New:</span>
          <input
            type="text" value={newCorrFrom} onChange={(e) => setNewCorrFrom(e.target.value)}
            placeholder="Wrong word(s)" style={{ flex: 1, padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ff8888", fontSize: 11, fontFamily: "inherit" }}
          />
          <span style={{ color: "#555", fontSize: 11 }}>&rarr;</span>
          <input
            type="text" value={newCorrTo} onChange={(e) => setNewCorrTo(e.target.value)}
            placeholder="Correct word(s)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCorrFrom.trim() && newCorrTo.trim()) {
                onUpdateUniversalCorrections([...universalCorrections, { from: newCorrFrom.trim(), to: newCorrTo.trim(), pattern: newCorrPattern }]);
                setNewCorrFrom(""); setNewCorrTo(""); setNewCorrPattern(false);
              }
            }}
            style={{ flex: 1, padding: "4px 8px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#51cf66", fontSize: 11, fontFamily: "inherit" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#888", cursor: "pointer", flexShrink: 0 }}>
            <input type="checkbox" checked={newCorrPattern} onChange={(e) => setNewCorrPattern(e.target.checked)} style={{ accentColor: "#f783ac" }} />
            pattern
          </label>
          <button
            onClick={() => {
              if (!newCorrFrom.trim() || !newCorrTo.trim()) return;
              onUpdateUniversalCorrections([...universalCorrections, { from: newCorrFrom.trim(), to: newCorrTo.trim(), pattern: newCorrPattern }]);
              setNewCorrFrom(""); setNewCorrTo(""); setNewCorrPattern(false);
            }}
            disabled={!newCorrFrom.trim() || !newCorrTo.trim()}
            style={{
              padding: "4px 10px", background: newCorrFrom.trim() && newCorrTo.trim() ? "#f783ac22" : "none",
              border: "1px solid #f783ac33", color: newCorrFrom.trim() && newCorrTo.trim() ? "#f783ac" : "#555",
              borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: newCorrFrom.trim() && newCorrTo.trim() ? "pointer" : "default",
            }}
          >
            Add Universal
          </button>
        </div>
      )}

      {/* Issues list */}
      {filteredIssues.length === 0 && filter !== "all" && (
        <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>
          No issues in this category
        </div>
      )}

      {filteredIssues.length === 0 && filter === "all" && (
        <div style={{ textAlign: "center", padding: 40, color: "#4ecdc4", fontSize: 13 }}>
          All {validation.summary.total} bits pass validation checks.
        </div>
      )}

      {filteredIssues.map((issue, idx) => {
        const bit = topics.find((t) => t.id === issue.bitId);
        const category = getIssueCategory(issue);
        const catColor = categoryColors[category];
        const isExpanded = expandedIssue === idx;
        const canAutoFix = category === "mismatch" || category === "bounds";
        const transcript = bit
          ? transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId]
          : issue.source ? transcriptMap[issue.source] : null;

        return (
          <div
            key={`${issue.bitId}-${idx}`}
            style={{
              background: "#12121f",
              border: `1px solid ${isExpanded ? catColor.bg : "#1e1e30"}`,
              borderRadius: "8px",
              marginBottom: 8,
              overflow: "hidden",
              transition: "all 0.15s",
            }}
          >
            {/* Issue header */}
            <div
              onClick={() => setExpandedIssue(isExpanded ? null : idx)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                cursor: "pointer",
              }}
            >
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: catColor.bg,
                flexShrink: 0,
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#ddd",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {issue.bitTitle || "Unknown bit"}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                  {issue.error}
                  {issue.severity && issue.severity !== Infinity && (
                    <span style={{ color: "#ff6b6b", marginLeft: 6, fontWeight: 600 }}>
                      {issue.severity} chars
                    </span>
                  )}
                </div>
              </div>

              {issue.source && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const tr = transcripts.find((t) => t.name === issue.source);
                    if (tr) onGoToMix(tr, issue.bitId, issue.type === "gap" ? { gapStart: issue.gapStart, gapEnd: issue.gapEnd } : null);
                  }}
                  style={{
                    padding: "3px 8px",
                    background: "#1e1e30",
                    borderRadius: "4px",
                    fontSize: 10,
                    color: "#74c0fc",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  title="View in mix"
                >
                  {issue.source}
                </div>
              )}

              <span style={{
                fontSize: 10,
                color: catColor.bg,
                background: `${catColor.bg}20`,
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {catColor.label}
              </span>

              <span style={{ color: "#666", fontSize: 10 }}>
                {isExpanded ? "\u25B2" : "\u25BC"}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (bit || category === "gap" || category === "join" || category === "transcription") && (
              <div style={{
                padding: "0 16px 16px",
                borderTop: "1px solid #1e1e30",
              }}>
                {/* Bit info — only for non-gap issues */}
                {bit && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginTop: 12,
                    fontSize: 11,
                  }}>
                    <div>
                      <div style={{ color: "#666", marginBottom: 4 }}>Position</div>
                      <div style={{ color: "#ddd", fontFamily: "'JetBrains Mono', monospace" }}>
                        {bit.textPosition
                          ? `${bit.textPosition.startChar} - ${bit.textPosition.endChar} (${bit.textPosition.endChar - bit.textPosition.startChar} chars)`
                          : "No position data"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#666", marginBottom: 4 }}>Source</div>
                      <div style={{ color: "#ddd" }}>{bit.sourceFile || "unknown"}</div>
                    </div>
                  </div>
                )}

                {/* Text comparison — mismatch only */}
                {category === "mismatch" && bit && bit.fullText && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Stored text (first 200 chars)</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#bbb",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 80,
                      overflow: "hidden",
                    }}>
                      {bit.fullText.substring(0, 200)}{bit.fullText.length > 200 ? "..." : ""}
                    </div>
                  </div>
                )}
                {category === "mismatch" && bit && transcript && bit.textPosition && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Text at position (first 200 chars)</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#ffa94d",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 80,
                      overflow: "hidden",
                    }}>
                      {transcript.text.replace(/\n/g, " ").substring(
                        bit.textPosition.startChar,
                        Math.min(bit.textPosition.endChar, bit.textPosition.startChar + 200)
                      )}
                      {(bit.textPosition.endChar - bit.textPosition.startChar) > 200 ? "..." : ""}
                    </div>
                  </div>
                )}

                {/* Overlap — show text of both overlapping bits */}
                {category === "overlap" && bit && (() => {
                  const otherBit = topics.find((t) => t.id === issue.overlappingBitId);
                  return (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>
                        This bit: "{bit.title}" ({bit.textPosition ? `${bit.textPosition.startChar}-${bit.textPosition.endChar}` : "?"})
                      </div>
                      <div style={{
                        background: "#0a0a14",
                        padding: "8px 12px",
                        borderRadius: "4px",
                        fontSize: 11,
                        color: "#ff8888",
                        lineHeight: 1.5,
                        fontFamily: "'JetBrains Mono', monospace",
                        maxHeight: 120,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}>
                        {bit.fullText ? bit.fullText.substring(0, 400) : "(no text)"}
                        {bit.fullText && bit.fullText.length > 400 ? "..." : ""}
                      </div>
                      {otherBit && (
                        <>
                          <div style={{ color: "#666", fontSize: 11, marginBottom: 4, marginTop: 8 }}>
                            Overlaps with: "{otherBit.title}" ({otherBit.textPosition ? `${otherBit.textPosition.startChar}-${otherBit.textPosition.endChar}` : "?"})
                          </div>
                          <div style={{
                            background: "#0a0a14",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            fontSize: 11,
                            color: "#ffaa88",
                            lineHeight: 1.5,
                            fontFamily: "'JetBrains Mono', monospace",
                            maxHeight: 120,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}>
                            {otherBit.fullText ? otherBit.fullText.substring(0, 400) : "(no text)"}
                            {otherBit.fullText && otherBit.fullText.length > 400 ? "..." : ""}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Gap preview */}
                {category === "gap" && issue.gapPreview && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>Gap text preview</div>
                    <div style={{
                      background: "#0a0a14",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      fontSize: 11,
                      color: "#c4b5fd",
                      lineHeight: 1.5,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxHeight: 240,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}>
                      {issue.gapPreview}{issue.gapEnd - issue.gapStart > 600 ? "..." : ""}
                    </div>
                  </div>
                )}

                {/* Join suggestion detail */}
                {category === "join" && issue.joinBitIds && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: "#666", fontSize: 11, marginBottom: 6 }}>
                      Adjacent bits matching touchstone "{issue.touchstoneName}"
                    </div>
                    {issue.joinBitIds.map((jbId) => {
                      const jb = topics.find((t) => t.id === jbId);
                      if (!jb) return null;
                      return (
                        <div
                          key={jbId}
                          style={{
                            background: "#0a0a14",
                            padding: "6px 12px",
                            borderRadius: "4px",
                            marginBottom: 4,
                            fontSize: 11,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ color: "#4ecdc4", fontWeight: 600, flexShrink: 0 }}>
                            {jb.textPosition ? `${jb.textPosition.startChar}-${jb.textPosition.endChar}` : "?"}
                          </span>
                          <span style={{ color: "#ddd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {jb.title}
                          </span>
                          <span
                            onClick={() => onSelectBit(jb)}
                            style={{ color: "#74c0fc", cursor: "pointer", fontSize: 10, flexShrink: 0 }}
                          >
                            detail
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ color: "#888", fontSize: 10, marginTop: 4 }}>
                      These bits are sequential in the transcript and all belong to the same touchstone.
                      Joining them will merge their text and titles into a single bit.
                    </div>
                  </div>
                )}

                {/* Transcription correction detail */}
                {category === "transcription" && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#ff8888", textDecoration: "line-through" }}>{issue.correctionFrom}</span>
                      <span style={{ fontSize: 11, color: "#555" }}>&rarr;</span>
                      <span style={{ fontSize: 11, color: "#51cf66" }}>{issue.correctionTo}</span>
                      {issue.isPattern && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#f783ac22", color: "#f783ac" }}>pattern</span>}
                    </div>
                    {issue.touchstoneNames && issue.touchstoneNames.length > 0 && (
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 8 }}>
                        Used in: {issue.touchstoneNames.join(", ")}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      {!issue.isUniversal && onUpdateUniversalCorrections && (
                        <button
                          onClick={() => {
                            const updated = [...universalCorrections, { from: issue.correctionFrom, to: issue.correctionTo }];
                            onUpdateUniversalCorrections(updated);
                          }}
                          style={{
                            padding: "4px 10px", background: "#f783ac22", border: "1px solid #f783ac44",
                            color: "#f783ac", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          Make Universal
                        </button>
                      )}
                      {issue.isUniversal && (
                        <span style={{ fontSize: 10, padding: "4px 10px", background: "#f783ac18", borderRadius: 4, color: "#f783ac", fontWeight: 600 }}>
                          Universal
                        </span>
                      )}
                      {issue.isUniversal && onUpdateUniversalCorrections && (
                        <button
                          onClick={() => {
                            const updated = universalCorrections.filter(c => !(c.from === issue.correctionFrom && c.to === issue.correctionTo));
                            onUpdateUniversalCorrections(updated);
                          }}
                          style={{
                            padding: "4px 10px", background: "#ff6b6b22", border: "1px solid #ff6b6b44",
                            color: "#ff6b6b", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          Remove Universal
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {canAutoFix && (
                    <>
                      <button
                        onClick={() => handleAutoFix(issue)}
                        disabled={autoFixing === issue.bitId}
                        style={{
                          padding: "6px 12px",
                          background: "#4ecdc4",
                          border: "none",
                          color: "#000",
                          borderRadius: "4px",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: autoFixing === issue.bitId ? 0.5 : 1,
                        }}
                      >
                        {autoFixing === issue.bitId ? "Fixing..." : "Auto-fix Position"}
                      </button>
                      {lastFixResult?.bitId === issue.bitId && (
                        <span style={{ fontSize: 10, color: lastFixResult.result === "fixed" ? "#4ecdc4" : "#ff6b6b" }}>
                          {lastFixResult.result === "fixed" ? `Fixed (${lastFixResult.method})` :
                           lastFixResult.result === "no_match" ? "Could not locate text in transcript" :
                           lastFixResult.result === "no_transcript" ? "Transcript not found (stale?)" :
                           lastFixResult.result === "no_bit" ? "Bit not found" : "Error"}
                        </span>
                      )}
                    </>
                  )}

                  {category === "gap" && onApproveGap && (
                    <button
                      onClick={() => onApproveGap(issue.gapKey)}
                      style={{
                        padding: "6px 12px",
                        background: "#51cf6622",
                        border: "1px solid #51cf6644",
                        color: "#51cf66",
                        borderRadius: "4px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Approve Gap
                    </button>
                  )}

                  {bit && (
                    <button
                      onClick={() => onSelectBit(bit)}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #2a2a40",
                        color: "#ccc",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View Detail
                    </button>
                  )}

                  {transcript && (
                    <button
                      onClick={() => onGoToMix(transcript, issue.bitId, issue.type === "gap" ? { gapStart: issue.gapStart, gapEnd: issue.gapEnd } : null)}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #2a2a40",
                        color: "#74c0fc",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View in Mix
                    </button>
                  )}

                  {category === "join" && issue.joinBitIds && (
                    <button
                      onClick={() => {
                        const tr = transcripts.find((t) => t.name === issue.source);
                        if (tr) onGoToMix(tr, issue.joinBitIds[0]);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "#4ecdc422",
                        border: "1px solid #4ecdc444",
                        color: "#4ecdc4",
                        borderRadius: "4px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Join in Mix
                    </button>
                  )}

                  {category === "overlap" && issue.overlappingBitId && (
                    <button
                      onClick={() => {
                        const otherBit = topics.find((t) => t.id === issue.overlappingBitId);
                        if (otherBit) onSelectBit(otherBit);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "#1e1e30",
                        border: "1px solid #ff6b6b40",
                        color: "#ff6b6b",
                        borderRadius: "4px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      View Overlapping Bit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
