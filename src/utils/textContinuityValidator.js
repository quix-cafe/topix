/**
 * Text continuity validator - Ensures bits map to valid, non-overlapping positions
 */

/**
 * Validate a single bit's position
 * @param {object} bit - The bit object with textPosition
 * @param {string} transcriptText - The full transcript text
 * @returns {object} {valid, errors}
 */
export function validateBit(bit, transcriptText) {
  const errors = [];

  if (!bit.textPosition) {
    errors.push({ message: "No position data", severity: Infinity });
    return { valid: false, errors };
  }

  const { startChar, endChar } = bit.textPosition;

  // Check bounds
  if (startChar < 0) {
    errors.push({ message: `Start position ${startChar} is negative`, severity: Math.abs(startChar) });
  }

  if (endChar > transcriptText.length) {
    errors.push({ message: `End position ${endChar} exceeds transcript length ${transcriptText.length}`, severity: endChar - transcriptText.length });
  }

  // Check validity
  if (startChar >= endChar) {
    errors.push({ message: `Start position (${startChar}) >= end position (${endChar})`, severity: Infinity });
  }

  // Verify text match
  if (errors.length === 0 && bit.fullText) {
    const extractedText = transcriptText.substring(startChar, endChar);
    const similarity = calculateSimilarity(bit.fullText, extractedText);

    if (similarity < 0.8) {
      const mismatchChars = Math.round((1 - similarity) * Math.max(bit.fullText.length, extractedText.length));
      errors.push({
        message: `Text mismatch: stored text doesn't match position (${Math.round(similarity * 100)}% similarity)`,
        severity: mismatchChars,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all bits in a set of transcripts
 * @param {array} bits - Array of bit objects
 * @param {array} transcripts - Array of transcript objects
 * @returns {object} {valid, issues, summary}
 */
export function validateAllBits(bits, transcripts) {
  const issues = [];
  const transcriptMap = {};

  // Build map of transcripts by name/id
  transcripts.forEach((tr) => {
    transcriptMap[tr.name] = tr;
    transcriptMap[tr.id] = tr;
  });

  bits.forEach((bit) => {
    const transcript = transcriptMap[bit.sourceFile] || transcriptMap[bit.transcriptId];

    if (!transcript) {
      issues.push({
        bitId: bit.id,
        bitTitle: bit.title,
        error: "Source transcript not found",
        severity: Infinity,
      });
      return;
    }

    const validation = validateBit(bit, transcript.text);

    if (!validation.valid) {
      validation.errors.forEach((err) => {
        issues.push({
          bitId: bit.id,
          bitTitle: bit.title,
          source: bit.sourceFile,
          error: err.message,
          severity: err.severity,
        });
      });
    }
  });

  // Check for overlaps within each transcript
  const overlapIssues = findOverlaps(bits, transcriptMap);
  issues.push(...overlapIssues);

  return {
    valid: issues.length === 0,
    issues,
    summary: {
      total: bits.length,
      valid: bits.length - issues.length,
      invalid: issues.length,
    },
  };
}

/**
 * Find overlapping bits within transcripts
 * @param {array} bits - Array of bit objects
 * @param {object} transcriptMap - Map of transcript objects by name/id
 * @returns {array} Array of overlap issues
 */
export function findOverlaps(bits, transcriptMap) {
  const issues = [];
  const transcriptGroups = {};

  // Group bits by transcript
  bits.forEach((bit) => {
    const key = bit.sourceFile || bit.transcriptId;
    if (!transcriptGroups[key]) {
      transcriptGroups[key] = [];
    }
    transcriptGroups[key].push(bit);
  });

  // Check each transcript for overlaps
  Object.entries(transcriptGroups).forEach(([transcriptKey, groupBits]) => {
    const sorted = groupBits.sort((a, b) => (a.textPosition?.startChar || 0) - (b.textPosition?.startChar || 0));

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      const currentEnd = current.textPosition?.endChar || 0;
      const nextStart = next.textPosition?.startChar || 0;

      if (currentEnd > nextStart) {
        const overlapChars = Math.abs(currentEnd - nextStart);
        issues.push({
          bitId: current.id,
          bitTitle: current.title,
          source: current.sourceFile,
          error: `Overlaps with "${next.title}" (${overlapChars} chars)`,
          overlappingBitId: next.id,
          severity: overlapChars,
        });
      }
    }
  });

  return issues;
}

/**
 * Enforce continuity - return report of non-continuous bits
 * @param {array} bits - Array of bits
 * @param {string} transcriptText - Full transcript text
 * @returns {object} {continuous, gaps, summary}
 */
export function enforceContiguity(bits, transcriptText) {
  const sorted = [...bits]
    .filter((b) => b.textPosition)
    .sort((a, b) => a.textPosition.startChar - b.textPosition.startChar);

  const gaps = [];
  let lastEnd = 0;

  sorted.forEach((bit) => {
    const start = bit.textPosition.startChar;

    if (start > lastEnd) {
      gaps.push({
        startChar: lastEnd,
        endChar: start,
        length: start - lastEnd,
        text: transcriptText.substring(lastEnd, start),
      });
    }

    lastEnd = bit.textPosition.endChar;
  });

  // Check if there's uncovered text at the end
  if (lastEnd < transcriptText.length) {
    gaps.push({
      startChar: lastEnd,
      endChar: transcriptText.length,
      length: transcriptText.length - lastEnd,
      text: transcriptText.substring(lastEnd),
    });
  }

  return {
    continuous: gaps.length === 0,
    gaps,
    coverage: sorted.length > 0 ? (lastEnd / transcriptText.length) * 100 : 0,
    summary: {
      totalBits: sorted.length,
      totalCovered: lastEnd,
      totalUncovered: transcriptText.length - lastEnd,
      coveragePercent: Math.round((lastEnd / transcriptText.length) * 100),
    },
  };
}

/**
 * Calculate text similarity (0-1) using word overlap
 */
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  const words1 = text1.toLowerCase().match(/\b\w{2,}\b/g) || [];
  const words2 = text2.toLowerCase().match(/\b\w{2,}\b/g) || [];

  if (words1.length === 0 || words2.length === 0) return 0;

  const bag1 = new Map();
  for (const w of words1) bag1.set(w, (bag1.get(w) || 0) + 1);
  const bag2 = new Map();
  for (const w of words2) bag2.set(w, (bag2.get(w) || 0) + 1);

  let overlap = 0;
  for (const [word, count] of bag1) {
    overlap += Math.min(count, bag2.get(word) || 0);
  }

  return overlap / Math.max(words1.length, words2.length);
}

/**
 * Auto-correct bit positions based on full text search
 * @param {object} bit - Bit with fullText property
 * @param {string} transcriptText - Full transcript
 * @returns {object} Corrected textPosition or null
 */
export function autoCorrectPosition(bit, transcriptText) {
  if (!bit.fullText) return null;

  const searchText = bit.fullText.trim();
  const pos = transcriptText.indexOf(searchText);

  if (pos === -1) {
    // Try fuzzy search
    const fuzzyPos = findFuzzyMatch(transcriptText, searchText);
    return fuzzyPos ? { startChar: fuzzyPos.start, endChar: fuzzyPos.end } : null;
  }

  return {
    startChar: pos,
    endChar: pos + searchText.length,
  };
}

/**
 * Find fuzzy match in text
 */
function findFuzzyMatch(fullText, searchText) {
  const minMatchLength = Math.max(50, Math.floor(searchText.length * 0.6));

  // Try progressively longer matches
  for (let len = searchText.length; len >= minMatchLength; len--) {
    for (let offset = 0; offset <= searchText.length - len; offset++) {
      const substr = searchText.substring(offset, offset + len);
      const pos = fullText.indexOf(substr);

      if (pos !== -1) {
        // Estimate bounds
        const startChar = Math.max(0, pos - offset);
        const endChar = Math.min(fullText.length, pos + (searchText.length - offset));
        return { start: startChar, end: endChar };
      }
    }
  }

  return null;
}
