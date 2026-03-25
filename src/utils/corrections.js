/**
 * Apply word corrections to text.
 * Accepts an array of {from, to, pattern?} objects.
 * If pattern is true, `from` is used as a regex pattern; otherwise it's escaped for literal match.
 * All replacements are case-insensitive and global.
 */
export function applyCorrections(text, corrections) {
  if (!text || !corrections || corrections.length === 0) return text;
  let result = text;
  for (const c of corrections) {
    try {
      const pattern = c.pattern
        ? c.from
        : c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(pattern, 'gi'), c.to);
    } catch {
      // Invalid regex — skip
    }
  }
  return result;
}

/**
 * Merge touchstone-specific corrections with universal corrections.
 * Touchstone corrections take priority (applied first).
 */
export function mergeCorrections(touchstoneCorrections, universalCorrections) {
  const ts = touchstoneCorrections || [];
  const uni = universalCorrections || [];
  if (ts.length === 0 && uni.length === 0) return [];
  // Deduplicate: touchstone-specific corrections override universal ones with same `from`
  const fromSet = new Set(ts.map(c => c.from.toLowerCase()));
  const deduped = uni.filter(c => !fromSet.has(c.from.toLowerCase()));
  return [...ts, ...deduped];
}
