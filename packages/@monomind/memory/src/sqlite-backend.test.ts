/**
 * SQLiteBackend — embedding round-trip regression test.
 *
 * Guards against Buffer-pool corruption: `Buffer.from(existingBuffer)` for
 * copies under Node's pooling threshold (4KB) allocates from a shared pool,
 * so `.buffer` on the copy refers to the ENTIRE pool ArrayBuffer at a
 * nonzero byteOffset — not just the copied bytes. Reading it back as a
 * Float32Array without slicing by byteOffset/byteLength silently yields
 * garbage. See AUDIT-BACKLOG.md P1-4.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteBackend } from './sqlite-backend.js';
import { createDefaultEntry } from './types.js';

describe('SQLiteBackend embedding round-trip', () => {
  let backend: SQLiteBackend;

  beforeEach(async () => {
    backend = new SQLiteBackend({ databasePath: ':memory:', walMode: false, verbose: false });
    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
  });

  function makeEmbedding(dim = 384): Float32Array {
    const emb = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      emb[i] = Math.sin(i) * (i + 1) * 0.001;
    }
    return emb;
  }

  it('stores and reads back a single embedding intact', async () => {
    const embedding = makeEmbedding();
    const entry = createDefaultEntry({ key: 'k1', content: 'hello world' });
    entry.embedding = embedding;

    await backend.store(entry);
    const fetched = await backend.get(entry.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.embedding).toBeDefined();
    expect(fetched!.embedding!.length).toBe(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      expect(fetched!.embedding![i]).toBeCloseTo(embedding[i], 6);
    }
  });

  it('keeps embeddings distinct across multiple small entries stored consecutively', async () => {
    // Storing several small (1536-byte) embeddings back-to-back is exactly the
    // scenario that triggers Buffer pool aliasing if the slice is wrong —
    // each read must reflect only its own entry, not a neighbor's bytes.
    const entries = Array.from({ length: 5 }, (_, i) => {
      const entry = createDefaultEntry({ key: `k${i}`, content: `entry ${i}` });
      entry.embedding = makeEmbedding().map((v) => v + i);
      return entry;
    });

    for (const entry of entries) {
      await backend.store(entry);
    }

    for (let i = 0; i < entries.length; i++) {
      const fetched = await backend.get(entries[i].id);
      expect(fetched!.embedding).toBeDefined();
      const expected = entries[i].embedding as Float32Array;
      for (let j = 0; j < expected.length; j++) {
        expect(fetched!.embedding![j]).toBeCloseTo(expected[j], 6);
      }
    }
  });

  it('preserves an existing embedding when re-storing an entry without one (read-before-cascade path)', async () => {
    const embedding = makeEmbedding();
    const entry = createDefaultEntry({ key: 'k-reuse', content: 'v1' });
    entry.embedding = embedding;
    await backend.store(entry);

    // Re-store the same id without an embedding — store() must read the
    // existing embedding back out before INSERT OR REPLACE cascades and
    // deletes it, then re-persist it unchanged.
    const updated = { ...entry, content: 'v2', embedding: undefined };
    await backend.store(updated as any);

    const fetched = await backend.get(entry.id);
    expect(fetched!.content).toBe('v2');
    expect(fetched!.embedding).toBeDefined();
    for (let i = 0; i < embedding.length; i++) {
      expect(fetched!.embedding![i]).toBeCloseTo(embedding[i], 6);
    }
  });
});
