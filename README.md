# Topix Comedy Parser - Complete Codebase Documentation

**Project**: Comedy transcript parser for identifying and matching repeated jokes across performances  
**Architecture**: React SPA with Vite, Ollama LLM backend, IndexedDB persistence  
**Main Component**: `/src/comedy-parser.jsx` (~3050 lines)

---

## TABLE OF CONTENTS

1. [Core Architecture & Data Model](#core-architecture)
2. [Main Component (comedy-parser.jsx)](#main-component)
3. [State Management](#state-management)
4. [Database Layer](#database-layer)
5. [LLM Integration (Ollama)](#llm-integration)
6. [Touchstone Detection & Matching](#touchstone-detection)
7. [Auto-Dedup & Similarity](#auto-dedup)
8. [Bit Flow Analysis](#bit-flow-analysis)
9. [Utilities & Helpers](#utilities)
10. [Component Tree](#component-tree)
11. [Data Pathways & Flows](#data-pathways)

---

## CORE ARCHITECTURE

### Key Concepts

- **Bit**: A discrete comedy unit (joke/segment) extracted from a transcript
  - Properties: id, title, summary, fullText, tags, keywords, textPosition, sourceFile, transcriptId, etc.
  
- **Touchstone**: A recurring joke identified across multiple transcripts/performances
  - Categories: "confirmed" (verified), "possible" (detected but unverified), "rejected" (user dismissed)
  - Structure: bitIds[], instances[], frequency, name, summary, matchInfo, corrections, userReasons, rejectedReasons
  
- **Match**: A relationship detected between two bits by LLM
  - Relationships: "same_bit" (90%+ confidence), "evolved" (70-89%), "related" (40-69%), "callback" (meta-reference)
  - Only same_bit and evolved edges form touchstone clusters
  
- **Transcript**: Source material for bits
  - Properties: id, name, text, parsedAt

- **Root Bit**: Merged aggregation of multiple matched bits (not used heavily in current version)

### Data Flow Overview

```
Upload Transcript → Parse with Ollama → Extract Bits → AutoDedup (same-transcript)
↓
Save to IndexedDB → Detect Matches (Ollama) → Cluster into Touchstones
↓
User Confirms/Rejects Touchstones → Export or Further Analysis
```

---

## MAIN COMPONENT (src/comedy-parser.jsx)

### Component Signature
```javascript
export default function ComedyParser()
```

### State Structure
```javascript
const initialState = {
  transcripts: [],           // Array of uploaded transcript objects
  topics: [],                // All extracted bits
  matches: [],               // LLM-detected relationships between bits
  status: "",                // Current operation status message
  processing: false,         // Parsing/matching in progress
  activeTab: "upload",       // Current UI tab
  selectedTopic: null,       // Focused bit for detail view
  filterTag: null,           // Tag filter for bit list
  streamingProgress: null,   // Real-time parse progress
  foundBits: [],            // Bits found during streaming parse
  selectedTranscript: null,  // Transcript selected in MixPanel
  adjustingBit: null,        // Bit being adjusted (boundary)
  validationResult: null,    // Text position validation report
  editingMode: null,         // "split", "join", null
  touchstones: { confirmed: [], possible: [], rejected: [] },
  rootBits: [],             // Merged aggregations
  dbStats: null,            // Database statistics
  lastSave: null,           // Timestamp of last save
  selectedModel: "qwen3.5:9b",
  availableModels: [],
  shouldStop: false,        // Abort current operation
  debugMode: false,
  debugLog: [],             // Recent debug entries (max 20)
  dedupResults: [],         // Dedup pair matches waiting for user action
  dedupRunning: false,
  huntProgress: null,       // { current, total, found, status }
};
```

### State Management
- **Reducer**: Single reducer function with actions: SET, UPDATE, MERGE, MERGE_DEDUP, CLEAR_ALL
- **useRef**: stateRef, fileInput, restoreFileInput, abortControllerRef, huntControllerRef, dedupControllerRef
- **Named Setters**: useCallback helpers for stable prop references

### Major Methods

#### Parsing Flow
1. **handleFiles(fileList)**: Load text/md files into transcripts
2. **parseAll()** / **parseUnparsed()**: Stream LLM parse with SYSTEM_PARSE_V2
3. **handleNewBit(bit)**: Called on each bit found during streaming
   - Calls absorbOrMerge for same-transcript dedup
   - Saves to DB immediately via saveSingleTopic
   - Runs auto-matching if in continuous mode

#### Matching Flow
1. **runMatching()**: Compare all new/unparsed bits against existing
   - Batch processing to stay within context limits
   - Uses SYSTEM_HUNT_BATCH for scoring
   - Stores matches in state and DB
   - Updates touchstones after matching completes

2. **runDedup()**: Find same-joke duplicates (same or different transcripts)
   - Batch processing with cross-batch refinement
   - Surfaces pairs to user for merging decision

#### Touchstone Operations
1. **detectTouchstones() hook**: Auto-detect when bits/matches change
   - Filters to only same_bit/evolved edges (MIN_EDGE_SCORE = 50)
   - Clusters via union-find with constraints (1 bit per transcript per touchstone)
   - Caches LLM-generated names with fuzzy matching
   - Preserves user edits (manualName, corrections, userReasons, rejectedReasons)

2. **handleConfirmTouchstone(id)**: Move from possible → confirmed

3. **handleHuntSimilarBits(bitId)**: Deep search for matches for a specific bit
   - Uses similarity search to find candidates
   - Runs batch matching on candidates
   - Creates new possible touchstones for found matches

#### Bit Editing (MixPanel Operations)
1. **handleSplitBit(bitId, newBits)**: One bit becomes many
   - Updates all touchstones referencing old bitId
   - Updates match relationships

2. **handleJoinBits(bitsToJoin, joinedBit)**: Many bits become one
   - Prunes stale matches pointing to removed bits
   - Updates touchstone references

3. **handleBoundaryChange / handleScrollBoundary**: Adjust textPosition
   - Stores edit history on bit

#### Dedup & Merge
1. **runDedup()**: LLM-powered duplicate detection
   - Batch pairs for UI review

2. **mergeDedupPair(result, keepId)**: User confirms merge
   - Removes other bit, updates matches/touchstones

#### Database & Persistence
1. **loadSavedData()**: Load from IndexedDB on mount
2. Auto-save every 5s via effect on topics/matches/transcripts/touchstones/rootBits
3. **exportDatabase()** / **importDatabase()**: Full vault JSON export/import

---

## STATE MANAGEMENT

### Reducer Pattern
```javascript
function reducer(state, action) {
  switch(action.type) {
    case 'SET': return { ...state, [field]: value }
    case 'UPDATE': return { ...state, [field]: fn(state[field]) }
    case 'MERGE': return { ...state, ...payload }
    case 'MERGE_DEDUP': special dedup handling
    case 'CLEAR_ALL': reset to initialState
  }
}
```

### Immutable Update Helpers
- `set(field, value)` → dispatch SET
- `update(field, fn)` → dispatch UPDATE
- `dispatch({ type: 'MERGE', payload: {...} })`

### useEffect Hooks
1. **Mount**: Initialize DB, load saved data, load available models, detect interrupts
2. **Auto-save debounce**: Every 5s on state changes
3. **Validation**: Whenever topics/transcripts change
4. **Touchstone detection**: Whenever topics/matches change
5. **MixPanel nav**: Arrow key handling

---

## DATABASE LAYER (src/utils/database.js)

### Schema (IndexedDB)

**Database**: "comedy-parser-vault" (v1)

**Stores**:
- `transcripts`: {id, name, text, parsedAt, sourceFile, timestamp}
- `topics`: {id, title, summary, fullText, tags, keywords, textPosition, sourceFile, transcriptId, timestamp}
- `matches`: {id, sourceId, targetId, relationship, confidence, matchPercentage, reason, timestamp}
- `touchstones`: {id, name, bitIds, instances, category, matchInfo, corrections, userReasons, rejectedReasons, timestamp}
- `rootBits`: {id, title, mergedFrom, aggregateData, editHistory, timestamp}
- `metadata`: {id: "vault-state", lastSaved, stats}

**Indexes**: All stores indexed on timestamp, sourceFile (except metadata)

### API Functions

**Write Operations**:
- `saveTranscripts(array)` → syncStore
- `saveTopics(array)` → syncStore
- `saveMatches(array)` → syncStore
- `saveTouchstones(array)` → syncStore (flattens confirmed/possible to flat array)
- `saveRootBits(array)` → syncStore
- `saveSingleTopic(topic)` → put (durable immediately, no delete)
- `saveVaultState(vaultData)` → save all stores at once

**Read Operations**:
- `loadTranscripts()` → array
- `loadTopics()` → array
- `loadMatches()` → array
- `loadTouchstones()` → {confirmed, possible} (reconstructed from flat array)
- `loadRootBits()` → array
- `loadVaultState()` → {transcripts, topics, matches, touchstones, rootBits}

**Utility**:
- `syncStore(storeName, records)` → atomic transaction, deletes stale records
- `clearDatabase()` → wipe all
- `exportDatabaseAsJSON()` → {version, exportDate, metadata, data}
- `importDatabaseFromJSON(json)` → restore from export
- `getDatabaseStats()` → {transcripts, topics, matches, touchstones, rootBits} counts

---

## LLM INTEGRATION (src/utils/ollama.js)

### Ollama API Wrapper

**Health & Model Management**:
- `checkOllamaHealth()` → tries backend /api/health, fallback to /api/tags
- `getAvailableModels()` → fetch from /api/tags
- `requestOllamaRestart()` → POST /api/restart-ollama (graceful fallback)
- `uid()` → crypto.randomUUID().slice(0, 8)

### callOllama (Non-Streaming)
```javascript
async callOllama(system, userMsg, onStatus, model, debugCallback, externalSignal)
```
- Posts to http://localhost:11434/api/chat
- 120s timeout with AbortController
- Strips <think> blocks and markdown fences
- Tries 4 parse strategies: strict JSON, extractRawJsonObjects, tryParsePartialJSON, tryRepairTruncatedObject
- **Returns**: Parsed object(s)

### callOllamaStream (Streaming)
```javascript
async callOllamaStream(system, userMsg, callbacks, model, abortController, timeoutMs)
```

**Callbacks**:
- `onChunk(fullText)` → accumulated text so far
- `onBitFound(bit, bitCount)` → each complete bit found during streaming
- `onTagProgress(progress)` → tag processing updates
- `onComplete(result)` → final array
- `onError(error)` → fatal error
- `onFrozen({bitsFound, lastBitEndChar})` → timeout detected
- `onDebug(entry)` → debug log entry

**Flow**:
1. Streams from /api/chat with options: num_predict=16384, num_ctx=32768
2. Real-time extraction of complete JSON objects via extractCompleteJsonObjects
3. Emits bits as found to UI
4. Inactivity timer (default 30s): if no data received, attempts partial bit salvage
5. On completion: tries full JSON parse, fallback to partial extraction
6. **Returns**: filtered array of bits

### JSON Repair & Parsing (tryRepairTruncatedObject)
- Handles truncated responses from token limit overflow
- Progressively trims and closes unclosed structures
- Counts braces/brackets to repair

### Bit Normalization (normalizeBit)
```javascript
normalizeBit(raw) → {title, summary, fullText, tags, keywords, textPosition}
```
- Fills missing fields with sensible defaults
- Cleans whitespace, lowercases/hyphenates tags
- Validates fullText presence (required)

---

## TOUCHSTONE DETECTION (src/utils/touchstoneDetector.js)

### detectTouchstones(bits, matches, minFrequency=2)

**Algorithm**:
1. **Edge Filtering**: Only same_bit (weight 1.0) and evolved (weight 0.8) edges
   - Minimum edge score: `edgeScore = matchPercentage * relationshipWeight`
   - MIN_EDGE_SCORE = 50
2. **Constraint-based Clustering** (Union-Find):
   - Only cross-transcript edges (different sourceFile)
   - One bit per transcript per cluster (highest-scoring wins if multiple)
   - Growth threshold: larger clusters need stronger edges (MIN_EDGE_SCORE + 5 per member beyond 3)
3. **Merge Overlapping Touchstones**: Union-find on touchstone pairs connected by same_bit/evolved
4. **Output**: {confirmed: [], possible: [], rejected: []}
   - All detected start as "possible"
   - User manually moves to "confirmed" or "rejected"

### Touchstone Object
```javascript
{
  id: "touchstone-{timestamp}-{random}",
  name: "[3-5 word] or, [5-8 word]",
  summary: string,
  bitIds: [],                    // All bits (1 per transcript when possible)
  coreBitIds: [],               // Subset connected by same_bit/evolved
  instances: [{
    bitId, sourceFile, title, instanceNumber, confidence, relationship
  }],
  frequency: number,             // count(instances)
  crossTranscript: boolean,
  sourceCount: number,
  tags: [],                      // Union of all bit tags
  commonWords: [],              // Words appearing in 50%+ of bit titles
  firstAppearance: { transcriptId, bitId, sourceFile },
  matchInfo: {
    totalMatches, sameBitCount, evolvedCount, relatedCount, callbackCount,
    avgConfidence, avgMatchPercentage, reasons[]
  },
  category: "confirmed" | "possible" | "rejected",
  manualName?: true,            // User explicitly renamed
  autoNamed?: true,             // LLM generated and persisted
  corrections: { wordOld: "wordNew", ... },
  userReasons: ["reason1", ...],
  rejectedReasons: ["reason1", ...],  // Anti-criteria for matching
}
```

### Helper Functions

- `identifyCoreBits(cluster, matches)` → bitIds with strongest same_bit/evolved connections
- `createTouchstone(cluster, matches)` → full touchstone object from bit cluster
- `mergeOverlappingTouchstones(touchstones, matches, bitById)` → union-find touchstones
- `enforceOnePerTranscript(bits, matches)` → keep strongest-connected bit per file
- `generateTouchstoneName(cluster, commonWords)` → "[words]" format
- `generateTouchstoneSummary(cluster, matches)` → descriptive string
- `calculateInstanceConfidence(bit, cluster, matches)` → 0-1 score
- `getInstanceRelationship(bit, cluster, matches)` → "same_bit" | "evolved" | etc
- `annotateBitsWithTouchstones(bits, touchstones)` → add touchstoneId to bits
- `getTouchstoneInstances(touchstoneId, bits)` → filtered bits
- `getBitTouchstones(bitId, touchstones)` → touchstones containing this bit

---

## SYSTEM PROMPTS (src/utils/prompts.js)

### SYSTEM_PARSE_V2
- **Purpose**: Extract comedy bits from transcript
- **Key Instruction**: Treat entire transcript as one continuous joke stream; extract ALL comedic material with NO gaps
- **No splitting**: Each bit covers setup → punchline → tags as one unit, not separate
- **Output**: JSON array of {title, summary, fullText, tags, keywords, textPosition}

### SYSTEM_MATCH
- **Purpose**: For a NEW bit, find matching bits in existing collection
- **Relationship**: "same_bit" (90%+ confidence) or "evolved" (70-89%)
- **Output**: Array of {existingId, confidence, relationship}

### SYSTEM_DEDUP
- **Purpose**: Find same jokes within or across transcripts
- **Input**: Numbered list of bits (different transcripts or parse runs)
- **Output**: Groups of indices {group: [0,5,12], confidence, reason}

### SYSTEM_MATCH_PAIR
- **Purpose**: Compare exactly TWO bits
- **Scoring**: 90-100 (same_bit), 70-89 (evolved), 40-69 (related), 0-39 (none)
- **Output**: {match_percentage, relationship, reason}

### SYSTEM_HUNT_BATCH
- **Purpose**: Given SOURCE bit, find matches in CANDIDATE list
- **Strict**: Only 70+ scores included (same_bit/evolved), no "related"
- **Output**: Array of {candidate: idx, match_percentage, relationship, reason}

### SYSTEM_MERGE_BITS
- **Purpose**: Merge metadata from two overlapping bits
- **Output**: {title, summary, tags, keywords}

### SYSTEM_TOUCHSTONE_VERIFY
- **Purpose**: Verify candidate bits belong to touchstone group
- **Input**: Touchstone group, candidates, REJECTED_REASONING (anti-criteria)
- **Special**: Candidates connected ONLY through rejected reasons → rejected
- **Output**: {candidates: [{candidate, accepted, relationship, confidence}], group_reasoning: []}

---

## AUTO-DEDUP (src/utils/autoDedup.js)

### absorbOrMerge(newBit, existingBits, callOllamaFn, model)

Runs during parsing on each new bit to silently merge same-transcript duplicates.

**Checks** (in order):
1. **Substring containment**: newBit text ⊆ existing text → absorb newBit
2. **Reverse containment**: existing text ⊆ newBit text → replace existing with newBit
3. **Position overlap > 50%**: textPosition overlap → merge metadata with LLM
4. **Word overlap > 0.7**: toWordBag similarity → merge metadata with LLM

**Return**:
```javascript
{action: "absorbed|absorbed_existing|merged|none", keptBit?, removedId?}
```

**Merging**: Uses SYSTEM_MERGE_BITS to combine title/summary/tags/keywords of longer bit + removed bit

---

## SIMILARITY SEARCH (src/utils/similaritySearch.js & textSimilarity.js)

### findDuplicateBit(newBit, existingBits, threshold=0.7)
- Word overlap (toWordBag) on fullText
- Length ratio filter: skip if one 3x+ longer
- **Returns**: Matching existing bit or null

### findSimilarBits(queryBit, allBits, threshold=0.5)
- Weighted similarity: title (0.2), summary (0.2), keywords (0.25), tags (0.15), fullText (0.2)
- **Returns**: [{bit, score, reasons}] sorted descending

### calculateSimilarity(bit1, bit2)
- Cross-transcript only (returns 0 if same sourceFile)
- Combines multiple signals with weights

### textSimilarity.js Utilities

**toWordBag(text)**: Extract words 2+ chars, lowercase
```javascript
text.toLowerCase().match(/\b\w{2,}\b/g)
```

**wordOverlapScore(words1, words2)**: 0-1 based on shared words
```javascript
overlap / Math.max(words1.length, words2.length)
```

**stringSimilarity(str1, str2, minWordLen=3)**: Word-based (3+ chars)

**calculateBitSimilarity(bit1, bit2)**: Title (0.4) + Summary (0.3) + Keywords (0.3)
- Returns 0 if same sourceFile

**sameTranscriptSimilarity(bit1, bit2)**: For duplicate detection
- Position overlap (strongest), fullText word overlap, title similarity

**extractCommonWords(bits)**: Words appearing in 50%+ of titles

---

## BIT FLOW ANALYSIS (src/utils/bitFlowAnalyzer.js)

### analyzeBitFlow(bitText, bitData={})

**Returns**:
```javascript
{
  pattern: "setup-punchline" | "setup-escalation-punchline" | etc,
  stages: [{type, startChar, endChar, text, confidence}],
  rhythm: "fast" | "slow" | "build" | "steady",
  callbacks: [],
  totalStages: number,
  analysis: {hasM isdirect, hasCallback, isMultiPart, estimatedDeliveryTime}
}
```

**Stage Types**: setup, escalation, punchline, tag, other

**Pattern Derivation**: Sequence of stage types with consecutive duplicates removed
- "setup-escalation-punchline-tag"
- "setup-punchline-escalation"

**Rhythm Detection**:
- fast: short sentences (70% of avg length)
- slow: long sentences (130% of avg)
- build: has escalation
- steady: default

**Callbacks**: Pattern matches for "as I mentioned", "remember when", etc.

---

## UTILITIES & HELPERS

### jsonParser.js
- `tryParsePartialJSON(text)` → Handles incomplete JSON arrays, finds matching ]
- `tryParsePartialBits(text)` → Extracts partial bit objects from frozen streams
- `extractPartialBitFields(jsonText)` → Regex extraction of title, fullText, summary, tags
- `extractCompleteJsonObjects(fullText)` → Real-time extraction during streaming

### positionTracker.js
- `calculateCharPosition(fullText, searchText)` → Find {startChar, endChar} in transcript
  - Exact substring match first, fallback to fuzzy word-level matching
- `extractTextByPosition(fullText, startChar, endChar)` → Substring
- `adjustBoundary(bit, direction, amount)` → Shift start/end char
- `findWordBoundary(text, charIndex, direction)` → Snap to word edge
- `getLineColumn(text, charIndex)` → Convert to line:column
- `getLineBoundaries(text, charIndex)` → Line start/end positions

### textContinuityValidator.js
- `validateBit(bit, transcriptText)` → Check position bounds and text match (80%+ similarity)
- `validateAllBits(bits, transcripts)` → Full vault validation
- `findOverlaps(bits, transcriptMap)` → Detect position overlaps within transcripts
- `enforceContiguity(bits, transcriptText)` → Report gaps between bits
- `autoCorrectPosition(bit, transcriptText)` → Find fullText in transcript and correct position

### bitMerger.js
- `createRootBit(bitIds, allBits, matches)` → Merge bits into aggregated root bit
- `enhanceRootBit(rootBit, newMatches, newBits)` → Update with new data
- `findMergeClusters(bits, threshold=0.7)` → Cluster similar bits

### obsidianExport.js
- `generateObsidianVault(topics, matches, transcripts, touchstones, rootBits)` → Array of {name, content} files
- **Structure**:
  - `Comedy Vault MOC.md` (index)
  - `_root-bits/*.md`
  - `_touchstones/*.md`
  - `bits/*.md` (individual bits with connections)
  - `tags/*.md` (tag indices)

---

## COMPONENT TREE

### Main Layout
```
App.jsx
  ↓
ComedyParser (main ~3050 lines)
  ├─ UploadTab
  ├─ TranscriptTab
  ├─ MixPanel (bit join/split UI)
  ├─ TouchstonePanel
  │   ├─ TouchstoneDetail
  │   └─ TouchstoneCard
  ├─ DedupTab (duplicate pair review)
  ├─ ValidationTab
  ├─ ExportTab
  ├─ DatabaseTab
  ├─ AnalyticsDashboard
  ├─ NetworkGraph
  ├─ DetailPanel (single bit view)
  ├─ StreamingProgressPanel (parsing progress)
  ├─ DebugPanel (debug log)
  └─ Various modal components
```

### Key Component Props

**UploadTab**:
- transcripts, topics, processing, selectedModel, fileInput
- handleFiles, parseAll, parseUnparsed, setShouldStop, abortControllerRef, onGoToMix

**TouchstonePanel**:
- touchstones, bits, matches, onSelectBit, onHunt, huntProgress, processing
- onGenerateTitle, onRenameTouchstone, onRemoveInstance, onConfirmTouchstone, onRestoreTouchstone, onCreateTouchstone
- onUpdateInstanceRelationship, onGoToMix, onMergeTouchstone, onRefreshReasons, onUpdateTouchstoneEdits

**MixPanel**:
- topics, transcripts, onJoinBits, onSplitBit, onTakeOverlap, onDeleteBit, onScrollBoundary
- onGenerateTitle, onConfirmRename, onAddPhantomBit, onViewBitDetail
- initialTranscript, onConsumeInitialTranscript

---

## DATA PATHWAYS & FLOWS

### 1. UPLOAD → PARSE FLOW
```
UploadTab (file input)
  ↓ handleFiles
ComedyParser: setState({transcripts: [...]})
  ↓ parseAll/parseUnparsed
callOllamaStream(SYSTEM_PARSE_V2, transcript text)
  ↓ onBitFound callback
handleNewBit(bit)
  ├─ absorbOrMerge (same-transcript dedup)
  ├─ saveSingleTopic (immediate DB persist)
  └─ setState({topics: [...], foundBits: [...]})
  ↓ onComplete callback
setState({processing: false})
```

### 2. AUTO-MATCHING FLOW (during parse or manual)
```
runMatching()
  ├─ Collect all new/unparsed bits
  ├─ Batch into groups of ~20
  │  └─ callOllama(SYSTEM_HUNT_BATCH, source bit + candidates)
  │     ↓ Returns: [{candidate: idx, match_percentage, relationship}]
  └─ Accumulate matches, setState({matches: [...]})
```

### 3. TOUCHSTONE DETECTION FLOW
```
useEffect([topics, matches])
  ├─ detectTouchstones(bits, matches, 2)
  │  └─ Union-find clustering on same_bit/evolved edges
  ├─ Preserve user state (confirmed, rejected, corrections)
  ├─ Find touchstones needing LLM names (not cached, not autoNamed)
  └─ Async naming loop:
     └─ For each unnamed touchstone:
        ├─ Extract core bit texts
        ├─ POST to Ollama for naming (format: "title or, longer title")
        ├─ Cache name and apply to state
        └─ setState({touchstones: {...}})
```

### 4. DEDUP DETECTION FLOW
```
runDedup()
  ├─ Batch bits into groups of 25
  ├─ For each batch:
  │  └─ callOllama(SYSTEM_DEDUP, batch list)
  │     ↓ Returns: [{group: [indices], confidence, reason}]
  ├─ Cross-batch scan on titles/summaries
  └─ Accumulate pairs, setState({dedupResults: [...]})
     ↓ User reviews and merges via mergeDedupPair(pair, keepId)
        └─ Removes other bit, prunes stale matches, saves to DB
```

### 5. HUNT FOR MATCHES FLOW (deep search for single bit)
```
handleHuntSimilarBits(bitId)
  ├─ findSimilarBits(bit, allOtherBits, threshold=0.5)
     ↓ Returns candidates sorted by similarity
  ├─ Batch candidates ~20 per group
  ├─ For each batch:
  │  └─ callOllama(SYSTEM_HUNT_BATCH, targetBit + candidates)
  │     ↓ Returns: [{candidate: {bit}, match_percentage, relationship}]
  ├─ Accumulate found matches
  └─ detectTouchstones() with new matches
     └─ Creates new "possible" touchstone if 2+ matches found
```

### 6. BIT EDITING (MixPanel) FLOW

#### JOIN BITS:
```
MixPanel: User selects 2+ bits and clicks "Join"
  ↓
handleJoinBits(bitsToJoin, joinedBit)
  ├─ Remove old bits from topics
  ├─ Add new combined bit with merged metadata
  ├─ Update matches: remove any referencing old bitIds
  ├─ updateTouchstoneBitIds: replace old bitIds → new bitId in touchstones
  └─ saveVaultState({topics, matches, touchstones})
```

#### SPLIT BIT:
```
MixPanel: User splits one bit into 2+
  ↓
handleSplitBit(bitId, newBits)
  ├─ Remove old bit from topics
  ├─ Add new bits with new IDs
  ├─ updateTouchstoneBitIds: replace old bitId → all new bitIds in touchstones
  └─ saveVaultState({topics, touchstones})
```

#### ADJUST BOUNDARY:
```
BoundaryAdjuster component: Drag start/end markers
  ↓
handleBoundaryChange(bitId, newPosition)
  ├─ Update bit.textPosition
  ├─ Add editHistory entry
  └─ saveVaultState({topics})
```

### 7. TOUCHSTONE CONFIRMATION FLOW
```
TouchstonePanel: User clicks "Confirm" on possible touchstone
  ↓
handleConfirmTouchstone(touchstoneId)
  └─ Move from touchstones.possible → touchstones.confirmed
     ├─ Preserve all user edits (manualName, corrections, userReasons, rejectedReasons)
     └─ saveVaultState({touchstones})
```

### 8. TOUCHSTONE MERGING FLOW
```
TouchstoneDetail: User selects merge target
  ↓
onMergeTouchstone(sourceId, targetId)
  ├─ Combine bitIds from both touchstones
  ├─ Deduplicate (one bit per transcript)
  ├─ Update instances and metadata
  └─ Remove source touchstone, update target
     └─ saveVaultState({touchstones})
```

### 9. AUTO-SAVE FLOW
```
useEffect([topics, matches, transcripts, touchstones, rootBits])
  ├─ Debounce 5s
  └─ saveVaultState(current state)
     ├─ DB: syncStore for each collection
     └─ Set lastSave timestamp
```

### 10. EXPORT FLOW
```
ExportTab: User clicks "Export to Obsidian"
  ↓
generateObsidianVault(topics, matches, transcripts, touchstones, rootBits)
  └─ Returns: [
       {name: "Comedy Vault MOC.md", content: ...},
       {name: "_touchstones/...", content: ...},
       {name: "bits/...", content: ...},
       ...
     ]
     ↓ User downloads as ZIP
```

---

## KEY NAMING CONVENTIONS

### Touchstone Names
Format: `[3-5 word title] or, [5-8 word title]`
- Examples: "Airline Food or, Economy Class Meal Complaints"
- Punchy first part, descriptive second part
- Separated by literal "or,"

### Bit Properties
- `title`: 2-6 word memorable name
- `summary`: 1-2 sentence description of premise/punchline
- `fullText`: Exact transcript excerpt
- `tags`: 5-15 categorical and thematic tags (lowercase, hyphenated)
- `keywords`: 8-15 semantic keywords (nouns, verbs, concepts, entities)

### File References
- `sourceFile`: Filename of source transcript (e.g., "comedy-set-2024.txt")
- `transcriptId`: UUID of transcript object
- `id`: Unique UUID for each bit, touchstone, match, etc.

---

## MATCHING RELATIONSHIP TYPES

| Type | Score | Meaning | Clustered? |
|------|-------|---------|------------|
| `same_bit` | 90-100% | Identical joke setup→punchline | ✓ YES (weight 1.0) |
| `evolved` | 70-89% | Same joke, meaningfully reworked | ✓ YES (weight 0.8) |
| `related` | 40-69% | Similar topic, different punchline | ✗ NO (info only) |
| `callback` | -- | Reference to another bit | ✗ NO (meta) |

---

## SPECIAL FLAGS & METADATA

### Touchstone User Edits
- `manualName: true` → Prevent auto-rename forever
- `autoNamed: true` → LLM-generated name, auto-replace if content changes
- `corrections: {old: "new"}` → Word replacements persist per touchstone
- `userReasons: []` → Custom "why matched" explanations (high priority)
- `rejectedReasons: []` → Anti-matching criteria, block candidates relying on these

### Bit Properties
- `editHistory: [{timestamp, action, details}]` → Track split/join/boundary changes
- `textPosition: {startChar, endChar}` → Position in transcript
- `bitFlow: {pattern, stages, rhythm, callbacks}` → Structural analysis
- `parsedWithModel: string` → Which LLM parsed this bit
- `timestamp: number` → When created
- `createdAt: number` → Alternative timestamp field

---

## CONSTRAINTS & LIMITS

### Parsing
- Default model: "qwen3.5:9b"
- Streaming context: num_ctx=32768, num_predict=16384
- Non-streaming: num_ctx=16384, num_predict=8192
- Stream inactivity timeout: 30s (configurable)
- Batch size for matching: ~20 bits
- Batch size for dedup: ~25 bits

### Touchstone Detection
- Minimum frequency: 2 (at least 2 instances)
- Minimum edge score: 50 (matchPercentage * relationshipWeight)
- Cross-transcript only: bits from same transcript don't cluster via LLM edges
- One per transcript: enforced for each touchstone
- Growth penalty: larger clusters need stronger edges (diminishing returns)

### Dedup Detection
- Substring containment check
- Position overlap threshold: 50%
- Word overlap threshold: 70%

---

## FILE LOCATIONS

```
src/
├─ main.jsx                          Entry point
├─ App.jsx                           Root wrapper
├─ comedy-parser.jsx                 Main component (~3050 lines)
├─ components/
│  ├─ TouchstonePanel.jsx            Touchstone UI (confirmed/possible/rejected)
│  ├─ MixPanel.jsx                   Bit join/split interface
│  ├─ UploadTab.jsx                  File upload & transcript management
│  ├─ TranscriptTab.jsx              View transcript & bits in context
│  ├─ DedupTab.jsx                   Review duplicate pairs
│  ├─ ExportTab.jsx                  Export to Obsidian
│  ├─ ValidationTab.jsx              Position validation & continuity
│  ├─ DatabaseTab.jsx                DB stats & management
│  ├─ AnalyticsDashboard.jsx         Statistics & insights
│  ├─ NetworkGraph.jsx               Bit relationship visualization
│  ├─ DetailPanel.jsx                Single bit detail view
│  ├─ StreamingProgressPanel.jsx     Real-time parsing progress
│  ├─ DebugPanel.jsx                 Debug log viewer
│  ├─ ValidationPanel.jsx            Bit validation details
│  ├─ FlowVisualization.jsx          Bit flow structure
│  ├─ BoundaryAdjuster.jsx           Drag-to-adjust textPosition
│  ├─ BitEditor.jsx                  Inline bit title/summary edit
│  ├─ BitJoiner.jsx                  Join multiple bits
│  ├─ MergePanel.jsx                 Merge touchstones
│  ├─ TranscriptViewer.jsx           View full transcript
│  └─ Other minor components
├─ utils/
│  ├─ database.js                    IndexedDB wrapper
│  ├─ prompts.js                     System prompts (SYSTEM_PARSE_V2, etc.)
│  ├─ ollama.js                      Ollama API wrapper
│  ├─ touchstoneDetector.js          Clustering & touchstone creation
│  ├─ autoDedup.js                   Same-transcript dedup
│  ├─ similaritySearch.js            Bit similarity matching
│  ├─ textSimilarity.js              Text comparison utilities
│  ├─ jsonParser.js                  Streaming JSON parsing
│  ├─ positionTracker.js             Character position mapping
│  ├─ textContinuityValidator.js     Position validation
│  ├─ bitFlowAnalyzer.js             Comedic structure analysis
│  ├─ bitMerger.js                   Root bit aggregation
│  └─ obsidianExport.js              Generate Obsidian vault
├─ styles.css                         Global styles
└─ index.html
```

---

## SUMMARY

This is a sophisticated comedy analysis system combining:
1. **LLM-powered extraction** of comedy bits from transcripts
2. **Intelligent deduplication** at parse time (same-transcript)
3. **Cross-transcript matching** to find recurring jokes
4. **Constraint-based clustering** that respects structure (1 bit per transcript per joke)
5. **User validation** for all auto-detected relationships
6. **Rich persistence** with IndexedDB and full export/import
7. **Interactive editing** for bit boundaries and combinations
8. **Semantic analysis** of joke structure and flow

The architecture is designed for incremental loading (parse incrementally, match continuously), user control (all auto-detected items require confirmation), and extensibility (plugin system for new analysis types).

