/**
 * Operation Queue — serializes async state mutations to prevent race conditions.
 * All state-modifying async operations (dedup, matching, naming) should go through this.
 */
export class OpQueue {
  #queue = [];
  #running = false;

  /**
   * Enqueue an async function to run serially.
   * Returns a promise that resolves with the function's return value.
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ fn, resolve, reject });
      this.#drain();
    });
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    while (this.#queue.length > 0) {
      const { fn, resolve, reject } = this.#queue.shift();
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    }
    this.#running = false;
  }

  /** Number of pending operations (including currently running) */
  get pending() {
    return this.#queue.length + (this.#running ? 1 : 0);
  }

  /** Clear all pending (not yet started) operations */
  clear() {
    const cleared = this.#queue.length;
    for (const { reject } of this.#queue) {
      reject(new Error("Queue cleared"));
    }
    this.#queue = [];
    return cleared;
  }
}
