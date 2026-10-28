// Scoring logic of the graph-vs-ripgrep retrieval check: rank, precision, recall,
// MRR, path extraction from tool text, query terms, and the rg baseline ranking.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations
import {
  estimateTokens,
  extractPaths,
  queryTerms,
  rgRanking,
  scoreRanking,
  sectionPaths,
  summarize,
} from './lib.mjs';

describe('scoreRanking', () => {
  const q = { expect: ['a/one.ts', 'b/two.ts'], acceptable: ['c/three.ts'] };

  it('reports first-hit rank, per-item rank, precision and recall at k', () => {
    const s = scoreRanking(['x.ts', 'b/two.ts', 'c/three.ts', 'y.ts', 'a/one.ts', 'z.ts'], q, 5);
    expect(s.rank).toBe(2);
    expect(s.foundAt).toEqual({ 'a/one.ts': 5, 'b/two.ts': 2 });
    expect(s.precisionAtK).toBeCloseTo(3 / 5);
    expect(s.recallAtK).toBe(1);
    expect(s.rr).toBeCloseTo(0.5);
  });

  it('does not credit hits beyond k and counts acceptable files for precision only', () => {
    const s = scoreRanking(['x.ts', 'y.ts', 'c/three.ts', 'a/one.ts'], q, 3);
    expect(s.rank).toBe(3);
    expect(s.foundAt['a/one.ts']).toBeNull();
    expect(s.recallAtK).toBe(0);
    expect(s.precisionAtK).toBeCloseTo(1 / 3);
  });

  it('scores a miss as rank null, rr 0, and a short answer by what it returned', () => {
    const miss = scoreRanking(['x.ts'], q, 5);
    expect(miss).toMatchObject({ rank: null, rr: 0, recallAtK: 0, precisionReturned: 0 });
    const tight = scoreRanking(['a/one.ts'], q, 5);
    expect(tight.precisionReturned).toBe(1);
    expect(tight.precisionAtK).toBeCloseTo(1 / 5);
  });

  it('matches case-insensitively on substrings', () => {
    expect(scoreRanking(['PKG/A/One.ts'], { expect: ['a/one.ts'] }, 5).rank).toBe(1);
  });
});

describe('summarize', () => {
  it('averages per question and splits by kind', () => {
    const hit = { rank: 1, rr: 1, precisionAtK: 0.2, precisionReturned: 1, recallAtK: 1 };
    const miss = { rank: null, rr: 0, precisionAtK: 0, precisionReturned: 0, recallAtK: 0 };
    const s = summarize([
      { kind: 'lookup', score: hit, tokens: 100 },
      { kind: 'lookup', score: miss, tokens: 300 },
      { kind: 'tests', score: hit, tokens: 50 },
    ]);
    expect(s.overall.foundRate).toBeCloseTo(2 / 3);
    expect(s.byKind.lookup).toMatchObject({
      questions: 2,
      foundRate: 0.5,
      mrr: 0.5,
      tokensMean: 200,
      tokensMedian: 200,
      tokensTotal: 400,
    });
    expect(s.byKind.tests.questions).toBe(1);
  });
});

describe('text helpers', () => {
  it('estimates tokens as ceil(chars/4)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('extracts paths in order without duplicates', () => {
    const t =
      '[Function] f  packages/a/src/x.ts:5\n[File] y  packages/a/src/y.ts\npackages/a/src/x.ts';
    expect(extractPaths(t)).toEqual(['packages/a/src/x.ts', 'packages/a/src/y.ts']);
  });

  it('reads only the requested blocks', () => {
    const t =
      'sym  packages/a/def.ts:1\n\nTests to run (1):\n  packages/a/t.test.ts\n\nCallers (2):\n  [Function] f  packages/a/c1.ts:3\n  [File] g  packages/a/c2.ts\n\nCommunity: #1';
    expect(sectionPaths(t, ['Callers'])).toEqual(['packages/a/c1.ts', 'packages/a/c2.ts']);
    expect(sectionPaths(t, ['Tests to run'])).toEqual(['packages/a/t.test.ts']);
  });

  it('keeps identifiers whole and drops stopwords and short words', () => {
    expect(queryTerms('where is cosineSimilarity used in the HookRegistry')).toEqual([
      'cosinesimilarity',
      'hookregistry',
    ]);
  });
});

describe('rgRanking', () => {
  it('ranks files by summed term hits, ties by path, and honours the glob', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-rank-'));
    try {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src/a.ts'), 'alpha alpha\nbeta\n');
      writeFileSync(join(dir, 'src/b.ts'), 'alpha\nbeta\nbeta\nbeta\n');
      writeFileSync(join(dir, 'src/c.ts'), 'alpha\nbeta\n');
      writeFileSync(join(dir, 'src/d.md'), 'alpha alpha alpha alpha\n');
      const r = rgRanking(dir, 'alpha beta');
      expect(r.map((x: { file: string }) => x.file)).toEqual(['src/b.ts', 'src/a.ts', 'src/c.ts']);
      expect(r.map((x: { count: number }) => x.count)).toEqual([4, 3, 2]);
      expect(rgRanking(dir, 'nomatchterm')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
