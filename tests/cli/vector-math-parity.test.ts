/**
 * Parity tests for the vector-math helpers duplicated between the cli and the
 * @monoes/routing / @monoes/memory packages (follow-ups F2/F3 in
 * docs/mastermind/plans/2026-11-dedupe-cli-vs-packages.md).
 *
 * - Centroid: the cli's private `meanCentroid` (routing/embedder.ts) matched
 *   routing's `computeCentroid` on every input below, so the cli copy was
 *   removed. `referenceMeanCentroid` is a verbatim copy of the removed code,
 *   kept here so the parity claim stays checked.
 * - Cosine: the four implementations agree on equal-length input but differ on
 *   length mismatch, so all of them stay. These tests pin the differences.
 * - Quantization: cli `quantizeInt8` and memory `Quantizer` are different
 *   algorithms; these tests pin how they differ. No merge.
 */
import { describe, expect, it } from 'vitest';
import {
  batchCosineSim,
  dequantizeInt8,
  quantizeInt8,
} from '../../packages/@monomind/cli/src/memory/hnsw-operations.js';
import { cosineSimilarity as cliCosine } from '../../packages/@monomind/cli/src/utils/cosine-similarity.js';
import { cosineDistance } from '../../packages/@monomind/memory/src/hnsw-distance.js';
import { Quantizer } from '../../packages/@monomind/memory/src/hnsw-quantizer.js';
import { cosineSimilarity as memoryCosine } from '../../packages/@monomind/memory/src/math-utils.js';
import {
  computeCentroid,
  cosineSimilarity as routingCosine,
} from '../../packages/@monomind/routing/src/cosine.js';

/** Verbatim copy of the cli `meanCentroid` removed from routing/embedder.ts. */
function referenceMeanCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error('cannot compute a centroid for a route with no utterances');
  }
  const dim = vectors[0].length;
  const c = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) c[i] += v[i];
  for (let i = 0; i < dim; i++) c[i] /= vectors.length;
  return c;
}

describe('centroid parity: cli meanCentroid (removed) vs routing computeCentroid', () => {
  const cases: Array<[string, number[][]]> = [
    ['single vector', [[1, 2, 3]]],
    [
      'several vectors',
      [
        [1, 2, 3],
        [4, 5, 6],
        [-7, 0.5, 1e-9],
      ],
    ],
    [
      'zero vectors',
      [
        [0, 0],
        [0, 0],
      ],
    ],
    [
      'NaN component',
      [
        [Number.NaN, 1],
        [2, 3],
      ],
    ],
    ['ragged (shorter later vector)', [[1, 2], [3]]],
    ['ragged (longer later vector)', [[1], [3, 4]]],
    ['empty vectors', [[], []]],
  ];

  for (const [name, vectors] of cases) {
    it(name, () => {
      expect(computeCentroid(vectors)).toEqual(referenceMeanCentroid(vectors));
    });
  }

  it('both throw on an empty list (messages differ)', () => {
    expect(() => referenceMeanCentroid([])).toThrow();
    expect(() => computeCentroid([])).toThrow();
  });
});

describe('cosine parity: cli vs routing vs memory math-utils vs memory cosineDistance', () => {
  const simFromDistance = (a: number[], b: number[]) =>
    1 - cosineDistance(Float32Array.from(a), Float32Array.from(b));
  const batch = (a: number[], b: number[]) => batchCosineSim(a, [b])[0];

  it('agree on equal-length vectors', () => {
    const pairs: Array<[number[], number[]]> = [
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [1, 0],
        [0, 1],
      ],
      [
        [1, 2],
        [-1, -2],
      ],
      [
        [0.3, -0.7, 2.5, 1e-6],
        [0.3, -0.7, 2.5, 1e-6],
      ],
    ];
    for (const [a, b] of pairs) {
      const expected = cliCosine(a, b);
      expect(routingCosine(a, b)).toBe(expected);
      expect(memoryCosine(a, b)).toBe(expected);
      expect(simFromDistance(a, b)).toBeCloseTo(expected, 6);
      expect(batch(a, b)).toBeCloseTo(expected, 6);
    }
  });

  it('agree on zero vectors (similarity 0, distance 1)', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cliCosine(a, b)).toBe(0);
    expect(routingCosine(a, b)).toBe(0);
    expect(memoryCosine(a, b)).toBe(0);
    expect(cosineDistance(Float32Array.from(a), Float32Array.from(b))).toBe(1);
    expect(batch(a, b)).toBe(0);
  });

  it('agree on empty vectors (similarity 0)', () => {
    expect(cliCosine([], [])).toBe(0);
    expect(routingCosine([], [])).toBe(0);
    expect(memoryCosine([], [])).toBe(0);
    expect(simFromDistance([], [])).toBe(0);
    expect(batch([], [])).toBe(0);
  });

  it('agree on NaN input (NaN out)', () => {
    const a = [Number.NaN, 1];
    const b = [1, 1];
    expect(cliCosine(a, b)).toBeNaN();
    expect(routingCosine(a, b)).toBeNaN();
    expect(memoryCosine(a, b)).toBeNaN();
    expect(simFromDistance(a, b)).toBeNaN();
    expect(batch(a, b)).toBeNaN();
  });

  it('DIFFER on length mismatch', () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(cliCosine(a, b)).toBeCloseTo(1, 12); // truncates to the shorter length
    expect(() => routingCosine(a, b)).toThrow(/length mismatch/);
    expect(memoryCosine(a, b)).toBe(0);
    expect(simFromDistance(a, b)).toBeNaN(); // reads b[2] === undefined
    // query norm over the full query, vector norm over the overlap
    expect(batch(a, b)).toBeCloseTo(5 / (Math.sqrt(14) * Math.sqrt(5)), 6);
  });
});

describe('quantization: cli quantizeInt8 vs memory Quantizer (scalar, 8 bit) differ', () => {
  const scalar = (v: number[]) =>
    new Quantizer({ type: 'scalar', bits: 8 }, v.length).encode(Float32Array.from(v));

  it('quantizeInt8 is symmetric Int8 with a per-vector scale; Quantizer is affine [0, 1] Float32', () => {
    const v = [-1, 0, 0.5, 1];
    const q = quantizeInt8(v);
    expect(q.quantized).toBeInstanceOf(Int8Array);
    expect(Array.from(q.quantized)).toEqual([-127, 0, 64, 127]);
    expect(q.scale).toBeCloseTo(1 / 127, 12);
    expect(q.zeroPoint).toBe(0);

    const s = scalar(v);
    expect(s).toBeInstanceOf(Float32Array);
    expect(Array.from(s)).toEqual(Array.from(Float32Array.from([0, 128 / 255, 191 / 255, 1])));
  });

  it('quantizeInt8 round-trips to the input scale; Quantizer output does not', () => {
    const v = [-2, -0.5, 0.25, 3];
    const back = dequantizeInt8(quantizeInt8(v).quantized, quantizeInt8(v).scale);
    for (let i = 0; i < v.length; i++) expect(back[i]).toBeCloseTo(v[i], 1);
    expect(Math.min(...scalar(v))).toBe(0);
    expect(Math.max(...scalar(v))).toBe(1);
  });

  it('constant vector: quantizeInt8 keeps magnitude, Quantizer collapses to 0', () => {
    expect(Array.from(quantizeInt8([2, 2]).quantized)).toEqual([127, 127]);
    expect(Array.from(scalar([2, 2]))).toEqual([0, 0]);
  });

  it('zero vector: both give zeros (quantizeInt8 uses a 1e-10 fallback scale)', () => {
    const q = quantizeInt8([0, 0, 0]);
    expect(Array.from(q.quantized)).toEqual([0, 0, 0]);
    expect(q.scale).toBe(1e-10);
    expect(Array.from(scalar([0, 0, 0]))).toEqual([0, 0, 0]);
  });

  it('Quantizer rejects a dimension mismatch; quantizeInt8 has no fixed dimension', () => {
    expect(() =>
      new Quantizer({ type: 'scalar', bits: 8 }, 3).encode(Float32Array.from([1, 2])),
    ).toThrow(/dimension mismatch/);
    expect(quantizeInt8([1, 2]).quantized).toHaveLength(2);
  });
});
