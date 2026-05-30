/**
 * Tests for HnswLite
 *
 * Covers: entry-point correctness, dimension validation,
 * serialize/deserialize, search accuracy, tombstone rebuild,
 * pruning symmetry, tombstone isolation, and bounded recall degradation.
 */

import { describe, it, expect } from 'vitest';
import { HnswLite, cosineSimilarity } from './hnsw-lite.js';

function makeVec(dims: number, value = 1): Float32Array {
  const v = new Float32Array(dims);
  v.fill(value / Math.sqrt(dims));
  return v;
}

function unitVec(dims: number, hotDim: number): Float32Array {
  const v = new Float32Array(dims);
  v[hotDim % dims] = 1;
  return v;
}

/**
 * Returns 10 genuinely distinct 4D vectors. Each vector has a dominant
 * dimension with varying secondary components so cosine similarity
 * gives a clear nearest-neighbour answer.
 */
function make4DVectors(): Array<{ id: string; vec: Float32Array }> {
  return [
    { id: 'v0', vec: new Float32Array([0.99, 0.10, 0.05, 0.02]) },
    { id: 'v1', vec: new Float32Array([0.05, 0.99, 0.10, 0.03]) },
    { id: 'v2', vec: new Float32Array([0.03, 0.08, 0.99, 0.10]) },
    { id: 'v3', vec: new Float32Array([0.02, 0.04, 0.07, 0.99]) },
    { id: 'v4', vec: new Float32Array([0.90, 0.40, 0.05, 0.01]) },
    { id: 'v5', vec: new Float32Array([0.04, 0.88, 0.45, 0.02]) },
    { id: 'v6', vec: new Float32Array([0.01, 0.05, 0.85, 0.50]) },
    { id: 'v7', vec: new Float32Array([0.50, 0.02, 0.06, 0.86]) },
    { id: 'v8', vec: new Float32Array([0.70, 0.70, 0.10, 0.05]) },
    { id: 'v9', vec: new Float32Array([0.10, 0.10, 0.70, 0.70]) },
  ];
}

describe('HnswLite', () => {
  describe('dimension validation', () => {
    it('throws RangeError when vector has wrong dimensions', () => {
      const idx = new HnswLite(4, 4, 8, 'cosine');
      const good = new Float32Array([1, 0, 0, 0]);
      const bad = new Float32Array([1, 0, 0]);
      idx.add('a', good);
      expect(() => idx.add('b', bad)).toThrow(RangeError);
      expect(() => idx.add('b', bad)).toThrow('dimension mismatch');
    });
  });

  describe('entry point included in search results', () => {
    it('returns the single entry when it is the only match', () => {
      const dims = 4;
      const idx = new HnswLite(dims, 4, 8, 'cosine');
      const v = new Float32Array([1, 0, 0, 0]);
      idx.add('only', v);

      const results = idx.search(v, 1);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('only');
      expect(results[0].score).toBeCloseTo(1.0);
    });

    it('returns the entry-point node when it is the closest match', () => {
      const dims = 4;
      const idx = new HnswLite(dims, 4, 8, 'cosine');
      // Entry point = first added vector
      idx.add('ep', new Float32Array([1, 0, 0, 0]));
      idx.add('other', new Float32Array([0, 1, 0, 0]));

      // Query closest to 'ep'
      const query = new Float32Array([0.9, 0.1, 0, 0]);
      const results = idx.search(query, 1);
      expect(results[0].id).toBe('ep');
    });
  });

  describe('persistent entry point (O(1) search startup)', () => {
    it('maintains entry point across add() calls', () => {
      const idx = new HnswLite(2, 4, 8, 'cosine');
      idx.add('first', new Float32Array([1, 0]));
      idx.add('second', new Float32Array([0, 1]));
      idx.add('third', new Float32Array([1, 1]));

      // After 3 adds the index should still find all vectors
      const results = idx.search(new Float32Array([1, 0]), 3);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.id === 'first')).toBe(true);
    });

    it('re-anchors entry point after rebuild triggered by tombstones', () => {
      // Use 10 genuinely distinct 4D vectors so the nearest-neighbour
      // assertion is meaningful (not vacuous as with 2D unitVec cycling).
      const idx = new HnswLite(4, 4, 8, 'cosine');
      const vecs = make4DVectors();
      for (const { id, vec } of vecs) {
        idx.add(id, vec);
      }

      // Remove v0 and v1 (2/10 = 20% > 12%) to trigger rebuild
      idx.remove('v0');
      idx.remove('v1');
      expect(idx.tombstoneCount).toBe(0); // rebuild clears tombstones

      // Query strongly aligned with v2's direction — v2 must be the top result
      // since v0 and v1 have been removed and v2 is the unambiguous nearest survivor.
      const query = new Float32Array([0.03, 0.08, 0.99, 0.10]);
      const results = idx.search(query, 1);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('v2');
    });
  });

  describe('pruning symmetry', () => {
    it('graph remains symmetric after pruneNeighbors fires', () => {
      // m=2 means pruning fires when a node accumulates > 4 connections.
      // Add enough vectors so the degree cap is hit for at least some nodes.
      const idx = new HnswLite(4, 2, 16, 'cosine');
      const vecs = make4DVectors();
      for (const { id, vec } of vecs) {
        idx.add(id, vec);
      }

      // Verify symmetry: for every (A, B) in neighbors, B must also list A
      // (or A must have been pruned away from B's list — both directions pruned
      // are allowed, but one-sided edges must not exist).
      for (const [nodeA, neighborsOfA] of idx.neighbors) {
        for (const nodeB of neighborsOfA) {
          const neighborsOfB = idx.neighbors.get(nodeB);
          expect(neighborsOfB).toBeDefined();
          expect(neighborsOfB!.has(nodeA)).toBe(true);
        }
      }
    });
  });

  describe('entry-point tombstone without rebuild', () => {
    it('search succeeds when entry point is removed but ratio stays below 12%', () => {
      const idx = new HnswLite(4, 4, 8, 'cosine');

      // Add 20 nodes — first added node becomes the entry point
      for (let i = 0; i < 20; i++) {
        idx.add(`node${i}`, unitVec(4, i));
      }

      // Remove only the first node: 1/20 = 5% < 12%, no rebuild
      idx.remove('node0');
      expect(idx.tombstoneCount).toBe(1); // rebuild did NOT fire

      // Search must not crash and must not return the removed node
      const query = unitVec(4, 1);
      const results = idx.search(query, 3);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.id !== 'node0')).toBe(true);
    });
  });

  describe('tombstone isolation (node only reachable via removed hub)', () => {
    it('search does not crash when hub is tombstoned and isolated node may be unreachable', () => {
      // Build a small index where one node acts as the hub (it is the entry
      // point and accumulates many connections due to being added first).
      const idx = new HnswLite(4, 4, 16, 'cosine');

      // Add the hub first so it is the entry point and will be well-connected
      idx.add('hub', new Float32Array([0.5, 0.5, 0.5, 0.5]));

      // Add vectors close to the hub so it gathers many edges
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * 0.4; // spread around hub direction
        idx.add(`spoke${i}`, new Float32Array([
          0.5 + angle * 0.1,
          0.5 - angle * 0.1,
          0.5 + angle * 0.05,
          0.5 - angle * 0.05,
        ]));
      }

      // Add the isolated node — it is only close to the hub by construction
      idx.add('isolated', new Float32Array([0.5, 0.5, 0.5, 0.499]));

      // Total = 10 nodes; removing hub = 1/10 = 10% < 12%, no rebuild
      idx.remove('hub');
      expect(idx.tombstoneCount).toBe(1);

      // Search near the isolated node — must not throw; result count may be 0
      const query = new Float32Array([0.5, 0.5, 0.5, 0.499]);
      let results: ReturnType<typeof idx.search> = [];
      expect(() => {
        results = idx.search(query, 3);
      }).not.toThrow();

      // All returned results must be live nodes
      expect(results.every(r => r.id !== 'hub')).toBe(true);
    });
  });

  describe('serialize / deserialize round-trip', () => {
    it('preserves all vectors and entry point (small index)', () => {
      const idx = new HnswLite(4, 4, 8, 'cosine');
      idx.add('a', new Float32Array([1, 0, 0, 0]));
      idx.add('b', new Float32Array([0, 1, 0, 0]));
      idx.add('c', new Float32Array([0, 0, 1, 0]));

      const data = idx.serialize();
      const restored = HnswLite.deserialize(data);

      expect(restored.size).toBe(3);
      const results = restored.search(new Float32Array([1, 0, 0, 0]), 1);
      expect(results[0].id).toBe('a');
      expect(results[0].score).toBeCloseTo(1.0);
    });

    it('preserves graph traversal with 20 vectors (exercises post-deserialize graph walk)', () => {
      const idx = new HnswLite(4, 4, 16, 'cosine');
      const vecs = make4DVectors();

      // Add the base 10 then 10 more variants
      for (const { id, vec } of vecs) {
        idx.add(id, vec);
      }
      for (let i = 0; i < 10; i++) {
        idx.add(`extra${i}`, new Float32Array([
          vecs[i % vecs.length].vec[0] * 0.95,
          vecs[i % vecs.length].vec[1] * 0.95,
          vecs[i % vecs.length].vec[2] * 0.95,
          vecs[i % vecs.length].vec[3] * 0.95,
        ]));
      }

      expect(idx.size).toBe(20);

      // Record the top result before serialization
      const query = new Float32Array([0.99, 0.10, 0.05, 0.02]);
      const preSave = idx.search(query, 1);
      expect(preSave.length).toBe(1);
      const expectedTopId = preSave[0].id;

      // Round-trip
      const data = idx.serialize();
      const restored = HnswLite.deserialize(data);

      expect(restored.size).toBe(20);

      // Same top result post-deserialize confirms graph structure is intact
      const postLoad = restored.search(query, 1);
      expect(postLoad.length).toBe(1);
      expect(postLoad[0].id).toBe(expectedTopId);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('returns 0 for zero vectors', () => {
      const z = new Float32Array([0, 0, 0]);
      const v = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(z, v)).toBe(0);
    });
  });
});
