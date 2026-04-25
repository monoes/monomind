/**
 * ShortTermMemory — In-memory Map-based buffer (Task 09)
 *
 * Holds entries for the current run only. Supports FIFO eviction
 * when capacity is exceeded and bulk flush to a long-term backend.
 *
 * @module v1/memory/tiers/short-term
 */

import type { MemoryEntry, IMemoryBackend } from '../types.js';

export class ShortTermMemory {
  /** Insertion-ordered map for FIFO eviction */
  private buffer: Map<string, MemoryEntry> = new Map();
  private readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  // ---- Mutation ----

  /**
   * Store an entry. If the buffer exceeds capacity the oldest entry
   * (first inserted) is evicted.
   */
  store(entry: MemoryEntry): void {
    // If key already exists, delete first so re-insertion moves it to end
    if (this.buffer.has(entry.id)) {
      this.buffer.delete(entry.id);
    }

    this.buffer.set(entry.id, entry);

    // FIFO eviction — remove oldest entries until within capacity
    while (this.buffer.size > this.capacity) {
      const oldest = this.buffer.keys().next().value;
      if (oldest !== undefined) {
        this.buffer.delete(oldest);
      }
    }
  }

  // ---- Retrieval ----

  retrieve(id: string): MemoryEntry | undefined {
    return this.buffer.get(id);
  }

  /**
   * Simple substring search across entry content and key fields.
   * Returns up to `limit` matches ordered by most-recent insertion.
   */
  search(query: string, limit = 10): MemoryEntry[] {
    const lowerQuery = query.toLowerCase();
    const results: MemoryEntry[] = [];

    // Iterate in reverse insertion order (newest first)
    const entries = Array.from(this.buffer.values()).reverse();

    for (const entry of entries) {
      if (results.length >= limit) break;
      const haystack = `${entry.key} ${entry.content}`.toLowerCase();
      if (haystack.includes(lowerQuery)) {
        results.push(entry);
      }
    }

    return results;
  }

  // ---- Lifecycle ----

  /**
   * Promote all buffered entries to the given long-term backend,
   * then clear the buffer. Returns the number of flushed entries.
   */
  async flush(longTermStore: IMemoryBackend): Promise<number> {
    const entries = Array.from(this.buffer.values());
    if (entries.length === 0) return 0;

    await longTermStore.bulkInsert(entries);
    const count = entries.length;
    this.buffer.clear();
    return count;
  }

  /** Remove all entries from the buffer. */
  clear(): void {
    this.buffer.clear();
  }

  /** Current number of entries in the buffer. */
  get size(): number {
    return this.buffer.size;
  }
}
