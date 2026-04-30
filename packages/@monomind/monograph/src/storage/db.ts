import Database from 'better-sqlite3';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import {
  CREATE_NODES, CREATE_EDGES, CREATE_COMMUNITIES,
  CREATE_INDEX_META, CREATE_NODES_FTS, CREATE_INDEXES, FTS_SYNC_TRIGGERS,
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
