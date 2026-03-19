/**
 * Obsidian vault export - generates markdown files for Obsidian import
 */

// Todo: 'Root bits' is extinct code. 

export function generateObsidianVault(topics, matches, transcripts, touchstones = [], rootBits = []) {
  const files = [];

  // MOC (Map of Content) index
  const transcriptMap = {};
  topics.forEach((t) => {
    if (!transcriptMap[t.sourceFile]) transcriptMap[t.sourceFile] = [];
    transcriptMap[t.sourceFile].push(t);
  });

  let moc = `---\ntags: [comedy-vault, index]\n---\n# Comedy Bit Vault\n\n`;
  moc += `> Last updated: ${new Date().toLocaleString()}\n\n`;

  if (rootBits.length > 0) {
    moc += `## Root Bits (${rootBits.length})\n`;
    rootBits.forEach((rb) => {
      moc += `- [[${rb.title}]] (merged from ${rb.aggregateData.totalInstances} instances)\n`;
    });
    moc += `\n`;
  }

  if (touchstones.length > 0) {
    moc += `## Recurring Touchstones (${touchstones.length})\n`;
    touchstones.forEach((ts) => {
      moc += `- [[${ts.name}]] (${ts.frequency} occurrences)\n`;
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

  moc += `\n## All Tags\n`;
  const allTags = [...new Set(topics.flatMap((t) => t.tags))].sort();
  allTags.forEach((tag) => {
    moc += `- #${tag.replace(/\s+/g, "-")}\n`;
  });
  files.push({ name: "Comedy Vault MOC.md", content: moc });

  // Root bit files
  rootBits.forEach((root) => {
    let md = `---\n`;
    md += `title: "${root.title}"\n`;
    md += `type: root-bit\n`;
    md += `merged-from: [${root.mergedFrom.join(", ")}]\n`;
    md += `total-instances: ${root.aggregateData.totalInstances}\n`;
    md += `average-confidence: ${root.aggregateData.averageConfidence.toFixed(2)}\n`;
    md += `tags: [${root.tags.map((t) => t.replace(/\s+/g, "-")).join(", ")}]\n`;
    md += `keywords: [${root.keywords.join(", ")}]\n`;
    md += `sources: [${root.aggregateData.sources.join(", ")}]\n`;
    md += `---\n\n`;
    md += `# ${root.title}\n\n`;
    md += `> [!success] Root Bit\n> Aggregated from **${root.aggregateData.totalInstances}** instances with **${Math.round(root.aggregateData.averageConfidence * 100)}%** average confidence.\n\n`;
    md += `## Summary\n${root.summary}\n\n`;

    if (root.aggregateData.variations && root.aggregateData.variations.length > 0) {
      md += `## Variations\n`;
      root.aggregateData.variations.forEach((v) => {
        md += `\n### Version ${v.version} - ${v.sourceFile}\n`;
        md += `**Title:** ${v.title}\n\n`;
        if (v.changes && v.changes.length > 0) {
          md += `**Changes:**\n`;
          v.changes.forEach((c) => {
            md += `- ${c}\n`;
          });
          md += `\n`;
        }
        if (v.lengthDifference !== 0) {
          md += `**Length:** ${v.lengthDifference > 0 ? "+" : ""}${v.lengthDifference} characters\n\n`;
        }
      });
    }

    md += `## Instances\n`;
    root.mergedFrom.forEach((bitId) => {
      const bit = topics.find((t) => t.id === bitId);
      if (bit) {
        md += `- [[${bit.title}]] (${bit.sourceFile})\n`;
      }
    });

    md += `\n## Tags\n${root.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ")}\n`;
    files.push({ name: `_root-bits/${root.title.replace(/[/\\:*?"<>|]/g, "_")}.md`, content: md });
  });

  // Touchstone files
  touchstones.forEach((touchstone) => {
    let md = `---\n`;
    md += `title: "${touchstone.name}"\n`;
    md += `type: touchstone\n`;
    md += `frequency: ${touchstone.frequency}\n`;
    md += `tags: [touchstone, ${touchstone.tags.map((t) => t.replace(/\s+/g, "-")).join(", ")}]\n`;
    md += `---\n\n`;
    md += `# ${touchstone.name}\n\n`;
    md += `> [!info] Recurring Joke\n> Appears **${touchstone.frequency}** times across **${new Set(touchstone.instances.map((i) => i.sourceFile)).size}** transcripts.\n\n`;
    md += `## Summary\n${touchstone.summary}\n\n`;

    md += `## Instances\n`;
    touchstone.instances.forEach((inst) => {
      const bit = topics.find((t) => t.id === inst.bitId);
      if (bit) {
        md += `- **${inst.instanceNumber}.** [[${inst.title}]] (${inst.sourceFile}, ${Math.round(inst.confidence * 100)}% match)\n`;
      }
    });

    files.push({ name: `_touchstones/${touchstone.name.replace(/[/\\:*?"<>|]/g, "_").replace(/^"/, "").replace(/"$/, "")}.md`, content: md });
  });

  // Individual topic files
  topics.forEach((topic) => {
    const relatedMatches = matches.filter(
      (m) => m.sourceId === topic.id || m.targetId === topic.id
    );
    const relatedTopics = relatedMatches.map((m) => {
      const otherId = m.sourceId === topic.id ? m.targetId : m.sourceId;
      return { ...topics.find((t) => t.id === otherId), match: m };
    }).filter((t) => t.id);

    let md = `---\n`;
    md += `title: "${topic.title}"\n`;
    md += `source: "${topic.sourceFile}"\n`;
    md += `tags: [${topic.tags.map((t) => t.replace(/\s+/g, "-")).join(", ")}]\n`;
    md += `keywords: [${topic.keywords.join(", ")}]\n`;

    // Add position data
    if (topic.textPosition) {
      md += `position: "${topic.textPosition.startChar}-${topic.textPosition.endChar}"\n`;
      md += `position-chars: ${topic.textPosition.endChar - topic.textPosition.startChar}\n`;
    }

    // Add flow data
    if (topic.bitFlow) {
      md += `flow-pattern: "${topic.bitFlow.pattern}"\n`;
      md += `flow-rhythm: "${topic.bitFlow.rhythm}"\n`;
      md += `flow-stages: ${topic.bitFlow.totalStages}\n`;
    }

    // Add touchstone info
    const topicTouchstones = touchstones.filter((ts) => ts.bitIds.includes(topic.id));
    if (topicTouchstones.length > 0) {
      md += `touchstones: [${topicTouchstones.map((ts) => ts.name).join(", ")}]\n`;
      topicTouchstones.forEach((ts) => {
        const instance = ts.instances.find((i) => i.bitId === topic.id);
        if (instance) {
          md += `touchstone-${ts.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}: "instance-${instance.instanceNumber}"\n`;
        }
      });
    }

    // Add edit history count
    if (topic.editHistory && topic.editHistory.length > 0) {
      md += `edit-history: ${topic.editHistory.length}\n`;
    }

    md += `---\n\n`;
    md += `# ${topic.title}\n\n`;
    md += `> [!info] Source\n> **File:** ${topic.sourceFile}\n`;

    if (topic.textPosition) {
      md += `> **Position:** Characters ${topic.textPosition.startChar}-${topic.textPosition.endChar}\n`;
    }
    md += `\n`;

    md += `## Summary\n${topic.summary}\n\n`;

    // Add flow visualization section
    if (topic.bitFlow) {
      md += `## Comedic Structure\n`;
      md += `**Pattern:** ${topic.bitFlow.pattern}\n`;
      md += `**Rhythm:** ${topic.bitFlow.rhythm}\n`;
      md += `**Stages:** ${topic.bitFlow.totalStages}\n\n`;
      if (topic.bitFlow.stages) {
        md += `| Stage | Type | Confidence |\n`;
        md += `|-------|------|------------|\n`;
        topic.bitFlow.stages.forEach((stage, idx) => {
          md += `| ${idx + 1} | ${stage.type} | ${Math.round(stage.confidence * 100)}% |\n`;
        });
        md += `\n`;
      }
    }

    md += `## Full Text\n\`\`\`\n${topic.fullText}\n\`\`\`\n\n`;

    if (relatedTopics.length > 0) {
      md += `## Connected Bits\n`;
      relatedTopics.forEach((rt) => {
        const emoji = { same_bit: "\u{1F504}", evolved: "\u{1F500}", related: "\u{1F517}", callback: "\u21A9\uFE0F" }[rt.match.relationship] || "\u{1F517}";
        md += `- ${emoji} [[${rt.title}]] — *${rt.match.relationship}* (${Math.round(rt.match.confidence * 100)}% confidence) · from \`${rt.sourceFile}\`\n`;
      });
      md += `\n`;
    }

    if (topicTouchstones.length > 0) {
      md += `## Recurring Touchstones\n`;
      topicTouchstones.forEach((ts) => {
        const instance = ts.instances.find((i) => i.bitId === topic.id);
        if (instance) {
          md += `- [[${ts.name}]] (instance ${instance.instanceNumber}/${ts.frequency})\n`;
        }
      });
      md += `\n`;
    }

    md += `## Tags\n${topic.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ")}\n`;
    files.push({ name: `bits/${topic.title.replace(/[/\\:*?"<>|]/g, "_")}.md`, content: md });
  });

  // Tag index files
  allTags.forEach((tag) => {
    const tagged = topics.filter((t) => t.tags.includes(tag));
    let md = `---\ntags: [tag-index]\n---\n# Tag: ${tag}\n\n`;
    tagged.forEach((t) => {
      md += `- [[${t.title}]] (${t.sourceFile})\n`;
    });
    files.push({ name: `tags/${tag.replace(/\s+/g, "-")}.md`, content: md });
  });

  return files;
}
