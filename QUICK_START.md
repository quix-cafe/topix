# Quick Start Guide - Comedy Parser Advanced Features

## 🚀 Getting Started

### Initial Setup (First Time)

1. **Start Ollama:**
   ```bash
   ollama serve
   ```

2. **Start Comedy Parser:**
   ```bash
   npm run dev
   ```
   Opens at `http://localhost:5173`

3. **Upload Transcripts:**
   - Go to **Upload** tab
   - Drop comedy transcript files (.txt or .md)
   - System prepares for parsing

### Parsing with Streaming

1. **Start Parse:**
   - Click "Parse All with Gemma 3:12B"
   - Watch **Streaming Progress Panel** at bottom

2. **Monitor Progress:**
   - Status shows: PARSING
   - Bits found updates in real-time
   - Progress bar shows % complete
   - Latest bits display as discovered
   - **Streamed text** shows raw Ollama output

3. **Wait for Completion:**
   - Panel shows "Done! Check Database and Graph tabs"
   - Auto-save indicator shows timestamp
   - Database stats update

---

## 📊 Using Analytics Dashboard

### First Look
1. Go to **Analytics** tab
2. See overview cards at top
3. Scroll to see detailed stats

### Key Metrics to Check

**Connection Density:**
- Green (75%+) = Great interconnection
- Orange (50-75%) = Good, could improve
- Red (<50%) = Parse more transcripts

**Coverage:**
- Tracks % of bits with position data
- Higher = better transcript alignment
- Improve by using Boundary Adjuster

**Merge Potential:**
- Shows opportunities to create root bits
- High (20%+) = Go to Merge tab
- Create root bits to aggregate matches

### Actionable Insights
- Read the "Insights" section at bottom
- Follow recommendations
- Track progress over time

### Backup & Restore

**Export Current State:**
```
Analytics tab → "📥 Export Backup"
File: vault-backup-[timestamp].json
Location: Downloads folder
```

**Restore from Backup:**
```
Analytics tab → "📤 Import Backup"
Select: vault-backup-*.json
Wait: Auto-restores vault
```

---

## 🔍 Similarity & Search

### Quick Tag-Based Search
1. Go to **Database** tab
2. Click any **tag** at top
3. See all bits with that tag
4. Click bit to view details

### Find by Tone
1. **Analytics** tab
2. Scroll to "Tone Distribution"
3. Click tone category
4. See all bits with that tone

### Find by Source
1. **Transcript** tab
2. Select transcript file
3. View only bits from that file
4. Color-coded highlights show bit locations

### Advanced Similarity (Coming Soon)
- Multi-criteria search
- Batch similarity scoring
- Related bits recommendations

---

## 🔗 Working with Bits

### View Transcript Context
1. Go to **Transcript** tab
2. Select transcript file
3. See full text with color overlays
4. Click bit to select in detail panel
5. Colored legend shows all bits

### Adjust Bit Boundaries
1. Select bit in detail panel
2. Click "✏️ Adjust Boundaries"
3. Move sliders to refine edges
4. See live preview
5. Click "Save Changes"

### Split a Bit
1. Select bit
2. Click "🔀 Split Bit"
3. Click text where to split
4. Review preview
5. Click "Create Segments"

### Join Bits
1. Select bit
2. Click "🔗 Join Bits"
3. Transcript tab → check boxes for bits to join
4. See merged preview
5. Click "Join Bits"

---

## 🌟 Creating Root Bits

### Automatic Detection
1. Parse 2+ transcripts
2. Go to **Merge** tab
3. See suggested clusters
4. Click cluster to preview

### Manual Root Bit Creation
1. **Merge** tab
2. Click "Create Root" on cluster
3. Edit title & summary (optional)
4. See merged instances
5. Click "✓ Create Root Bit"

### Root Bit Benefits
- Aggregates matched bits
- Tracks variations
- Shows evolution
- Improves organization

---

## 🔄 Touchstone Tracking

### Automatic Detection
1. Parse 2+ transcripts
2. System auto-detects recurring jokes
3. Go to **Touchstones** tab

### Explore Touchstones
1. **Touchstones** tab
2. See all recurring jokes
3. Click touchstone to explore
4. View evolution & instances
5. See frequency & variation stats

### Understanding Evolution
- **Changes:** How joke structure evolved
- **Added Elements:** New components added
- **Dropped Elements:** Components removed
- **Instances:** Each version listed

---

## 📈 Tracking Your Progress

### Weekly Checklist
- [ ] Parse new transcripts
- [ ] Check Analytics dashboard
- [ ] Create root bits from clusters
- [ ] Adjust boundaries as needed
- [ ] Export backup

### Monthly Review
- [ ] Review vault statistics
- [ ] Compare metrics to previous month
- [ ] Identify new patterns
- [ ] Plan next parsing session
- [ ] Archive old backups

### Growth Targets
- Connection Density: Target >70%
- Coverage: Target >85%
- Root Bits: One per 10 matched clusters
- Touchstones: Track growth rate

---

## 🛠️ Common Workflows

### Workflow 1: Parse & Organize
```
1. Upload transcripts (Upload tab)
2. Parse with streaming (watch progress)
3. Check Analytics (review stats)
4. Adjust boundaries (Transcript tab)
5. Create root bits (Merge tab)
6. Export backup (Analytics tab)
```

### Workflow 2: Analyze Existing Vault
```
1. Go to Analytics tab
2. Review health metrics
3. Check insights & recommendations
4. Go to recommended tab
5. Take action (split, join, adjust)
6. Save changes (auto-saved)
```

### Workflow 3: Find Similar Bits
```
1. Go to Database tab
2. Select bit (click card)
3. Review detail panel
4. Check "Similar Bits" section
5. Click related bit
6. Compare in detail view
```

### Workflow 4: Backup & Migrate
```
1. Analytics tab
2. Click "Export Backup"
3. Save file safely
4. On new machine: Import Backup
5. Vault fully restored
```

---

## ⚙️ Settings & Data

### Database Location
- Stored: Browser's IndexedDB
- Size: Up to ~50MB
- Backup: Export as JSON
- Restore: Import JSON file

### Auto-Save Behavior
- Triggers: After 5 seconds of changes
- Includes: All vault data
- Shows: ✓ Saved [time] in header
- Frequency: Automatic on idle

### Browser Storage
- IndexedDB for main data
- LocalStorage for settings
- Clear all: Settings → Clear Database

### Backup Files
- Format: JSON with full vault state
- Size: 10-20x smaller than database
- Portability: Import into any instance
- Versioning: Timestamp in filename

---

## 📱 Mobile & Cross-Device

### Browser Support
- Desktop Chrome/Firefox/Safari: Full support
- Mobile Chrome: Limited (no import)
- Mobile Safari: Full support
- Private Mode: Not recommended (clears on close)

### Cloud Sync Option
1. Export backup regularly
2. Save to Google Drive/Dropbox
3. Access from any device
4. Import on new device

---

## 🆘 Common Issues

### Streaming Not Showing
- **Issue:** No progress feedback
- **Fix:** Restart Ollama, refresh browser

### Database Full
- **Issue:** Can't save new data
- **Fix:** Export backup, clear old data

### Slow Performance
- **Issue:** Lag when searching/parsing
- **Fix:** Export backup, start fresh database

### Data Loss
- **Issue:** Vault disappeared
- **Fix:** Import from exported backup

---

## 📚 Next Steps

1. **Explore Features:**
   - Try each tab thoroughly
   - Review all Analytics sections
   - Test search & filtering

2. **Build Vault:**
   - Parse multiple transcripts
   - Create root bits
   - Track touchstones

3. **Optimize:**
   - Maintain database regularly
   - Export backups frequently
   - Monitor health metrics

4. **Export to Obsidian:**
   - Go to Export tab
   - Choose export format
   - Import to Obsidian vault
   - Link to notes

---

## 🎓 Learning Resources

- **In-App Help:** Hover over labels for tooltips
- **FEATURES.md:** Detailed feature documentation
- **This Guide:** Quick start & workflows
- **Analytics Tab:** Built-in insights & recommendations

---

## 💡 Pro Tips

1. **Save Often:** Export backup after major changes
2. **Use Tags:** Organize bits with consistent tagging
3. **Monitor Analytics:** Check weekly for insights
4. **Batch Process:** Process transcripts in groups
5. **Link Everything:** Adjust boundaries for full context
6. **Review Touchstones:** Understand your patterns
7. **Backup Strategy:** Keep 3+ monthly backups
8. **Clean Data:** Remove duplicates via root bits

---

Happy analyzing! 🎉
