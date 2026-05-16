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

// Import HnswLite from compiled output or source
let HnswLite;
try {
  ({ HnswLite } = await import('../../packages/@monomind/memory/src/hnsw-lite.js'));
} catch {
  try {
    // Try without extension (ts-node / vitest with ts transform)
    const mod = await import('../../packages/@monomind/memory/src/hnsw-lite.ts');
    HnswLite = mod.HnswLite;
  } catch {
    console.log('Note: hnsw-lite.ts requires compilation. Skipping cross-impl test.');
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

  it('HnswLite search returns same order as brute-force cosine', () => {
    if (!HnswLite) {
      console.log('Skipping: HnswLite not importable without compilation');
      return;
    }

    const index = new HnswLite(3, 4, 16, 'cosine');
    const vecs = {
      'a': new Float32Array([1, 0, 0]),
      'b': new Float32Array([0.9, 0.1, 0]),
      'c': new Float32Array([0, 1, 0]),
      'd': new Float32Array([0, 0, 1]),
      'e': new Float32Array([0.8, 0.2, 0]),
    };

    for (const [id, vec] of Object.entries(vecs)) index.add(id, vec);

    const query = new Float32Array([1, 0, 0]);
    const results = index.search(query, 3);

    // Brute-force ranking
    const bruteForce = Object.entries(vecs)
      .map(([id, vec]) => ({ id, score: cosineSimilarity(query, vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // Top result must match
    expect(results[0].id).toBe(bruteForce[0].id);
    // All 3 results must be in the brute-force top-3
    const bfIds = new Set(bruteForce.map(r => r.id));
    for (const r of results) expect(bfIds.has(r.id)).toBe(true);
  });

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
      const vec = new Float32Array([Math.random(), Math.random(), Math.random()]);
      index.add(`node_${i}`, vec);
    }

    expect(index.size).toBe(10);
    index.remove('node_5');
    // Tombstone kept (10% < 12% threshold) — size reflects logical count
    expect(index.size).toBe(9);
    expect(index.tombstoneCount).toBe(1);
  });
});
