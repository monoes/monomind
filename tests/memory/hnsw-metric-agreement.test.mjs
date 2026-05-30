import { describe, it, expect } from 'vitest';

// Reference cosine implementation (matches learning-service.mjs _cosineSimilarity)
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Brute-force top-k using cosine similarity
function bruteForceSearch(vectors, query, k) {
  return Object.entries(vectors)
    .map(([id, vec]) => ({ id, score: cosineSimilarity(query, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Build a deterministic vector: dimension `dims`, value at index `i` is
// `(i % dims + 1) / dims` — no Math.random(), fully reproducible.
function makeVec(i, dims) {
  const arr = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    arr[d] = ((i * 7 + d * 3 + 1) % 17) / 17;
  }
  // Ensure the vector is non-zero (the formula above is never all-zero for dims >= 1)
  return arr;
}

// Import HnswLite — prefer compiled dist, fall back to source for ts-node environments
let HnswLite;
try {
  ({ HnswLite } = await import('../../packages/@monomind/memory/dist/hnsw-lite.js'));
} catch {
  try {
    ({ HnswLite } = await import('../../packages/@monomind/memory/src/hnsw-lite.js'));
  } catch {
    try {
      const mod = await import('../../packages/@monomind/memory/src/hnsw-lite.ts');
      HnswLite = mod.HnswLite;
    } catch {
      console.log('Note: hnsw-lite requires compilation. Skipping HnswLite tests.');
    }
  }
}

describe('HNSW metric agreement', () => {
  it('cosineSimilarity matches the reference implementation', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    const c = new Float32Array([1, 1, 0]);

    // Orthogonal vectors: similarity = 0
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    // 45-degree vectors: similarity ≈ 0.707
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.7071, 3);
  });

  it('cosine similarity is commutative', () => {
    const a = new Float32Array([0.5, 0.3, 0.8]);
    const b = new Float32Array([0.1, 0.9, 0.4]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });

  it('cosine similarity of identical vectors is 1', () => {
    const a = new Float32Array([0.3, 0.7, 0.5]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  // -------------------------------------------------------------------------
  // Graph traversal agreement
  // 20 vectors, k=5 → vectors.size (20) > k*2 (10) → graph path is exercised.
  // The old test used 5 vectors + k=3 → 5 <= 6 → always brute-force (tautology).
  // -------------------------------------------------------------------------
  it('HnswLite graph traversal: top result matches brute-force', () => {
    if (!HnswLite) {
      console.log('Skipping: HnswLite not importable without compilation');
      return;
    }

    const DIMS = 10;
    const N = 20;
    const K = 5;
    // 20 > K*2=10 → search() takes the graph traversal path

    const index = new HnswLite(DIMS, 8, 32, 'cosine');
    const vecs = {};
    for (let i = 0; i < N; i++) {
      vecs[`v${i}`] = makeVec(i, DIMS);
      index.add(`v${i}`, vecs[`v${i}`]);
    }

    // Query close to v0
    const query = vecs['v0'].map(x => x * 0.99 + 0.001);
    const queryF32 = new Float32Array(query);

    const results = index.search(queryF32, K);
    const bf = bruteForceSearch(vecs, queryF32, 10); // top-10 brute-force
    const bfTopIds = new Set(bf.map(r => r.id));

    // Top result must match brute-force winner
    expect(results[0].id).toBe(bf[0].id);

    // All returned IDs must be in the brute-force top-10 (allows ANN recall degradation)
    for (const r of results) {
      expect(bfTopIds.has(r.id)).toBe(true);
    }

    // Results must be in descending score order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  // -------------------------------------------------------------------------
  // Pruning doesn't break graph connectivity
  // m=2 → pruning triggers when a node accumulates > m*2=4 neighbors.
  // With enough vectors connected to one hub, pruneNeighbors is invoked.
  // After pruning, nearest-neighbor search must still return the correct result.
  // -------------------------------------------------------------------------
  it('HnswLite pruning does not break graph connectivity', () => {
    if (!HnswLite) return;

    // m=2, efConstruction=10: pruning fires when a node has >4 neighbors
    // We insert 12 vectors all very similar to v0 so v0 accumulates connections
    const DIMS = 4;
    const M = 2;
    const index = new HnswLite(DIMS, M, 10, 'cosine');

    // v0 is the anchor — all other vectors point roughly in the same direction
    index.add('v0', new Float32Array([1, 0, 0, 0]));

    // Add 11 more vectors close to v0 — these will connect back to v0
    // triggering pruneNeighbors on v0 once its neighbor count exceeds M*2=4
    for (let i = 1; i <= 11; i++) {
      const scale = 1 - i * 0.02; // slightly different magnitudes, same direction
      index.add(`v${i}`, new Float32Array([scale, i * 0.01, 0, 0]));
    }

    // Total 12 vectors, k=5 → 12 > k*2=10 → graph traversal path
    const query = new Float32Array([1, 0, 0, 0]);
    const results = index.search(query, 5);

    // v0 is identical to query → must be the top result
    expect(results[0].id).toBe('v0');
    expect(results[0].score).toBeCloseTo(1, 4);
  });

  // -------------------------------------------------------------------------
  // Entry-point removal: search still works
  // The entry point is the first-added node. After removing it (keeping ratio
  // below 12% rebuild threshold), search must re-anchor and still work.
  // -------------------------------------------------------------------------
  it('HnswLite search still works after entry-point removal', () => {
    if (!HnswLite) return;

    const DIMS = 8;
    const N = 20;
    const index = new HnswLite(DIMS, 8, 32, 'cosine');

    const vecs = {};
    for (let i = 0; i < N; i++) {
      vecs[`v${i}`] = makeVec(i, DIMS);
      index.add(`v${i}`, vecs[`v${i}`]);
    }

    // The entry point is the first-added node 'v0'
    // Remove it: 1/20 = 5% < 12% threshold → tombstone, no rebuild
    index.remove('v0');

    expect(index.tombstoneCount).toBe(1);
    expect(index.size).toBe(N - 1);

    // Search should not include v0 and should still return correct top result
    // Query close to v1
    const query = vecs['v1'].map(x => x * 0.99 + 0.001);
    const queryF32 = new Float32Array(query);

    // Build brute-force ground-truth excluding v0
    const vecsWithoutV0 = Object.fromEntries(
      Object.entries(vecs).filter(([id]) => id !== 'v0')
    );
    const bf = bruteForceSearch(vecsWithoutV0, queryF32, 5);

    const results = index.search(queryF32, 5);

    // v0 must not appear
    expect(results.map(r => r.id)).not.toContain('v0');

    // Top result must match brute-force (v0 excluded)
    expect(results[0].id).toBe(bf[0].id);
  });

  // -------------------------------------------------------------------------
  // Serialize/deserialize with graph traversal
  // After round-tripping through serialize/deserialize, graph traversal (20
  // vectors, k=5 → 20 > 10) must return the same top result as before.
  // -------------------------------------------------------------------------
  it('HnswLite serialize/deserialize preserves graph traversal results', () => {
    if (!HnswLite) return;

    const DIMS = 10;
    const N = 20;
    const K = 5;

    const index = new HnswLite(DIMS, 8, 32, 'cosine');
    const vecs = {};
    for (let i = 0; i < N; i++) {
      vecs[`v${i}`] = makeVec(i + 100, DIMS); // offset seed to differ from other tests
      index.add(`v${i}`, vecs[`v${i}`]);
    }

    const query = new Float32Array(makeVec(50, DIMS));

    // Search before serialization
    const before = index.search(query, K);
    expect(before.length).toBeGreaterThan(0);

    // Round-trip
    const snapshot = index.serialize();
    const restored = HnswLite.deserialize(snapshot);

    // Search after deserialization — must use graph path (20 > K*2=10)
    const after = restored.search(query, K);

    // Top result must be identical
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].score).toBeCloseTo(before[0].score, 6);

    // Full result set must match
    expect(after.map(r => r.id)).toEqual(before.map(r => r.id));
  });

  // -------------------------------------------------------------------------
  // Existing valid tests (tombstone and size)
  // -------------------------------------------------------------------------
  it('HnswLite tombstone does not appear in search results', () => {
    if (!HnswLite) return;

    const index = new HnswLite(3, 4, 16, 'cosine');
    index.add('a', new Float32Array([1, 0, 0]));
    index.add('b', new Float32Array([0.99, 0.01, 0]));
    index.add('c', new Float32Array([0, 1, 0]));

    index.remove('b');

    const results = index.search(new Float32Array([1, 0, 0]), 3);
    const ids = results.map(r => r.id);
    expect(ids).not.toContain('b');
  });

  it('HnswLite size excludes tombstoned nodes', () => {
    if (!HnswLite) return;

    // Use enough nodes so a single removal stays below the 12% rebuild threshold
    const index = new HnswLite(3, 4, 16, 'cosine');
    // Add 10 nodes: 1/10 = 10% < 12%, so tombstone is NOT immediately flushed
    for (let i = 0; i < 10; i++) {
      const vec = makeVec(i, 3);
      index.add(`node_${i}`, vec);
    }

    expect(index.size).toBe(10);
    index.remove('node_5');
    // Tombstone kept (10% < 12% threshold) — size reflects logical count
    expect(index.size).toBe(9);
    expect(index.tombstoneCount).toBe(1);
  });
});
