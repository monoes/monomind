/**
 * V1 Intelligence Module — SQLite file layer for the pattern store.
 *
 * Opens `.monomind/neural/patterns.db` with better-sqlite3 (the driver the
 * memory backend and mesh store already use), in WAL mode with a busy
 * timeout so the MCP server and short-lived hook processes can write at once.
 * better-sqlite3 reaches the CLI through optional/transitive packages, so it
 * is loaded lazily with createRequire: when it is missing or its native
 * binary does not load, every function here returns null and callers fall
 * back to the JSON file (patterns.json).
 *
 * The first writable open imports an existing patterns.json once, when the
 * database is still empty, then renames the JSON file to
 * `patterns.json.imported` (never deletes it).
 *
 * @module v1/cli/intelligence
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { extraPatternFields, sanitizePatternRecord } from './intelligence-pattern-record.js';

export interface PatternDbStmt {
  run(...args: unknown[]): { changes: number };
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}
export interface PatternDb {
  exec(sql: string): void;
  prepare(sql: string): PatternDbStmt;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<F extends (...args: never[]) => unknown>(fn: F): F & { immediate: F };
  close(): void;
}
export type PatternDbDriver = new (
  path: string,
  options?: { timeout?: number; readonly?: boolean; fileMustExist?: boolean },
) => PatternDb;

export const PATTERNS_DB_FILE = 'patterns.db';
export const PATTERNS_JSON_FILE = 'patterns.json';
export const IMPORTED_JSON_SUFFIX = '.imported';
/** How long a writer waits for another process's write lock before SQLITE_BUSY. */
export const PATTERNS_DB_BUSY_TIMEOUT_MS = 5000;
/** Same cap the JSON store applies when it loads patterns.json (readJsonFileSync). */
const MAX_LEGACY_JSON_BYTES = 50 * 1024 * 1024;
const LEGACY_IMPORT_KEY = 'legacy_json_imported';

export const PATTERNS_SCHEMA = `
CREATE TABLE IF NOT EXISTS patterns (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  usage_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  embedding BLOB,
  metadata TEXT,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
CREATE TABLE IF NOT EXISTS pattern_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export interface PatternRow {
  seq: number;
  id: string;
  type: string;
  content: string;
  confidence: number;
  usage_count: number;
  created_at: number;
  last_used_at: number;
  embedding: Buffer | null;
  metadata: string | null;
  extra: string | null;
}

let driver: PatternDbDriver | null | undefined;

/** better-sqlite3's constructor, or null when it is not installed. */
export function loadPatternDbDriver(): PatternDbDriver | null {
  if (driver !== undefined) return driver;
  try {
    driver = createRequire(import.meta.url)('better-sqlite3') as PatternDbDriver;
  } catch {
    driver = null;
  }
  return driver;
}

/** Test seam: force a driver (or null = "SQLite unavailable"); undefined restores auto-detection. */
export function setPatternDbDriverForTests(d: PatternDbDriver | null | undefined): void {
  driver = d;
}

function debug(msg: string, e: unknown): void {
  if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`[intelligence] ${msg}:`, e);
}

/** Embeddings are stored as little-endian float64, so values round-trip exactly as JSON did. */
export function encodeEmbedding(embedding: number[]): Buffer | null {
  if (embedding.length === 0) return null;
  const buf = Buffer.alloc(embedding.length * 8);
  embedding.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
  return buf;
}

export function decodeEmbedding(buf: Buffer | null): number[] {
  if (!buf || buf.length % 8 !== 0) return [];
  const out = new Array<number>(buf.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
}

function parseJsonObject(text: string | null): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A row as the raw record shape patterns.json held (extra fields first, core fields win). */
export function rowToRaw(row: PatternRow): Record<string, unknown> {
  const metadata = parseJsonObject(row.metadata);
  return {
    ...parseJsonObject(row.extra),
    id: row.id,
    type: row.type,
    embedding: decodeEmbedding(row.embedding),
    content: row.content,
    confidence: row.confidence,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    ...(metadata ? { metadata } : {}),
  };
}

const UPSERT_COLUMNS =
  'id, type, content, confidence, usage_count, created_at, last_used_at, embedding, metadata, extra';

/**
 * Write raw records (validated with the JSON store's rules; invalid ones are
 * skipped). onConflict 'overwrite' replaces an existing id's fields in place,
 * 'keep' leaves an existing id untouched. Call inside a transaction.
 */
function insertRawRecords(
  db: PatternDb,
  records: unknown[],
  onConflict: 'overwrite' | 'keep',
): number {
  const conflict =
    onConflict === 'keep'
      ? 'DO NOTHING'
      : `DO UPDATE SET type = excluded.type, content = excluded.content,
           confidence = excluded.confidence, usage_count = excluded.usage_count,
           created_at = excluded.created_at, last_used_at = excluded.last_used_at,
           embedding = excluded.embedding, metadata = excluded.metadata, extra = excluded.extra`;
  const stmt = db.prepare(
    `INSERT INTO patterns (${UPSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) ${conflict}`,
  );
  let written = 0;
  for (const raw of records) {
    const p = sanitizePatternRecord(raw);
    if (!p) continue;
    const extra = extraPatternFields(raw as Record<string, unknown>);
    written += stmt.run(
      p.id,
      p.type,
      p.content,
      p.confidence,
      p.usageCount,
      p.createdAt,
      p.lastUsedAt,
      encodeEmbedding(p.embedding),
      p.metadata ? JSON.stringify(p.metadata) : null,
      extra ? JSON.stringify(extra) : null,
    ).changes;
  }
  return written;
}

function importedJsonTarget(jsonPath: string): string {
  const plain = `${jsonPath}${IMPORTED_JSON_SUFFIX}`;
  return existsSync(plain) ? `${plain}-${Date.now()}` : plain;
}

/**
 * One-time migration: when patterns.json exists, the database is empty and
 * no import was recorded, copy the JSON records in (keeping the newest
 * `maxSize`, the store's retention bound) and record it in
 * pattern_store_meta. BEGIN IMMEDIATE makes concurrent first opens import
 * exactly once. The JSON file is renamed only after the commit; if anything
 * fails it stays where it was, untouched.
 */
function importLegacyJsonOnce(db: PatternDb, dir: string, maxSize: number): void {
  const jsonPath = join(dir, PATTERNS_JSON_FILE);
  if (!existsSync(jsonPath)) return;
  let imported = false;
  try {
    imported = db
      .transaction(() => {
        if (db.prepare('SELECT 1 FROM pattern_store_meta WHERE key = ?').get(LEGACY_IMPORT_KEY)) {
          return false;
        }
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM patterns').get() as { n: number };
        if (n > 0) return false;
        if (statSync(jsonPath).size > MAX_LEGACY_JSON_BYTES) return false;
        const data: unknown = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        if (!Array.isArray(data)) return false;
        const valid = data.filter((r) => sanitizePatternRecord(r) !== null);
        const kept = valid.length > maxSize ? valid.slice(valid.length - maxSize) : valid;
        const count = insertRawRecords(db, kept, 'overwrite');
        db.prepare('INSERT INTO pattern_store_meta (key, value) VALUES (?, ?)').run(
          LEGACY_IMPORT_KEY,
          JSON.stringify({ at: Date.now(), source: PATTERNS_JSON_FILE, records: count }),
        );
        return true;
      })
      .immediate() as boolean;
  } catch (e) {
    debug('patterns.json import into patterns.db skipped', e);
    return;
  }
  if (!imported) return;
  try {
    renameSync(jsonPath, importedJsonTarget(jsonPath));
  } catch (e) {
    // Recorded as imported either way, so it is never imported twice.
    debug('could not rename imported patterns.json', e);
  }
}

/**
 * Open the pattern database in `dir`. Writable opens create it, set WAL mode
 * and run the one-time JSON import; read-only opens (another project's store,
 * stats) never create or migrate anything. Null when SQLite is unavailable or
 * the file cannot be opened.
 */
export function openPatternDb(
  dir: string,
  options: { readonly?: boolean; maxSize?: number } = {},
): PatternDb | null {
  const Driver = loadPatternDbDriver();
  if (!Driver) return null;
  const file = join(dir, PATTERNS_DB_FILE);
  const readonly = options.readonly === true;
  if (readonly && !existsSync(file)) return null;
  let db: PatternDb | null = null;
  try {
    if (!readonly) mkdirSync(dir, { recursive: true });
    db = new Driver(file, {
      timeout: PATTERNS_DB_BUSY_TIMEOUT_MS,
      readonly,
      fileMustExist: readonly,
    });
    db.pragma(`busy_timeout = ${PATTERNS_DB_BUSY_TIMEOUT_MS}`);
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.exec(PATTERNS_SCHEMA);
      importLegacyJsonOnce(db, dir, options.maxSize ?? Number.MAX_SAFE_INTEGER);
    }
    return db;
  } catch (e) {
    debug(`could not open ${file}`, e);
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Every record in the SQLite store in `dir`, in insertion order, as the raw
 * shape patterns.json held. Read-only. Null when there is no readable
 * database (the caller then reads patterns.json, as before).
 */
export function readPatternDbRecords(dir: string): Record<string, unknown>[] | null {
  const db = openPatternDb(dir, { readonly: true });
  if (!db) return null;
  try {
    return (db.prepare('SELECT * FROM patterns ORDER BY seq').all() as PatternRow[]).map(rowToRaw);
  } catch (e) {
    debug('could not read patterns.db', e);
    return null;
  } finally {
    db.close();
  }
}

/**
 * Write records into the SQLite store in `dir`: 'replace' swaps the whole
 * set (as rewriting patterns.json did), 'add' inserts only ids not already
 * there. False when SQLite is unavailable, so the caller writes patterns.json.
 */
export function writePatternDbRecords(
  dir: string,
  records: unknown[],
  mode: 'replace' | 'add',
): boolean {
  const db = openPatternDb(dir);
  if (!db) return false;
  try {
    db.transaction(() => {
      if (mode === 'replace') db.prepare('DELETE FROM patterns').run();
      insertRawRecords(db, records, mode === 'replace' ? 'overwrite' : 'keep');
    }).immediate();
    return true;
  } finally {
    db.close();
  }
}

/** On-disk size (database plus WAL) and row count of the store in `dir`, or null. */
export function patternDbStats(dir: string): { size: number; entries: number } | null {
  const db = openPatternDb(dir, { readonly: true });
  if (!db) return null;
  try {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM patterns').get() as { n: number };
    let size = 0;
    for (const f of [PATTERNS_DB_FILE, `${PATTERNS_DB_FILE}-wal`]) {
      try {
        size += statSync(join(dir, f)).size;
      } catch {
        /* no WAL file */
      }
    }
    return { size, entries: n };
  } catch {
    return null;
  } finally {
    db.close();
  }
}
