import { describe, it, expect } from 'vitest';
import { mergeRanks, type RankedResult } from '../../src/search/rrf.js';

describe('mergeRanks (RRF)', () => {
  it('returns empty array when both lists are empty', () => {
    expect(mergeRanks([], [])).toEqual([]);
  });

  it('returns list1 items when list2 is empty', () => {
    const list1: RankedResult[] = [
      { id: 'a', score: 1.0 },
      { id: 'b', score: 0.5 },
    ];
    const merged = mergeRanks(list1, []);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns list2 items when list1 is empty', () => {
    const list2: RankedResult[] = [
      { id: 'x', score: 0.9 },
      { id: 'y', score: 0.3 },
    ];
    const merged = mergeRanks([], list2);
    expect(merged.map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('computes correct RRF score for an item in both lists (K=60)', () => {
    // item A: rank 1 in list1, rank 2 in list2
    // expected rrf = 1/(60+1) + 1/(60+2) = 1/61 + 1/62
    const list1: RankedResult[] = [{ id: 'A', score: 1 }];
    const list2: RankedResult[] = [
      { id: 'B', score: 1 }, // rank 1
      { id: 'A', score: 0.8 }, // rank 2
    ];
    const merged = mergeRanks(list1, list2);
    const itemA = merged.find((r) => r.id === 'A')!;
    const expected = 1 / 61 + 1 / 62;
    expect(itemA.score).toBeCloseTo(expected, 10);
  });

  it('ranks an item appearing in both lists above items in only one list', () => {
    // A appears in both; B only in list1; C only in list2
    const list1: RankedResult[] = [
      { id: 'A', score: 0.5 },
      { id: 'B', score: 0.4 },
    ];
    const list2: RankedResult[] = [
      { id: 'A', score: 0.6 },
      { id: 'C', score: 0.3 },
    ];
    const merged = mergeRanks(list1, list2);
    const ids = merged.map((r) => r.id);
    expect(ids[0]).toBe('A');
  });

  it('sorts results by RRF score descending', () => {
    const list1: RankedResult[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 0.9 },
      { id: 'c', score: 0.8 },
    ];
    const list2: RankedResult[] = [
      { id: 'c', score: 1 },
      { id: 'b', score: 0.95 },
      { id: 'a', score: 0.7 },
    ];
    const merged = mergeRanks(list1, list2);
    const scores = merged.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('preserves extra properties from list1 items', () => {
    const list1: RankedResult[] = [{ id: 'x', score: 1, name: 'myNode', filePath: 'src/x.ts' }];
    const merged = mergeRanks(list1, []);
    expect(merged[0]).toMatchObject({ id: 'x', name: 'myNode', filePath: 'src/x.ts' });
  });

  it('uses custom K value correctly', () => {
    const list1: RankedResult[] = [{ id: 'a', score: 1 }]; // rank 1
    const list2: RankedResult[] = [{ id: 'a', score: 1 }]; // rank 1
    const K = 10;
    const merged = mergeRanks(list1, list2, K);
    const expected = 2 / (K + 1); // 2 * 1/(10+1)
    expect(merged[0].score).toBeCloseTo(expected, 10);
  });

  it('handles large lists without duplicates', () => {
    const list1 = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}`, score: 100 - i }));
    const list2 = Array.from({ length: 100 }, (_, i) => ({ id: `other-${i}`, score: 100 - i }));
    const merged = mergeRanks(list1, list2);
    expect(merged).toHaveLength(200);
  });
});
