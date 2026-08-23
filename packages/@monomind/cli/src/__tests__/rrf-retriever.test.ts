/**
 * Tests for the RRF (Reciprocal Rank Fusion) retriever.
 *
 * Verifies the fusion formula: fusionScore(d) = Σ 1/(k + rank_i)
 * for each child retriever i that returned document d.
 */

import { describe, expect, it } from 'vitest';
import { type RawHit, type Retriever, RrfRetriever } from '../knowledge/eval/retrievers.js';

/** Stub retriever that returns a fixed result set. */
class StubRetriever implements Retriever {
  name: string;
  description = 'stub';
  constructor(
    name: string,
    private results: RawHit[],
  ) {
    this.name = name;
  }
  async search(_query: string, limit: number): Promise<RawHit[]> {
    return this.results.slice(0, limit);
  }
}

describe('RrfRetriever', () => {
  it('fuses two retrievers with correct RRF scores', async () => {
    const dense = new StubRetriever('dense', [
      { docId: 'A', chunkIndex: 0, score: 0.9 },
      { docId: 'B', chunkIndex: 0, score: 0.8 },
      { docId: 'C', chunkIndex: 0, score: 0.7 },
    ]);
    const bm25 = new StubRetriever('bm25', [
      { docId: 'C', chunkIndex: 0, score: 5.0 },
      { docId: 'A', chunkIndex: 0, score: 3.0 },
      { docId: 'D', chunkIndex: 0, score: 1.0 },
    ]);

    const rrf = new RrfRetriever([dense, bm25], 10);
    const hits = await rrf.search('test', 10);

    // A: dense rank 1 + bm25 rank 2 => 1/(10+1) + 1/(10+2) = 0.09090.. + 0.08333.. = 0.17424..
    // B: dense rank 2 only           => 1/(10+2) = 0.08333..
    // C: dense rank 3 + bm25 rank 1 => 1/(10+3) + 1/(10+1) = 0.07692.. + 0.09090.. = 0.16783..
    // D: bm25 rank 3 only            => 1/(10+3) = 0.07692..

    expect(hits).toHaveLength(4);
    expect(hits[0].docId).toBe('A');
    expect(hits[1].docId).toBe('C');
    expect(hits[2].docId).toBe('B');
    expect(hits[3].docId).toBe('D');

    // Verify exact scores
    expect(hits[0].score).toBeCloseTo(1 / 11 + 1 / 12, 10);
    expect(hits[1].score).toBeCloseTo(1 / 13 + 1 / 11, 10);
    expect(hits[2].score).toBeCloseTo(1 / 12, 10);
    expect(hits[3].score).toBeCloseTo(1 / 13, 10);
  });

  it('dedupes by docId within each child before ranking', async () => {
    // Same doc appears twice in one retriever (different chunks)
    const child = new StubRetriever('child', [
      { docId: 'A', chunkIndex: 0, score: 0.9 },
      { docId: 'A', chunkIndex: 1, score: 0.8 }, // duplicate, should be ignored
      { docId: 'B', chunkIndex: 0, score: 0.7 },
    ]);

    const rrf = new RrfRetriever([child], 10);
    const hits = await rrf.search('test', 10);

    // A at rank 1, B at rank 2 (the second A chunk is skipped)
    expect(hits).toHaveLength(2);
    expect(hits[0].docId).toBe('A');
    expect(hits[0].score).toBeCloseTo(1 / 11, 10);
    expect(hits[1].docId).toBe('B');
    expect(hits[1].score).toBeCloseTo(1 / 12, 10);
  });

  it('respects the limit parameter', async () => {
    const child = new StubRetriever('child', [
      { docId: 'A', chunkIndex: 0, score: 0.9 },
      { docId: 'B', chunkIndex: 0, score: 0.8 },
      { docId: 'C', chunkIndex: 0, score: 0.7 },
    ]);
    const rrf = new RrfRetriever([child], 10);
    const hits = await rrf.search('test', 2);
    expect(hits).toHaveLength(2);
  });

  it('returns empty for empty children', async () => {
    const child = new StubRetriever('child', []);
    const rrf = new RrfRetriever([child], 10);
    const hits = await rrf.search('test', 10);
    expect(hits).toHaveLength(0);
  });

  it('names itself after the k parameter', () => {
    const child = new StubRetriever('a', []);
    const rrf = new RrfRetriever([child], 60);
    expect(rrf.name).toBe('rrf-k60');
  });

  it('documents in only one child get a single 1/(k+rank) contribution', async () => {
    const a = new StubRetriever('a', [{ docId: 'X', chunkIndex: 0, score: 1.0 }]);
    const b = new StubRetriever('b', [{ docId: 'Y', chunkIndex: 0, score: 1.0 }]);

    const rrf = new RrfRetriever([a, b], 60);
    const hits = await rrf.search('test', 10);

    // Both at rank 1 in their respective child, each gets 1/(60+1)
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeCloseTo(1 / 61, 10);
    expect(hits[1].score).toBeCloseTo(1 / 61, 10);
  });
});
