/**
 * Parity tests for the vector-math helpers duplicated between the cli and the
 * @monoes/routing / @monoes/memory packages (follow-ups F2/F3 in
 * docs/mastermind/plans/2026-11-dedupe-cli-vs-packages.md).
 *
 * - Centroid: the cli's private `meanCentroid` (routing/embedder.ts) matched
 *   routing's `computeCentroid` on every input below, so the cli copy was
 *   removed. `referenceMeanCentroid` is a verbatim copy of the removed code,
 *   kept here so the parity claim stays checked.
 * - Cosine: every copy agrees on equal-length input and returns 0 (no
 *   similarity) for mismatched lengths, empty vectors and zero vectors, with
 *   at most one warning per process naming the two lengths.
 * - Quantization: cli `quantizeInt8` and memory `Quantizer` are different
 *   algorithms; these tests pin how they differ. No merge.
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  batchCosineSim,
  dequantizeInt8,
  quantizedCosineSim,
  quantizeInt8,
} from '../../packages/@monomind/cli/src/memory/hnsw-operations.js';
import { cosineSimilarity as cliCosine } from '../../packages/@monomind/cli/src/utils/cosine-similarity.js';
import {
  cosineDistance,
  cosineDistanceNormalized,
  normalizeVector,
} from '../../packages/@monomind/memory/src/hnsw-distance.js';
import { Quantizer } from '../../packages/@monomind/memory/src/hnsw-quantizer.js';
import { cosineSimilarity as memoryCosine } from '../../packages/@monomind/memory/src/math-utils.js';
import {
  computeCentroid,
  cosineSimilarity as routingCosine,
} from '../../packages/@monomind/routing/src/cosine.js';
import { InMemoryVectorStore } from '../../packages/monofence-ai/src/domain/services/threat-learning-inmemory-store.js';

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

describe('cosine parity: every copy', () => {
  // Every implementation, mapped to a similarity. Distances map back with 1 - d.
  // monofence-ai is not here yet: see the pinned test below.
  const copies: Record<string, (a: number[], b: number[]) => number> = {
    'cli cosineSimilarity': (a, b) => cliCosine(a, b),
    'cli batchCosineSim': (a, b) => batchCosineSim(a, [b])[0],
    'cli quantizedCosineSim': (a, b) =>
      quantizedCosineSim(Int8Array.from(a), 1, Int8Array.from(b), 1),
    'routing cosineSimilarity': (a, b) => routingCosine(a, b),
    'memory cosineSimilarity': (a, b) => memoryCosine(a, b),
    'memory cosineDistance': (a, b) =>
      1 - cosineDistance(Float32Array.from(a), Float32Array.from(b)),
    'memory cosineDistanceNormalized': (a, b) =>
      1 -
      cosineDistanceNormalized(
        normalizeVector(Float32Array.from(a)),
        normalizeVector(Float32Array.from(b)),
      ),
  };
  const WARNED = Symbol.for('monomind.cosine.lengthMismatchWarned');
  const resetWarned = () => {
    delete (globalThis as Record<symbol, unknown>)[WARNED];
  };
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    resetWarned();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    resetWarned();
  });

  for (const [name, sim] of Object.entries(copies)) {
    describe(name, () => {
      it('agrees with the cli copy on equal-length vectors', () => {
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
            [3, -7, 25, 1],
            [3, -7, 25, 1],
          ],
        ];
        for (const [a, b] of pairs) expect(sim(a, b)).toBeCloseTo(cliCosine(a, b), 6);
      });

      it('returns 0 for mismatched lengths, either way round, and never throws', () => {
        expect(sim([1, 2, 3], [1, 2])).toBe(0);
        expect(sim([1, 2], [1, 2, 3])).toBe(0);
        expect(sim([], [1, 2])).toBe(0);
        expect(sim([1, 2], [])).toBe(0);
      });

      it('returns 0 for empty vectors', () => {
        expect(sim([], [])).toBe(0);
      });

      it('returns 0 (not NaN) for zero vectors', () => {
        expect(sim([0, 0, 0], [1, 2, 3])).toBe(0);
        expect(sim([1, 2, 3], [0, 0, 0])).toBe(0);
        expect(sim([0, 0], [0, 0])).toBe(0);
      });
    });
  }

  it('all copies together warn once per process, naming the two lengths', () => {
    for (const sim of Object.values(copies)) {
      sim([1, 2, 3], [1, 2]);
      sim([1], [1, 2, 3, 4]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/length mismatch \(3 vs 2\)/);
  });

  it('does not warn for equal lengths, empty or zero vectors', () => {
    for (const sim of Object.values(copies)) {
      sim([1, 2], [3, 4]);
      sim([], []);
      sim([0, 0], [1, 1]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('memory cosineDistance and cosineDistanceNormalized give distance 1 on mismatch', () => {
    expect(cosineDistance(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2]))).toBe(1);
    expect(cosineDistanceNormalized(Float32Array.from([1, 0, 0]), Float32Array.from([1, 0]))).toBe(
      1,
    );
  });

  it('cli batchCosineSim scores only the mismatched vectors 0', () => {
    const scores = batchCosineSim(
      [1, 0],
      [
        [1, 0],
        [1, 0, 0],
        [0, 1],
      ],
    );
    expect(Array.from(scores)).toEqual([1, 0, 0]);
  });

  it('NaN input still gives NaN where the copy computes it (unchanged)', () => {
    const a = [Number.NaN, 1];
    const b = [1, 1];
    expect(cliCosine(a, b)).toBeNaN();
    expect(routingCosine(a, b)).toBeNaN();
    expect(memoryCosine(a, b)).toBeNaN();
    expect(copies['memory cosineDistance'](a, b)).toBeNaN();
    expect(batchCosineSim(a, [b])[0]).toBeNaN();
  });
});

describe('cosine: monofence-ai InMemoryVectorStore (pinned, not yet aligned)', () => {
  // The cli loads monofence-ai only if each dist/*.js file matches the SHA-256
  // it pins for the published 2.24.0 tarball (OPTIONAL_DEPENDENCY_CODE_PINS in
  // packages/@monomind/cli/src/utils/optional-deps-locks.ts). Changing this
  // copy changes a pinned file, and the workspace build is then refused. It is
  // aligned with the rule above once a monofence-ai release moves the pin.
  const monofence = new InMemoryVectorStore() as unknown as {
    cosineSimilarity(a: number[], b: number[]): number;
  };

  it('agrees with the cli copy on equal-length vectors, empty and zero vectors', () => {
    expect(monofence.cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(
      cliCosine([1, 2, 3], [4, 5, 6]),
      12,
    );
    expect(monofence.cosineSimilarity([], [])).toBe(0);
    expect(monofence.cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('DIFFERS on length mismatch: still truncates to the shorter length', () => {
    expect(monofence.cosineSimilarity([1, 2, 3], [1, 2])).toBeCloseTo(1, 12);
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
