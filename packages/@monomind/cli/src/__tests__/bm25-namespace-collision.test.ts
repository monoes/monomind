// packages/@monomind/cli/src/__tests__/bm25-namespace-collision.test.ts
//
// #126 review follow-up: bridgeSearchEntries's BM25 fallback branch used to
// key its result-lookup Map by the bare entry key (`e.key`), but
// memory_entries only enforces UNIQUE(namespace, key) — the same key string
// can legitimately exist in two different namespaces. When searching across
// all namespaces (no namespace filter) with two entries sharing a key, every
// BM25 hit for that key resolved to whichever entry happened to be inserted
// last into the Map, silently returning the wrong entry's content/namespace.
// Fixed by indexing chunks by array position instead of key.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@huggingface/transformers', () => ({
  pipeline: async () => {
    throw new Error('mocked: no embedding model — forces the keyword/BM25 fallback path');
  },
}));

import { bridgeStoreEntry, bridgeSearchEntries, shutdownBridge } from '../memory/memory-bridge.js';

const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-bm25-collision-'));

describe('#126 review: BM25 fallback does not collide entries sharing a key across namespaces', () => {
  beforeAll(async () => {
    // Same key ("summary"), two different namespaces, distinct content —
    // this is exactly the collision scenario: UNIQUE(namespace, key) allows it.
    await bridgeStoreEntry({
      key: 'summary',
      value: 'alpha agent report on database migration progress',
      namespace: 'agent:alpha',
      dbPath: FIXTURE_DIR,
      upsert: true,
    });
    await bridgeStoreEntry({
      key: 'summary',
      value: 'beta agent report on frontend redesign progress',
      namespace: 'agent:beta',
      dbPath: FIXTURE_DIR,
      upsert: true,
    });
  }, 60_000);

  afterAll(async () => {
    await shutdownBridge();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('a namespace-less search returns BOTH entries with their own correct content, not a duplicate of one', async () => {
    // No namespace filter — bridgeSearchEntries fetches across all namespaces,
    // which is what makes the key collision reachable.
    const res = await bridgeSearchEntries({
      query: 'agent report progress',
      dbPath: FIXTURE_DIR,
      limit: 10,
    });
    expect(res?.success).toBe(true);

    const hits = (res?.results ?? []).filter((r) => r.key === 'summary');
    expect(hits.length).toBe(2);

    const byNamespace = new Map(hits.map((h) => [h.namespace, h.content]));
    expect(byNamespace.get('agent:alpha')).toContain('database migration');
    expect(byNamespace.get('agent:beta')).toContain('frontend redesign');
    // The bug's signature: both rows collapsing onto the SAME content.
    expect(byNamespace.get('agent:alpha')).not.toBe(byNamespace.get('agent:beta'));
  }, 60_000);
});
