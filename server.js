#!/usr/bin/env node
/**
 * Topix Server
 * Handles Ollama health checks, audio registry, and file management
 * Runs on port 3001 by default
 */

import http from "http";
import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "node:fs/promises";
import { existsSync, createReadStream, statSync, openSync } from "node:fs";
import path from "node:path";
import { parseFilename, buildFilename, withRating, withDuration, transcriptName, formatDuration as formatDur, AUDIO_EXT } from "./server/filename.js";
import { hashFiles } from "./server/hash.js";

const execPromise = promisify(exec);
const PORT = process.env.PORT || 3001;
const AUDIO_DIR = "/home/kai/ownCloud/Comedy/Audio";
const REGISTRY_FILE = path.join(AUDIO_DIR, "audio_registry.json");
const CONFIG_FILE = path.join(import.meta.dirname, ".topix-config.json");

async function loadConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8")); } catch { return {}; }
}
async function saveConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// --- Registry helpers ---

async function loadRegistry() {
  try {
    const data = await fs.readFile(REGISTRY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveRegistry(data) {
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

let writeQueue = Promise.resolve();
async function withRegistry(fn) {
  const result = await new Promise((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      const reg = await loadRegistry();
      const ret = await fn(reg);
      await saveRegistry(reg);
      return ret;
    }).then(resolve, reject);
  });
  return result;
}

// --- Helpers ---

function formatDuration(seconds) {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getRating(filename) {
  const m = filename.match(/^\[(.{5})\]/);
  return m ? m[1] : "_____";
}

function getAudioDuration(filepath) {
  return new Promise((resolve) => {
    execFile("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filepath,
    ], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const val = parseFloat(stdout.trim());
      resolve(isNaN(val) ? null : val);
    });
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function execCommand(command) {
  try {
    const { stdout, stderr } = await execPromise(command);
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, error: error.message, stderr: error.stderr };
  }
}

async function ollamaHealthCheck() {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
      timeout: 5000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function restartOllama() {
  console.log("[Ollama] Restarting via systemctl (user-level, then system-level)...");

  // Try user-level first (no sudo needed), fall back to systemctl with pkexec
  const strategies = [
    { cmd: "systemctl --user restart ollama", label: "user-level systemctl" },
    { cmd: "pkill -f 'ollama serve' && sleep 1 && ollama serve &", label: "pkill + relaunch" },
  ];

  for (const { cmd, label } of strategies) {
    console.log(`[Ollama] Trying ${label}...`);
    const result = await execCommand(cmd);
    if (!result.success) {
      console.log(`[Ollama] ${label} failed: ${result.error}`);
      continue;
    }

    console.log(`[Ollama] ${label} issued, waiting for healthy...`);
    let healthy = false;
    let attempts = 0;
    while (!healthy && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      healthy = await ollamaHealthCheck();
      attempts++;
    }

    if (healthy) {
      console.log(`[Ollama] Ollama healthy after ${attempts}s via ${label}`);
      return { success: true, message: `Ollama restarted via ${label} (${attempts}s)` };
    }
  }

  console.log("[Ollama] All restart strategies failed");
  return { success: false, message: "All restart strategies failed (tried user systemctl, pkill + relaunch)" };
  }
}

// --- Server ---

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Health check endpoint
    if (req.url === "/api/health" && req.method === "GET") {
      const healthy = await ollamaHealthCheck();
      json(res, healthy ? 200 : 503, { healthy, status: healthy ? "ok" : "down" });
      return;
    }

    // Restart Ollama endpoint
    if (req.url === "/api/restart-ollama" && req.method === "POST") {
      const result = await restartOllama();
      json(res, result.success ? 200 : 500, result);
      return;
    }

    // List all files from registry (enriched for Play tab)
    if (req.url === "/api/transcripts" && req.method === "GET") {
      // Auto-discover .m4a files on disk that aren't in the registry
      const registry = await loadRegistry();
      const knownAudioFiles = new Set(Object.values(registry).map(r => r.audio_filename));
      const dirFiles = await fs.readdir(AUDIO_DIR);
      const newM4as = dirFiles.filter(f => f.endsWith(AUDIO_EXT) && !knownAudioFiles.has(f));
      if (newM4as.length > 0) {
        const fullPaths = newM4as.map(f => path.join(AUDIO_DIR, f));
        const hashes = await hashFiles(fullPaths);
        const durations = await Promise.all(fullPaths.map(p => getAudioDuration(p)));
        await withRegistry(async (reg) => {
          for (let i = 0; i < newM4as.length; i++) {
            const fp = fullPaths[i];
            const h = hashes[fp];
            if (!h || reg[h]) continue;
            reg[h] = {
              hash: h,
              audio_filename: newM4as[i],
              transcript_filename: transcriptName(newM4as[i]),
              duration_seconds: durations[i] || 0,
              transcript_hash: null,
            };
          }
        });
        // Reload after mutation
        Object.assign(registry, await loadRegistry());
        console.log(`[Registry] Auto-discovered ${newM4as.length} new audio file(s):`, newM4as);
      }

      const entries = [];
      const toRemove = [];

      for (const [hash, record] of Object.entries(registry)) {
        const audioPath = path.join(AUDIO_DIR, record.audio_filename);
        const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);
        
        const has_audio = existsSync(audioPath);
        const has_transcript = existsSync(transcriptPath);

        if (!has_audio && !has_transcript) {
          toRemove.push(hash);
          continue;
        }

        entries.push({
          hash,
          audio_filename: record.audio_filename,
          transcript_filename: record.transcript_filename,
          has_audio,
          has_transcript,
          duration_seconds: record.duration_seconds || 0,
          duration_formatted: formatDuration(record.duration_seconds),
          rating: getRating(record.audio_filename),
        });
      }

      if (toRemove.length > 0) {
        console.log(`[Registry] Cleaning up ${toRemove.length} stale entries:`, toRemove);
        await withRegistry(async (reg) => {
          for (const hash of toRemove) delete reg[hash];
        });
      }

      json(res, 200, entries);
      return;
    }

    // Get transcript content by hash
    const transcriptMatch = req.url.match(/^\/api\/transcripts\/([a-f0-9]+)$/);
    if (transcriptMatch && req.method === "GET") {
      const registry = await loadRegistry();
      const record = registry[transcriptMatch[1]];
      if (!record) { json(res, 404, { error: "Not found" }); return; }
      const audioPath = path.join(AUDIO_DIR, record.audio_filename);
      const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);
      let text = "";
      try { text = await fs.readFile(transcriptPath, "utf-8"); } catch {}
      json(res, 200, {
        hash: transcriptMatch[1],
        audio_filename: record.audio_filename,
        transcript_filename: record.transcript_filename,
        has_audio: existsSync(audioPath),
        has_transcript: existsSync(transcriptPath),
        duration_seconds: record.duration_seconds || 0,
        duration_formatted: formatDuration(record.duration_seconds),
        rating: getRating(record.audio_filename),
        text,
      });
      return;
    }

    // Stream audio with Range support
    const audioMatch = req.url.match(/^\/api\/audio\/(.+)$/);
    if (audioMatch && req.method === "GET") {
      const filename = decodeURIComponent(audioMatch[1]);
      const filepath = path.join(AUDIO_DIR, filename);
      if (!existsSync(filepath)) { json(res, 404, { error: "Not found" }); return; }

      const stat = statSync(filepath);
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": "audio/mp4",
        });
        createReadStream(filepath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "audio/mp4",
          "Accept-Ranges": "bytes",
        });
        createReadStream(filepath).pipe(res);
      }
      return;
    }

    // Rate a file
    const rateMatch = req.url.match(/^\/api\/files\/([a-f0-9]+)\/rate$/);
    if (rateMatch && req.method === "POST") {
      const body = await parseBody(req);
      const result = await withRegistry(async (registry) => {
        const record = registry[rateMatch[1]];
        if (!record) return { status: 404, error: "Not found" };

        const newRating = (body.rating || "").trim();
        if (newRating.length !== 5) return { status: 400, error: "Rating must be exactly 5 characters" };

        const oldFilename = record.audio_filename;
        const oldPath = path.join(AUDIO_DIR, oldFilename);
        if (!existsSync(oldPath)) return { status: 404, error: "Audio file not found" };

        const newFilename = withRating(oldFilename, newRating);
        const newPath = path.join(AUDIO_DIR, newFilename);
        await fs.rename(oldPath, newPath);

        const oldTranscript = path.join(AUDIO_DIR, record.transcript_filename);
        const newTranscriptName = transcriptName(newFilename);
        const newTranscript = path.join(AUDIO_DIR, newTranscriptName);
        if (existsSync(oldTranscript)) {
          try { await fs.rename(oldTranscript, newTranscript); }
          catch { await fs.rename(newPath, oldPath); return { status: 500, error: "Transcript rename failed, rolled back" }; }
        }

        record.audio_filename = newFilename;
        record.transcript_filename = newTranscriptName;
        return { success: true, filename: newFilename };
      });
      if (result.error) { json(res, result.status, { error: result.error }); return; }
      json(res, 200, result);
      return;
    }

    // Rename a file
    const renameMatch = req.url.match(/^\/api\/files\/([a-f0-9]+)\/rename$/);
    if (renameMatch && req.method === "POST") {
      const body = await parseBody(req);
      const result = await withRegistry(async (registry) => {
        const record = registry[renameMatch[1]];
        if (!record) return { status: 404, error: "Not found" };

        const newTitle = (body.title || "").trim();
        if (!newTitle) return { status: 400, error: "Title required" };

        const oldFilename = record.audio_filename;
        const oldPath = path.join(AUDIO_DIR, oldFilename);
        const parsed = parseFilename(oldFilename);

        const newFilename = buildFilename(
          parsed?.rating || "_____",
          newTitle,
          parsed?.duration || "00:00",
        );
        const newPath = path.join(AUDIO_DIR, newFilename);
        await fs.rename(oldPath, newPath);

        const oldTranscript = path.join(AUDIO_DIR, record.transcript_filename);
        const newTranscriptName = transcriptName(newFilename);
        const newTranscript = path.join(AUDIO_DIR, newTranscriptName);
        if (existsSync(oldTranscript)) {
          try { await fs.rename(oldTranscript, newTranscript); }
          catch { await fs.rename(newPath, oldPath); return { status: 500, error: "Transcript rename failed, rolled back" }; }
        }

        record.audio_filename = newFilename;
        record.transcript_filename = newTranscriptName;
        return { success: true, filename: newFilename };
      });
      if (result.error) { json(res, result.status, { error: result.error }); return; }
      json(res, 200, result);
      return;
    }

    // Trim a file
    const trimMatch = req.url.match(/^\/api\/files\/([a-f0-9]+)\/trim$/);
    if (trimMatch && req.method === "POST") {
      const body = await parseBody(req);
      const registry = await loadRegistry();
      const record = registry[trimMatch[1]];
      if (!record) { json(res, 404, { error: "Not found" }); return; }

      const startTime = body.start || "0";
      const endTime = body.end;
      if (!endTime) { json(res, 400, { error: "End time required" }); return; }

      const oldFilename = record.audio_filename;
      const oldPath = path.join(AUDIO_DIR, oldFilename);
      if (!existsSync(oldPath)) { json(res, 404, { error: "Audio file not found" }); return; }

      const backupDir = path.join(AUDIO_DIR, "trimmed");
      await fs.mkdir(backupDir, { recursive: true });
      await fs.copyFile(oldPath, path.join(backupDir, oldFilename));

      const tempOutput = path.join(AUDIO_DIR, `temp_trim_${Date.now()}.m4a`);

      try {
        await new Promise((resolve, reject) => {
          execFile("ffmpeg", [
            "-i", oldPath, "-ss", startTime, "-to", endTime,
            "-c", "copy", "-y", tempOutput,
          ], (err, _stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve();
          });
        });

        const newDuration = await getAudioDuration(tempOutput);
        if (!newDuration) { json(res, 500, { error: "Could not determine new duration" }); return; }

        const durStr = formatDur(newDuration);
        const newFilename = withDuration(oldFilename, durStr);
        const newPath = path.join(AUDIO_DIR, newFilename);

        await fs.unlink(oldPath);
        await fs.rename(tempOutput, newPath);

        // Delete old transcript — no longer accurate for trimmed audio
        const oldTranscript = path.join(AUDIO_DIR, record.transcript_filename);
        if (existsSync(oldTranscript)) await fs.unlink(oldTranscript);

        const newTranscriptName = transcriptName(newFilename);
        const hashes = await hashFiles([newPath]);
        const newHash = hashes[newPath];

        await withRegistry(async (reg) => {
          delete reg[trimMatch[1]];
          reg[newHash] = {
            hash: newHash,
            audio_filename: newFilename,
            transcript_filename: newTranscriptName,
            duration_seconds: newDuration,
            transcript_hash: null,
          };
        });

        json(res, 200, { success: true, filename: newFilename, hash: newHash });

        // Transcription is triggered by the client via POST /api/transcribe (SSE)
      } catch (e) {
        await fs.unlink(tempOutput).catch(() => {});
        json(res, 500, { error: e.message });
      }
      return;
    }

    // Run transcribe.py (SSE stream)
    if (req.url === "/api/transcribe" && req.method === "POST") {
      const transcribeScript = path.join(AUDIO_DIR, "transcribe.py");
      if (!existsSync(transcribeScript)) {
        json(res, 404, { error: "transcribe.py not found" });
        return;
      }
      console.log("[Transcribe] Manually spawning transcribe.py (SSE)");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const child = spawn("python3", ["-u", transcribeScript], {
        cwd: AUDIO_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const sendChunk = (text) => {
        // Split on \r and \n, send each meaningful segment
        const segments = text.split(/[\r\n]+/);
        for (const seg of segments) {
          const trimmed = seg.trim();
          if (trimmed) {
            res.write(`data: ${JSON.stringify({ line: trimmed })}\n\n`);
          }
        }
      };

      child.stdout.on("data", (d) => {
        process.stdout.write(`[transcribe.py] ${d}`);
        sendChunk(d.toString());
      });

      child.stderr.on("data", (d) => {
        process.stderr.write(`[transcribe.py] ${d}`);
        sendChunk(d.toString());
      });

      child.on("error", (err) => {
        console.error(`[transcribe.py] Failed: ${err.message}`);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write("data: {\"done\":true}\n\n");
        res.end();
      });

      child.on("close", (code) => {
        console.log(`[transcribe.py] Exited with code ${code}`);
        res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
        res.end();
      });

      req.on("close", () => {
        // Client disconnected — kill the process
        if (!child.killed) child.kill();
      });
      return;
    }

    // Prune multiple registry entries
    if (req.url === "/api/prune-registry" && req.method === "POST") {
      const body = await parseBody(req);
      const hashes = body.hashes;
      if (!Array.isArray(hashes) || hashes.length === 0) {
        json(res, 400, { error: "Array of hashes required" });
        return;
      }
      console.log(`[Registry] Explicitly pruning ${hashes.length} hashes:`, hashes);
      await withRegistry(async (reg) => {
        for (const hash of hashes) {
          delete reg[hash];
        }
      });
      json(res, 200, { success: true });
      return;
    }

    // Delete a file
    const deleteMatch = req.url.match(/^\/api\/files\/([a-f0-9]+)\/delete$/);
    if (deleteMatch && req.method === "POST") {
      try {
        await withRegistry(async (registry) => {
          const record = registry[deleteMatch[1]];
          if (!record) throw Object.assign(new Error("Not found"), { statusCode: 404 });

          const audioPath = path.join(AUDIO_DIR, record.audio_filename);
          const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);

          if (existsSync(audioPath)) await fs.unlink(audioPath);
          if (existsSync(transcriptPath)) await fs.unlink(transcriptPath);

          delete registry[deleteMatch[1]];
        });
        json(res, 200, { success: true });
      } catch (e) {
        json(res, e.statusCode || 500, { error: e.message });
      }
      return;
    }

    // ── Notes API ──────────────────────────────────────────────────

    // GET /api/notes/clickup — Parse ClickUp CSV
    if (req.url === "/api/notes/clickup" && req.method === "GET") {
      try {
        const csvPath = "/home/kai/ownCloud/Comedy/clickup/data.csv";
        const raw = await fs.readFile(csvPath, "utf-8");
        const lines = raw.split("\n");
        // Skip header row
        const notes = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          // Parse CSV with quoted fields: Task Name, Date Created Text, List Name
          const fields = [];
          let current = "", inQuotes = false;
          for (let c = 0; c < line.length; c++) {
            if (line[c] === '"') {
              if (inQuotes && line[c + 1] === '"') { current += '"'; c++; }
              else inQuotes = !inQuotes;
            } else if (line[c] === ',' && !inQuotes) {
              fields.push(current); current = "";
            } else {
              current += line[c];
            }
          }
          fields.push(current);
          const [taskName, dateText, listName] = fields;
          if (!taskName) continue;
          // Parse date MM/DD/YY → YYYY-MM-DD
          let date = "";
          if (dateText) {
            const parts = dateText.split("/");
            if (parts.length === 3) {
              const yr = parseInt(parts[2], 10);
              date = `${yr < 50 ? 2000 + yr : 1900 + yr}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
            }
          }
          const tags = (listName && listName !== "!") ? [listName] : [];
          notes.push({ text: taskName, title: taskName.slice(0, 80), date, tags, source: "clickup" });
        }
        json(res, 200, { notes });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    // GET /api/notes/keep — Read Keep markdown files
    if (req.url === "/api/notes/keep" && req.method === "GET") {
      try {
        const keepDir = "/home/kai/ownCloud/skydown/keep";
        const files = (await fs.readdir(keepDir)).filter(f => f.endsWith(".md"));
        const notes = [];
        for (const file of files) {
          const content = await fs.readFile(path.join(keepDir, file), "utf-8");
          const title = file.replace(/\.md$/, "");
          // Try to extract date from "Untitled - YYYY-MM-DD" header
          let date = "";
          const dateMatch = content.match(/^Untitled\s*-\s*(\d{4}-\d{2}-\d{2})/m);
          if (dateMatch) date = dateMatch[1];
          // Content: everything after first line (header)
          const lines = content.split("\n");
          const text = lines.slice(1).join("\n").trim() || lines[0] || "";
          notes.push({ text, title, date, tags: [], source: "keep", sourceFile: file });
        }
        json(res, 200, { notes });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    // GET /api/notes/journals — Read journal markdown files
    if (req.url === "/api/notes/journals" && req.method === "GET") {
      try {
        const journalDir = "/home/kai/ownCloud/skydown/journals";
        const files = (await fs.readdir(journalDir)).filter(f => /^\d{4}[-_]\d{2}[-_]\d{2}\.md$/.test(f));
        const notes = [];
        for (const file of files) {
          const content = await fs.readFile(path.join(journalDir, file), "utf-8");
          const date = file.replace(/\.md$/, "").replace(/_/g, "-");
          const stat = await fs.stat(path.join(journalDir, file));
          notes.push({ text: content, title: file.replace(/\.md$/, ""), date, tags: [], source: "journal", sourceFile: file, mtime: stat.mtimeMs });
        }
        json(res, 200, { notes });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    // ── LLM Config & Proxy ─────────────────────────────────────────

    // GET /api/llm/config — return saved API keys (masked) and models
    if (req.url === "/api/llm/config" && req.method === "GET") {
      const config = await loadConfig();
      json(res, 200, {
        geminiKey: config.geminiKey ? "••••" + config.geminiKey.slice(-4) : "",
        claudeKey: config.claudeKey ? "••••" + config.claudeKey.slice(-4) : "",
        ollamaHighModel: config.ollamaHighModel || "",
      });
      return;
    }

    // POST /api/llm/config — save API keys and model settings
    if (req.url === "/api/llm/config" && req.method === "POST") {
      const body = await parseBody(req);
      const config = await loadConfig();
      if (body.geminiKey !== undefined && !body.geminiKey.startsWith("••••")) config.geminiKey = body.geminiKey;
      if (body.claudeKey !== undefined && !body.claudeKey.startsWith("••••")) config.claudeKey = body.claudeKey;
      if (body.ollamaHighModel !== undefined) config.ollamaHighModel = body.ollamaHighModel;
      await saveConfig(config);
      json(res, 200, { success: true });
      return;
    }

    // POST /api/passthru/start — start the passthru server (server.py) if not running
    if (req.url === "/api/passthru/start" && req.method === "POST") {
      try {
        // Check if already running
        try {
          const healthRes = await fetch("http://localhost:8899/health", { signal: AbortSignal.timeout(3000) });
          if (healthRes.ok) {
            json(res, 200, { status: "already_running" });
            return;
          }
        } catch {}

        // Launch server.py
        const serverPy = path.join(import.meta.dirname, "server.py");
        const logPath = path.join(import.meta.dirname, "passthru.log");
        const logFd = openSync(logPath, "a");
        const proc = spawn("python", ["-u", serverPy], {
          cwd: import.meta.dirname,
          stdio: ["ignore", logFd, logFd],
          detached: true,
        });
        proc.unref();
        console.log(`[Passthru] Launched server.py (pid=${proc.pid}), logs: ${logPath}`);
        json(res, 200, { status: "started", pid: proc.pid });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    // POST /api/llm/call — proxy a prompt to Gemini, Claude, or Ollama high-end
    // Claude and Gemini route through the passthru server (web UI automation)
    if (req.url === "/api/llm/call" && req.method === "POST") {
      const body = await parseBody(req);
      const { provider, system, user } = body;
      const config = await loadConfig();

      try {
        let result;

        if (provider === "gemini" || provider === "claude") {
          // Route through passthru server (browser automation)
          // Ensure passthru is running
          let passthruUp = false;
          try {
            const healthRes = await fetch("http://localhost:8899/health", { signal: AbortSignal.timeout(3000) });
            passthruUp = healthRes.ok;
          } catch {}

          if (!passthruUp) {
            // Try to start it
            const serverPy = path.join(import.meta.dirname, "server.py");
            const logPath = path.join(import.meta.dirname, "passthru.log");
            const logFd = openSync(logPath, "a");
            const proc = spawn("python", ["-u", serverPy], {
              cwd: import.meta.dirname,
              stdio: ["ignore", logFd, logFd],
              detached: true,
            });
            proc.unref();
            console.log(`[Passthru] Auto-launching server.py (pid=${proc.pid})`);
            // Wait for it to come up
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 1000));
              try {
                const h = await fetch("http://localhost:8899/health", { signal: AbortSignal.timeout(2000) });
                if (h.ok) { passthruUp = true; break; }
              } catch {}
            }
            if (!passthruUp) throw new Error("Passthru server failed to start");
          }

          // Build prompt combining system + user
          let prompt = user;
          if (system) prompt = `${system}\n\n${user}`;

          const apiRes = await fetch("http://localhost:8899/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, prompt }),
          });
          if (!apiRes.ok) {
            const err = await apiRes.text();
            throw new Error(`Passthru ${provider} error ${apiRes.status}: ${err}`);
          }
          const data = await apiRes.json();
          result = data.response || "";

        } else if (provider === "ollama-high") {
          const model = config.ollamaHighModel;
          if (!model) throw new Error("No high-end Ollama model configured");
          const apiRes = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              stream: false,
              think: false,
              options: { num_predict: 8192, num_ctx: 32768 },
            }),
          });
          if (!apiRes.ok) {
            const err = await apiRes.text();
            throw new Error(`Ollama API ${apiRes.status}: ${err}`);
          }
          const data = await apiRes.json();
          result = data.message?.content || "";

        } else {
          throw new Error(`Unknown provider: ${provider}`);
        }

        json(res, 200, { result });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    // POST /api/export/obsidian — write generated vault files directly to ~/ownCloud/Comedy/
    if (req.url === "/api/export/obsidian" && req.method === "POST") {
      const body = await parseBody(req);
      const { files } = body;
      if (!Array.isArray(files) || files.length === 0) {
        json(res, 400, { error: "files array required" });
        return;
      }
      const VAULT_DIR = "/home/kai/ownCloud/Comedy";
      const written = [];
      const errors = [];
      for (const f of files) {
        if (!f.name || typeof f.content !== "string") continue;
        const filePath = path.join(VAULT_DIR, f.name);
        // Prevent path traversal
        if (!filePath.startsWith(VAULT_DIR)) {
          errors.push({ name: f.name, error: "path traversal rejected" });
          continue;
        }
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, f.content, "utf-8");
          written.push(f.name);
        } catch (e) {
          errors.push({ name: f.name, error: e.message });
        }
      }
      json(res, 200, { written: written.length, errors, files: written });
      return;
    }

    // 404
    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[Server] Unhandled error:", err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "localhost", () => {
  console.log(`[Server] Topix server running on http://localhost:${PORT}`);
  
  // Background registry cleanup: every 5 minutes
  setInterval(async () => {
    try {
      const registry = await loadRegistry();
      const toPrune = [];
      for (const [hash, record] of Object.entries(registry)) {
        const audioPath = path.join(AUDIO_DIR, record.audio_filename);
        const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);
        if (!existsSync(audioPath) && !existsSync(transcriptPath)) {
          toPrune.push(hash);
        }
      }
      if (toPrune.length > 0) {
        console.log(`[Background Prune] Removing ${toPrune.length} stale entries from registry`);
        await withRegistry(async (reg) => {
          for (const h of toPrune) delete reg[h];
        });
      }
    } catch (err) {
      console.error("[Background Prune] Error:", err.message);
    }
  }, 5 * 60 * 1000);
});

process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("[Server] Server closed");
    process.exit(0);
  });
});
