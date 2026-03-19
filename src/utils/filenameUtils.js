/**
 * Shared filename parsing and rating color utilities.
 */

/** Numeric value for sorting: xxxxx=-5, _____=0, +=1..5 */
export function ratingValue(rating) {
  if (!rating) return -99;
  const plusCount = (rating.match(/\+/g) || []).length;
  const xCount = (rating.match(/x/g) || []).length;
  if (xCount > 0) return -xCount;
  if (plusCount > 0) return plusCount;
  return 0;
}

export function parseFilenameClient(filename) {
  const ratingMatch = filename.match(/^\[(.{5})\]\s*/);
  const durationMatch = filename.match(/\s*\{(\d+):(\d+)\}/);
  const rating = ratingMatch ? ratingMatch[1] : null;
  const title = filename
    .replace(/^\[.{5}\]\s*/, "")
    .replace(/\s*\{\d+:\d+\}/, "")
    .replace(/\.\w+$/, "") // strip extension
    .trim();
  const duration = durationMatch
    ? `${String(parseInt(durationMatch[1])).padStart(2, "0")}:${String(parseInt(durationMatch[2])).padStart(2, "0")}`
    : null;
  return { rating, title, duration };
}

/** Base style for rating badge text — monospace without ligatures */
export const RATING_FONT = {
  fontFamily: "'Courier New', Courier, monospace",
  fontVariantLigatures: "none",
  fontWeight: 700,
};

export function ratingColor(rating) {
  if (!rating) return { bg: "#1a1a2a", fg: "#555" };
  const plusCount = (rating.match(/\+/g) || []).length;
  const xCount = (rating.match(/x/g) || []).length;
  if (xCount >= 2) return { bg: "#ff6b6b18", fg: "#ff6b6b" };       // xx___ and worse → red
  if (plusCount >= 2) return { bg: "#51cf6618", fg: "#51cf66" };     // ++___ and better → green
  // Center 3: x____, _____, +____ → blue
  return { bg: "#74c0fc18", fg: "#74c0fc" };
}
