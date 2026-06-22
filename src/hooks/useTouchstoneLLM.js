import { useState } from "react";
import { SYSTEM_SYNTHESIZE_TOUCHSTONE, SYSTEM_TOUCHSTONE_COMMUNE, SYSTEM_TOUCHSTONE_VERIFY } from "../utils/prompts";

function tryParseJSON(text) {
  const cleaned = text.replace(/```json\s?|```/g, "").trim();
  const attempts = [cleaned];
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) attempts.push(objMatch[0]);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) attempts.push(arrMatch[0]);

  for (const raw of attempts) {
    try { return JSON.parse(raw); } catch {}
    try {
      const fixed = raw.replace(/"(?:[^"\\]|\\.)*"/g, (m) =>
        m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
      );
      return JSON.parse(fixed);
    } catch {}
  }

  for (const raw of attempts) {
    try {
      const fixed = raw.replace(/:\s*"([\s\S]*?)"\s*([,\]\}])/g, (match, inner, after) => {
        try { JSON.parse(`{"k":"${inner}"}`); return match; } catch {}
        const escaped = inner
          .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
          .replace(/(?<!\\)"/g, '\\"');
        return `: "${escaped}"${after}`;
      });
      const result = JSON.parse(fixed);
      if (result) return result;
    } catch {}
  }

  const idealMatch = cleaned.match(/"idealText"\s*:\s*"([\s\S]*?)"\s*,\s*"notes"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/);
  if (idealMatch) {
    return { idealText: idealMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), notes: idealMatch[2].replace(/\\n/g, "\n").replace(/\\"/g, '"') };
  }
  const idealIdx = cleaned.indexOf('"idealText"');
  const notesIdx = cleaned.indexOf('"notes"');
  if (idealIdx !== -1 && notesIdx !== -1) {
    try {
      const between = cleaned.substring(idealIdx, notesIdx);
      const valMatch = between.match(/"idealText"\s*:\s*"([\s\S]*)"\s*,?\s*$/);
      const notesRest = cleaned.substring(notesIdx);
      const notesMatch = notesRest.match(/"notes"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
      if (valMatch && notesMatch) {
        return { idealText: valMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), notes: notesMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') };
      }
    } catch {}
  }
  return null;
}

export function useTouchstoneLLM({ touchstone, bits, instances, userReasons, rejectedReasons, notes, applyCorrections, onUpdateTouchstoneEdits }) {
  const [copyPromptOpen, setCopyPromptOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [pasteResponseType, setPasteResponseType] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [sendingTo, setSendingTo] = useState(null);
  const [llmResponse, setLlmResponse] = useState(null);
  const [sendPromptType, setSendPromptType] = useState(null);

  const buildPrompt = (type) => {
    const instanceBits = instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
    if (instanceBits.length === 0) return null;

    let system, user;
    if (type === "synthesize") {
      const instanceTexts = instanceBits.map((b, idx) =>
        `[Instance ${idx + 1} from "${b.sourceFile}"]:\n${applyCorrections(b.fullText || b.summary)}`
      ).join('\n\n---\n\n');
      system = SYSTEM_SYNTHESIZE_TOUCHSTONE;
      const generatedReasons = touchstone.matchInfo?.reasons || [];
      let reasonsBlock = '';
      if (userReasons.length > 0 || generatedReasons.length > 0) {
        reasonsBlock = '\n\n--- WHY THESE ARE THE SAME BIT ---';
        if (userReasons.length > 0) {
          reasonsBlock += `\nCOMEDIAN-PROVIDED REASONS (trust these heavily):\n${userReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }
        if (generatedReasons.length > 0) {
          reasonsBlock += `\nAUTO-DETECTED REASONS:\n${generatedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }
      }
      user = `TOUCHSTONE: "${touchstone.name}"\n\n${instanceBits.length} performance${instanceBits.length > 1 ? 's' : ''} of the same bit:${reasonsBlock}\n\n${instanceTexts}`;
    } else if (type === "commune") {
      const userCriteria = touchstone.userReasons || [];
      const generatedCriteria = touchstone.matchInfo?.reasons || [];
      const allBitTexts = instanceBits.map((b) => {
        const hasUserCriteria = userCriteria.length > 0;
        const criteriaBlock = hasUserCriteria
          ? `USER CRITERIA (high-confidence signals from the comedian):\n${userCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}\n\nGENERATED CRITERIA (auto-generated):\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`
          : `GENERATED CRITERIA:\n${generatedCriteria.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}`;
        return `TOUCHSTONE: "${touchstone.name}"\n\n${criteriaBlock}\n\nBIT TO EVALUATE:\nTitle: ${b.title}\nSource: ${b.sourceFile}\nFull text: ${applyCorrections(b.fullText || b.summary)}`;
      }).join('\n\n========================================\n\n');
      system = SYSTEM_TOUCHSTONE_COMMUNE;
      user = allBitTexts;
    } else if (type === "why_matched") {
      const anchorBit = instanceBits[0];
      const candidateBits = instanceBits.slice(1);
      const anchorText = `EXISTING 1 (from "${anchorBit.sourceFile}"):\nTitle: ${applyCorrections(anchorBit.title)}\n${applyCorrections(anchorBit.fullText || anchorBit.summary)}`;
      const candidateText = candidateBits.map((b, i) => `CANDIDATE ${i + 1} (from "${b.sourceFile}"):\nTitle: ${applyCorrections(b.title)}\n${applyCorrections(b.fullText || b.summary)}`).join('\n\n');
      const userReasonsBlock = userReasons.length > 0
        ? `\n\n--- USER-CONFIRMED REASONING ---\n${userReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
      const rejectedBlock = rejectedReasons.length > 0
        ? `\n\n--- REJECTED REASONING ---\n${rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';
      const attachedNotes = (notes || []).filter(n => n.matchedTouchstoneId === touchstone.id);
      const notesBlock = attachedNotes.length > 0
        ? `\n\n--- ATTACHED NOTES (${attachedNotes.length}) ---\n${attachedNotes.map((n, i) => {
            const title = n.title ? `[${n.title}]` : '';
            const body = applyCorrections(n.text || '');
            return `NOTE ${i + 1}${title ? ' ' + title : ''}:\n${body}`;
          }).join('\n\n')}`
        : '';
      system = SYSTEM_TOUCHSTONE_VERIFY;
      user = `TOUCHSTONE: "${touchstone.name}"\n\n--- GROUP (1 anchor instance) ---\n${anchorText}${userReasonsBlock}${rejectedBlock}${notesBlock}\n\n--- CANDIDATES TO EVALUATE (${candidateBits.length}) ---\n${candidateText}`;
    }
    return { system, user };
  };

  const buildAndCopyPrompt = async (type) => {
    const prompt = buildPrompt(type);
    if (!prompt) return;
    const fullPrompt = `SYSTEM:\n${prompt.system}\n\n---\n\nUSER:\n${prompt.user}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopyFeedback(type);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {}
    setCopyPromptOpen(false);
  };

  const applyParsedResponse = (responseText, type, source) => {
    const parsed = tryParseJSON(responseText);

    if (type === "synthesize") {
      const idealText = parsed?.idealText || parsed?.ideal_text || responseText;
      const notesField = parsed?.notes || "";
      setLlmResponse({ provider: source, type, text: idealText, parsed: true });
      const versions = [...(touchstone.idealTextVersions || [])];
      versions.push({ idealText, notes: notesField, model: source, source: source === "paste" ? "paste" : "send-to", date: new Date().toISOString() });
      onUpdateTouchstoneEdits?.(touchstone.id, { idealTextVersions: versions });

    } else if (type === "commune") {
      if (parsed && typeof parsed.generated_criteria_score === "number") {
        const userScore = typeof parsed.user_criteria_score === "number" ? parsed.user_criteria_score : null;
        const genScore = parsed.generated_criteria_score;
        const hasUserCriteria = userScore !== null;
        const finalScore = hasUserCriteria ? Math.round(userScore * 0.51 + genScore * 0.49) : genScore;
        const status = finalScore >= 70 ? "blessed" : finalScore >= 40 ? "damned" : "removed";
        const communionResult = {
          provider: source,
          userScore,
          generatedScore: genScore,
          finalScore,
          status,
          reasoning: parsed.reasoning || "",
          date: new Date().toISOString(),
        };
        const prevResults = [...(touchstone.highEndCommunionResults || [])];
        prevResults.push(communionResult);
        onUpdateTouchstoneEdits?.(touchstone.id, { highEndCommunionResults: prevResults });
        setLlmResponse({ provider: source, type, text: `Score: ${finalScore} (user: ${userScore ?? "n/a"}, gen: ${genScore}) → ${status}\n\n${parsed.reasoning || ""}`, parsed: true, communionResult });
      } else {
        setLlmResponse({ provider: source, type, text: responseText });
      }

    } else if (type === "why_matched") {
      const hasReasoning = parsed && (Array.isArray(parsed.group_reasoning) ? parsed.group_reasoning.length > 0 : !!parsed.group_reasoning);
      const hasCandidates = parsed && Array.isArray(parsed.candidates) && parsed.candidates.length > 0;
      if (parsed && (hasReasoning || hasCandidates)) {
        const reasoning = hasReasoning
          ? (Array.isArray(parsed.group_reasoning) ? parsed.group_reasoning : [parsed.group_reasoning])
          : [];
        const rejectedSet = new Set((rejectedReasons || []).map((r) => r.toLowerCase().trim()));
        const llmReasons = reasoning.filter((r) => !rejectedSet.has(r.toLowerCase().trim())).slice(0, 5);
        const finalReasons = llmReasons.slice(0, 6);

        const instanceBits = instances.map((i) => bits.find((b) => b.id === i.bitId)).filter(Boolean);
        const anchorBit = instanceBits[0];
        const candidateBits = instanceBits.slice(1);
        const candidateScores = new Map();
        for (const c of (parsed.candidates || [])) {
          if (typeof c.candidate === 'number' && typeof c.confidence === 'number') {
            const idx = c.candidate - 1;
            if (idx >= 0 && idx < candidateBits.length) {
              candidateScores.set(candidateBits[idx].id, { confidence: c.confidence, relationship: c.relationship || 'same_bit' });
            }
          }
        }

        const updatedInstances = instances.map((inst) => {
          if (inst.bitId === anchorBit?.id) return { ...inst, confidence: 1, relationship: 'same_bit' };
          const score = candidateScores.get(inst.bitId);
          if (!score) return inst;
          return { ...inst, confidence: score.confidence, relationship: score.relationship };
        });
        const avgConf = updatedInstances.length > 0 ? updatedInstances.reduce((s, i) => s + (i.confidence || 0), 0) / updatedInstances.length : 0;

        const verifyResult = { provider: source, candidates: parsed.candidates || [], group_reasoning: reasoning, date: new Date().toISOString() };
        const prevVerify = [...(touchstone.highEndVerifyResults || [])];
        prevVerify.push(verifyResult);
        onUpdateTouchstoneEdits?.(touchstone.id, {
          reasons: finalReasons.length > 0 ? finalReasons : undefined,
          highEndVerifyResults: prevVerify,
          instances: updatedInstances,
          matchInfo: {
            ...(touchstone.matchInfo || {}),
            reasons: finalReasons.length > 0 ? finalReasons : touchstone.matchInfo?.reasons || [],
            totalMatches: updatedInstances.length,
            sameBitCount: updatedInstances.filter((i) => i.relationship === "same_bit").length,
            evolvedCount: updatedInstances.filter((i) => i.relationship === "evolved").length,
            avgConfidence: avgConf,
            avgMatchPercentage: Math.round(avgConf * 100),
          },
        });

        const lines = [`Group reasoning (${source}):`];
        reasoning.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
        if (parsed.candidates) {
          lines.push("", "Candidates:");
          parsed.candidates.forEach((c) => {
            lines.push(`  #${c.candidate}: ${c.accepted ? "✓" : "✗"} ${c.relationship} (${Math.round(c.confidence * 100)}%)`);
          });
        }
        setLlmResponse({ provider: source, type, text: lines.join("\n"), parsed: true, verifyResult: parsed });
      } else {
        setLlmResponse({ provider: source, type, text: responseText });
      }
    } else {
      setLlmResponse({ provider: source, type, text: responseText });
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim() || !pasteResponseType || pasteResponseType === "pick") return;
    applyParsedResponse(pasteText.trim(), pasteResponseType, "paste");
    setPasteResponseType(null);
    setPasteText("");
  };

  const sendToProvider = async (providerId, type) => {
    const prompt = buildPrompt(type);
    if (!prompt) return;
    setSendingTo(providerId);
    setSendPromptType(null);
    setCopyPromptOpen(false);
    setLlmResponse(null);
    const geminiMatch = providerId.match(/^gemini-(.+)$/);
    const provider = geminiMatch ? "gemini" : providerId;
    const gemini_model = geminiMatch ? geminiMatch[1] : undefined;
    try {
      const res = await fetch("/api/llm/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, system: prompt.system, user: prompt.user, ...(gemini_model && { gemini_model }) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "API call failed");
      applyParsedResponse(data.result, type, provider);
    } catch (e) {
      setLlmResponse({ provider, type, text: `Error: ${e.message}` });
    }
    setSendingTo(null);
  };

  return {
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
  };
}
