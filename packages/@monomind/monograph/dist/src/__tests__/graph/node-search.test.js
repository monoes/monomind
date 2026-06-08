import { describe, it, expect } from 'vitest';
import { searchNodesByProperty, searchNodesInMemory } from '../../graph/node-search.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
function makeTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-node-search-test-'));
    return openDb(join(dir, 'test.db'));
}
function insertNode(db, id, opts = {}) {
    db.prepare(`INSERT INTO nodes (id, label, name, norm_label, file_path, is_exported, language, community_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, opts.label ?? 'Function', id, id.toLowerCase(), opts.filePath ?? null, opts.isExported ? 1 : 0, opts.language ?? null, opts.communityId ?? null);
}
describe('searchNodesByProperty (DB-backed)', () => {
    it('returns all nodes when no options given', () => {
        const db = makeTempDb();
        insertNode(db, 'a');
        insertNode(db, 'b');
        const result = searchNodesByProperty(db);
        expect(result).toHaveLength(2);
        db.close();
    });
    it('filters by label', () => {
        const db = makeTempDb();
        insertNode(db, 'f1', { label: 'Function' });
        insertNode(db, 'c1', { label: 'Class' });
        const result = searchNodesByProperty(db, { label: 'Class' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c1');
        db.close();
    });
    it('filters by language (case-insensitive)', () => {
        const db = makeTempDb();
        insertNode(db, 'ts1', { language: 'typescript' });
        insertNode(db, 'py1', { language: 'python' });
        const result = searchNodesByProperty(db, { language: 'TypeScript' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('ts1');
        db.close();
    });
    it('filters by file extension', () => {
        const db = makeTempDb();
        insertNode(db, 'f1', { filePath: '/src/foo.ts' });
        insertNode(db, 'f2', { filePath: '/src/bar.py' });
        const result = searchNodesByProperty(db, { fileExtension: '.ts' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('f1');
        db.close();
    });
    it('filters by file extension without leading dot', () => {
        const db = makeTempDb();
        insertNode(db, 'f1', { filePath: '/src/foo.ts' });
        insertNode(db, 'f2', { filePath: '/src/bar.py' });
        const result = searchNodesByProperty(db, { fileExtension: 'py' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('f2');
        db.close();
    });
    it('filters by filePath substring', () => {
        const db = makeTempDb();
        insertNode(db, 'f1', { filePath: '/src/auth/login.ts' });
        insertNode(db, 'f2', { filePath: '/src/utils/helper.ts' });
        const result = searchNodesByProperty(db, { filePath: 'auth' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('f1');
        db.close();
    });
    it('filters by isExported', () => {
        const db = makeTempDb();
        insertNode(db, 'exported', { isExported: true });
        insertNode(db, 'private', { isExported: false });
        const result = searchNodesByProperty(db, { isExported: true });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('exported');
        db.close();
    });
    it('filters by communityId', () => {
        const db = makeTempDb();
        insertNode(db, 'c1', { communityId: 1 });
        insertNode(db, 'c2', { communityId: 2 });
        insertNode(db, 'c3', { communityId: 1 });
        const result = searchNodesByProperty(db, { communityId: 1 });
        expect(result).toHaveLength(2);
        db.close();
    });
    it('respects limit', () => {
        const db = makeTempDb();
        for (let i = 0; i < 10; i++)
            insertNode(db, `n${i}`);
        const result = searchNodesByProperty(db, { limit: 3 });
        expect(result).toHaveLength(3);
        db.close();
    });
});
describe('searchNodesInMemory', () => {
    const nodes = [
        { id: 'f1', label: 'Function', name: 'login', normLabel: 'login', filePath: '/auth/login.ts', language: 'typescript', isExported: true, communityId: 1 },
        { id: 'f2', label: 'Class', name: 'User', normLabel: 'user', filePath: '/models/user.py', language: 'python', isExported: false, communityId: 2 },
        { id: 'f3', label: 'Function', name: 'hash', normLabel: 'hash', filePath: '/utils/crypto.ts', language: 'typescript', isExported: true, communityId: 1 },
    ];
    it('returns all with no options', () => {
        expect(searchNodesInMemory(nodes)).toHaveLength(3);
    });
    it('filters by label', () => {
        expect(searchNodesInMemory(nodes, { label: 'Class' })).toHaveLength(1);
    });
    it('filters by language', () => {
        expect(searchNodesInMemory(nodes, { language: 'Python' })).toHaveLength(1);
    });
    it('filters by fileExtension', () => {
        expect(searchNodesInMemory(nodes, { fileExtension: '.ts' })).toHaveLength(2);
    });
    it('filters by filePath substring', () => {
        expect(searchNodesInMemory(nodes, { filePath: 'auth' })).toHaveLength(1);
    });
    it('filters by isExported', () => {
        expect(searchNodesInMemory(nodes, { isExported: false })).toHaveLength(1);
    });
    it('filters by communityId', () => {
        expect(searchNodesInMemory(nodes, { communityId: 1 })).toHaveLength(2);
    });
    it('respects limit', () => {
        expect(searchNodesInMemory(nodes, { limit: 2 })).toHaveLength(2);
    });
});
//# sourceMappingURL=node-search.test.js.map