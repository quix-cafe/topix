/**
 * Embedding-based semantic search using Ollama's /api/embed endpoint.
 * Stores embeddings in IndexedDB, caches in memory for fast cosine similarity search.
 */

import { getDB } from "./database.js";

const EMBEDDINGS_STORE = "embeddings";
const BATCH_SIZE = 50;

// ─── Embedding queue ─────────────────────────────────────────────────
// Serializes all embedding API calls to prevent Ollama contention.
const _embedQueue = [];
let _embedRunning = false;

function enqueueEmbed(fn) {
  return new Promise((resolve, reject) => {
    _embedQueue.push({ fn, resolve, reject });
    _drainEmbedQueue();
  });
}

async function _drainEmbedQueue() {
  if (_embedRunning || _embedQueue.length === 0) return;
  _embedRunning = true;
  while (_embedQueue.length > 0) {
    const { fn, resolve, reject } = _embedQueue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }
  _embedRunning = false;
}

/**
 * Generate embedding for a single text
 */
export async function embedText(text, model = "mxbai-embed-large") {
  return enqueueEmbed(async () => {
    const res = await fetch("http://localhost:11434/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error("No embedding returned");
    }
    return new Float32Array(data.embeddings[0]);
  });
}

/**
 * Generate embeddings for multiple texts in batches
 * @param {function} onBatchProgress - callback({batchDone, batchTotal}) called after each batch
 */
export async function embedBatch(texts, model = "mxbai-embed-large", onBatchProgress) {
  return enqueueEmbed(async () => {
    const results = [];
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE);
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      onBatchProgress?.({ batchDone: batchNum - 1, batchTotal: totalBatches, textsDone: i, textsTotal: texts.length });
      const res = await fetch("http://localhost:11434/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: batch }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${err}`);
      }
      const data = await res.json();
      if (!data.embeddings) {
        throw new Error("No embeddings returned");
      }
      for (const emb of data.embeddings) {
        results.push(new Float32Array(emb));
      }
      onBatchProgress?.({ batchDone: batchNum, batchTotal: totalBatches, textsDone: Math.min(i + BATCH_SIZE, texts.length), textsTotal: texts.length });
    }
    return results;
  });
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple text fingerprint for staleness detection
 */
function textHash(bit) {
  const ft = bit.fullText || "";
  return ft.length + ":" + ft.slice(0, 50);
}

/**
 * Build the text sent to the embedding model for a bit.
 * Deliberately excludes tags/keywords — those cause false positives.
 */
function bitToEmbedText(bit) {
  return `Title: ${bit.title || ""}\nSummary: ${bit.summary || ""}\nText: ${bit.fullText || ""}`;
}

// ─── IndexedDB helpers for embeddings ───────────────────────────────

async function saveEmbeddingToDB(record) {
  const db = await getDB();
  const tx = db.transaction([EMBEDDINGS_STORE], "readwrite");
  // Convert Float32Array to regular array for storage
  tx.objectStore(EMBEDDINGS_STORE).put({
    ...record,
    vector: Array.from(record.vector),
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllEmbeddingsFromDB() {
  const db = await getDB();
  if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) return [];
  const tx = db.transaction([EMBEDDINGS_STORE], "readonly");
  const store = tx.objectStore(EMBEDDINGS_STORE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function deleteEmbeddingFromDB(id) {
  const db = await getDB();
  if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) return;
  const tx = db.transaction([EMBEDDINGS_STORE], "readwrite");
  tx.objectStore(EMBEDDINGS_STORE).delete(id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearEmbeddingsFromDB() {
  const db = await getDB();
  if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) return;
  const tx = db.transaction([EMBEDDINGS_STORE], "readwrite");
  tx.objectStore(EMBEDDINGS_STORE).clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── EmbeddingStore class ────────────────────────────────────────────

export class EmbeddingStore {
  constructor() {
    // In-memory cache: bitId → { vector: Float32Array, model, textHash }
    this.cache = new Map();
    this.model = null;
  }

  /**
   * Load all embeddings from IndexedDB into memory
   */
  async loadFromDB() {
    try {
      const records = await loadAllEmbeddingsFromDB();
      for (const rec of records) {
        this.cache.set(rec.id, {
          vector: new Float32Array(rec.vector),
          model: rec.model,
          textHash: rec.textHash,
        });
      }
      console.log(`[Embeddings] Loaded ${records.length} embeddings from DB`);
    } catch (err) {
      console.warn("[Embeddings] Failed to load from DB:", err.message);
    }
  }

  /**
   * Get count of cached embeddings
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Compute missing/stale embeddings for a set of bits.
   * @param {Array} bits - bits to embed
   * @param {string} model - embedding model name
   * @param {function} onProgress - callback({done, total, status})
   */
  async ensureEmbeddings(bits, model, onProgress) {
    // Find bits that need (re-)embedding
    const toEmbed = bits.filter(bit => {
      const cached = this.cache.get(bit.id);
      if (!cached) return true;
      if (cached.model !== model) return true;
      if (cached.textHash !== textHash(bit)) return true;
      return false;
    });

    const cached = bits.length - toEmbed.length;

    if (toEmbed.length === 0) {
      onProgress?.({ done: bits.length, total: bits.length, status: `All ${bits.length} bits already embedded` });
      return;
    }

    console.log(`[Embeddings] Computing ${toEmbed.length} embeddings (${cached} cached) using ${model}`);

    const texts = toEmbed.map(bitToEmbedText);
    const vectors = await embedBatch(texts, model, ({ textsDone, textsTotal }) => {
      const totalDone = cached + textsDone;
      onProgress?.({
        done: totalDone,
        total: bits.length,
        status: `Embedding with ${model}: ${totalDone}/${bits.length} bits (${cached} cached, ${textsDone}/${textsTotal} computing...)`,
      });
    });

    for (let i = 0; i < toEmbed.length; i++) {
      const bit = toEmbed[i];
      const record = {
        id: bit.id,
        vector: vectors[i],
        model,
        textHash: textHash(bit),
        timestamp: Date.now(),
      };
      this.cache.set(bit.id, record);

      // Persist to DB (fire-and-forget batched)
      saveEmbeddingToDB(record).catch(err =>
        console.warn(`[Embeddings] DB save failed for ${bit.id}:`, err.message)
      );
    }

    onProgress?.({ done: bits.length, total: bits.length, status: `Embedded ${bits.length} bits (${cached} were cached, ${toEmbed.length} computed)` });
  }

  /**
   * Find k nearest neighbors to a given bit ID
   * @returns {Array<{bitId, score}>} sorted by descending similarity
   */
  findNearest(queryBitId, k = 8, excludeIds = new Set()) {
    const queryEntry = this.cache.get(queryBitId);
    if (!queryEntry) return [];

    return this.findNearestByVector(queryEntry.vector, k, new Set([...excludeIds, queryBitId]));
  }

  /**
   * Find k nearest neighbors to a raw vector
   * @returns {Array<{bitId, score}>} sorted by descending similarity
   */
  findNearestByVector(vec, k = 8, excludeIds = new Set()) {
    const results = [];
    for (const [bitId, entry] of this.cache) {
      if (excludeIds.has(bitId)) continue;
      const score = cosineSimilarity(vec, entry.vector);
      results.push({ bitId, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Invalidate a bit's embedding (called on split/join/boundary change)
   */
  invalidate(bitId) {
    this.cache.delete(bitId);
    deleteEmbeddingFromDB(bitId).catch(err =>
      console.warn(`[Embeddings] DB delete failed for ${bitId}:`, err.message)
    );
  }

  /**
   * Clear all embeddings (model change, DB import, DB wipe)
   */
  clear() {
    this.cache.clear();
    clearEmbeddingsFromDB().catch(err =>
      console.warn("[Embeddings] DB clear failed:", err.message)
    );
    console.log("[Embeddings] Cleared all embeddings");
  }
}
