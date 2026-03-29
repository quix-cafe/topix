import { callOllama } from "./ollama";

const NAMING_SYSTEM_PROMPT = "Name this recurring comedy bit based on these performances of the SAME joke. Use the format: '[3-5 word title] or, [5-8 word title]' — the first title is a punchy shorthand, the second is more descriptive. Include the literal text 'or,' between them. Focus on the core topic or punchline. Reply with ONLY the title text, nothing else. No quotes, no punctuation wrapping. Example: 'DMV Nightmare or, The Witness Protection Line at the DMV'";

/**
 * Auto-name touchstones that need names via the centralized LLM queue.
 *
 * @param {Object} opts
 * @param {Array}    opts.toName         - touchstones needing names
 * @param {Array}    opts.topics         - all bits (for text lookup)
 * @param {string}   opts.model          - selected Ollama model
 * @param {AbortSignal} opts.signal      - abort signal for cancellation
 * @param {Set}      opts.namingInFlight - ref Set tracking in-flight keys
 * @param {Function} opts.findCachedName - (bitIds) => cached name or null
 * @param {Function} opts.setCachedName  - (bitIds, name) => void
 * @param {Function} opts.keyOf          - (ts) => sorted bitId key string
 * @param {Function} opts.onName         - (tsKey, name, ts) => update state
 * @param {Function} opts.onStatus       - (msg|null) => set status bar
 */
export async function autoNameTouchstones({ toName, topics, model, signal, namingInFlight, findCachedName, setCachedName, keyOf, onName, onStatus }) {
  for (const ts of toName) {
    if (signal.aborted) break;
    const tsKey = keyOf(ts);
    if (findCachedName(ts.bitIds) || namingInFlight.has(tsKey)) continue;
    namingInFlight.add(tsKey);

    try {
      const coreIds = ts.coreBitIds || ts.bitIds;
      const coreBits = coreIds.map(id => topics.find(t => t.id === id)).filter(Boolean);
      if (coreBits.length === 0) { namingInFlight.delete(tsKey); continue; }

      const coreTexts = coreBits.map(b => (b.fullText || "").substring(0, 600)).join("\n---\n");
      if (!coreTexts.trim()) { namingInFlight.delete(tsKey); continue; }

      onStatus(`Naming touchstone: "${ts.name}"...`);

      const result = await callOllama(
        NAMING_SYSTEM_PROMPT,
        `${coreBits.length} performances of the same bit:\n\n${coreTexts}`,
        () => {},
        model,
        null,
        signal,
        { label: "touchstone-naming", priority: "normal", ollamaOptions: { num_predict: 64, num_ctx: 4096 }, rawText: true },
      );

      // callOllama returns parsed JSON — for naming we expect raw text, so handle both
      let name;
      if (typeof result === "string") {
        name = result;
      } else if (result?.message?.content) {
        name = result.message.content;
      } else {
        name = String(result || "");
      }
      name = name.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();

      if (!name || signal.aborted) { namingInFlight.delete(tsKey); continue; }

      setCachedName(ts.bitIds, name);
      onName(tsKey, name, ts);
      console.log(`[Touchstone] Auto-named "${ts.name}" → "${name}" (core: ${coreIds.length}/${ts.bitIds.length} bits)`);
    } catch (err) {
      if (err.name === "AbortError") { onStatus(null); break; }
      console.warn(`[Touchstone] Auto-name failed:`, err.message);
    } finally {
      namingInFlight.delete(tsKey);
    }
  }
  onStatus(null);
}
