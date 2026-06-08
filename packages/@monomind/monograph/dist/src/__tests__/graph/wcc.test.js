import { describe, it, expect } from 'vitest';
import { weaklyConnectedComponents } from '../../graph/wcc.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-wcc-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
        .run(id, id, id.toLowerCase());
}
function insertEdge(db, src, tgt) {
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
        .run(`${src}_${tgt}`, src, tgt);
}
describe('weaklyConnectedComponents', () => {
    it('returns empty array for empty graph', () => {
        const db = makeTempDb();
        expect(weaklyConnectedComponents(db)).toEqual([]);
        db.close();
    });
    it('returns single component for single node', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(1);
        expect(result[0]).toContain('a');
        db.close();
    });
    it('returns single component for connected chain a->b->c', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'c');
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(1);
        expect(result[0].sort()).toEqual(['a', 'b', 'c'].sort());
        db.close();
    });
    it('returns two components for two disconnected pairs', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertNode(db, 'd');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'c', 'd');
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(2);
        const allNodes = result.flat().sort();
        expect(allNodes).toEqual(['a', 'b', 'c', 'd'].sort());
        db.close();
    });
    it('treats directed edges as undirected (weak connectivity)', () => {
        const db = makeTempDb();
        // b->a but they should still be in same WCC
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'b', 'a');
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(1);
        expect(result[0].sort()).toEqual(['a', 'b'].sort());
        db.close();
    });
    it('returns isolated nodes as separate components', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        // no edges — 3 separate components
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(3);
        db.close();
    });
    it('handles cycle within a component', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'a');
        const result = weaklyConnectedComponents(db);
        expect(result.length).toBe(1);
        db.close();
    });
});
//# sourceMappingURL=wcc.test.js.map