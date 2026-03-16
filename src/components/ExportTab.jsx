export function ExportTab({
  topics,
  exportVault,
  exportMarkdownZip,
  exportSingleMd,
}) {
  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: 22,
        fontWeight: 700,
        marginBottom: 20,
        color: "#eee",
      }}>
        Export to Obsidian
      </h2>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>JSON Vault Export</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Downloads a structured JSON file containing all markdown files, frontmatter, wikilinks, and tags. Use a script or manually extract into your Obsidian vault.
        </p>
        <button className="btn btn-primary" onClick={exportVault} disabled={topics.length === 0}>
          Download JSON Vault
        </button>
      </div>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Combined Markdown</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Single .md file with all topics, tags, and links. Good for quick review or import.
        </p>
        <button className="btn btn-secondary" onClick={exportSingleMd} disabled={topics.length === 0}>
          Download Combined .md
        </button>
      </div>

      <div className="card" style={{ cursor: "default" }}>
        <div style={{ fontWeight: 600, color: "#eee", marginBottom: 6 }}>Individual Files</div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Downloads each topic as a separate .md file. Your browser may ask permission for multiple downloads. Place all files in a single Obsidian vault folder.
        </p>
        <button className="btn btn-secondary" onClick={exportMarkdownZip} disabled={topics.length === 0}>
          Download All .md Files
        </button>
      </div>

      <div style={{
        marginTop: 20,
        padding: 16,
        background: "#12121f",
        borderRadius: 10,
        border: "1px solid #1e1e30",
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#ffa94d", marginBottom: 8 }}>
          Obsidian Setup Tips
        </div>
        <div style={{ fontSize: 12, color: "#777", lineHeight: 1.7 }}>
          Each exported bit becomes a note with YAML frontmatter (tags, tone, structure, keywords) and <code style={{ color: "#74c0fc" }}>[[wikilinks]]</code> to matched bits. For the best graph experience, enable the core <strong style={{ color: "#bbb" }}>Graph View</strong> plugin and install <strong style={{ color: "#bbb" }}>Dataview</strong> for querying by tag/property. The <strong style={{ color: "#bbb" }}>Juggl</strong> or <strong style={{ color: "#bbb" }}>Graph Analysis</strong> community plugins will give you the richest network visualization. Connection types (same_bit, evolved, callback, related) and confidence scores are included in each note's links section.
        </div>
      </div>
    </div>
  );
}
