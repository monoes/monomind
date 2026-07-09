import { describe, it, expect } from 'vitest';
import { cosineSimilarity, computeCentroid } from '../cosine.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('returns 1 for scaled identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it('returns 0 when first vector is zero', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 when second vector is zero', () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('returns 0 when both vectors are zero', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector length mismatch');
  });

  it('handles single-element vectors', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1, 10);
  });
});

describe('computeCentroid', () => {
  it('returns the vector itself for a single vector', () => {
    const v = [1, 2, 3];
    expect(computeCentroid([v])).toEqual([1, 2, 3]);
  });

  it('returns the mean of multiple vectors', () => {
    const result = computeCentroid([
      [0, 0, 0],
      [2, 4, 6],
    ]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('computes centroid of three vectors', () => {
    const result = computeCentroid([
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ]);
    expect(result).toEqual([1, 1, 1]);
  });

  it('throws on empty array', () => {
    expect(() => computeCentroid([])).toThrow('Cannot compute centroid of empty array');
  });
});
