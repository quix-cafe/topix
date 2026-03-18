#!/usr/bin/env node
/**
 * Topix Server
 * Handles Ollama health checks, audio registry, and file management
 * Runs on port 3001 by default
 */

import http from "http";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "node:fs/promises";
import { existsSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { parseFilename, buildFilename, withRating, withDuration, transcriptName, formatDuration as formatDur, AUDIO_EXT } from "./server/filename.js";
import { hashFiles } from "./server/hash.js";

const execPromise = promisify(exec);
const PORT = process.env.PORT || 3001;
const AUDIO_DIR = "/home/kai/ownCloud/Comedy/Audio";
const REGISTRY_FILE = path.join(AUDIO_DIR, "audio_registry.json");

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
  console.log("[Ollama] Restarting via sudo systemctl restart ollama...");

  const result = await execCommand("sudo systemctl restart ollama");
  if (!result.success) {
    console.error("[Ollama] systemctl restart failed:", result.error);
    return { success: false, message: `systemctl restart failed: ${result.error}` };
  }

  console.log("[Ollama] systemctl restart issued, waiting for healthy...");

  let healthy = false;
  let attempts = 0;
  while (!healthy && attempts < 60) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    healthy = await ollamaHealthCheck();
    attempts++;
  }

  if (healthy) {
    console.log(`[Ollama] Ollama healthy after ${attempts}s`);
    return { success: true, message: `Ollama restarted successfully (${attempts}s)` };
  } else {
    console.log("[Ollama] Ollama still not healthy after 60s");
    return { success: false, message: "Ollama restart timeout after 60s" };
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
      const registry = await loadRegistry();
      const entries = [];
      for (const [hash, record] of Object.entries(registry)) {
        const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);
        entries.push({
          hash,
          audio_filename: record.audio_filename,
          transcript_filename: record.transcript_filename,
          has_transcript: existsSync(transcriptPath),
          duration_seconds: record.duration_seconds || 0,
          duration_formatted: formatDuration(record.duration_seconds),
          rating: getRating(record.audio_filename),
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
      const transcriptPath = path.join(AUDIO_DIR, record.transcript_filename);
      let text = "";
      try { text = await fs.readFile(transcriptPath, "utf-8"); } catch {}
      json(res, 200, {
        hash: transcriptMatch[1],
        audio_filename: record.audio_filename,
        transcript_filename: record.transcript_filename,
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
      } catch (e) {
        await fs.unlink(tempOutput).catch(() => {});
        json(res, 500, { error: e.message });
      }
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

    // 404
    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[Server] Unhandled error:", err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "localhost", () => {
  console.log(`[Server] Topix server running on http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("[Server] Server closed");
    process.exit(0);
  });
});
