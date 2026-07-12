import Database from 'better-sqlite3';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import {
  CREATE_NODES, CREATE_EDGES, CREATE_COMMUNITIES,
  CREATE_INDEX_META, CREATE_NODES_FTS, CREATE_INDEXES, FTS_SYNC_TRIGGERS,
  CREATE_EMBEDDINGS, CREATE_WIKI_PAGES,
  CREATE_AGENT_INTERACTIONS, CREATE_AGENT_INTERACTIONS_IDX,
  CREATE_AGENT_INTERACTIONS_ORG_IDX, CREATE_AGENT_INTERACTIONS_TYPE_IDX,
  CREATE_AGENT_INTERACTIONS_TS_IDX,
} from './schema.js';
import { MonographError } from '../types.js';

export type MonographDb = Database.Database;

export interface OpenDbOptions {
  /**
   * When true, throw a clear error instead of silently creating a fresh,
   * empty-but-migrated database if `dbPath` doesn't exist yet. Defaults to
   * false to preserve legacy build-time behavior (the `monograph build`
   * codepath legitimately creates new DBs). Read-only analysis tools should
   * pass `true` so pointing them at a repo whose real index lives elsewhere
   * (e.g. running from a subdirectory) fails loudly instead of reporting
   * fake-successful-looking empty results.
   */
  fileMustExist?: boolean;
}

export function openDb(dbPath: string, options: OpenDbOptions = {}): MonographDb {
  if (options.fileMustExist && !existsSync(dbPath)) {
    throw new MonographError(`Monograph database does not exist at ${dbPath}. Run monograph build first.`);
  }
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Concurrent pipeline phases + long-lived MCP connections share this DB —
    // without a busy timeout, writers fail immediately with "database is locked".
    db.pragma('busy_timeout = 10000');
    db.pragma('synchronous = NORMAL');
    // node-store uses INSERT OR REPLACE; without recursive_triggers the implicit
    // DELETE never fires the nodes_fts delete trigger, leaving ghost FTS rows that
    // corrupt queries ("missing row N from content table") and bloat the index.
    db.pragma('recursive_triggers = ON');
    applyMigrations(db);
    return db;
  } catch (err) {
    throw new MonographError(`Failed to open database at ${dbPath}`, err);
  }
}

export function closeDb(db: MonographDb): void {
  db.close();
}

function applyMigrations(db: MonographDb): void {
  db.exec(CREATE_NODES);
  db.exec(CREATE_EDGES);
  db.exec(CREATE_COMMUNITIES);
  db.exec(CREATE_INDEX_META);
  db.exec(CREATE_NODES_FTS);
  for (const idx of CREATE_INDEXES) db.exec(idx);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CREATE_EMBEDDINGS);
  db.exec(CREATE_WIKI_PAGES);
  db.exec(CREATE_AGENT_INTERACTIONS);
  db.exec(CREATE_AGENT_INTERACTIONS_IDX);
  db.exec(CREATE_AGENT_INTERACTIONS_ORG_IDX);
  db.exec(CREATE_AGENT_INTERACTIONS_TYPE_IDX);
  db.exec(CREATE_AGENT_INTERACTIONS_TS_IDX);

  // Schema version table — tracks incremental column additions.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;

  if (current < 1) {
    // v1: added `reason TEXT` to edges
    try { db.exec('ALTER TABLE edges ADD COLUMN reason TEXT'); } catch { /* already present */ }
    db.prepare('INSERT OR REPLACE INTO schema_version VALUES (1)').run();
  }
}

/** Write to a .tmp file then rename for atomic replacement. */
export function atomicRebuild(dbPath: string, buildFn: (db: MonographDb) => void): void {
  const tmpPath = dbPath + '.tmp';
  const db = openDb(tmpPath);
  try {
    buildFn(db);
    db.close();
    renameSync(tmpPath, dbPath);
  } catch (err) {
    db.close();
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    throw err;
  }
}
