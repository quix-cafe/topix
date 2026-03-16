/**
 * BitFlowAnalyzer - Analyze the structure, pacing, and delivery pattern of comedy bits
 * Breaks bits into setup/escalation/punchline/tag stages and analyzes rhythm
 */

/**
 * Analyze the flow of a comedy bit
 * @param {string} bitText - The full text of the bit
 * @param {object} bitData - Additional bit data (tags, structure, etc)
 * @returns {object} BitFlow analysis with pattern, stages, rhythm
 */
export function analyzeBitFlow(bitText, bitData = {}) {
  if (!bitText || bitText.trim().length === 0) {
    return null;
  }

  const sentences = getSentences(bitText);
  if (sentences.length === 0) return null;

  // Classify each sentence
  const stages = sentences.map((sent, idx) => {
    const type = classifySentence(sent.text, idx, sentences.length, bitData);
    return {
      type,
      startChar: sent.startChar,
      endChar: sent.endChar,
      text: sent.text,
      confidence: calculateConfidence(sent.text, type),
    };
  });

  // Derive overall pattern
  const pattern = derivePattern(stages);

  // Analyze rhythm/pacing
  const rhythm = analyzeRhythm(stages, sentences);

  // Find callbacks (references to other bits)
  const callbacks = extractCallbacks(bitText);

  return {
    pattern,
    stages,
    rhythm,
    callbacks,
    totalStages: stages.length,
    analysis: {
      hasMisdirect: pattern.includes("misdirect"),
      hasCallback: callbacks.length > 0,
      isMultiPart: pattern.split("-").length > 3,
      estimatedDeliveryTime: estimateDeliveryTime(bitText),
    },
  };
}

/**
 * Split text into sentences
 */
function getSentences(text) {
  // Split by periods, question marks, exclamation marks, but preserve them
  const sentencePattern = /([^.!?]+[.!?]+)/g;
  const matches = text.match(sentencePattern) || [];

  let startChar = 0;
  return matches.map((sentence) => {
    const trimmed = sentence.trim();
    const pos = text.indexOf(sentence, startChar);
    const result = {
      text: trimmed,
      startChar: pos,
      endChar: pos + sentence.length,
    };
    startChar = pos + sentence.length;
    return result;
  });
}

/**
 * Classify a sentence as setup/escalation/punchline/tag/other
 */
function classifySentence(text, index, totalSentences, bitData = {}) {
  const lower = text.toLowerCase();

  // Setup indicators (questions, statements of fact, beginnings)
  if (
    index === 0 ||
    lower.includes("so") ||
    lower.includes("have you ever") ||
    lower.includes("you know") ||
    text.includes("?")
  ) {
    return "setup";
  }

  // Punchline indicators (extreme, unexpected)
  if (
    (/^\s*and\b/i.test(text) && index > 0) ||
    lower.includes("actually") ||
    lower.includes("turns out") ||
    lower.includes("the thing is") ||
    lower.includes("but here's") ||
    index === totalSentences - 1 ||
    isExclamatory(text)
  ) {
    return "punchline";
  }

  // Tag indicators (short, comes after punchline)
  if (index === totalSentences - 1 && text.length < 50 && isExclamatory(text)) {
    return "tag";
  }

  // Escalation (building up)
  if (lower.includes("because") || lower.includes("which") || lower.includes("and then")) {
    return "escalation";
  }

  return "other";
}

/**
 * Check if text is exclamatory
 */
function isExclamatory(text) {
  const exclamationCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  return exclamationCount > 0 || questionCount > 1;
}

/**
 * Calculate confidence for stage classification
 */
function calculateConfidence(text, stageType) {
  const lower = text.toLowerCase();

  // Base confidence
  let confidence = 0.6;

  if (stageType === "setup") {
    if (lower.includes("so") || lower.includes("you know")) confidence = 0.85;
    if (text.endsWith("?")) confidence = 0.8;
  } else if (stageType === "punchline") {
    if (text.endsWith("!") || text.endsWith("?!")) confidence = 0.9;
    if (lower.includes("but")) confidence = 0.8;
  } else if (stageType === "tag") {
    if (text.length < 30 && text.endsWith("!")) confidence = 0.85;
  }

  return confidence;
}

/**
 * Derive overall pattern from stages
 */
function derivePattern(stages) {
  const typeSequence = stages.map((s) => s.type);

  // Remove consecutive duplicates
  const unique = [];
  typeSequence.forEach((type) => {
    if (unique[unique.length - 1] !== type) {
      unique.push(type);
    }
  });

  return unique.join("-");
}

/**
 * Analyze the rhythm/pacing of the bit
 */
function analyzeRhythm(stages, sentences) {
  // Calculate average sentence length
  const avgLength = sentences.reduce((sum, s) => sum + s.text.length, 0) / sentences.length;

  // Look for patterns
  const short = sentences.filter((s) => s.text.length < avgLength * 0.7).length;
  const long = sentences.filter((s) => s.text.length > avgLength * 1.3).length;

  // Determine rhythm
  if (short > long) {
    return "fast"; // Short, punchy delivery
  } else if (long > short) {
    return "slow"; // Longer, more narrative
  } else if (stages.some((s) => s.type === "escalation")) {
    return "build"; // Building up to something
  }

  return "steady";
}

/**
 * Extract callback references (mentions of other bits)
 */
function extractCallbacks(text) {
  // Look for "as I mentioned" or similar callback patterns
  const callbackPatterns = [
    /as i (?:mentioned|said|talked about)/gi,
    /remember when/gi,
    /like i said/gi,
    /going back to/gi,
  ];

  const callbacks = [];
  callbackPatterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      callbacks.push(...matches);
    }
  });

  return callbacks;
}

/**
 * Estimate delivery time in seconds (roughly 2-3 words per second)
 */
function estimateDeliveryTime(text) {
  const wordCount = text.trim().split(/\s+/).length;
  return Math.round(wordCount / 2.5);
}

/**
 * Common comedy structure patterns
 */
const COMEDY_PATTERNS = {
  "setup-punchline": "Classic two-part joke",
  "setup-escalation-punchline": "Building joke with escalation",
  "setup-escalation-punchline-tag": "Full structure with button",
  "setup-callback-punchline": "Call back to earlier joke",
  "setup-misdirect-punchline": "Misdirection joke",
  "other": "Unstructured narrative",
};

export function getPatternDescription(pattern) {
  return COMEDY_PATTERNS[pattern] || "Mixed structure";
}

/**
 * Analyze multiple bits to understand overall set flow
 */
export function analyzeSetFlow(bits) {
  const flows = bits.map((bit) => ({
    id: bit.id,
    title: bit.title,
    flow: analyzeBitFlow(bit.fullText, bit),
  }));

  // Analyze transitions
  const transitions = [];
  for (let i = 0; i < flows.length - 1; i++) {
    const current = flows[i];
    const next = flows[i + 1];

    // Check if there's a callback reference
    if (
      next.flow?.callbacks &&
      next.flow.callbacks.some((cb) =>
        current.title.toLowerCase().includes(cb.toLowerCase())
      )
    ) {
      transitions.push({
        from: current.id,
        to: next.id,
        type: "callback",
      });
    }
  }

  return {
    bits: flows,
    transitions,
    totalBits: flows.length,
    averageRhythm: calculateAverageRhythm(flows),
  };
}

/**
 * Calculate average rhythm across multiple bits
 */
function calculateAverageRhythm(flows) {
  const rhythms = flows
    .filter((f) => f.flow?.rhythm)
    .map((f) => f.flow.rhythm);

  if (rhythms.length === 0) return "steady";

  const count = {
    fast: rhythms.filter((r) => r === "fast").length,
    slow: rhythms.filter((r) => r === "slow").length,
    build: rhythms.filter((r) => r === "build").length,
    steady: rhythms.filter((r) => r === "steady").length,
  };

  const max = Math.max(count.fast, count.slow, count.build, count.steady);
  for (const [rhythm, val] of Object.entries(count)) {
    if (val === max) return rhythm;
  }

  return "steady";
}
