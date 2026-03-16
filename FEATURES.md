# Comedy Parser - Advanced Features Guide

## 🆕 New Features (Phase 8)

This guide covers the four major new features implemented:

1. **Local Database Persistence** - Automatic vault saves
2. **Similarity Search** - Find similar bits across genres
3. **Batch Processing** - Handle large transcript collections
4. **Analytics Dashboard** - Visualize patterns and trends

---

## 1. 💾 Local Database Persistence

### Overview
All vault data is automatically saved to your browser's IndexedDB database. No server needed—everything stays on your machine.

### How It Works

**Automatic Saves:**
- Vault state saves every 5 seconds after changes
- Includes: transcripts, topics, matches, touchstones, root bits
- Metadata tracks: last save time, statistics

**What Gets Saved:**
- All transcripts (file contents)
- All parsed bits (topics)
- All matches between bits
- Touchstone data
- Root bits (merged bits)
- Edit history
- Flow analysis data
- Position tracking data

### Features

#### Auto-Save Indicator
```
Header shows: 💾 Saved [time]
Green dot indicates successful save
```

#### Backup & Restore
**Export Backup:**
1. Go to Analytics tab
2. Click "📥 Export Backup"
3. JSON file downloads with full vault state
4. Filename: `vault-backup-[timestamp].json`

**Import Backup:**
1. Go to Analytics tab
2. Click "📤 Import Backup"
3. Select previously exported `.json` file
4. Vault restores automatically

#### Database Statistics
- Visible in Analytics dashboard
- Shows count of items in each store
- Updated with each save

### Technical Details

**Database Name:** `comedy-parser-vault`
**Storage Limit:** ~50MB (depends on browser)

**Stores:**
- `transcripts` - Source transcript files
- `topics` - Parsed bits/jokes
- `matches` - Connections between bits
- `touchstones` - Recurring jokes
- `rootBits` - Aggregated root bits
- `metadata` - Vault state & statistics

**Indexes:**
- `timestamp` - All stores indexed by save time
- `sourceFile` - Searchable by transcript source

### Browser Compatibility
- ✅ Chrome/Brave/Edge - Full support
- ✅ Firefox - Full support
- ✅ Safari - Full support
- ⚠️ Private/Incognito - Disabled (data clears on close)

---

## 2. 🔍 Similarity Search

### Overview
Find similar bits across your vault using intelligent matching algorithms. Great for discovering related jokes, shared themes, and variations.

### Search Methods

#### 1. Find Similar Bits (Direct Search)
When viewing a bit in the detail panel:
```
Click on "Similar Bits" section (if available)
Shows matching bits ranked by similarity score
```

#### 2. Advanced Search
Available in future UI updates. Uses multiple criteria:
- Text content
- Keywords
- Tags
- Tone
- Structure
- Source

#### 3. Search by Category

**By Tag:**
Database tab → Click tag → See all bits with that tag

**By Tone:**
Analytics → Tone Distribution → Click tone category

**By Structure:**
Analytics → Structure Distribution → Click structure

**By Source File:**
Transcript tab → Select transcript → See only bits from that file

### Similarity Scoring

**Score Range:** 0-1 (0 = no match, 1 = identical)

**Factors Considered:**
1. **Title Similarity** (25%) - Word overlap in titles
2. **Summary Similarity** (25%) - Premise matching
3. **Keywords** (25%) - Semantic content
4. **Tags** (15%) - Category overlap
5. **Tone** (10%) - Emotional delivery match

**Default Threshold:** 0.5 (medium similarity)

### Similarity Explanations

When searching, you see why bits match:
```
✓ Similar titles (78%)
✓ Shared keywords: bathroom, embarrassing
✓ Same categories: personal, self-deprecating
✓ Both dry tone
```

### Example Use Cases

**Find variations of a joke:**
- Search for "your first joke"
- Discover similar versions from other transcripts
- See how the joke evolved

**Find related themes:**
- Search for family-related bits
- Discover all jokes about relationships
- Identify thematic patterns

**Batch categorization:**
- Use tag-based search
- Organize bits by theme
- Build topic collections

---

## 3. 📦 Batch Processing

### Overview
Efficiently handle large transcript collections with improved performance and progress tracking.

### Features

#### Real-Time Streaming Progress
Shows during parsing:
```
Status: PARSING
3 / 47 bits found (6%)
Progress bar with percentage
Latest bits list
Streamed text output
```

#### Batch Statistics
In Analytics dashboard:
- Total processing time
- Bits per transcript
- Match efficiency
- Coverage percentage

#### Handling Large Collections

**Upload Multiple Files:**
1. Upload tab → Drop multiple transcripts
2. Click "Parse All"
3. Watch streaming progress
4. Bits appear in real-time

**Performance Tips:**
- Process in groups of 5-10 transcripts
- Allow 5 seconds between batches
- Monitor database size (Analytics tab)

**Large Transcript Optimization:**
- Files up to 1MB: Full parsing
- Files 1-10MB: May require splitting
- Max database: ~50MB total

### Batch Matching

After parsing:
1. System automatically matches new bits against existing ones
2. Cross-transcript connections found
3. Touchstones detected across batch

### Progress Indicators

**Streaming Panel (bottom of screen):**
- Real-time status updates
- Progress bar
- Recent bits list
- Streamed parsing output

**Header:**
- Updated statistics
- Save status
- Database size

---

## 4. 📊 Analytics Dashboard

### Overview
Comprehensive vault statistics, health metrics, and actionable insights.

### Dashboard Sections

#### Overview Cards (Top Row)
```
📝 Total Bits        - All parsed jokes
🔗 Connections       - Matched relationships
🔄 Touchstones       - Recurring jokes
🌳 Root Bits         - Merged aggregates
```

#### Bit Distribution
**Tone Distribution:**
- Light, Dark, Absurd, Dry, Energetic, etc.
- Click to filter database

**Structure Distribution:**
- Setup-Punchline, Story, Callback, etc.
- Shows prevalence of structure types

**Top Tags:**
- Most common categories
- Helps identify vault themes

**Source Distribution:**
- Bits per transcript file
- Coverage per source

#### Connection Analysis

**Relationship Types:**
- 🔄 Same Bit - Identical jokes rewording
- 🔀 Evolved - Same premise, developed
- 🔗 Related - Overlapping themes
- ↩️ Callback - References other bit

Shows count of each relationship type.

#### Similarity Analysis

**Average Similarity:**
- Ranges 0-100%
- High = vault has cohesive themes
- Low = diverse, varied jokes

**Similarity Distribution Bar:**
- Very High (>80%) - Strong matches
- High (60-80%) - Good matches
- Medium (40-60%) - Related
- Low (<40%) - Tangential

#### Vault Health Metrics

**Connection Density:**
- % of bits with at least one match
- High = good interconnection
- Low = may need more analysis

**Merge Potential:**
- % of bits that could be aggregated
- High = opportunity for root bits
- Low = vault well-organized

**Coverage:**
- % of bits with position data
- High = good transcript linking
- Low = need to adjust boundaries

**Touchstone Rate:**
- % of bits in recurring jokes
- High = consistent themes
- Low = unique, standalone jokes

#### Comedy Pattern Statistics

**Flow Patterns:**
- Setup-Punchline (most common)
- Setup-Escalation-Punchline
- Setup-Callback-Punchline
- etc.

Shows frequency of each pattern type.

#### Actionable Insights

**AI-Generated Recommendations:**
```
💡 Low connection density. Parse more transcripts.
🔄 High merge potential! Create root bits.
⚠️ Low position coverage. Adjust boundaries.
🎯 Strong recurring themes detected.
🌟 Vault is mature! Good organization.
✨ Root bits well-organized.
🚀 Getting started! Keep building.
```

### Using Analytics

**Identify Vault Gaps:**
- Low coverage? Use Transcript tab to adjust positions
- Low connection? Parse more transcripts
- High merge potential? Go to Merge tab

**Monitor Vault Health:**
- Check metrics regularly
- Aim for Connection Density >60%
- Maintain Coverage >80%

**Export Data:**
- Click "Export Backup" to save analytics snapshot
- Useful for tracking growth over time
- Restore later to compare metrics

### Example Analysis Workflow

1. Parse transcripts → Check streaming progress
2. Adjust boundaries → Monitor coverage in Analytics
3. Create root bits → Check merge potential metrics
4. Detect touchstones → Track in Analytics
5. Export backup → Save vault state
6. Review insights → Plan next steps

---

## 🔄 Integration with Existing Features

### Streaming + Analytics
- Real-time parsing shows in progress panel
- Results immediately reflected in database
- Analytics updates automatically

### Similarity + Touchstones
- Similarity search helps find touchstones
- Touchstone analysis uses similarity metrics
- Can manually create roots from similar bits

### Database + Export
- Auto-saved data included in export
- Position tracking, flow analysis persisted
- Root bits and touchstones included

### Batch Processing + Matching
- Streaming shows as batch processes
- Auto-matching runs after batch complete
- Touchstones detected across batch

---

## ⚡ Performance Tips

### Database
- Regular exports for backup
- Clear old data if limit approaching
- Import backups when starting fresh

### Streaming
- Keep browser window open during parsing
- Don't navigate away mid-parse
- Check progress panel for status

### Analytics
- Refresh dashboard after large changes
- Export snapshots periodically
- Monitor growth trends

### Similarity Search
- Use categories for quick filtering
- Advanced search for complex queries
- Review similarity explanations

---

## 🐛 Troubleshooting

### Data Not Saving
- Check browser's storage quota
- Try export/import to refresh
- Clear browser cache if needed

### Streaming Not Showing
- Verify Ollama running locally
- Check console for errors
- Restart parsing process

### Slow Performance
- Reduce batch sizes
- Clear old backup files
- Check browser memory usage

### Database Full
- Export and backup current vault
- Clear old transcripts if safe
- Start new database session

---

## 📈 Statistics & Metrics

**What Gets Tracked:**
- Parse count & bit count
- Match count & relationships
- Touchstone frequency
- Root bit aggregation
- Position coverage %
- Flow pattern distribution
- Similarity statistics
- Save timestamps

**Available In:**
- Analytics Dashboard
- Export backup JSON
- Database metadata
- Header statistics

---

## 🎯 Best Practices

1. **Regular Backups:**
   - Export monthly
   - Save to cloud (Google Drive, Dropbox, etc.)
   - Keep multiple versions

2. **Monitor Health:**
   - Check Analytics weekly
   - Maintain >60% connection density
   - Keep coverage >80%

3. **Organize Bits:**
   - Create root bits from clusters
   - Use tags consistently
   - Adjust boundaries accurately

4. **Leverage Search:**
   - Find similar bits before manual edits
   - Use tags for filtering
   - Review insights for patterns

5. **Batch Processing:**
   - Process in groups
   - Allow database time to save
   - Export after large changes

---

## 🔗 Related Documentation

- See `README.md` for basic usage
- See `FEATURES.md` (this file) for new features
- See main UI for in-app help tooltips
- Check Analytics tab for vault-specific insights

