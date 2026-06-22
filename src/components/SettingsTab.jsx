import LLMConfigPanel from "./LLMConfigPanel";
import { ExportTab } from "./ExportTab";

export function SettingsTab({
  availableModels,
  selectedModel,
  onSelectModel,
  embeddingModel,
  onSelectEmbeddingModel,
  processing,
  matches,
  topics,
  onMassCommunion,
  transcriptOps,
}) {
  return (
    <div className="settings-container">
      {/* Model Selection */}
      <h2 className="section-heading">Models</h2>
      <div className="card card-static card-flex">
        {availableModels.length > 0 && (
          <div>
            <div className="field-label">LLM Model</div>
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              className="dark-select"
            >
              {availableModels.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
        )}
        {availableModels.filter(m => m.toLowerCase().includes("embed")).length > 0 && (
          <div>
            <div className="field-label">Embedding Model</div>
            <select
              value={embeddingModel}
              onChange={(e) => onSelectEmbeddingModel(e.target.value)}
              title="Embedding model for semantic search"
              className="dark-select embed"
            >
              {availableModels.filter(m => m.toLowerCase().includes("embed")).map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* API Keys */}
      <h2 className="section-heading mt">External LLMs</h2>
      <div className="card card-static">
        <p className="settings-description">
          Configure API keys for high-end models. Used by "Send to..." on touchstone details. Keys are stored server-side only.
        </p>
        <LLMConfigPanel />
      </div>

      {/* Match Maintenance */}
      <h2 className="section-heading mt">Match Maintenance</h2>
      <div className="card card-static">
        <p className="settings-description">
          Mass Communion re-evaluates every stored match via the LLM, removing false positives. Processes the most-matched bits first.
        </p>
        <div className="action-row">
          <button
            onClick={onMassCommunion}
            disabled={processing || matches.length === 0}
            className={`mass-communion-btn ${processing || matches.length === 0 ? "disabled" : "enabled"}`}
          >
            {processing ? "Running..." : `Mass Communion (${matches.length} matches)`}
          </button>
          <span className="connection-count">
            {topics.filter((t) => matches.some((m) => m.sourceId === t.id || m.targetId === t.id)).length} bits with connections
          </span>
        </div>
      </div>

      {/* Data Management */}
      <h2 className="section-heading mt">Data Management</h2>
      <div className="card card-static">
        <div className="data-btn-row">
          {[
            { label: "Backup", icon: "📥", onClick: transcriptOps.handleBackup, title: "Download a full database backup as JSON", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
            { label: "Restore", icon: "📤", onClick: transcriptOps.handleRestore, title: "Restore database from a backup JSON file", bg: "#1a1a2a", border: "#2a2a40", color: "#888" },
            { label: "Reset Touchstones", icon: "🔄", onClick: transcriptOps.handleResetTouchstones, title: "Clear all touchstones and matches for re-detection", bg: "#1a1a2a", border: "#2a2a40", color: "#ff6b6b" },
            { label: "Reset Transcripts", icon: "🔄", onClick: transcriptOps.clearProcessedData, title: "Clear bits, matches, touchstones — keep transcripts", bg: "#1a2a3a", border: "#224466", color: "#74c0fc" },
            { label: "Fresh DB", icon: "⚠️", onClick: transcriptOps.clearAllData, title: "Delete all data and start over", bg: "#3a1a1a", border: "#662222", color: "#ff6b6b" },
          ].map(({ label, icon, onClick, title, bg, border, color }) => (
            <button
              key={label}
              onClick={onClick}
              title={title}
              className="data-btn"
              style={{ background: bg, border: `1px solid ${border}`, color }}
              onMouseEnter={(e) => { e.target.style.borderColor = color; }}
              onMouseLeave={(e) => { e.target.style.borderColor = border; }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Export */}
      <div className="export-spacer" />
      <ExportTab
        topics={topics}
        exportVault={transcriptOps.exportVault}
        exportMarkdownZip={transcriptOps.exportMarkdownZip}
        exportSingleMd={transcriptOps.exportSingleMd}
        syncToVault={transcriptOps.syncToVault}
        undoVaultSync={transcriptOps.undoVaultSync}
      />
    </div>
  );
}
