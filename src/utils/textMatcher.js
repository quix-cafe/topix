/**
 * Multi-strategy text position finder.
 * Cascades through increasingly fuzzy strategies to locate a search text
 * within an original transcript, returning {startChar, endChar, confidence}.
 */

import { calculateCharPosition } from "./positionTracker.js";

/**
 * Normalize text for comparison: collapse whitespace, strip smart quotes/punctuation variants
 */
function normalizeWhitespace(text) {
  return text
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // smart quotes → straight
    .replace(/\u2014/g, "--")                      // em dash → double hyphen
    .replace(/\u2013/g, "-")                       // en dash → hyphen
    .replace(/\u2026/g, "...")                      // ellipsis char → dots
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip all punctuation and lowercase for normalized comparison
 */
function stripForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strategy 1: Exact match after whitespace/quote normalization
 */
function exactNormalized(originalText, searchText) {
  const normOrig = normalizeWhitespace(originalText);
  const normSearch = normalizeWhitespace(searchText);

  const idx = normOrig.indexOf(normSearch);
  if (idx === -1) return null;

  return {
    startChar: idx,
    endChar: idx + normSearch.length,
    confidence: 1.0,
    strategy: "exact-normalized",
  };
}

/**
 * Strategy 2: Fully stripped comparison (no punctuation, lowercase)
 */
function strippedMatch(originalText, searchText) {
  const strippedOrig = stripForComparison(originalText);
  const strippedSearch = stripForComparison(searchText);

  if (strippedSearch.length < 10) return null;

  const idx = strippedOrig.indexOf(strippedSearch);
  if (idx === -1) return null;

  // Map stripped position back to original position approximately.
  // Walk through original text counting non-punctuation chars to find real start.
  let origIdx = 0;
  let strippedIdx = 0;
  while (strippedIdx < idx && origIdx < originalText.length) {
    const ch = originalText[origIdx].toLowerCase();
    if (/[\w\s]/.test(originalText[origIdx])) {
      // Count spaces only if they'd survive the strip (collapse to single)
      if (/\s/.test(originalText[origIdx])) {
        // Skip consecutive whitespace
        while (origIdx + 1 < originalText.length && /\s/.test(originalText[origIdx + 1])) {
          origIdx++;
        }
      }
      strippedIdx++;
    }
    origIdx++;
  }
  const startChar = origIdx;

  // Similarly find end
  let endStrippedIdx = 0;
  let endOrigIdx = 0;
  const targetEnd = idx + strippedSearch.length;
  while (endStrippedIdx < targetEnd && endOrigIdx < originalText.length) {
    if (/[\w\s]/.test(originalText[endOrigIdx])) {
      if (/\s/.test(originalText[endOrigIdx])) {
        while (endOrigIdx + 1 < originalText.length && /\s/.test(originalText[endOrigIdx + 1])) {
          endOrigIdx++;
        }
      }
      endStrippedIdx++;
    }
    endOrigIdx++;
  }

  return {
    startChar,
    endChar: endOrigIdx,
    confidence: 0.9,
    strategy: "stripped",
  };
}

/**
 * Strategy 3: Anchor match — find first N and last N words, use them as bookends
 */
function anchorMatch(originalText, searchText) {
  const ANCHOR_WORDS = 8;

  const getWords = (t) => t.toLowerCase().match(/\b\w+\b/g) || [];
  const searchWords = getWords(searchText);
  if (searchWords.length < ANCHOR_WORDS * 2) return null;

  const firstAnchor = searchWords.slice(0, ANCHOR_WORDS).join(" ");
  const lastAnchor = searchWords.slice(-ANCHOR_WORDS).join(" ");

  const origLower = originalText.toLowerCase();
  const origWords = getWords(originalText);

  // Find first anchor: search for the word sequence in original
  const findAnchorPos = (anchorWords, startFrom = 0) => {
    const words = anchorWords.split(" ");
    for (let i = startFrom; i <= origWords.length - words.length; i++) {
      let match = true;
      for (let j = 0; j < words.length; j++) {
        if (origWords[i + j] !== words[j]) { match = false; break; }
      }
      if (match) {
        // Convert word index to char position
        let wordIdx = 0;
        for (let ci = 0; ci < originalText.length; ci++) {
          if (/\w/.test(originalText[ci]) && (ci === 0 || !/\w/.test(originalText[ci - 1]))) {
            if (wordIdx === i) return ci;
            wordIdx++;
          }
        }
      }
    }
    return -1;
  };

  const firstPos = findAnchorPos(firstAnchor);
  if (firstPos === -1) return null;

  // Find last anchor starting after the first anchor
  const lastAnchorWords = lastAnchor.split(" ");
  let lastPos = -1;
  let lastEndPos = -1;
  for (let i = 0; i <= origWords.length - lastAnchorWords.length; i++) {
    let match = true;
    for (let j = 0; j < lastAnchorWords.length; j++) {
      if (origWords[i + j] !== lastAnchorWords[j]) { match = false; break; }
    }
    if (match) {
      // Convert to char pos for end of this anchor
      let wordIdx = 0;
      let startOfWord = 0;
      for (let ci = 0; ci < originalText.length; ci++) {
        if (/\w/.test(originalText[ci]) && (ci === 0 || !/\w/.test(originalText[ci - 1]))) {
          if (wordIdx === i + lastAnchorWords.length - 1) {
            // Find end of this word
            let endCi = ci;
            while (endCi < originalText.length && /\w/.test(originalText[endCi])) endCi++;
            if (endCi > firstPos) {
              lastPos = ci;
              lastEndPos = endCi;
            }
          }
          wordIdx++;
        }
      }
    }
  }

  if (lastEndPos === -1) return null;

  // Plausibility check: the span shouldn't be more than 2x the search text length
  const span = lastEndPos - firstPos;
  if (span > searchText.length * 2.5 || span < searchText.length * 0.3) return null;

  return {
    startChar: firstPos,
    endChar: lastEndPos,
    confidence: 0.75,
    strategy: "anchor",
  };
}

/**
 * Strategy 4: Sliding window with word-bag overlap scoring
 */
function slidingWindowMatch(originalText, searchText) {
  const searchLen = searchText.length;
  if (searchLen < 30 || originalText.length < searchLen * 0.5) return null;

  const searchBag = new Map();
  const searchWordsArr = searchText.toLowerCase().match(/\b\w+\b/g) || [];
  for (const w of searchWordsArr) {
    searchBag.set(w, (searchBag.get(w) || 0) + 1);
  }
  if (searchBag.size < 3) return null;

  const minWindow = Math.floor(searchLen * 0.8);
  const maxWindow = Math.ceil(searchLen * 1.2);
  const windowSize = Math.min(maxWindow, originalText.length);
  const step = Math.max(1, Math.floor(windowSize * 0.1)); // 10% step for performance

  let bestScore = 0;
  let bestPos = -1;
  let bestEnd = -1;

  for (let i = 0; i <= originalText.length - minWindow; i += step) {
    const end = Math.min(i + windowSize, originalText.length);
    const window = originalText.substring(i, end);
    const windowWords = window.toLowerCase().match(/\b\w+\b/g) || [];

    // Count overlap with search bag
    const windowBag = new Map();
    for (const w of windowWords) {
      windowBag.set(w, (windowBag.get(w) || 0) + 1);
    }

    let intersection = 0;
    for (const [word, count] of searchBag) {
      intersection += Math.min(count, windowBag.get(word) || 0);
    }

    const totalSearchWords = searchWordsArr.length;
    const score = totalSearchWords > 0 ? intersection / totalSearchWords : 0;

    if (score > bestScore) {
      bestScore = score;
      bestPos = i;
      bestEnd = end;
    }
  }

  // Refine: search around bestPos with step=1
  if (bestPos >= 0 && step > 1) {
    const refineStart = Math.max(0, bestPos - step);
    const refineEnd = Math.min(originalText.length - minWindow, bestPos + step);
    for (let i = refineStart; i <= refineEnd; i++) {
      const end = Math.min(i + windowSize, originalText.length);
      const window = originalText.substring(i, end);
      const windowWords = window.toLowerCase().match(/\b\w+\b/g) || [];

      const windowBag = new Map();
      for (const w of windowWords) {
        windowBag.set(w, (windowBag.get(w) || 0) + 1);
      }

      let intersection = 0;
      for (const [word, count] of searchBag) {
        intersection += Math.min(count, windowBag.get(word) || 0);
      }

      const score = searchWordsArr.length > 0 ? intersection / searchWordsArr.length : 0;
      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
        bestEnd = end;
      }
    }
  }

  if (bestScore < 0.7 || bestPos === -1) return null;

  return {
    startChar: bestPos,
    endChar: bestEnd,
    confidence: Math.min(0.65, bestScore * 0.75), // Cap at 0.65 — this is a rough match
    strategy: "sliding-window",
  };
}

/**
 * Main entry point: cascade through strategies to find searchText in originalText.
 * Returns {startChar, endChar, confidence, strategy} or null if nothing found.
 */
export function findTextPosition(originalText, searchText) {
  if (!originalText || !searchText || searchText.trim().length < 10) return null;

  // Clean newlines from search text to match transcript format
  const cleanSearch = searchText.replace(/\n/g, " ");

  // Strategy 0: Use existing calculateCharPosition (exact + fuzzy from positionTracker)
  const existing = calculateCharPosition(originalText, cleanSearch);
  if (existing) {
    // Verify quality: check if the extracted text is close to what we searched for
    const extracted = originalText.substring(existing.startChar, existing.endChar);
    const normExtracted = stripForComparison(extracted);
    const normSearch = stripForComparison(cleanSearch);

    // If the existing match covers roughly the right amount of text, trust it
    const lenRatio = normExtracted.length / Math.max(1, normSearch.length);
    if (lenRatio > 0.5 && lenRatio < 2.0) {
      console.log(`[textMatcher] positionTracker match: ${existing.startChar}-${existing.endChar}`);
      return { ...existing, confidence: 0.85, strategy: "positionTracker" };
    }
  }

  // Strategy 1: Exact match after normalizing whitespace and quotes
  const exact = exactNormalized(originalText, cleanSearch);
  if (exact) {
    console.log(`[textMatcher] exact-normalized match: ${exact.startChar}-${exact.endChar}`);
    return exact;
  }

  // Strategy 2: Stripped match (no punctuation, lowercase)
  const stripped = strippedMatch(originalText, cleanSearch);
  if (stripped) {
    console.log(`[textMatcher] stripped match: ${stripped.startChar}-${stripped.endChar} (conf: ${stripped.confidence})`);
    return stripped;
  }

  // Strategy 3: Anchor match (first/last N words)
  const anchor = anchorMatch(originalText, cleanSearch);
  if (anchor) {
    console.log(`[textMatcher] anchor match: ${anchor.startChar}-${anchor.endChar} (conf: ${anchor.confidence})`);
    return anchor;
  }

  // Strategy 4: Sliding window word-bag overlap
  const sliding = slidingWindowMatch(originalText, cleanSearch);
  if (sliding) {
    console.log(`[textMatcher] sliding-window match: ${sliding.startChar}-${sliding.endChar} (conf: ${sliding.confidence})`);
    return sliding;
  }

  console.warn(`[textMatcher] No strategy found a match for text (${cleanSearch.length} chars): "${cleanSearch.substring(0, 60)}..."`);
  return null;
}
