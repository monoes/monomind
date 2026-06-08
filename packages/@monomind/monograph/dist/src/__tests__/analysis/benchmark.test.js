import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runBenchmark, estimateTokens } from '../../analysis/benchmark.js';
function makeDb(nodeCount) {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
  `);
    const insert = db.prepare('INSERT INTO nodes VALUES (?,?,?,?,?,?,?)');
    for (let i = 0; i < nodeCount; i++) {
        insert.run(`n${i}`, `symbol_${i}`, 'Function', `/app/file${i % 10}.ts`, i * 5 + 1, i * 5 + 4, i % 3);
    }
    for (let i = 1; i < Math.min(nodeCount, 20); i++) {
        db.prepare('INSERT INTO edges VALUES (?,?,?,?,?,?)').run(`e${i}`, `n${i - 1}`, `n${i}`, 'CALLS', 'EXTRACTED', 0.9);
    }
    return db;
}
describe('estimateTokens', () => {
    it('estimates tokens as text length divided by 4', () => {
        expect(estimateTokens('a'.repeat(400))).toBe(100);
        expect(estimateTokens('')).toBe(0);
    });
});
describe('runBenchmark', () => {
    it('returns corpus_tokens, avg_query_tokens, and reduction_ratio', () => {
        const db = makeDb(50);
        const result = runBenchmark(db, { corpusWordCount: 5000 });
        expect(result.corpus_tokens).toBeGreaterThan(0);
        expect(result.avg_query_tokens).toBeGreaterThanOrEqual(0);
        expect(result.reduction_ratio).toBeGreaterThanOrEqual(0);
        expect(result.nodes).toBe(50);
    });
    it('returns per_question breakdown', () => {
        const db = makeDb(30);
        const result = runBenchmark(db, {
            questions: ['how does authentication work', 'what is the entry point'],
            corpusWordCount: 3000,
        });
        expect(Array.isArray(result.per_question)).toBe(true);
    });
    it('works with no matching nodes gracefully', () => {
        const db = makeDb(5);
        const result = runBenchmark(db, { questions: ['zzz_nonexistent_xyz'] });
        expect(result.nodes).toBe(5);
        expect(typeof result.reduction_ratio).toBe('number');
    });
    it('uses default questions when none provided', () => {
        const db = makeDb(20);
        const result = runBenchmark(db);
        expect(result.per_question.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=benchmark.test.js.map