import { describe, it, expect } from 'vitest';
import { findStronglyConnectedComponents } from '../../graph/cycles.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-scc-test-'));
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
describe('findStronglyConnectedComponents', () => {
    it('returns empty array for empty graph', () => {
        const db = makeTempDb();
        expect(findStronglyConnectedComponents(db)).toEqual([]);
        db.close();
    });
    it('returns each single node as its own SCC in a DAG', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'c');
        const result = findStronglyConnectedComponents(db);
        // In a DAG, every node is its own SCC
        expect(result.length).toBe(3);
        expect(result.every(comp => comp.length === 1)).toBe(true);
        db.close();
    });
    it('returns single SCC containing both nodes for a->b->a cycle', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'a');
        const result = findStronglyConnectedComponents(db);
        const cycleScc = result.find(comp => comp.length === 2);
        expect(cycleScc).toBeDefined();
        expect(cycleScc.sort()).toEqual(['a', 'b']);
        db.close();
    });
    it('covers all nodes across all SCCs', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertNode(db, 'd');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'a'); // cycle: {a, b}
        insertEdge(db, 'c', 'd'); // DAG tail: {c}, {d}
        const result = findStronglyConnectedComponents(db);
        const allNodes = result.flat().sort();
        expect(allNodes).toEqual(['a', 'b', 'c', 'd'].sort());
        db.close();
    });
    it('returns each node in exactly one SCC', () => {
        const db = makeTempDb();
        ['a', 'b', 'c'].forEach(n => insertNode(db, n));
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'c');
        insertEdge(db, 'c', 'a');
        const result = findStronglyConnectedComponents(db);
        const allNodes = result.flat();
        const unique = new Set(allNodes);
        expect(unique.size).toBe(allNodes.length); // no duplicates
        db.close();
    });
});
//# sourceMappingURL=scc.test.js.map