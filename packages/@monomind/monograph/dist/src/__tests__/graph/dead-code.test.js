import { describe, it, expect } from 'vitest';
import { detectDeadCode } from '../../graph/dead-code.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-deadcode-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id, isExported = 0) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, ?)`)
        .run(id, id, id.toLowerCase(), isExported);
}
function insertEdge(db, src, tgt) {
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
        .run(`${src}_${tgt}`, src, tgt);
}
describe('detectDeadCode', () => {
    it('returns empty array for empty graph', () => {
        const db = makeTempDb();
        expect(detectDeadCode(db)).toEqual([]);
        db.close();
    });
    it('detects a node with in-degree 0 that is not exported', () => {
        const db = makeTempDb();
        // orphan: no incoming edges, not exported
        insertNode(db, 'orphan', 0);
        insertNode(db, 'b');
        insertEdge(db, 'b', 'orphan');
        // orphan has in-degree 1 — not dead
        // let's make a true orphan
        insertNode(db, 'dead', 0);
        // dead has no incoming edges
        const result = detectDeadCode(db);
        expect(result).toContain('dead');
        db.close();
    });
    it('does NOT flag exported nodes as dead code', () => {
        const db = makeTempDb();
        // exported root with in-degree 0 — this is an entrypoint, not dead code
        insertNode(db, 'entry', 1);
        const result = detectDeadCode(db);
        expect(result).not.toContain('entry');
        db.close();
    });
    it('does NOT flag nodes that have incoming edges', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'a', 'b');
        // b has in-degree 1 — reachable from a
        const result = detectDeadCode(db);
        expect(result).not.toContain('b');
        db.close();
    });
    it('flags node with in-degree 0 and not exported', () => {
        const db = makeTempDb();
        insertNode(db, 'unused', 0);
        const result = detectDeadCode(db);
        expect(result).toContain('unused');
        db.close();
    });
    it('handles mix of dead and live nodes', () => {
        const db = makeTempDb();
        insertNode(db, 'live_exported', 1); // exported — not dead
        insertNode(db, 'live_used'); // has incoming
        insertNode(db, 'dead1'); // orphan, not exported
        insertNode(db, 'dead2'); // orphan, not exported
        insertEdge(db, 'live_exported', 'live_used');
        const result = detectDeadCode(db);
        expect(result).toContain('dead1');
        expect(result).toContain('dead2');
        expect(result).not.toContain('live_exported');
        expect(result).not.toContain('live_used');
        db.close();
    });
    it('returns array of node id strings', () => {
        const db = makeTempDb();
        insertNode(db, 'unused');
        const result = detectDeadCode(db);
        expect(Array.isArray(result)).toBe(true);
        for (const id of result) {
            expect(typeof id).toBe('string');
        }
        db.close();
    });
});
//# sourceMappingURL=dead-code.test.js.map