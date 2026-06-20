import Database from 'better-sqlite3';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { CREATE_NODES, CREATE_EDGES, CREATE_COMMUNITIES, CREATE_INDEX_META, CREATE_NODES_FTS, CREATE_INDEXES, FTS_SYNC_TRIGGERS, CREATE_EMBEDDINGS, CREATE_WIKI_PAGES, } from './schema.js';
import { MonographError } from '../types.js';
export function openDb(dbPath) {
    try {
        mkdirSync(dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        applyMigrations(db);
        return db;
    }
    catch (err) {
        throw new MonographError(`Failed to open database at ${dbPath}`, err);
    }
}
export function closeDb(db) {
    db.close();
}
function applyMigrations(db) {
    db.exec(CREATE_NODES);
    db.exec(CREATE_EDGES);
    db.exec(CREATE_COMMUNITIES);
    db.exec(CREATE_INDEX_META);
    db.exec(CREATE_NODES_FTS);
    for (const idx of CREATE_INDEXES)
        db.exec(idx);
    db.exec(FTS_SYNC_TRIGGERS);
    db.exec(CREATE_EMBEDDINGS);
    db.exec(CREATE_WIKI_PAGES);
    // Schema version table — tracks incremental column additions.
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
    const current = row?.v ?? 0;
    if (current < 1) {
        // v1: added `reason TEXT` to edges
        try {
            db.exec('ALTER TABLE edges ADD COLUMN reason TEXT');
        }
        catch { /* already present */ }
        db.prepare('INSERT OR REPLACE INTO schema_version VALUES (1)').run();
    }
}
/** Write to a .tmp file then rename for atomic replacement. */
export function atomicRebuild(dbPath, buildFn) {
    const tmpPath = dbPath + '.tmp';
    const db = openDb(tmpPath);
    try {
        buildFn(db);
        db.close();
        renameSync(tmpPath, dbPath);
    }
    catch (err) {
        db.close();
        if (existsSync(tmpPath)) {
            try {
                unlinkSync(tmpPath);
            }
            catch { /* ignore */ }
        }
        throw err;
    }
}
//# sourceMappingURL=db.js.map