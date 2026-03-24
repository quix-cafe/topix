/**
 * Search touchstones across multiple fields, ranked by relevance.
 * Searches: name, idealText, summary (ideal text notes), matchInfo.reasons (why matched), tags
 *
 * Returns touchstones sorted by best match score (highest first).
 */
export function searchTouchstones(touchstones, query) {
  if (!query) return touchstones.slice(0, 30);
  const q = query.trim().toLowerCase();
  if (!q) return touchstones.slice(0, 30);

  const scored = [];
  for (const ts of touchstones) {
    let score = 0;

    // Name match (highest weight)
    const name = (ts.name || "").toLowerCase();
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 60;
    else if (name.includes(q)) score += 40;

    // Ideal text match
    if ((ts.idealText || "").toLowerCase().includes(q)) score += 25;

    // Summary match
    if ((ts.summary || "").toLowerCase().includes(q)) score += 20;

    // Why matched / reasons
    const reasons = ts.matchInfo?.reasons || [];
    for (const r of reasons) {
      if ((r || "").toLowerCase().includes(q)) { score += 15; break; }
    }

    // User reasons
    for (const r of (ts.userReasons || [])) {
      if ((r || "").toLowerCase().includes(q)) { score += 15; break; }
    }

    // Tags on instances / bit tags
    const tagStr = (ts.tags || []).join(" ").toLowerCase();
    if (tagStr.includes(q)) score += 10;

    // Instance titles
    for (const inst of (ts.instances || [])) {
      if ((inst.title || "").toLowerCase().includes(q)) { score += 8; break; }
    }

    if (score > 0) scored.push({ ts, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.ts);
}
