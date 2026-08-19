/**
 * Tests for HNSWIndex (MEM-10).
 *
 * hnsw-index.ts had zero unit tests despite being 947 lines. These tests
 * port the 6 metric-agreement designs from the deleted
 * tests/memory/hnsw-metric-agreement.test.mjs (removed in Wave 0/1 — it
 * exercised a nonexistent `hnsw-lite` package and a locally-redefined
 * cosine function instead of the real class) onto the actual `HNSWIndex`
 * class shipped from this package, plus a couple of edge cases (empty
 * index, single item) the deleted suite didn't cover.
 *
 * `search()` returns results sorted by ascending cosine *distance*
 * (0 = identical, up to 2 = opposite; distance = 1 - cosine similarity),
 * not a similarity score — see `cosineDistanceNormalized()`.
 */
import { describe, it, expect } from 'vitest';
import { HNSWIndex } from './hnsw-index.js';

/** Reference cosine similarity, used to build a brute-force ground truth. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Brute-force top-k by cosine similarity (descending). */
function bruteForceSearch(
  vectors: Record<string, Float32Array>,
  query: Float32Array,
  k: number
): Array<{ id: string; score: number }> {
  return Object.entries(vectors)
    .map(([id, vec]) => ({ id, score: cosineSimilarity(query, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Deterministic, well-separated vector generator — no Math.random(). Vector
 * `i` has a dominant unit component in dimension `i % dims` plus small
 * fixed noise elsewhere, so distinct vectors are clearly separated in
 * cosine space. HNSW is an *approximate* index (random per-node levels via
 * `Math.random()`, greedy layer descent), so brute-force agreement on a
 * near-uniform/ambiguous vector set is not guaranteed even for a correct
 * implementation — clear separation keeps these tests a meaningful check of
 * correctness rather than a coin flip on ANN recall.
 */
function makeVec(i: number, dims: number): Float32Array {
  const arr = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    arr[d] = 0.05 * (((i * 7 + d * 3 + 1) % 17) / 17);
  }
  arr[i % dims] += 1;
  return arr;
}

describe('HNSWIndex', () => {
  it('search() on an empty index returns []', async () => {
    const index = new HNSWIndex({ dimensions: 8 });
    const results = await index.search(new Float32Array(8), 5);
    expect(results).toEqual([]);
  });

  it('single-item index: search returns that item with distance ~0 for an identical query', async () => {
    const index = new HNSWIndex({ dimensions: 4 });
    const vec = new Float32Array([1, 0, 0, 0]);
    await index.addPoint('only', vec);

    expect(index.size).toBe(1);
    expect(index.has('only')).toBe(true);

    const results = await index.search(vec, 5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
    expect(results[0].distance).toBeCloseTo(0, 5);
  });

  it('graph traversal top result matches brute-force cosine search', async () => {
    const DIMS = 10;
    const N = 20;
    const K = 5;
    // 20 > K*2 → search() exercises the multi-layer graph traversal path,
    // not just a degenerate single-layer scan.

    const index = new HNSWIndex({ dimensions: DIMS, M: 8, efConstruction: 32, metric: 'cosine' });
    const vecs: Record<string, Float32Array> = {};
    for (let i = 0; i < N; i++) {
      vecs[`v${i}`] = makeVec(i, DIMS);
      await index.addPoint(`v${i}`, vecs[`v${i}`]);
    }

    // Query close to v0.
    const query = new Float32Array(vecs.v0.map((x) => x * 0.99 + 0.001));

    const results = await index.search(query, K);
    const bf = bruteForceSearch(vecs, query, 10); // top-10 brute-force ground truth
    const bfTopIds = new Set(bf.map((r) => r.id));

    // Top result must agree with brute-force.
    expect(results[0].id).toBe(bf[0].id);

    // Every returned id must be within the brute-force top-10 (allows for
    // ANN recall degradation without requiring an exact top-K match).
    for (const r of results) {
      expect(bfTopIds.has(r.id)).toBe(true);
    }

    // Results must be sorted by ascending distance (best match first).
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('search still returns the correct nearest neighbor after removePoint() removes the entry point', async () => {
    const DIMS = 8;
    const N = 20;

    const index = new HNSWIndex({ dimensions: DIMS, M: 8, efConstruction: 32, metric: 'cosine' });
    const vecs: Record<string, Float32Array> = {};
    for (let i = 0; i < N; i++) {
      vecs[`v${i}`] = makeVec(i, DIMS);
      await index.addPoint(`v${i}`, vecs[`v${i}`]);
    }

    // v0 was added first, so it's the initial entry point.
    const removed = await index.removePoint('v0');
    expect(removed).toBe(true);
    expect(index.size).toBe(N - 1);
    expect(index.has('v0')).toBe(false);

    // Removing an id that no longer exists returns false.
    expect(await index.removePoint('v0')).toBe(false);

    const query = new Float32Array(vecs.v1.map((x) => x * 0.99 + 0.001));
    const vecsWithoutV0 = Object.fromEntries(Object.entries(vecs).filter(([id]) => id !== 'v0'));
    const bf = bruteForceSearch(vecsWithoutV0, query, 5);

    const results = await index.search(query, 5);
    expect(results.map((r) => r.id)).not.toContain('v0');
    expect(results[0].id).toBe(bf[0].id);
  });

  it('rebuild() replaces the index contents and clears stale entries', async () => {
    const DIMS = 6;
    const index = new HNSWIndex({ dimensions: DIMS, M: 8, efConstruction: 32 });

    await index.addPoint('stale', new Float32Array([1, 0, 0, 0, 0, 0]));
    expect(index.size).toBe(1);

    const fresh = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, vector: makeVec(i, DIMS) }));
    await index.rebuild(fresh);

    expect(index.size).toBe(10);
    expect(index.has('stale')).toBe(false);
    expect(index.has('f0')).toBe(true);

    const results = await index.search(fresh[0].vector, 3);
    expect(results[0].id).toBe('f0');
    expect(results[0].distance).toBeCloseTo(0, 5);
  });

  it('addPoint() rejects vectors whose dimensionality does not match the index', async () => {
    const index = new HNSWIndex({ dimensions: 4 });
    await index.addPoint('a', new Float32Array([1, 0, 0, 0]));

    await expect(index.addPoint('b', new Float32Array([1, 0, 0]))).rejects.toThrow(
      /dimension mismatch/i
    );
    await expect(index.search(new Float32Array([1, 0]), 1)).rejects.toThrow(/dimension mismatch/i);
  });
});
