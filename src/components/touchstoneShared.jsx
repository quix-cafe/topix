import { parseFilenameClient, ratingColor, RATING_FONT } from "../utils/filenameUtils";

export const RELATIONSHIP_OPTIONS = ["same_bit", "evolved", "related", "callback", "tag-on"];

export const COMMUNION_STATUS_CONFIG = {
  sainted: { label: "Sainted", color: "#f5c218", bg: "#f5c21818", border: "#f5c21833", icon: "✦" },
  blessed: { label: "Blessed", color: "#51cf66", bg: "#51cf6618", border: "#51cf6633", icon: "✓" },
  purgatory: { label: "Purgatory", color: "#888", bg: "#88888818", border: "#88888833", icon: "◌" },
  damned: { label: "Damned", color: "#ff6b6b", bg: "#ff6b6b18", border: "#ff6b6b33", icon: "⚠" },
};

export function pctColor(pct) {
  if (pct >= 90) return "#51cf66";
  if (pct >= 80) return "#8bc98b";
  if (pct >= 70) return "#ffa94d";
  if (pct >= 60) return "#e8a44c";
  if (pct >= 50) return "#ff8c42";
  if (pct >= 40) return "#ff6b6b";
  return "#cc5555";
}

export function KeywordBadge({ keyword }) {
  if (!keyword) return null;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#4ecdc4", background: "#4ecdc418", padding: "1px 6px", borderRadius: 3, border: "1px solid #4ecdc433", marginRight: 6, letterSpacing: 0.3, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {keyword}
    </span>
  );
}

export function StyledFilename({ sourceFile, style }) {
  const p = parseFilenameClient(sourceFile || "");
  const rc = ratingColor(p.rating);
  return (
    <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", ...style }}>
      {p.rating && <span style={{ padding: "1px 3px", borderRadius: 2, background: rc.bg, color: rc.fg, fontWeight: 700, ...RATING_FONT }}>{p.rating}</span>}
      <span style={{ color: "#666", marginLeft: p.rating ? 3 : 0 }}>{p.title}</span>
      {p.duration && <span style={{ color: "#74c0fc", marginLeft: 3 }}>{p.duration}</span>}
    </span>
  );
}
