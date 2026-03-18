# Topix

Comedy transcript parser that identifies repeated jokes across performances. Upload transcripts, extract bits via local LLM, and build a searchable database of recurring touchstones.

## Stack

- React 19 SPA (Vite, no TypeScript)
- Local LLM via [Ollama](https://ollama.ai) (default: `qwen3.5:9b`)
- Text embeddings via Ollama (default: `mxbai-embed-large`)
- IndexedDB for client-side persistence
- Node.js backend server (port 3001) for audio and file management

## Setup

```bash
npm install

# App only (no audio features)
npm run dev

# App + backend server
npm run dev:full
```

Requires Ollama running locally on port 11434.

### Recommended Ollama models

```bash
ollama pull qwen3.5:9b          # default parse/match model
ollama pull mxbai-embed-large   # embedding model for similarity search
```

You can switch models at runtime from the settings panel in the UI.

## How It Works

1. **Upload** comedy transcripts as plain text files
2. **Parse** — LLM extracts discrete bits (title, summary, fullText, tags, keywords, character positions)
3. **Hunt** — cross-transcript batch matching finds the same joke across performances
4. **Touchstones** — recurring jokes are clustered with union-find and surfaced for confirmation
5. **Mix** — join, split, and adjust bit boundaries within transcripts without re-parsing
6. **Play** — browse and rate audio recordings synced to transcript bits
7. **Export** — generate an Obsidian vault or JSON backup of the full database

## Key Concepts

- **Bit**: A discrete comedy unit extracted from a transcript — setup, punchline, and all follow-up riffs on the same premise, stored with exact character positions in the source text.
- **Touchstone**: A recurring joke identified across multiple performances — same premise, same punchline. Clustered automatically and confirmed by the user.
- **Match**: An LLM-detected relationship between two bits:
  - `same_bit` (90%+) — forms touchstone clusters
  - `evolved` (70–89%) — forms touchstone clusters
  - `related` / `callback` — informational only, does not cluster
- **Root Bit**: The canonical representative of a touchstone cluster, used as the merge target for deduplication.

## Matching Philosophy

Touchstones represent the **same joke**, not the same topic. Two bits about dating with different punchlines are NOT a touchstone. The test: would a comedy fan say "she's doing that bit again"?

## Tabs

| Tab | Description |
|-----|-------------|
| **Play** | Browse audio recordings, rate files, play alongside transcript |
| **Upload** | Add new transcripts; trigger parse loop |
| **Transcripts** | View all transcripts; open Mix panel for bit editing |
| **Database** | Search and browse all extracted bits |
| **Tags** | Browse and filter bits by tag |
| **Hunt** | Run cross-transcript matching to find touchstones |
| **Touchstones** | Review, confirm, and manage touchstone clusters |
| **Analytics** | Stats on bits, matches, coverage, and tag frequency |
| **Dedup** | Find and merge duplicate bits |
| **Sync** | Sync transcript files from the filesystem |
| **Export** | Export as Obsidian vault or JSON backup |
| **Validation** | Validate bit character positions against source text |

## Project Structure

```
src/
├── comedy-parser.jsx              Main component — all state and handlers
├── App.jsx
├── main.jsx
├── styles.css
├── components/
│   ├── AnalyticsDashboard.jsx     Stats and insights
│   ├── BitEditor.jsx              Inline bit editing
│   ├── BitJoiner.jsx              Join adjacent bits
│   ├── BoundaryAdjuster.jsx       Fine-tune bit start/end positions
│   ├── DatabaseTab.jsx            Searchable bit database
│   ├── DebugPanel.jsx             LLM debug log
│   ├── DedupTab.jsx               Duplicate detection and merging
│   ├── DetailPanel.jsx            Single bit detail sidebar
│   ├── ExportTab.jsx              Obsidian / JSON export
│   ├── FlowVisualization.jsx      Bit flow diagram
│   ├── MergePanel.jsx             Manual touchstone merging
│   ├── MixPanel.jsx               Bit join/split/boundary editing
│   ├── NetworkGraph.jsx           D3 relationship graph
│   ├── PlayTab.jsx                Audio player with transcript sync
│   ├── StreamingProgressPanel.jsx Live LLM streaming progress
│   ├── SyncTab.jsx                Filesystem transcript sync
│   ├── TagsTab.jsx                Tag browser
│   ├── TouchstonePanel.jsx        Touchstone management UI
│   ├── TranscriptTab.jsx          Transcript table with inline Mix
│   ├── TranscriptViewer.jsx       Full transcript view
│   ├── UploadTab.jsx              Transcript upload
│   └── ValidationTab.jsx          Bit position validation
└── utils/
    ├── autoDedup.js               Automatic deduplication (absorb/merge)
    ├── bitFlowAnalyzer.js         Bit flow analysis
    ├── bitMerger.js               Root bit creation and merging
    ├── bitOperations.js           Split, join, boundary, overlap ops
    ├── database.js                IndexedDB persistence layer
    ├── embeddings.js              Embedding store (mxbai-embed-large)
    ├── huntRunner.js              Batch hunt orchestration
    ├── jsonParser.js              Partial/streaming JSON parsing
    ├── obsidianExport.js          Obsidian vault generator
    ├── ollama.js                  Ollama API wrapper + generation queue
    ├── opQueue.js                 Serialized async operation queue
    ├── parseLoop.js               Parse loop orchestration
    ├── positionTracker.js         Char position utilities
    ├── preClustering.js           Pre-clustering before LLM hunt
    ├── prompts.js                 All LLM system prompts
    ├── similaritySearch.js        Text similarity scoring and search
    ├── textContinuityValidator.js Validates bit text against transcript
    ├── textMatcher.js             Fuzzy text position finder
    ├── textSimilarity.js          String similarity utilities
    └── touchstoneDetector.js      Union-find touchstone clustering

server/
├── filename.js                    Audio filename parsing and formatting
└── hash.js                        File hashing utilities

server.js                          Backend server (port 3001)
```

## Backend Server API

The optional Node.js server (`npm run server`) provides audio file management:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Ollama health check |
| `/api/restart-ollama` | POST | Restart the local Ollama process |
| `/api/transcripts` | GET | List transcript files from disk |
| `/api/transcripts/:id` | GET | Fetch a single transcript file |
| `/api/audio/:file` | GET | Stream an audio file |
| `/api/files/:id/rate` | POST | Set star rating on a file |
| `/api/files/:id/rename` | POST | Rename a file |
| `/api/files/:id/trim` | POST | Trim audio file (start/end) |
| `/api/files/:id/delete` | DELETE | Delete a file |

Audio files are read from `AUDIO_DIR` (configured in `server.js`).

## LLM Generation Queue

All Ollama calls are serialized through a global generation queue so parse, hunt, and embed jobs don't contend on the GPU. Each call waits for the previous one to finish before starting.

## Data Persistence

All transcript, bit, match, and touchstone data is stored in IndexedDB in the browser. Use **Export → JSON** to create portable backups. The database can be fully restored from a JSON export.
