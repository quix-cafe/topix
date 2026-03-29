/**
 * Operation Queue — serializes async state mutations to prevent race conditions.
 * All state-modifying async operations (dedup, matching, naming) should go through this.
 */
export class OpQueue {
  #queue = [];
  #running = false;
  #currentController = null;

  /**
   * Enqueue an async function to run serially.
   * The callback receives an AbortSignal: fn(signal).
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
      const controller = new AbortController();
      this.#currentController = controller;
      try {
        resolve(await fn(controller.signal));
      } catch (e) {
        reject(e);
      }
      this.#currentController = null;
    }
    this.#running = false;
  }

  /** Number of pending operations (including currently running) */
  get pending() {
    return this.#queue.length + (this.#running ? 1 : 0);
  }

  /** Clear all pending (not yet started) operations and abort the currently running task */
  clear() {
    const cleared = this.#queue.length + (this.#currentController ? 1 : 0);
    if (this.#currentController) {
      this.#currentController.abort();
      this.#currentController = null;
    }
    for (const { reject } of this.#queue) {
      reject(new Error("Queue cleared"));
    }
    this.#queue = [];
    return cleared;
  }
}
