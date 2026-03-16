#!/usr/bin/env node
/**
 * Ollama Process Manager Server
 * Handles Ollama health checks and restarts on Fedora
 * Runs on port 3001 by default
 */

import http from "http";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);
const PORT = process.env.PORT || 3001;

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

  // Wait for Ollama to be healthy again (max 60 seconds)
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

  // Health check endpoint
  if (req.url === "/api/health" && req.method === "GET") {
    const healthy = await ollamaHealthCheck();
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ healthy, status: healthy ? "ok" : "down" }));
    return;
  }

  // Restart Ollama endpoint
  if (req.url === "/api/restart-ollama" && req.method === "POST") {
    const result = await restartOllama();
    res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "localhost", () => {
  console.log(`[Server] Ollama Process Manager running on http://localhost:${PORT}`);
  console.log(`[Server] Health check: GET http://localhost:${PORT}/api/health`);
  console.log(`[Server] Restart Ollama: POST http://localhost:${PORT}/api/restart-ollama`);
});

process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("[Server] Server closed");
    process.exit(0);
  });
});
