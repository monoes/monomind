/**
 * V1 Intelligence Module — LocalReasoningBank
 * Split out of intelligence.ts (file-size sweep). Pure move.
 *
 * @module v1/cli/intelligence
 */

import type { PatternStore } from '@monoes/memory';
import { cosineSimilarity as sharedCosineSimilarity } from '../utils/cosine-similarity.js';
import { readJsonFileSync, writeJsonFileAtomic } from '../utils/json-file.js';
import {
  claimPatternsLock,
  ensureDataDir,
  getPatternsPath,
  releasePatternsLock,
} from './intelligence-persistence.js';
import type { StoredPattern } from './intelligence-types.js';

/**
 * Lightweight ReasoningBank
 * Uses Map for O(1) storage and array for similarity search
 * Supports persistence to disk
 */
export class LocalReasoningBank implements PatternStore {
  private patterns: Map<string, StoredPattern> = new Map();
  private patternList: StoredPattern[] = [];
  private maxSize: number;
  private persistenceEnabled: boolean;
  private dirty: boolean = false;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { maxSize: number; persistence?: boolean }) {
    this.maxSize = options.maxSize;
    this.persistenceEnabled = options.persistence !== false;

    // Load persisted patterns
    if (this.persistenceEnabled) {
      this.loadFromDisk();
    }
  }

  /**
   * Load patterns from disk
   */
  private loadFromDisk(): void {
    try {
      const data = readJsonFileSync<unknown[]>(getPatternsPath(), []);
      if (Array.isArray(data)) {
        // Validate each persisted pattern. patterns.json can be replaced or
        // hand-edited outside the process (a transferred/imported file, or
        // direct tampering) — without bounds checks, a malicious file can
        // inject `confidence: 1e9` (deterministically wins every routing
        // decision) or `keywords: [10000 strings]` (DoS on every
        // findBestPatternMatch call).
        for (const pattern of data) {
          if (!pattern || typeof pattern !== 'object') continue;
          const rec = pattern as Record<string, unknown>;
          const id = rec.id;
          if (typeof id !== 'string' || id.length === 0 || id.length > 256) continue;
          const conf = rec.confidence;
          if (
            conf !== undefined &&
            (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1)
          ) {
            continue;
          }
          const keywords = rec.keywords;
          if (keywords !== undefined && (!Array.isArray(keywords) || keywords.length > 64)) {
            continue;
          }
          // Build a well-typed StoredPattern instead of trusting the raw JSON
          // shape — this both satisfies the compiler (the previous code cast
          // `unknown` straight into the Map/array, which TS correctly rejected)
          // and hardens against malformed/malicious persisted entries (e.g. a
          // missing embedding array previously reached cosineSim() as `undefined`).
          const rawEmbedding = rec.embedding;
          const embedding =
            Array.isArray(rawEmbedding) &&
            rawEmbedding.every((v) => typeof v === 'number' && Number.isFinite(v))
              ? (rawEmbedding as number[])
              : [];
          const rawUsage = rec.usageCount;
          const rawCreated = rec.createdAt;
          const rawLastUsed = rec.lastUsedAt;
          const stored: StoredPattern = {
            id,
            type: typeof rec.type === 'string' ? rec.type : 'general',
            embedding,
            content: typeof rec.content === 'string' ? rec.content : '',
            confidence: typeof conf === 'number' ? conf : 0.5,
            usageCount: typeof rawUsage === 'number' && Number.isFinite(rawUsage) ? rawUsage : 0,
            createdAt:
              typeof rawCreated === 'number' && Number.isFinite(rawCreated)
                ? rawCreated
                : Date.now(),
            lastUsedAt:
              typeof rawLastUsed === 'number' && Number.isFinite(rawLastUsed)
                ? rawLastUsed
                : Date.now(),
            metadata:
              rec.metadata && typeof rec.metadata === 'object'
                ? (rec.metadata as Record<string, unknown>)
                : undefined,
          };
          this.patterns.set(id, stored);
          this.patternList.push(stored);
        }
      }

      // MCP-trained patterns (neural-tools) now write directly to this
      // ReasoningBank via intelligence.ts's public API, so no separate
      // models.json bridge is needed.
    } catch (e) {
      // Ignore load errors, start fresh
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[intelligence] failed to load patterns.json, starting fresh:', e);
    }
  }

  /**
   * Save patterns to disk (debounced)
   */
  private saveToDisk(): void {
    if (!this.persistenceEnabled) return;

    this.dirty = true;

    // Debounce saves to avoid excessive disk I/O
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.flushToDisk();
    }, 100);
  }

  /**
   * Immediately flush patterns to disk
   */
  flushToDisk(): void {
    if (!this.persistenceEnabled || !this.dirty) return;

    try {
      ensureDataDir();

      let acquired = claimPatternsLock();
      if (!acquired) acquired = claimPatternsLock(); // one retry — lock is short-lived
      try {
        // Re-read the current on-disk patterns and merge this process's
        // in-memory changes in by id (newer lastUsedAt wins) instead of
        // blindly overwriting the whole file with this.patternList — see
        // the P1-14 comment above claimPatternsLock() for why.
        const diskPatterns = readJsonFileSync<StoredPattern[]>(getPatternsPath(), []);
        const merged = new Map<string, StoredPattern>();
        if (Array.isArray(diskPatterns)) {
          for (const p of diskPatterns) {
            if (p && typeof p.id === 'string') merged.set(p.id, p);
          }
        }
        for (const p of this.patternList) {
          const existing = merged.get(p.id);
          if (!existing || (p.lastUsedAt ?? 0) >= (existing.lastUsedAt ?? 0)) {
            merged.set(p.id, p);
          }
        }
        writeJsonFileAtomic(getPatternsPath(), Array.from(merged.values()));
      } finally {
        if (acquired) releasePatternsLock();
      }

      this.dirty = false;
    } catch {
      // Log but don't throw - persistence failures shouldn't break training
      // Do not reflect raw error to avoid leaking internal paths
      console.error('Failed to persist patterns');
    }
  }

  /**
   * Store a pattern - O(1)
   */
  store(
    pattern: Omit<StoredPattern, 'usageCount' | 'createdAt' | 'lastUsedAt'> &
      Partial<StoredPattern>,
  ): void {
    const now = Date.now();
    const stored: StoredPattern = {
      ...pattern,
      usageCount: pattern.usageCount ?? 0,
      createdAt: pattern.createdAt ?? now,
      lastUsedAt: pattern.lastUsedAt ?? now,
    };

    // Update or insert
    if (this.patterns.has(pattern.id)) {
      const existing = this.patterns.get(pattern.id)!;
      // Preserve accumulated metadata from the existing entry
      stored.usageCount = existing.usageCount + 1;
      stored.createdAt = existing.createdAt;

      // Update in-place: both Map and patternList hold the same object reference,
      // so mutating it here updates both without an O(n) list scan (no findIndex).
      Object.assign(existing, stored);
      // No need to re-insert into Map or patternList — reference unchanged.
      this.saveToDisk();
      return;
    } else {
      // Evict oldest if at capacity
      if (this.patterns.size >= this.maxSize) {
        const oldest = this.patternList.shift();
        if (oldest) {
          this.patterns.delete(oldest.id);
        }
      }
      this.patternList.push(stored);
    }

    this.patterns.set(pattern.id, stored);

    // Trigger persistence (debounced)
    this.saveToDisk();
  }

  /**
   * Find similar patterns by embedding.
   *
   * This is a pure read operation: it does NOT mutate usageCount or
   * lastUsedAt, so no disk save is triggered. Callers that need to record
   * a usage hit should call `recordUsage(id)` explicitly after consuming
   * the results.
   */
  findSimilar(
    queryEmbedding: number[],
    options: { k?: number; threshold?: number; type?: string },
  ): StoredPattern[] {
    const { k = 5, threshold = 0.5, type } = options;

    // Filter by type if specified
    const candidates = type ? this.patternList.filter((p) => p.type === type) : this.patternList;

    // Compute similarities without mutating patterns
    const scored: { pattern: StoredPattern; score: number }[] = [];
    for (const pattern of candidates) {
      const score = this.cosineSim(queryEmbedding, pattern.embedding);
      if (score >= threshold) {
        scored.push({ pattern, score });
      }
    }

    // Sort descending and slice, returning snapshot copies with confidence=score
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({ ...s.pattern, confidence: s.score }));
  }

  /**
   * Record that a pattern was used, updating its usage metrics and scheduling
   * a debounced disk save. Separated from findSimilar to keep searches pure.
   */
  recordUsage(id: string): void {
    const pattern = this.patterns.get(id);
    if (!pattern) return;
    pattern.usageCount++;
    pattern.lastUsedAt = Date.now();
    // Update list entry in-place using the Map reference (already same object)
    this.saveToDisk();
  }

  /**
   * Cosine similarity — delegates to shared utility
   * (see src/utils/cosine-similarity.ts)
   */
  private cosineSim(a: number[], b: number[]): number {
    return sharedCosineSimilarity(a, b);
  }

  /**
   * Get statistics
   */
  stats(): { size: number; patternCount: number } {
    return {
      size: this.patterns.size,
      patternCount: this.patternList.length,
    };
  }

  /**
   * Get pattern by ID
   */
  get(id: string): StoredPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Get all patterns
   */
  getAll(): StoredPattern[] {
    return [...this.patternList];
  }

  /**
   * Get patterns by type
   */
  getByType(type: string): StoredPattern[] {
    return this.patternList.filter((p) => p.type === type);
  }

  /**
   * Delete a pattern by ID
   */
  delete(id: string): boolean {
    const pattern = this.patterns.get(id);
    if (!pattern) return false;

    this.patterns.delete(id);
    const idx = this.patternList.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.patternList.splice(idx, 1);
    }

    this.saveToDisk();
    return true;
  }

  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
    this.patternList = [];
    this.saveToDisk();
  }
}
