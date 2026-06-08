import { describe, it, expect } from 'vitest';
import { regexSearchNodes, regexSearchEdges, regexSearchNodesInMemory, regexSearchEdgesInMemory, } from '../../graph/regex-search.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-regex-search-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id, name = id, opts = {}) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, file_path, language, is_exported)
     VALUES (?, ?, ?, ?, ?, ?, 0)`).run(id, opts.label ?? 'Function', name, name.toLowerCase(), opts.filePath ?? null, opts.language ?? null);
}
function insertEdge(db, id, src, tgt, relation = 'CALLS', reason = null) {
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason)
     VALUES (?, ?, ?, ?, 'EXTRACTED', 1.0, ?)`).run(id, src, tgt, relation, reason);
}
// ── DB-backed node search ──────────────────────────────────────────────────────
describe('regexSearchNodes (DB)', () => {
    it('matches nodes by name using regex', () => {
        const db = makeTempDb();
        insertNode(db, 'n1', 'authenticateUser');
        insertNode(db, 'n2', 'validateInput');
        insertNode(db, 'n3', 'handleRequest');
        const results = regexSearchNodes(db, /authenticate/i);
        expect(results).toHaveLength(1);
        expect(results[0].node.id).toBe('n1');
        expect(results[0].field).toBe('name');
        db.close();
    });
    it('accepts string pattern', () => {
        const db = makeTempDb();
        insertNode(db, 'n1', 'UserService');
        insertNode(db, 'n2', 'OrderService');
        const results = regexSearchNodes(db, 'User');
        expect(results).toHaveLength(1);
        db.close();
    });
    it('matches by filePath', () => {
        const db = makeTempDb();
        insertNode(db, 'n1', 'login', { filePath: '/auth/login.ts' });
        insertNode(db, 'n2', 'hash', { filePath: '/utils/crypto.ts' });
        const results = regexSearchNodes(db, /\/auth\//, ['filePath']);
        expect(results).toHaveLength(1);
        expect(results[0].field).toBe('filePath');
        db.close();
    });
    it('returns empty for no match', () => {
        const db = makeTempDb();
        insertNode(db, 'n1', 'fooBar');
        const results = regexSearchNodes(db, /^zzz/);
        expect(results).toHaveLength(0);
        db.close();
    });
    it('reports each node at most once', () => {
        const db = makeTempDb();
        // name and filePath both match but should only appear once
        insertNode(db, 'n1', 'auth', { filePath: '/auth/index.ts' });
        const results = regexSearchNodes(db, /auth/, ['name', 'filePath']);
        expect(results).toHaveLength(1);
        db.close();
    });
});
// ── DB-backed edge search ──────────────────────────────────────────────────────
describe('regexSearchEdges (DB)', () => {
    it('matches edges by relation', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertNode(db, 'c');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS');
        insertEdge(db, 'e2', 'b', 'c', 'IMPORTS');
        const results = regexSearchEdges(db, /^CALLS$/);
        expect(results).toHaveLength(1);
        expect(results[0].edge.id).toBe('e1');
        expect(results[0].field).toBe('relation');
        db.close();
    });
    it('matches edges by reason', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        insertEdge(db, 'e1', 'a', 'b', 'CALLS', 'direct function call');
        insertEdge(db, 'e2', 'a', 'b', 'CALLS', null);
        const results = regexSearchEdges(db, /direct/, ['reason']);
        expect(results).toHaveLength(1);
        expect(results[0].edge.id).toBe('e1');
        db.close();
    });
});
// ── In-memory variants ─────────────────────────────────────────────────────────
describe('regexSearchNodesInMemory', () => {
    const nodes = [
        { id: 'n1', label: 'Function', name: 'loginUser', normLabel: 'loginuser', filePath: '/auth/login.ts', isExported: true },
        { id: 'n2', label: 'Class', name: 'UserService', normLabel: 'userservice', filePath: '/services/user.ts', isExported: true },
        { id: 'n3', label: 'Function', name: 'hash', normLabel: 'hash', isExported: false },
    ];
    it('matches by name', () => {
        const results = regexSearchNodesInMemory(nodes, /User/);
        expect(results.map(r => r.node.id)).toContain('n2');
        expect(results.map(r => r.node.id)).toContain('n1');
    });
    it('matches by filePath', () => {
        const results = regexSearchNodesInMemory(nodes, /\/auth\//, ['filePath']);
        expect(results).toHaveLength(1);
    });
    it('returns empty for no match', () => {
        expect(regexSearchNodesInMemory(nodes, /^zzz/)).toHaveLength(0);
    });
});
describe('regexSearchEdgesInMemory', () => {
    const edges = [
        { id: 'e1', sourceId: 'a', targetId: 'b', relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1, reason: 'function call' },
        { id: 'e2', sourceId: 'b', targetId: 'c', relation: 'IMPORTS', confidence: 'INFERRED', confidenceScore: 0.5 },
    ];
    it('matches by relation', () => {
        const results = regexSearchEdgesInMemory(edges, /^IMPORTS$/);
        expect(results).toHaveLength(1);
        expect(results[0].edge.id).toBe('e2');
    });
    it('matches by reason', () => {
        const results = regexSearchEdgesInMemory(edges, /function/, ['reason']);
        expect(results).toHaveLength(1);
        expect(results[0].field).toBe('reason');
    });
});
//# sourceMappingURL=regex-search.test.js.map