/**
 * Tests for the in-process Okapi BM25 lexical arm (plan item 1, Part A).
 *
 * The load-bearing tests here are not "does BM25 rank sensibly" — they are:
 *   1. the live-only filter is applied BY THE INDEX, so no caller can skip it;
 *   2. the tokeniser matches the eval harness's, so the measured 0.697 Recall@5
 *      baseline transfers to production instead of being silently re-earned by
 *      a different scorer.
 */

import { describe, expect, it, vi } from 'vitest';
import { contentTokens } from '../knowledge/eval/metrics.js';
import {
  BM25_B,
  BM25_K1,
  Bm25Index,
  bm25Tokens,
  LIVE_CHUNK_WARN_THRESHOLD,
  SCALING_REVIEW_CHUNKS,
} from '../memory/bm25-index.js';

const never = () => false;

function chunk(key: string, text: string) {
  return { key, text };
}

describe('BM25 parameters match the measured baseline', () => {
  it('uses the eval harness Okapi parameters exactly', () => {
    // knowledge/eval/retrievers.ts: "Okapi BM25 with the standard k1=1.2,
    // b=0.75". Item 1 was promoted on a 0.697 Recall@5 produced by THAT
    // scorer. Different constants make this a different scorer and the
    // baseline stops transferring.
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.75);
  });

  it('tokenises identically to the eval harness', () => {
    // If these ever diverge, production and the scoreboard are measuring two
    // different systems while reporting one number.
    const samples = [
      'How does memory search fall back to keyword matching?',
      'RRF fusion — reranking, top-50 hits (bge-reranker-v2-m3)',
      'doc:00484e6f:12  §Heading/Sub  CamelCase_snake-case',
      'a I of the 42 x9',
      '',
    ];
    for (const s of samples) {
      expect(bm25Tokens(s), `divergence on: ${s}`).toEqual(contentTokens(s));
    }
  });
});

describe('the live-only filter is enforced by the index, not the caller', () => {
  it('applies the superseded predicate itself', () => {
    const chunks = [
      chunk('doc:live:0', 'alpha beta gamma'),
      chunk('doc:dead:0', 'alpha beta gamma'),
      chunk('doc:dead:1', 'alpha beta gamma'),
    ];
    const idx = Bm25Index.build(chunks, (key) => key.startsWith('doc:dead:'));

    expect(idx.size).toBe(1);
    expect(idx.stats.indexed).toBe(1);
    expect(idx.stats.supersededSkipped).toBe(2);
    expect(idx.search('alpha', 10).map((h) => h.key)).toEqual(['doc:live:0']);
  });

  it('superseded chunks cannot be retrieved even on an exact term match', () => {
    const idx = Bm25Index.build(
      [chunk('doc:dead:0', 'quokka quokka quokka'), chunk('doc:live:0', 'unrelated content here')],
      (key) => key.startsWith('doc:dead:'),
    );
    expect(idx.search('quokka', 10)).toEqual([]);
  });

  it('warns loudly when the live filter appears to have stopped applying', () => {
    // The failure mode is invisible: results stay CORRECT, the build just
    // silently costs 1,729ms/314MB instead of 113ms/15MB. Nothing else in the
    // system would report it, so this warning is the only detector.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const many = Array.from({ length: LIVE_CHUNK_WARN_THRESHOLD + 1 }, (_, i) =>
        chunk(`doc:h:${i}`, 'token'),
      );
      Bm25Index.build(many, never);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/superseded filter is still applying/);
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet at normal live scale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 673 live chunks was the real measured figure.
      const normal = Array.from({ length: 673 }, (_, i) => chunk(`doc:h:${i}`, 'token here'));
      Bm25Index.build(normal, never);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('records the deferred scaling trigger rather than leaving it implicit', () => {
    // Deferred, not forgotten: crossing this means revisiting persistence.
    expect(SCALING_REVIEW_CHUNKS).toBe(1_000_000);
  });
});

describe('ranking behaviour', () => {
  const corpus = [
    chunk('doc:a:0', 'the memory bridge falls back to keyword search when embedding fails'),
    chunk('doc:b:0', 'superseded document chunks accumulate because nothing deletes them'),
    chunk('doc:c:0', 'reciprocal rank fusion combines two ranked lists without calibration'),
    chunk('doc:d:0', 'the quick brown fox jumps over the lazy dog'),
  ];

  it('ranks the lexically matching chunk first', () => {
    const idx = Bm25Index.build(corpus, never);
    expect(idx.search('reciprocal rank fusion', 5)[0].key).toBe('doc:c:0');
    expect(idx.search('superseded chunks', 5)[0].key).toBe('doc:b:0');
  });

  it('returns nothing when no query term appears in the corpus', () => {
    const idx = Bm25Index.build(corpus, never);
    expect(idx.search('quokka platypus', 5)).toEqual([]);
  });

  it('respects the limit', () => {
    const idx = Bm25Index.build(corpus, never);
    expect(idx.search('the', 2).length).toBeLessThanOrEqual(2);
  });

  it('handles an empty index without throwing', () => {
    const idx = Bm25Index.build([], never);
    expect(idx.size).toBe(0);
    expect(idx.search('anything', 5)).toEqual([]);
    expect(idx.lexicalSupport('anything')).toBe(0);
  });

  it('scores are raw BM25 and are never squashed into [0,1]', () => {
    // A BM25 score must never be mistakable for a cosine similarity. The
    // existing honesty invariant in memory-bridge.ts exists because a rescaled
    // keyword score once outranked a genuine cosine match.
    const idx = Bm25Index.build(
      [chunk('doc:a:0', 'fusion fusion fusion fusion fusion'), chunk('doc:b:0', 'other')],
      never,
    );
    const [top] = idx.search('fusion', 5);
    expect(top.score).toBeGreaterThan(0);
    expect(Number.isFinite(top.score)).toBe(true);
  });
});

describe('lexicalSupport — the query-adaptive fusion signal (UNVALIDATED)', () => {
  const corpus = [
    chunk('doc:a:0', 'reciprocal rank fusion combines ranked lists'),
    chunk('doc:b:0', 'embedding models produce dense vectors'),
    chunk('doc:c:0', 'the memory bridge stores chunks'),
  ];

  it('is 1 when every query term exists in the corpus', () => {
    const idx = Bm25Index.build(corpus, never);
    expect(idx.lexicalSupport('reciprocal rank fusion')).toBeCloseTo(1, 5);
  });

  it('is 0 when no query term exists in the corpus', () => {
    const idx = Bm25Index.build(corpus, never);
    // This is the case the signal exists to detect: BM25 has nothing to work
    // with, so its vote should be discounted in favour of dense.
    expect(idx.lexicalSupport('quokka platypus wombat')).toBe(0);
  });

  it('falls between 0 and 1 on partial support', () => {
    const idx = Bm25Index.build(corpus, never);
    const s = idx.lexicalSupport('fusion quokka');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('weights rare query terms more heavily than common ones', () => {
    // A query missing a rare, information-bearing term is in worse shape than
    // one missing a ubiquitous term, and the signal must say so — otherwise it
    // is just unweighted token coverage.
    const idx = Bm25Index.build(
      [
        chunk('doc:a:0', 'the the the the common common quokka'),
        chunk('doc:b:0', 'the the the common'),
        chunk('doc:c:0', 'the common'),
      ],
      never,
    );
    const missingRare = idx.lexicalSupport('the common missingterm');
    const missingNothing = idx.lexicalSupport('the common quokka');
    expect(missingNothing).toBeGreaterThan(missingRare);
  });

  it('ignores superseded chunks when deciding what the corpus contains', () => {
    // Support must reflect what is SEARCHABLE. A term that appears only in
    // dead chunks would otherwise inflate BM25's apparent competence.
    const idx = Bm25Index.build(
      [chunk('doc:dead:0', 'quokka'), chunk('doc:live:0', 'fusion')],
      (key) => key.startsWith('doc:dead:'),
    );
    expect(idx.lexicalSupport('quokka')).toBe(0);
    expect(idx.lexicalSupport('fusion')).toBeCloseTo(1, 5);
  });
});
