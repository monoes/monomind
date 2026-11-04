/**
 * V1 Intelligence Module — SqlitePatternStore, the SQLite-backed PatternStore.
 *
 * Same contract and semantics as the JSON-file LocalReasoningBank, with
 * multi-process safety the JSON file cannot give:
 *  - every mutation is a short SQLite transaction (WAL, busy timeout), so
 *    concurrent hook processes never overwrite each other's patterns, and
 *    usage counts are incremented in SQL, so no increment is lost;
 *  - reads are served from an in-memory copy that is reloaded when another
 *    connection has committed (`PRAGMA data_version` changes);
 *  - retention matches the JSON store: at most `maxSize` patterns, evicting
 *    the oldest inserted (updates do not move a pattern).
 *
 * Objects returned by get()/getAll() are live, as with the JSON store: the
 * SONA loop adjusts `confidence`/`usageCount`/`lastUsedAt` on them in place.
 * Those edits are written by flushToDisk(), which runs 100ms after each
 * mutation (the JSON store's debounce) and on close(). A row is only
 * overwritten when this copy's lastUsedAt is not older than the stored one —
 * the JSON store's merge rule.
 *
 * @module v1/cli/intelligence
 */

import type { PatternStore } from '@monoes/memory';
import { cosineSimilarity } from '../utils/cosine-similarity.js';
import {
  encodeEmbedding,
  openPatternDb,
  type PatternDb,
  type PatternRow,
  rowToRaw,
} from './intelligence-pattern-db.js';
import { extraPatternFields, sanitizePatternRecord } from './intelligence-pattern-record.js';
import type { LocalReasoningBank } from './intelligence-reasoning-bank.js';
import type { StoredPattern } from './intelligence-types.js';

/** Either PatternStore implementation, as held by intelligence.ts. */
export type ReasoningBankStore = LocalReasoningBank | SqlitePatternStore;

const FLUSH_DEBOUNCE_MS = 100;

function mutableKey(p: StoredPattern): string {
  return `${p.confidence}|${p.usageCount}|${p.lastUsedAt}`;
}

export class SqlitePatternStore implements PatternStore {
  private byId = new Map<string, StoredPattern>();
  private list: StoredPattern[] = [];
  /** Last persisted confidence/usage/lastUsed per id, to detect in-place edits. */
  private persisted = new Map<string, string>();
  private dataVersion = -1;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly db: PatternDb,
    private readonly maxSize: number,
  ) {
    this.reload();
  }

  // ── cache coherence ──────────────────────────────────────────────────────

  private reload(): void {
    this.dataVersion = this.db.pragma('data_version', { simple: true }) as number;
    this.byId.clear();
    this.list = [];
    this.persisted.clear();
    for (const row of this.db
      .prepare('SELECT * FROM patterns ORDER BY seq')
      .all() as PatternRow[]) {
      const p = sanitizePatternRecord(rowToRaw(row));
      if (!p) continue;
      this.byId.set(p.id, p);
      this.list.push(p);
      this.persisted.set(p.id, mutableKey(p));
    }
  }

  /** Pick up commits made by other connections/processes since the last call. */
  private sync(): void {
    if (this.closed) return;
    const v = this.db.pragma('data_version', { simple: true }) as number;
    if (v === this.dataVersion) return;
    this.flushToDisk();
    this.reload();
  }

  /** Apply a freshly read row to the cache, keeping object identity for existing ids. */
  private applyRow(row: PatternRow): StoredPattern | null {
    const fresh = sanitizePatternRecord(rowToRaw(row));
    if (!fresh) return null;
    const existing = this.byId.get(fresh.id);
    if (existing) {
      if (!fresh.metadata) delete existing.metadata;
      Object.assign(existing, fresh);
    } else {
      this.byId.set(fresh.id, fresh);
      this.list.push(fresh);
    }
    const target = existing ?? fresh;
    this.persisted.set(target.id, mutableKey(target));
    return target;
  }

  private dropFromCache(ids: string[]): void {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    for (const id of ids) {
      this.byId.delete(id);
      this.persisted.delete(id);
    }
    this.list = this.list.filter((p) => !gone.has(p.id));
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushToDisk();
    }, FLUSH_DEBOUNCE_MS);
  }

  // ── PatternStore ─────────────────────────────────────────────────────────

  store(
    pattern: Omit<StoredPattern, 'usageCount' | 'createdAt' | 'lastUsedAt'> &
      Partial<StoredPattern>,
  ): void {
    this.sync();
    const now = Date.now();
    const hasMetadata = 'metadata' in pattern;
    const extra = extraPatternFields(pattern as unknown as Record<string, unknown>);
    const result = this.db
      .transaction(() => {
        // An existing id keeps its createdAt and position and gains one use,
        // exactly as LocalReasoningBank.store() does; omitted metadata/extra
        // fields are preserved.
        this.db
          .prepare(
            `INSERT INTO patterns (id, type, content, confidence, usage_count, created_at,
             last_used_at, embedding, metadata, extra)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET type = excluded.type, content = excluded.content,
             confidence = excluded.confidence, usage_count = patterns.usage_count + 1,
             last_used_at = excluded.last_used_at, embedding = excluded.embedding,
             metadata = CASE WHEN ? THEN excluded.metadata ELSE patterns.metadata END,
             extra = COALESCE(excluded.extra, patterns.extra)`,
          )
          .run(
            pattern.id,
            pattern.type,
            pattern.content,
            pattern.confidence,
            pattern.usageCount ?? 0,
            pattern.createdAt ?? now,
            pattern.lastUsedAt ?? now,
            encodeEmbedding(pattern.embedding ?? []),
            pattern.metadata ? JSON.stringify(pattern.metadata) : null,
            extra ? JSON.stringify(extra) : null,
            hasMetadata ? 1 : 0,
          );
        // Retention: keep the newest `maxSize` by insertion order.
        const evicted = this.db
          .prepare(
            `DELETE FROM patterns WHERE seq IN (
             SELECT seq FROM patterns ORDER BY seq
             LIMIT MAX(0, (SELECT COUNT(*) FROM patterns) - ?))
           RETURNING id`,
          )
          .all(this.maxSize) as { id: string }[];
        const row = this.db.prepare('SELECT * FROM patterns WHERE id = ?').get(pattern.id) as
          | PatternRow
          | undefined;
        return { evicted: evicted.map((e) => e.id), row };
      })
      .immediate();
    this.dropFromCache(result.evicted);
    if (result.row) this.applyRow(result.row);
    this.scheduleFlush();
  }

  /** Cosine-similarity search over the cached patterns; a pure read. */
  findSimilar(
    queryEmbedding: number[],
    options: { k?: number; threshold?: number; type?: string },
  ): StoredPattern[] {
    this.sync();
    const { k = 5, threshold = 0.5, type } = options;
    const candidates = type ? this.list.filter((p) => p.type === type) : this.list;
    const scored: { pattern: StoredPattern; score: number }[] = [];
    for (const pattern of candidates) {
      const score = cosineSimilarity(queryEmbedding, pattern.embedding);
      if (score >= threshold) scored.push({ pattern, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({ ...s.pattern, confidence: s.score }));
  }

  recordUsage(id: string): void {
    this.sync();
    const pattern = this.byId.get(id);
    if (!pattern) return;
    const row = this.db
      .prepare(
        `UPDATE patterns SET usage_count = usage_count + 1, last_used_at = ?
         WHERE id = ? RETURNING *`,
      )
      .get(Date.now(), id) as PatternRow | undefined;
    if (row) this.applyRow(row);
    else this.dropFromCache([id]);
    this.scheduleFlush();
  }

  get(id: string): StoredPattern | undefined {
    this.sync();
    return this.byId.get(id);
  }

  getAll(): StoredPattern[] {
    this.sync();
    return [...this.list];
  }

  getByType(type: string): StoredPattern[] {
    this.sync();
    return this.list.filter((p) => p.type === type);
  }

  delete(id: string): boolean {
    this.sync();
    const had = this.byId.has(id);
    const { changes } = this.db.prepare('DELETE FROM patterns WHERE id = ?').run(id);
    this.dropFromCache([id]);
    return had || changes > 0;
  }

  clear(): void {
    this.sync();
    this.db.prepare('DELETE FROM patterns').run();
    this.byId.clear();
    this.list = [];
    this.persisted.clear();
  }

  /** Write in-place edits (confidence/usage/lastUsed) made to returned objects. */
  flushToDisk(): void {
    if (this.closed) return;
    const changed = this.list.filter((p) => this.persisted.get(p.id) !== mutableKey(p));
    if (changed.length === 0) return;
    try {
      const update = this.db.prepare(
        `UPDATE patterns SET confidence = ?, usage_count = ?, last_used_at = ?
         WHERE id = ? AND last_used_at <= ?`,
      );
      this.db
        .transaction(() => {
          for (const p of changed) {
            update.run(p.confidence, p.usageCount, p.lastUsedAt, p.id, p.lastUsedAt);
            this.persisted.set(p.id, mutableKey(p));
          }
        })
        .immediate();
    } catch {
      // Same policy as the JSON store: persistence failures must not break training.
      console.error('Failed to persist patterns');
    }
  }

  stats(): { size: number; patternCount: number } {
    this.sync();
    return { size: this.byId.size, patternCount: this.list.length };
  }

  /** Flush pending edits and close the database connection. */
  close(): void {
    if (this.closed) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flushToDisk();
    this.closed = true;
    this.db.close();
  }
}

/** Open the SQLite pattern store in `dir`, or null when SQLite is unavailable. */
export function openSqlitePatternStore(dir: string, maxSize: number): SqlitePatternStore | null {
  const db = openPatternDb(dir, { maxSize });
  if (!db) return null;
  try {
    return new SqlitePatternStore(db, maxSize);
  } catch {
    db.close();
    return null;
  }
}
