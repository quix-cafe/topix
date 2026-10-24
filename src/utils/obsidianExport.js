/**
 * Obsidian vault export — generates markdown files matching the existing
 * Comedy vault structure at ~/ownCloud/Comedy/, and supports pulling
 * hand-edited changes back out of the vault (bidirectional sync).
 *
 * Vault layout (mirrors what the user maintains by hand):
 *   Jokes/   — one file per touchstone (the unique, recurring joke)
 *   Sets/    — one file per set (an ordered list of jokes)
 *
 * Joke format:
 *   Category: A/B
 *   Tags: #tag1 #tag2
 *
 *   <body text>
 *
 *   Related Jokes:
 *   - [[Other Joke]]
 *
 *   Performance Flows:
 *   - [[Set Name]]
 *
 *   <!-- topix:<touchstone id> -->   ← stable identity, survives renames
 *
 * Set format:
 *   1. [[Joke A]]
 *   2. [[Joke B]]
 *   3. plain text line
 */

export const sanitize = (s) => s.replace(/[/\\:*?"<>|]/g, "_").replace(/^"/, "").replace(/"$/, "");

// Short, human-facing title for a touchstone — matches the existing Jokes/ naming.
// Touchstone names follow "[short title] or, [longer title]"; use the short part
// so generated files line up with the user's hand-titled jokes and set wikilinks.
export const touchstoneTitle = (ts) => {
  const name = (ts?.name || "").trim();
  if (!name) return "Untitled";
  return name.split(/\s+or,\s+/i)[0].trim() || name;
};

// The on-disk basename for a touchstone's joke file (and its wikilink target):
// "<KEYWORD> ~ <title>" when a keyword exists, else just "<title>". The keyword is
// upper-cased for the vault; each part is sanitized so the " ~ " separator survives.
export function jokeBaseName(ts) {
  const title = sanitize(touchstoneTitle(ts));
  const keyword = (ts?.keyword || "").trim().toUpperCase();
  return keyword ? `${sanitize(keyword)} ~ ${title}` : title;
}

// Decompose an Obsidian joke filename back into { keyword, title }. A single
// ALL-CAPS leading token followed by " ~ " is treated as the keyword (matching
// the vault convention); otherwise the whole name is the title, so an ordinary
// title with a tilde isn't mistaken for a keyword.
export function parseJokeBaseName(name) {
  const s = (name || "").trim();
  const m = s.match(/^(\S+)\s+~\s+(.+)$/);
  if (m) {
    const kw = m[1].trim();
    if (/[A-Z]/.test(kw) && kw === kw.toUpperCase()) {
      return { keyword: kw, title: m[2].trim() };
    }
  }
  return { keyword: "", title: s };
}

// camelCase / lowercase tag -> "Title Case" for the Category path
const prettyTag = (t) =>
  (t || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

// How a tag is written into a joke file (and therefore how it reads back)
const tagToken = (t) => (t || "").replace(/\s+/g, "-");

/**
 * The text/title/tags topix would write for a touchstone — the canonical
 * "topix side" of the bidirectional merge.
 */
export function resolveJokeFields(ts, bitMap = {}) {
  const title = touchstoneTitle(ts);

  const tags = (ts.themeTags && ts.themeTags.length)
    ? ts.themeTags
    : (ts.bitTags && ts.bitTags.length)
      ? ts.bitTags
      : [...new Set((ts.bitIds || []).flatMap((id) => bitMap[id]?.tags || []))];

  let body = (ts.idealText || "").trim();
  if (!body) {
    const candidateIds = (ts.coreBitIds && ts.coreBitIds.length) ? ts.coreBitIds : (ts.bitIds || []);
    const bestBit = candidateIds
      .map((id) => bitMap[id])
      .filter(Boolean)
      .sort((a, b) => (b.fullText || "").length - (a.fullText || "").length)[0];
    body = (bestBit?.fullText || ts.summary || "").trim();
  }

  return { title, tags, body };
}

/** Render a single joke file's markdown (including the hidden identity comment). */
export function renderJoke(ts, { related = [], inSets = [] } = {}, bitMap = {}) {
  const { title, tags, body } = resolveJokeFields(ts, bitMap);
  const category = tags.length ? tags.slice(0, 2).map(prettyTag).join("/") : "Uncategorized";

  let md = `Category: ${category}\n`;
  md += `Tags: ${tags.map((t) => `#${tagToken(t)}`).join(" ")}\n\n`;
  md += `${body}\n`;

  if (related.length > 0) {
    md += `\nRelated Jokes:\n`;
    related.forEach((name) => { md += `- [[${name}]]\n`; });
  }
  if (inSets.length > 0) {
    md += `\nPerformance Flows:\n`;
    inSets.forEach((name) => { md += `- [[${name}]]\n`; });
  }

  md += `\n<!-- topix:${ts.id} -->\n`;
  return { title, content: md };
}

/**
 * Parse the editable fields back out of a joke file's markdown.
 * Title is the filename (handled by the caller); here we read id/tags/body.
 */
export function parseJokeContent(content) {
  const idMatch = content.match(/<!--\s*topix:([^\s>]+)\s*-->/);
  const id = idMatch ? idMatch[1] : null;

  const lines = content.split("\n");
  const tagLine = lines.find((l) => /^Tags:/i.test(l)) || "";
  const tags = (tagLine.match(/#[^\s#]+/g) || []).map((t) => t.slice(1));

  // Body = text after the Category/Tags header block, before any wikilink
  // section or the identity comment.
  let i = 0;
  while (i < lines.length && /^(Category|Tags|Source)\s*:/i.test(lines[i])) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const bodyLines = [];
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(Related Jokes|Performance Flows|Instances|Related)\s*:/i.test(t)) break;
    if (/^<!--\s*topix:/.test(t)) break;
    bodyLines.push(lines[i]);
  }
  return { id, tags, body: bodyLines.join("\n").trim() };
}

const normBody = (s) => (s || "").trim();
const normTags = (arr) => [...(arr || [])].map(tagToken).sort().join("");

/**
 * Three-way merge of joke fields (title/text/tags) between topix and the vault.
 *
 * For each field: whichever side diverged from the last-synced base wins.
 * If both diverged (a true conflict), Obsidian wins. With no base (first link),
 * an existing hand-curated vault file is adopted so it isn't clobbered.
 *
 * @returns { pulls: Map<id, edits>, summary }
 *   edits use the touchstone edit vocabulary: { name, manualName, idealText,
 *   manualIdealText, themeTags }.
 */
export function mergeVaultEdits(touchstones, vaultJokes = [], manifest = {}, topics = []) {
  const bitMap = {};
  (topics || []).forEach((t) => { bitMap[t.id] = t; });

  const fileName = (p) => (p || "").split("/").pop().replace(/\.md$/i, "");

  // Index current vault joke files by embedded id, by the full "keyword ~ title"
  // basename, and by the bare title portion (so pre-keyword hand files still
  // match). When two files share an id, keep the most recently modified.
  const byId = {};
  const byName = {};
  (vaultJokes || []).forEach((f) => {
    const parsed = parseJokeContent(f.content);
    const base = fileName(f.path);
    const entry = { ...parsed, base, path: f.path, mtimeMs: f.mtimeMs || 0, ...parseJokeBaseName(base) };
    if (parsed.id) {
      if (!byId[parsed.id] || entry.mtimeMs >= byId[parsed.id].mtimeMs) byId[parsed.id] = entry;
    }
    byName[sanitize(base)] = entry;
    byName[sanitize(entry.title)] = entry; // bare title portion
  });

  const pulls = new Map();
  const summary = { pulled: 0, pushed: 0, conflicts: 0, conflictTitles: [], pulledItems: [] };

  const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const resolve = (vaultVal, baseVal, topixVal, hasBase, eq) => {
    if (!hasBase) {
      // First link / adoption: only adopt a non-empty vault value that differs,
      // so an existing hand file without a keyword doesn't wipe topix's keyword.
      if (isEmpty(vaultVal)) return { src: "same" };
      return eq(vaultVal, topixVal) ? { src: "same" } : { src: "pull" };
    }
    const vaultChanged = !eq(vaultVal, baseVal);
    const topixChanged = !eq(topixVal, baseVal);
    if (vaultChanged && topixChanged) return eq(vaultVal, topixVal) ? { src: "same" } : { src: "conflict" };
    if (vaultChanged) return { src: "pull" };
    if (topixChanged) return { src: "push" };
    return { src: "same" };
  };

  const eqStr = (a, b) => normBody(a) === normBody(b);
  const eqKw = (a, b) => normBody(a).toUpperCase() === normBody(b).toUpperCase();
  const eqTags = (a, b) => normTags(a) === normTags(b);

  for (const ts of touchstones) {
    const topixF = resolveJokeFields(ts, bitMap);
    const topixTitle = touchstoneTitle(ts);
    const topixKeyword = (ts.keyword || "").trim();

    const baseRec = manifest[ts.id];
    const hasBase = !!baseRec;
    const baseParsed = hasBase
      ? { ...parseJokeContent(baseRec.content), ...parseJokeBaseName(fileName(baseRec.path)) }
      : null;

    // Current vault file: by stable id, else by full "keyword ~ title", else by
    // the bare title (adopting a pre-keyword hand file).
    const vault = byId[ts.id] || byName[sanitize(jokeBaseName(ts))] || byName[sanitize(topixTitle)] || null;
    if (!vault) { summary.pushed++; continue; }

    const edits = {};
    const fields = [];
    let conflicted = false;
    const mark = (r) => {
      if (r.src === "conflict") conflicted = true;
      return r.src === "pull" || r.src === "conflict";
    };

    // Title — the bare title portion of "keyword ~ title"
    if (mark(resolve(vault.title, baseParsed?.title, topixTitle, hasBase, eqStr))) {
      edits.name = vault.title;
      edits.manualName = true;
      fields.push("title");
    }
    // Keyword — the prefix before the separator (compared case-insensitively
    // since the vault keeps it upper-cased)
    if (mark(resolve(vault.keyword, baseParsed?.keyword, topixKeyword, hasBase, eqKw))) {
      edits.keyword = vault.keyword;
      fields.push("keyword");
    }
    // Text
    if (mark(resolve(vault.body, baseParsed?.body, topixF.body, hasBase, eqStr))) {
      edits.idealText = vault.body;
      edits.manualIdealText = true;
      fields.push("text");
    }
    // Tags
    if (mark(resolve(vault.tags, baseParsed?.tags, topixF.tags, hasBase, eqTags))) {
      edits.themeTags = vault.tags;
      fields.push("tags");
    }

    if (fields.length > 0) {
      pulls.set(ts.id, edits);
      summary.pulled++;
      summary.pulledItems.push({ id: ts.id, title: topixTitle, fields, conflict: conflicted });
      if (conflicted) { summary.conflicts++; summary.conflictTitles.push(topixTitle); }
    } else {
      summary.pushed++;
    }
  }

  return { pulls, summary };
}

export function generateObsidianVault(topics, matches, transcripts, touchstones = [], sets = []) {
  const files = [];

  const bitMap = {};
  (topics || []).forEach((t) => { bitMap[t.id] = t; });

  // touchstone id -> names of sets that include it (for the "Performance Flows" section)
  const setsByTouchstone = {};
  const collectTouchstoneRefs = (items, setName) => {
    (items || []).forEach((it) => {
      if (it.type === "group") { collectTouchstoneRefs(it.children, setName); return; }
      if (it.type === "touchstone" && it.touchstoneId) {
        (setsByTouchstone[it.touchstoneId] || (setsByTouchstone[it.touchstoneId] = [])).push(setName);
      }
    });
  };
  (sets || []).forEach((s) => collectTouchstoneRefs(s.items, s.name));

  const exportedIds = new Set(touchstones.map((t) => t.id));

  // ── Jokes (one file per touchstone) ───────────────────────────
  touchstones.forEach((ts) => {
    const related = (ts.relatedTouchstoneIds || [])
      .map((id) => touchstones.find((o) => o.id === id))
      .filter((o) => o && exportedIds.has(o.id))
      .map((o) => jokeBaseName(o));

    const inSets = [...new Set(setsByTouchstone[ts.id] || [])];

    const { content } = renderJoke(ts, { related, inSets }, bitMap);
    files.push({ name: `Jokes/${jokeBaseName(ts)}.md`, content });
  });

  // ── Sets (one file per set) ───────────────────────────────────
  sets.forEach((set) => {
    const lines = [];
    let n = 0;
    const renderItem = (it) => {
      if (it.type === "hr") { lines.push("---"); return; }
      if (it.type === "group") {
        if (it.title) lines.push(`**${it.title}**`);
        (it.children || []).forEach(renderItem);
        return;
      }
      let label;
      if (it.type === "touchstone" && it.touchstoneId) {
        const ts = touchstones.find((t) => t.id === it.touchstoneId);
        label = ts ? `[[${jokeBaseName(ts)}]]` : (it.text || "").trim();
      } else {
        label = (it.text || "").trim();
      }
      if (!label) return;
      n += 1;
      lines.push(`${n}. ${label}`);
    };
    (set.items || []).forEach(renderItem);

    files.push({ name: `Sets/${sanitize(set.name || "Untitled Set")}.md`, content: `${lines.join("\n")}\n` });
  });

  return files;
}
