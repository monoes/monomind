import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { checkUpdate } from '../../cli/check-update.js';
function makeDb(indexedAt = null) {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
    if (indexedAt) {
        db.prepare("INSERT INTO index_meta VALUES ('indexed_at', ?)").run(indexedAt);
    }
    return db;
}
describe('checkUpdate', () => {
    it('returns needsUpdate=true when index is very old', () => {
        const db = makeDb('2020-01-01T00:00:00.000Z');
        const result = checkUpdate(db, { maxAgeMs: 1000 });
        expect(result.needsUpdate).toBe(true);
    });
    it('returns needsUpdate=false when index is fresh', () => {
        const db = makeDb(new Date().toISOString());
        const result = checkUpdate(db, { maxAgeMs: 60_000 });
        expect(result.needsUpdate).toBe(false);
    });
    it('returns needsUpdate=true when index_meta has no indexed_at', () => {
        const db = makeDb(null);
        const result = checkUpdate(db, {});
        expect(result.needsUpdate).toBe(true);
    });
    it('returns indexedAt and ageMs in result', () => {
        const now = new Date().toISOString();
        const db = makeDb(now);
        const result = checkUpdate(db, { maxAgeMs: 60_000 });
        expect(result.indexedAt).toBe(now);
        expect(typeof result.ageMs).toBe('number');
    });
});
//# sourceMappingURL=check-update.test.js.map