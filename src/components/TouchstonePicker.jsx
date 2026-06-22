import { searchTouchstones } from "../utils/touchstoneSearch";
import { KeywordBadge } from "./touchstoneShared";

export function TouchstonePicker({ accentColor, header, targets, search, setSearch, onSelect, disabled, result }) {
  return (
    <div style={{ marginBottom: 12, padding: 12, background: "#0d0d16", borderRadius: 8, border: `1px solid ${accentColor}33` }}>
      <div style={{ fontSize: 11, color: accentColor, fontWeight: 600, marginBottom: 8 }}>
        {header}
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search touchstones..."
        autoFocus
        style={{ width: "100%", padding: "6px 10px", background: "#0a0a14", border: "1px solid #252538", borderRadius: 4, color: "#ddd", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
      />
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {searchTouchstones(targets, search).map((target) => (
          <div
            key={target.id}
            onClick={() => { if (!disabled) onSelect(target); }}
            style={{ padding: "8px 10px", cursor: disabled ? "default" : "pointer", fontSize: 12, color: "#bbb", borderBottom: "1px solid #1a1a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a2a"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <div>
              <span style={{ fontWeight: 600, color: "#ddd", display: "flex", alignItems: "center" }}>
                <KeywordBadge keyword={target.keyword} />
                {target.name}
              </span>
              <span style={{ marginLeft: 8, fontSize: 10, color: target.category === "confirmed" ? "#51cf66" : "#ffa94d" }}>
                {target.category}
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#666" }}>{target.instances.length} instances</span>
          </div>
        ))}
      </div>
      {result && (
        <div style={{ marginTop: 8, fontSize: 11, color: result.accepted > 0 ? "#51cf66" : "#ff8888" }}>
          {result.accepted} accepted, {result.rejected} rejected by LLM.
        </div>
      )}
    </div>
  );
}
