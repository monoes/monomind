import { describe, it, expect } from 'vitest';
import {
  jaccardSimilarity,
  findSimilarNodes,
  buildNeighborMap,
} from '../../analysis/node-similarity.js';

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c']))).toBeCloseTo(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd']))).toBeCloseTo(0);
  });

  it('returns 1/3 for sets with one shared and two unique elements', () => {
    // intersection={b}, union={a,b,c} => 1/3
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBeCloseTo(0);
  });

  it('returns 0 when one set is empty and other is not', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBeCloseTo(0);
  });
});

describe('buildNeighborMap', () => {
  it('builds an undirected adjacency map', () => {
    const edges = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
    ];
    const map = buildNeighborMap(edges);
    expect(map.get('a')).toEqual(new Set(['b']));
    expect(map.get('b')).toEqual(new Set(['a', 'c']));
    expect(map.get('c')).toEqual(new Set(['b']));
  });
});

describe('findSimilarNodes', () => {
  const edges = [
    { sourceId: 'a', targetId: 'b' },
    { sourceId: 'a', targetId: 'c' },
    { sourceId: 'a', targetId: 'd' },
    { sourceId: 'x', targetId: 'b' },
    { sourceId: 'x', targetId: 'c' },
    { sourceId: 'x', targetId: 'd' },
    { sourceId: 'y', targetId: 'e' },
  ];

  it('returns nodes sorted by jaccard similarity descending', () => {
    const results = findSimilarNodes('a', edges, 5);
    // 'x' shares all 3 neighbors (b,c,d) — should be top result
    expect(results[0]?.nodeId).toBe('x');
    expect(results[0]?.score).toBeGreaterThan(0.5);
  });

  it('respects the k limit', () => {
    const results = findSimilarNodes('a', edges, 1);
    expect(results.length).toBe(1);
  });

  it('excludes the query node itself', () => {
    const results = findSimilarNodes('a', edges, 10);
    expect(results.every(r => r.nodeId !== 'a')).toBe(true);
  });

  it('returns empty array for unknown node', () => {
    const results = findSimilarNodes('unknown', edges, 5);
    expect(results).toHaveLength(0);
  });

  it('returns only nodes with score > 0', () => {
    const results = findSimilarNodes('a', edges, 10);
    expect(results.every(r => r.score > 0)).toBe(true);
  });
});
