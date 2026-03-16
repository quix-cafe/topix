# Topix

Comedy transcript parser that identifies repeated jokes across performances. Upload transcripts, extract bits via local LLM, and build a database of recurring touchstones.

## Stack

- React SPA (Vite, no TypeScript)
- Local LLM via [Ollama](https://ollama.ai) (default: qwen3.5:9b)
- IndexedDB for persistence

## Setup

```bash
npm install
npm run dev
```

Requires Ollama running locally on port 11434.

## How It Works

1. **Upload** comedy transcripts (plain text)
2. **Parse** — LLM extracts discrete bits (setup + punchline + tags as one unit)
3. **Hunt** — cross-transcript matching finds the same joke across performances
4. **Touchstones** — recurring jokes are clustered and surfaced for confirmation
5. **Mix** — join, split, and adjust bit boundaries within transcripts
6. **Export** — Obsidian vault or JSON backup

## Key Concepts

- **Bit**: A discrete comedy unit extracted from a transcript
- **Touchstone**: A recurring joke identified across multiple performances — same premise, same punchline
- **Match**: An LLM-detected relationship between two bits (`same_bit` 90%+ or `evolved` 70-89%)
- Only `same_bit` and `evolved` matches form touchstone clusters; `related` and `callback` are informational only

## Matching Philosophy

Touchstones represent the **same joke**, not the same topic. Two bits about dating with different punchlines are NOT a touchstone. The test: would a comedy fan say "she's doing that bit again"?

## Project Structure

```
src/
├── comedy-parser.jsx          Main component, all state/handlers
├── components/
│   ├── TouchstonePanel.jsx    Touchstone management UI
│   ├── MixPanel.jsx           Bit join/split/boundary editing
│   ├── TranscriptTab.jsx      Transcript table with inline Mix
│   ├── DetailPanel.jsx        Single bit detail sidebar
│   ├── AnalyticsDashboard.jsx Stats and insights
│   ├── NetworkGraph.jsx       D3 relationship graph
│   ├── ValidationTab.jsx      Bit position validation
│   └── ...
├── utils/
│   ├── ollama.js              LLM API wrapper
│   ├── prompts.js             All system prompts
│   ├── touchstoneDetector.js  Clustering via union-find
│   ├── database.js            IndexedDB persistence
│   ├── similaritySearch.js    Text similarity scoring
│   └── ...
└── styles.css
```
