/**
 * JSON parsing utilities for streaming/partial Ollama responses
 */

import { normalizeBit } from "./ollama.js";

/**
 * Try to parse partial/incomplete JSON from text
 * Useful for streaming responses that may not be complete
 */
export function tryParsePartialJSON(text) {
  if (!text) return null;

  // Remove markdown code blocks
  let cleaned = text.replace(/```json\s?|```/g, "").trim();

  // Try to find JSON array
  const arrayStart = cleaned.indexOf('[');
  if (arrayStart === -1) return null;

  // Find matching closing bracket
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '[') depth++;
      if (char === ']') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.substring(arrayStart, i + 1));
            if (Array.isArray(parsed)) {
              return parsed.map(normalizeBit).filter(Boolean);
            }
            return parsed;
          } catch (e) {
            return null;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parse partial/incomplete JSON objects from frozen stream output
 * Extracts whatever fields are available from incomplete bit objects
 * Useful when stream freezes mid-response
 */
export function tryParsePartialBits(text) {
  if (!text) return [];

  const partialBits = [];

  // Remove markdown code blocks
  let cleaned = text.replace(/```json\s?|```/g, "").trim();

  // Find all potential bit objects - look for { ... patterns
  // Match from opening { to either } or end of text
  const objectPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  const matches = cleaned.match(objectPattern) || [];

  for (const match of matches) {
    try {
      const obj = JSON.parse(match);
      const bit = normalizeBit(obj);
      if (bit) partialBits.push(bit);
    } catch (e) {
      const partialBit = extractPartialBitFields(match);
      const bit = normalizeBit(partialBit);
      if (bit) partialBits.push(bit);
    }
  }

  // Also try to extract incomplete objects that might not have closing }
  const incompletePattern = /\{[^}]*"fullText"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/g;
  let match;
  while ((match = incompletePattern.exec(cleaned)) !== null) {
    const fullTextMatch = match[0];
    const fullText = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    if (!partialBits.some(b => b.fullText === fullText)) {
      const titleMatch = fullTextMatch.match(/"title"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      const bit = normalizeBit({
        title: titleMatch ? titleMatch[1].replace(/\\"/g, '"') : null,
        fullText: fullText,
      });
      if (bit) partialBits.push(bit);
    }
  }

  return partialBits;
}

/**
 * Extract whatever fields we can from incomplete JSON text
 */
export function extractPartialBitFields(jsonText) {
  const bit = {};

  // Extract title
  const titleMatch = jsonText.match(/"title"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (titleMatch) {
    bit.title = titleMatch[1].replace(/\\"/g, '"');
  }

  // Extract fullText (most important for removing from remaining text)
  const fullTextMatch = jsonText.match(/"fullText"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (fullTextMatch) {
    bit.fullText = fullTextMatch[1].replace(/\\"/g, '"');
  }

  // Extract summary if available
  const summaryMatch = jsonText.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (summaryMatch) {
    bit.summary = summaryMatch[1].replace(/\\"/g, '"');
  }

  // Extract tags if available
  const tagsMatch = jsonText.match(/"tags"\s*:\s*\[([^\]]*)\]/);
  if (tagsMatch) {
    try {
      bit.tags = JSON.parse(`[${tagsMatch[1]}]`);
    } catch (e) {
      bit.tags = [];
    }
  } else {
    bit.tags = [];
  }

  // Set defaults for other fields
  bit.keywords = [];
  bit.textPosition = { startChar: 0, endChar: 0 };

  return bit.fullText ? bit : null;
}

/**
 * Extract all complete JSON objects from streaming text
 * Finds individual {...} objects regardless of array completion
 * Returns array of parsed bit objects that have fullText
 */
export function extractCompleteJsonObjects(text) {
  if (!text) return [];
  return extractCompleteJsonObjectsFrom(text, 0).objects;
}

/**
 * Extract complete JSON objects from text starting at a given offset.
 * Returns { objects: Array, endPos: number } where endPos is the character
 * position just past the last complete object found (use as cursor for next call).
 * If no objects are found, endPos equals startIndex so the cursor doesn't advance.
 *
 * @param {string} text - Full accumulated text
 * @param {number} startIndex - Character index to start scanning from
 * @returns {{ objects: Array, endPos: number }}
 */
export function extractCompleteJsonObjectsFrom(text, startIndex = 0) {
  if (!text || startIndex >= text.length) return { objects: [], endPos: startIndex };

  const objects = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;
  let endPos = startIndex;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      if (depth === 0) {
        objectStart = i;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        // Found a complete object
        const objectText = text.substring(objectStart, i + 1);
        try {
          const obj = JSON.parse(objectText);
          const bit = normalizeBit(obj);
          if (bit) {
            objects.push(bit);
            endPos = i + 1;  // Advance past this complete object
          }
        } catch (e) {
          // Skip invalid JSON objects
        }
        objectStart = -1;
      }
    }
  }

  return { objects, endPos };
}

/**
 * Extract raw JSON objects from text without normalizeBit filtering.
 * Used by callOllama for non-bit JSON responses (e.g. dedup results).
 */
export function extractRawJsonObjects(text) {
  if (!text) return [];

  // Strip markdown fences
  const cleaned = text.replace(/```json\s?|```/g, "").trim();

  const objects = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"' && !escaped) { inString = !inString; continue; }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        try {
          const obj = JSON.parse(cleaned.substring(objectStart, i + 1));
          if (obj && typeof obj === 'object') objects.push(obj);
        } catch (e) { /* skip */ }
        objectStart = -1;
      }
    }
  }

  return objects;
}
