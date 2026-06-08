import { describe, it, expect } from 'vitest';
import { topologicalLevelSort } from '../../graph/topo-sort.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-topo-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'File', ?, ?, 0)`)
        .run(id, id, id.toLowerCase());
}
function insertEdge(db, src, tgt) {
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'IMPORTS', 'EXTRACTED', 1.0)`)
        .run(`${src}_${tgt}`, src, tgt);
}
describe('topologicalLevelSort', () => {
    it('returns empty levels and 0 cycleCount for empty graph', () => {
        const db = makeTempDb();
        const result = topologicalLevelSort(db);
        expect(result.levels).toEqual([]);
        expect(result.cycleCount).toBe(0);
        db.close();
    });
    it('returns single level for single node with no edges', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        const result = topologicalLevelSort(db);
        expect(result.levels.length).toBe(1);
        expect(result.levels[0]).toContain('a');
        expect(result.cycleCount).toBe(0);
        db.close();
    });
    it('orders a linear chain leaf-first: a->b->c => [c, b, a]', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'c');
        const result = topologicalLevelSort(db);
        // c has no outgoing IMPORTS => level 0, then b, then a
        expect(result.cycleCount).toBe(0);
        expect(result.levels.length).toBeGreaterThanOrEqual(2);
        const allNodes = result.levels.flat();
        expect(allNodes).toContain('a');
        expect(allNodes).toContain('b');
        expect(allNodes).toContain('c');
        // leaf (c) must appear before root (a)
        const levelC = result.levels.findIndex(l => l.includes('c'));
        const levelA = result.levels.findIndex(l => l.includes('a'));
        expect(levelC).toBeLessThan(levelA);
        db.close();
    });
    it('puts independent nodes in level 0', () => {
        const db = makeTempDb();
        insertNode(db, 'x');
        insertNode(db, 'y');
        // no edges
        const result = topologicalLevelSort(db);
        expect(result.levels.length).toBe(1);
        expect(result.levels[0]).toContain('x');
        expect(result.levels[0]).toContain('y');
        expect(result.cycleCount).toBe(0);
        db.close();
    });
    it('detects a cycle and appends cycle nodes at end', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'b', 'a');
        const result = topologicalLevelSort(db);
        expect(result.cycleCount).toBeGreaterThan(0);
        // cycle nodes must still appear somewhere in levels
        const allNodes = result.levels.flat();
        expect(allNodes).toContain('a');
        expect(allNodes).toContain('b');
        db.close();
    });
    it('handles diamond dependency: a->b, a->c, b->d, c->d', () => {
        const db = makeTempDb();
        ['a', 'b', 'c', 'd'].forEach(n => insertNode(db, n));
        insertEdge(db, 'a', 'b');
        insertEdge(db, 'a', 'c');
        insertEdge(db, 'b', 'd');
        insertEdge(db, 'c', 'd');
        const result = topologicalLevelSort(db);
        expect(result.cycleCount).toBe(0);
        const allNodes = result.levels.flat();
        expect(allNodes.sort()).toEqual(['a', 'b', 'c', 'd'].sort());
        // d must appear in earlier level than a
        const levelD = result.levels.findIndex(l => l.includes('d'));
        const levelA = result.levels.findIndex(l => l.includes('a'));
        expect(levelD).toBeLessThan(levelA);
        db.close();
    });
});
//# sourceMappingURL=topo-sort.test.js.map