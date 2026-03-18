/**
 * Database Service - IndexedDB wrapper for persistent local storage
 * Automatically saves vault data continuously
 */

const DB_NAME = "comedy-parser-vault";
const DB_VERSION = 3; // v3: adds embeddings store

const STORES = {
  transcripts: "transcripts",
  topics: "topics",
  matches: "matches",
  touchstones: "touchstones",
  rootBits: "rootBits",
  metadata: "metadata",
};

/**
 * Initialize the database with versioned migrations
 */
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // v0 → v1: create all stores
      if (oldVersion < 1) {
        Object.entries(STORES).forEach(([, storeName]) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "id" });
            store.createIndex("timestamp", "timestamp", { unique: false });
            if (storeName !== "metadata") {
              store.createIndex("sourceFile", "sourceFile", { unique: false });
            }
          }
        });
      }

      // v1 → v2: ensure all stores exist (safe for existing DBs)
      if (oldVersion < 2) {
        Object.entries(STORES).forEach(([, storeName]) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "id" });
            store.createIndex("timestamp", "timestamp", { unique: false });
            if (storeName !== "metadata") {
              store.createIndex("sourceFile", "sourceFile", { unique: false });
            }
          }
        });
      }

      // v2 → v3: add embeddings store (derived data, not included in exports)
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains("embeddings")) {
          db.createObjectStore("embeddings", { keyPath: "id" });
        }
      }
    };
  });
}

/** Cached database connection */
let dbPromise = null;

/**
 * Get (or create) a cached database connection
 */
export function getDB() {
  if (!dbPromise) dbPromise = initDatabase();
  return dbPromise;
}

/**
 * Sync a store within an existing transaction.
 * Put all records, delete any DB records whose IDs are not in the new set.
 */
async function syncStoreInTx(store, records) {
  const newIds = new Set(records.map((r) => r.id));

  // Get existing keys to find stale records
  const existingKeys = await new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });

  // Delete records not in the new set
  for (const key of existingKeys) {
    if (!newIds.has(key)) {
      store.delete(key);
    }
  }

  // Put all current records
  const ts = Date.now();
  for (const record of records) {
    store.put({ ...record, timestamp: ts });
  }
}

/**
 * Sync a store: put all records, delete any DB records whose IDs are not in the new set.
 * Uses a single transaction so it's atomic.
 */
async function syncStore(storeName, records) {
  const db = await getDB();
  const tx = db.transaction([storeName], "readwrite");
  const store = tx.objectStore(storeName);

  await syncStoreInTx(store, records);

  // Wait for the whole transaction to complete
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

export async function saveTranscripts(transcripts) {
  await syncStore(STORES.transcripts, transcripts);
}

/**
 * Load transcripts from database
 */
export async function loadTranscripts() {
  const db = await getDB();
  const store = db.transaction([STORES.transcripts], "readonly").objectStore(STORES.transcripts);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Save topics (bits) to database
 */
export async function saveTopics(topics) {
  await syncStore(STORES.topics, topics);
}

/**
 * Immediately persist a single topic to the database.
 * Does NOT delete other records — just a single put so the bit
 * is durable the moment the LLM returns it.
 */
export async function saveSingleTopic(topic) {
  const db = await getDB();
  const tx = db.transaction([STORES.topics], "readwrite");
  tx.objectStore(STORES.topics).put({ ...topic, timestamp: Date.now() });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Load topics from database
 */
export async function loadTopics() {
  const db = await getDB();
  const store = db.transaction([STORES.topics], "readonly").objectStore(STORES.topics);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Save matches to database
 */
export async function saveMatches(matches) {
  await syncStore(STORES.matches, matches);
}

/**
 * Load matches from database
 */
export async function loadMatches() {
  const db = await getDB();
  const store = db.transaction([STORES.matches], "readonly").objectStore(STORES.matches);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Flatten touchstones object to array for DB storage
 */
function flattenTouchstones(touchstones) {
  if (Array.isArray(touchstones)) return touchstones;
  if (touchstones && typeof touchstones === "object") {
    return [
      ...(touchstones.confirmed || []).map((t) => ({ ...t, category: "confirmed" })),
      ...(touchstones.possible || []).map((t) => ({ ...t, category: "possible" })),
      ...(touchstones.rejected || []).map((t) => ({ ...t, category: "rejected" })),
    ];
  }
  return [];
}

/**
 * Save touchstones to database
 */
export async function saveTouchstones(touchstones) {
  await syncStore(STORES.touchstones, flattenTouchstones(touchstones));
}

/**
 * Load touchstones from database
 */
export async function loadTouchstones() {
  const db = await getDB();
  const store = db.transaction([STORES.touchstones], "readonly").objectStore(STORES.touchstones);

  const records = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  // Reconstruct { confirmed, possible, rejected } from flat array
  // Legacy records without a category default to confirmed
  return {
    confirmed: records.filter((t) => !t.category || t.category === "confirmed"),
    possible: records.filter((t) => t.category === "possible"),
    rejected: records.filter((t) => t.category === "rejected"),
  };
}

/**
 * Save root bits to database
 */
export async function saveRootBits(rootBits) {
  await syncStore(STORES.rootBits, rootBits);
}

/**
 * Load root bits from database
 */
export async function loadRootBits() {
  const db = await getDB();
  const store = db.transaction([STORES.rootBits], "readonly").objectStore(STORES.rootBits);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Save entire vault state atomically — all stores in one transaction.
 * If any store fails, the entire save rolls back.
 */
export async function saveVaultState(vaultData) {
  const db = await getDB();
  const storeNames = [STORES.transcripts, STORES.topics, STORES.matches, STORES.touchstones, STORES.rootBits, STORES.metadata];
  const tx = db.transaction(storeNames, "readwrite");

  const flatTouchstones = flattenTouchstones(vaultData.touchstones || {});

  // Gather all store references and data pairs
  const pairs = [
    [tx.objectStore(STORES.transcripts), vaultData.transcripts || []],
    [tx.objectStore(STORES.topics), vaultData.topics || []],
    [tx.objectStore(STORES.matches), vaultData.matches || []],
    [tx.objectStore(STORES.touchstones), flatTouchstones],
    [tx.objectStore(STORES.rootBits), vaultData.rootBits || []],
  ];

  // Fetch all existing keys in parallel (single await keeps transaction alive)
  const allKeys = await Promise.all(
    pairs.map(([store]) => new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || []);
    }))
  );

  // Now do all deletes and puts synchronously (no awaits = transaction stays active)
  const ts = Date.now();
  for (let i = 0; i < pairs.length; i++) {
    const [store, records] = pairs[i];
    const newIds = new Set(records.map((r) => r.id));
    for (const key of allKeys[i]) {
      if (!newIds.has(key)) store.delete(key);
    }
    for (const record of records) {
      store.put({ ...record, timestamp: ts });
    }
  }

  // Save metadata in same transaction
  tx.objectStore(STORES.metadata).put({
    id: "vault-state",
    lastSaved: Date.now(),
    stats: {
      totalBits: vaultData.topics?.length || 0,
      totalMatches: vaultData.matches?.length || 0,
      totalTouchstones: flatTouchstones.length,
      totalRootBits: vaultData.rootBits?.length || 0,
    },
  });

  // Wait for the entire transaction to commit
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

/**
 * Load entire vault state
 */
export async function loadVaultState() {
  return {
    transcripts: await loadTranscripts(),
    topics: await loadTopics(),
    matches: await loadMatches(),
    touchstones: await loadTouchstones(),
    rootBits: await loadRootBits(),
  };
}

/**
 * Get vault metadata
 */
export async function getVaultMetadata() {
  const db = await getDB();
  const store = db.transaction([STORES.metadata], "readonly").objectStore(STORES.metadata);

  return new Promise((resolve, reject) => {
    const request = store.get("vault-state");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || { id: "vault-state", lastSaved: null, stats: {} });
  });
}

/**
 * Clear all data from database
 */
export async function clearDatabase() {
  const db = await getDB();
  const tx = db.transaction(Object.values(STORES), "readwrite");

  for (const storeName of Object.values(STORES)) {
    await new Promise((resolve, reject) => {
      const request = tx.objectStore(storeName).clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

/**
 * Export all data as JSON
 */
export async function exportDatabaseAsJSON() {
  const vaultState = await loadVaultState();
  const metadata = await getVaultMetadata();

  return {
    version: 2,
    exportDate: new Date().toISOString(),
    metadata,
    data: vaultState,
  };
}

/**
 * Import data from JSON
 */
export async function importDatabaseFromJSON(jsonData) {
  if (!jsonData.data) {
    throw new Error("Invalid import format");
  }

  await saveVaultState(jsonData.data);

  // Clear derived embeddings on import — they'll be recomputed
  try {
    const db = await getDB();
    if (db.objectStoreNames.contains("embeddings")) {
      const tx = db.transaction(["embeddings"], "readwrite");
      tx.objectStore("embeddings").clear();
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } catch (err) {
    console.warn("[DB] Failed to clear embeddings on import:", err.message);
  }

  return true;
}

/**
 * Get database size stats
 */
export async function getDatabaseStats() {
  const db = await getDB();

  const stats = {};
  for (const [key, storeName] of Object.entries(STORES)) {
    const store = db.transaction([storeName], "readonly").objectStore(storeName);
    stats[key] = await new Promise((resolve, reject) => {
      const request = store.count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || 0);
    });
  }

  return stats;
}
