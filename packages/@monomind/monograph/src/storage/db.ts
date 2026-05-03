import Database from 'better-sqlite3';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import {
  CREATE_NODES, CREATE_EDGES, CREATE_COMMUNITIES,
  CREATE_INDEX_META, CREATE_NODES_FTS, CREATE_INDEXES, FTS_SYNC_TRIGGERS,
  CREATE_NODE_PROPERTIES, SEED_NODE_PROPERTIES, CREATE_SUPPRESSIONS,
} from './schema.js';
import { MonographError } from '../types.js';

export type MonographDb = Database.Database;

export function openDb(dbPath: string): MonographDb {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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

  // v2: embedding column for semantic search (ALTER TABLE for existing dbs)
  const cols = (db.prepare('PRAGMA table_info(nodes)').all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('embedding')) {
    db.exec('ALTER TABLE nodes ADD COLUMN embedding TEXT');
  }

  // v3: weight column on edges for co-occurrence frequency
  const edgeCols = (db.prepare('PRAGMA table_info(edges)').all() as { name: string }[]).map(c => c.name);
  if (!edgeCols.includes('weight')) {
    db.exec('ALTER TABLE edges ADD COLUMN weight REAL NOT NULL DEFAULT 1.0');
  }

  // v4: trigram FTS for substring matching
  // FTS5 virtual tables cannot be ALTER'd; check the tokenize config key and rebuild if needed.
  let hasTrigram = false;
  try {
    const row = db.prepare(`SELECT v FROM nodes_fts_config WHERE k='tokenize'`).get() as { v: string } | undefined;
    hasTrigram = row?.v === 'trigram';
  } catch {
    // nodes_fts_config may not exist if the table is newly created — in that case
    // CREATE_NODES_FTS above already used trigram, so skip the rebuild.
    hasTrigram = true;
  }
  if (!hasTrigram) {
    db.exec('DROP TABLE IF EXISTS nodes_fts');
    db.exec(CREATE_NODES_FTS);
    db.exec(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`);
  }

  // v5: typed property registry
  db.exec(CREATE_NODE_PROPERTIES);
  db.exec(SEED_NODE_PROPERTIES);

  // v6: stale suppression detection table
  db.exec(CREATE_SUPPRESSIONS);
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
