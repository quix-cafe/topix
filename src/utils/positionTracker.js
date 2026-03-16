/**
 * Position tracking utilities for mapping bit text to transcript positions
 */

/**
 * Find character position of text within a larger text
 * @param {string} fullText - The full transcript text (cleaned, no newlines)
 * @param {string} searchText - The bit text to find (may contain newlines)
 * @returns {object} {startChar, endChar} or null if not found
 */
export function calculateCharPosition(fullText, searchText) {
  if (!searchText || !fullText) return null;

  // Clean searchText to match fullText format (replace newlines with spaces)
  const cleanedSearchText = searchText.replace(/\n/g, " ");

  const startChar = fullText.indexOf(cleanedSearchText);

  if (startChar === -1) {
    // Log when exact match fails for debugging
    console.warn("[Position] Exact match failed for:", {
      searchTextLength: cleanedSearchText.length,
      searchTextPreview: cleanedSearchText.substring(0, 50),
      fullTextLength: fullText.length,
      method: "fuzzy"
    });
    // Try fuzzy match if exact match fails
    return findFuzzyPosition(fullText, cleanedSearchText);
  }

  console.log("[Position] Found exact match:", {
    start: startChar,
    end: startChar + cleanedSearchText.length,
    textPreview: cleanedSearchText.substring(0, 50)
  });

  return {
    startChar,
    endChar: startChar + cleanedSearchText.length,
  };
}

/**
 * Find position using word-level matching (more robust than substring matching)
 * Splits text into words and finds the best matching sequence
 */
function findWordMatchPosition(fullText, searchText) {
  if (!searchText || !fullText) return null;

  // Split into words, preserving punctuation attachment
  const toWords = (text) => {
    return text
      .toLowerCase()
      .match(/\b\w+\b/g) || [];
  };

  const searchWords = toWords(searchText);
  const fullWords = toWords(fullText);

  if (searchWords.length === 0) return null;

  // Find best matching sequence of words
  let bestMatch = null;
  let bestMatchCount = 0;

  for (let i = 0; i <= fullWords.length - searchWords.length; i++) {
    let matchCount = 0;
    for (let j = 0; j < searchWords.length; j++) {
      if (fullWords[i + j] === searchWords[j]) {
        matchCount++;
      }
    }

    // Track best match (most consecutive matching words)
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestMatch = i;
    }

    // Perfect match found
    if (matchCount === searchWords.length) {
      break;
    }
  }

  if (bestMatch === null || bestMatchCount === 0) {
    return null;
  }

  // Convert word indices to character positions
  // Find the actual character position of the first matching word
  let wordIndex = 0;
  let searchWordStart = null;

  for (let i = 0; i < fullText.length; i++) {
    // Check if we're at the start of a word (current char is word char, previous is not)
    if (/\w/.test(fullText[i]) && (i === 0 || !/\w/.test(fullText[i - 1]))) {
      if (wordIndex === bestMatch) {
        searchWordStart = i;
      }
      wordIndex++;
      if (wordIndex > bestMatch + searchWords.length) {
        break; // No need to scan further
      }
    }
  }

  if (searchWordStart === null) {
    return null;
  }

  // Find end position by looking for the end of the last matching word
  let endChar = searchWordStart;
  let matchedWords = 0;
  let inWord = false;

  for (let i = searchWordStart; i < fullText.length && matchedWords < searchWords.length; i++) {
    const isWordChar = /\w/.test(fullText[i]);

    if (isWordChar && !inWord) {
      inWord = true;
      matchedWords++;
    } else if (!isWordChar && inWord) {
      inWord = false;
      if (matchedWords === searchWords.length) {
        endChar = i;
        break;
      }
    }
  }

  // If we ended in the middle of a word, extend to the end of the current word
  if (inWord) {
    let i = searchWordStart;
    // Advance to where we stopped counting
    let wc = 0;
    let iw = false;
    for (; i < fullText.length; i++) {
      const isWC = /\w/.test(fullText[i]);
      if (isWC && !iw) { iw = true; wc++; }
      else if (!isWC && iw) { iw = false; }
      if (wc > searchWords.length) break;
      if (!iw && wc === searchWords.length) break;
    }
    endChar = i;
  }

  return {
    startChar: Math.max(0, searchWordStart),
    endChar: Math.min(fullText.length, endChar),
  };
}

/**
 * Find position using fuzzy matching (for slightly modified text)
 */
function findFuzzyPosition(fullText, searchText) {
  // Try word-level matching first (more robust)
  const wordMatch = findWordMatchPosition(fullText, searchText);
  if (wordMatch) {
    return wordMatch;
  }

  // Fallback to substring matching if word matching fails
  const minMatch = Math.min(100, Math.floor(searchText.length * 0.7));

  for (let len = searchText.length; len >= minMatch; len--) {
    for (let offset = 0; offset <= searchText.length - len; offset++) {
      const substr = searchText.substring(offset, offset + len);
      const pos = fullText.indexOf(substr);

      if (pos !== -1) {
        // Estimate bounds
        const startChar = Math.max(0, pos - offset);
        const endChar = Math.min(fullText.length, pos + (searchText.length - offset));
        return { startChar, endChar };
      }
    }
  }

  return null;
}

/**
 * Extract text from transcript by character positions
 * @param {string} fullText - The full transcript
 * @param {number} startChar - Start position
 * @param {number} endChar - End position
 * @returns {string} Extracted text
 */
export function extractTextByPosition(fullText, startChar, endChar) {
  if (startChar < 0 || endChar > fullText.length) return "";
  return fullText.substring(startChar, endChar);
}

/**
 * Adjust bit boundary by a character offset
 * @param {object} bit - The bit object with textPosition
 * @param {string} direction - 'start' or 'end'
 * @param {number} amount - Number of characters to adjust (can be negative)
 * @returns {object} New position
 */
export function adjustBoundary(bit, direction, amount) {
  const pos = { ...bit.textPosition };

  if (direction === 'start') {
    pos.startChar = Math.max(0, pos.startChar + amount);
  } else if (direction === 'end') {
    pos.endChar = Math.max(pos.startChar + 1, pos.endChar + amount);
  }

  return pos;
}

/**
 * Snap a character position to the nearest word boundary
 * @param {string} text - The full text
 * @param {number} charIndex - The character index
 * @param {string} direction - 'start' (move left) or 'end' (move right)
 * @returns {number} New character index at word boundary
 */
export function findWordBoundary(text, charIndex, direction = 'start') {
  if (direction === 'start') {
    // Move backwards to start of word
    let i = charIndex;
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    while (i > 0 && !/\s/.test(text[i - 1])) i--;
    return i;
  } else {
    // Move forwards to end of word
    let i = charIndex;
    while (i < text.length && !/\s/.test(text[i])) i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    return i;
  }
}

/**
 * Calculate line and column numbers from character position
 * @param {string} text - The full text
 * @param {number} charIndex - Character position
 * @returns {object} {line, column}
 */
export function getLineColumn(text, charIndex) {
  let line = 1;
  let column = 1;

  for (let i = 0; i < charIndex && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return { line, column };
}

/**
 * Find line boundaries for a character position
 * @param {string} text - The full text
 * @param {number} charIndex - Character position
 * @returns {object} {startLine, endLine, startChar, endChar}
 */
export function getLineBoundaries(text, charIndex) {
  let lineStart = 0;
  let lineEnd = text.length;
  let currentPos = 0;
  let lineNum = 1;

  for (let i = 0; i < text.length; i++) {
    if (i === charIndex) {
      lineStart = currentPos;
      // Find end of current line
      while (lineEnd > 0 && text[lineEnd - 1] !== '\n') lineEnd--;
      lineEnd = text.indexOf('\n', i);
      if (lineEnd === -1) lineEnd = text.length;
      break;
    }

    if (text[i] === '\n') {
      currentPos = i + 1;
      lineNum++;
    }
  }

  return {
    startLine: lineNum,
    endLine: lineNum,
    startChar: lineStart,
    endChar: lineEnd,
  };
}
