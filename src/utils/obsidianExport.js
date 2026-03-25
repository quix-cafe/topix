/**
 * Obsidian vault export - generates markdown files compatible with
 * the existing Comedy vault structure at ~/ownCloud/Comedy/
 *
 * Vault layout:
 *   Jokes/          — individual bit/joke files (matches existing folder)
 *   Touchstones/    — recurring joke touchstone files
 *   Performance Flows/ — transcript setlist/flow files (matches existing folder)
 *   Comedy Vault MOC.md — root index linking everything
 *
 * Format matches the existing vault convention:
 *   Category line, Tags line, body text, wikilink sections
 *   (no YAML frontmatter — existing vault doesn't use it)
 */

const sanitize = (s) => s.replace(/[/\\:*?"<>|]/g, "_").replace(/^"/, "").replace(/"$/, "");

export function generateObsidianVault(topics, matches, transcripts, touchstones = []) {
  const files = [];

  // Build lookup maps
  const transcriptMap = {};
  topics.forEach((t) => {
    if (!transcriptMap[t.sourceFile]) transcriptMap[t.sourceFile] = [];
    transcriptMap[t.sourceFile].push(t);
  });

  const touchstonesByBit = {};
  touchstones.forEach((ts) => {
    (ts.bitIds || []).forEach((id) => {
      if (!touchstonesByBit[id]) touchstonesByBit[id] = [];
      touchstonesByBit[id].push(ts);
    });
  });

  // ── MOC (Map of Content) ──────────────────────────────────────

  let moc = `# Comedy Vault\n\n`;
  moc += `> Last updated: ${new Date().toLocaleString()}\n\n`;

  if (touchstones.length > 0) {
    moc += `## Touchstones (${touchstones.length})\n`;
    touchstones.forEach((ts) => {
      const sources = new Set((ts.instances || []).map((i) => i.sourceFile)).size;
      moc += `- [[${ts.name}]] — ${ts.frequency} occurrences across ${sources} transcript${sources !== 1 ? "s" : ""}\n`;
    });
    moc += `\n`;
  }

  moc += `## Transcripts\n`;
  Object.keys(transcriptMap).forEach((f) => {
    moc += `\n### ${f}\n`;
    transcriptMap[f].forEach((t) => {
      moc += `- [[${t.title}]]\n`;
    });
  });

  const allTags = [...new Set(topics.flatMap((t) => t.tags))].sort();
  if (allTags.length > 0) {
    moc += `\n## Tags\n`;
    allTags.forEach((tag) => {
      moc += `- #${tag.replace(/\s+/g, "-")}\n`;
    });
  }
  files.push({ name: "Comedy Vault MOC.md", content: moc });

  // ── Touchstone files ──────────────────────────────────────────

  touchstones.forEach((touchstone) => {
    const tags = (touchstone.tags || []).map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ");
    let md = `Category: Touchstone\n`;
    if (tags) md += `Tags: #touchstone ${tags}\n`;
    else md += `Tags: #touchstone\n`;
    md += `\n`;

    md += `${touchstone.summary || ""}\n\n`;

    if (touchstone.idealText) {
      md += `> [!quote] Synthesized Version\n`;
      touchstone.idealText.split("\n").forEach((line) => {
        md += `> ${line}\n`;
      });
      md += `\n`;
    }

    md += `Instances:\n`;
    (touchstone.instances || []).forEach((inst) => {
      const bit = topics.find((t) => t.id === inst.bitId);
      if (bit) {
        const rel = inst.relationship || "same_bit";
        const pct = Math.round((inst.confidence || 0) * 100);
        md += `- [[${bit.title}]] — ${rel} (${pct}%) · \`${inst.sourceFile}\`\n`;
      }
    });
    md += `\n`;

    md += `Related Jokes:\n`;
    const seenBits = new Set();
    (touchstone.instances || []).forEach((inst) => {
      const bit = topics.find((t) => t.id === inst.bitId);
      if (bit && !seenBits.has(bit.id)) {
        seenBits.add(bit.id);
        md += `- [[${bit.title}]]\n`;
      }
    });

    // Flow neighbors (related touchstones that often appear adjacent in setlists)
    const relatedIds = touchstone.relatedTouchstoneIds || [];
    if (relatedIds.length > 0) {
      md += `\nFlow Neighbors:\n`;
      relatedIds.forEach((relId) => {
        const rel = touchstones.find((t) => t.id === relId);
        if (rel) md += `- [[${rel.name}]]\n`;
      });
    }

    files.push({ name: `Touchstones/${sanitize(touchstone.name)}.md`, content: md });
  });

  // ── Individual joke/bit files ─────────────────────────────────
  // Matches existing Jokes/ folder format

  topics.forEach((topic) => {
    const relatedMatches = matches.filter(
      (m) => m.sourceId === topic.id || m.targetId === topic.id
    );
    const relatedTopics = relatedMatches.map((m) => {
      const otherId = m.sourceId === topic.id ? m.targetId : m.sourceId;
      return { ...topics.find((t) => t.id === otherId), match: m };
    }).filter((t) => t.id);

    // Category from tags (use first tag as category path, like existing vault)
    const category = topic.tags.length > 0
      ? topic.tags.slice(0, 2).map((t) => t.replace(/\s+/g, "-")).join("/")
      : "Uncategorized";
    const tags = topic.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ");

    let md = `Category: ${category}\n`;
    md += `Tags: ${tags}\n`;
    if (topic.sourceFile) md += `Source: ${topic.sourceFile}\n`;
    md += `\n`;

    // Main text body
    md += `${topic.fullText || topic.summary || ""}\n`;

    // Related jokes (wikilinks)
    if (relatedTopics.length > 0) {
      md += `\nRelated Jokes:\n`;
      relatedTopics.forEach((rt) => {
        const rel = rt.match.relationship;
        const pct = Math.round((rt.match.confidence || 0) * 100);
        md += `- [[${rt.title}]] — *${rel}* (${pct}%)\n`;
      });
    }

    // Touchstone links
    const topicTouchstones = touchstonesByBit[topic.id] || [];
    if (topicTouchstones.length > 0) {
      md += `\nTouchstones:\n`;
      topicTouchstones.forEach((ts) => {
        const instance = (ts.instances || []).find((i) => i.bitId === topic.id);
        const instanceNum = instance ? ` (instance ${instance.instanceNumber}/${ts.frequency})` : "";
        md += `- [[${ts.name}]]${instanceNum}\n`;
      });
    }

    // Comedic structure (if available)
    if (topic.bitFlow) {
      md += `\nStructure:\n`;
      md += `- Pattern: ${topic.bitFlow.pattern}\n`;
      md += `- Rhythm: ${topic.bitFlow.rhythm}\n`;
      if (topic.bitFlow.stages) {
        topic.bitFlow.stages.forEach((stage, idx) => {
          md += `- Stage ${idx + 1}: ${stage.type} (${Math.round(stage.confidence * 100)}%)\n`;
        });
      }
    }

    files.push({ name: `Jokes/${sanitize(topic.title)}.md`, content: md });
  });

  // ── Performance Flow files ────────────────────────────────────
  // One file per transcript, showing the setlist order

  Object.entries(transcriptMap).forEach(([sourceFile, bits]) => {
    const sorted = [...bits].sort((a, b) => {
      const aStart = a.textPosition?.startChar ?? 0;
      const bStart = b.textPosition?.startChar ?? 0;
      return aStart - bStart;
    });

    let md = `# ${sourceFile}\n\n`;
    md += `| Bit | Tags | Touchstone |\n`;
    md += `| --- | ---- | ---------- |\n`;
    sorted.forEach((bit) => {
      const ts = (touchstonesByBit[bit.id] || []).map((t) => `[[${t.name}]]`).join(", ") || "—";
      const tags = bit.tags.slice(0, 3).map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ") || "—";
      md += `| [[${bit.title}]] | ${tags} | ${ts} |\n`;
    });

    files.push({ name: `Performance Flows/${sanitize(sourceFile)}.md`, content: md });
  });

  return files;
}
