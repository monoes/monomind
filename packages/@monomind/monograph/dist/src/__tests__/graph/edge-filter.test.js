import { describe, it, expect } from 'vitest';
import { filterEdges, filterEdgesInMemory } from '../../graph/edge-filter.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-edge-filter-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
        .run(id, id, id.toLowerCase());
}
function insertEdge(db, id, src, tgt, relation = 'CALLS', confidence = 'EXTRACTED', score = 1.0) {
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
     VALUES (?, ?, ?, ?, ?, ?)`).run(id, src, tgt, relation, confidence, score);
}
describe('filterEdges (DB-backed)', () => {
    it('returns all edges when no filter options are given', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 1.0);
        insertEdge(db, 'e2', 'b', 'c', 'IMPORTS', 'INFERRED', 0.5);
        const result = filterEdges(db);
        expect(result).toHaveLength(2);
        db.close();
    });
    it('filters by relation type', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 1.0);
        insertEdge(db, 'e2', 'b', 'c', 'IMPORTS', 'EXTRACTED', 1.0);
        const result = filterEdges(db, { relations: ['CALLS'] });
        expect(result).toHaveLength(1);
        expect(result[0].relation).toBe('CALLS');
        db.close();
    });
    it('filters by confidence label', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 1.0);
        insertEdge(db, 'e2', 'b', 'c', 'CALLS', 'INFERRED', 0.5);
        const result = filterEdges(db, { confidences: ['INFERRED'] });
        expect(result).toHaveLength(1);
        expect(result[0].confidence).toBe('INFERRED');
        db.close();
    });
    it('filters by minConfidenceScore', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 0.9);
        insertEdge(db, 'e2', 'b', 'c', 'CALLS', 'INFERRED', 0.3);
        const result = filterEdges(db, { minConfidenceScore: 0.8 });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e1');
        db.close();
    });
    it('filters by maxConfidenceScore', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 0.9);
        insertEdge(db, 'e2', 'b', 'c', 'CALLS', 'AMBIGUOUS', 0.2);
        const result = filterEdges(db, { maxConfidenceScore: 0.5 });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e2');
        db.close();
    });
    it('combines relation and confidence filters (AND)', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'EXTRACTED', 1.0);
        insertEdge(db, 'e2', 'b', 'c', 'IMPORTS', 'INFERRED', 0.5);
        insertEdge(db, 'e3', 'a', 'c', 'CALLS', 'INFERRED', 0.5);
        const result = filterEdges(db, { relations: ['CALLS'], confidences: ['INFERRED'] });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e3');
        db.close();
    });
});
describe('filterEdgesInMemory', () => {
    const edges = [
        { id: 'e1', sourceId: 'a', targetId: 'b', relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0 },
        { id: 'e2', sourceId: 'b', targetId: 'c', relation: 'IMPORTS', confidence: 'INFERRED', confidenceScore: 0.5 },
        { id: 'e3', sourceId: 'c', targetId: 'a', relation: 'CALLS', confidence: 'AMBIGUOUS', confidenceScore: 0.2 },
    ];
    it('returns all edges with no options', () => {
        expect(filterEdgesInMemory(edges)).toHaveLength(3);
    });
    it('filters by relation', () => {
        const result = filterEdgesInMemory(edges, { relations: ['CALLS'] });
        expect(result).toHaveLength(2);
    });
    it('filters by confidence', () => {
        const result = filterEdgesInMemory(edges, { confidences: ['EXTRACTED'] });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e1');
    });
    it('filters by minConfidenceScore and maxConfidenceScore', () => {
        const result = filterEdgesInMemory(edges, { minConfidenceScore: 0.3, maxConfidenceScore: 0.8 });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e2');
    });
});
//# sourceMappingURL=edge-filter.test.js.map