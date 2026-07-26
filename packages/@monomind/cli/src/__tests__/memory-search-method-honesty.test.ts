// packages/@monomind/cli/src/__tests__/memory-search-method-honesty.test.ts
//
// `memory search` used to print "(semantic)" unconditionally — it echoed the
// REQUESTED search type, so a run that silently degraded to token-overlap
// keyword matching still claimed vector similarity. Worse, the keyword scores
// were rescaled to `min(0.9, 0.3 + score*0.6)`, which put them on a
// cosine-looking 0.30-0.90 band: an exact keyword hit rendered as 0.90 while
// the genuine cosine for the same entry was 0.63.
//
// These tests pin the honest behaviour: the reported method is always what
// actually ran, and keyword scores stay raw token-overlap fractions.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Flipped between tests to force each degradation path. */
let embedMode: 'ok' | 'pipeline-fails' | 'extract-fails' = 'ok';

/** Deterministic 16-dim unit vector — no network, no model download. */
function fakeEmbedding(text: string): Float32Array {
  const v = new Float32Array(16);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % 16] += 1;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

vi.mock('@huggingface/transformers', () => ({
  pipeline: async () => {
    if (embedMode === 'pipeline-fails') throw new Error('mocked: embedding model unavailable');
    return async (text: string) => {
      if (embedMode === 'extract-fails') throw new Error('mocked: inference failed');
      return { data: fakeEmbedding(text) };
    };
  },
}));

import { bridgeStoreEntry, bridgeSearchEntries, shutdownBridge } from '../memory/memory-bridge.js';

// The bridge's traversal guard only accepts dbPaths under cwd or the project
// data dir, so the fixture store must live inside cwd.
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-search-method-'));
const NS = 'knowledge:search-method';

describe('memory search reports the method that actually ran', () => {
  beforeAll(async () => {
    embedMode = 'ok';
    const res = await bridgeStoreEntry({
      key: 'jwt-auth',
      value: 'JWT refresh token rotation for authentication',
      namespace: NS,
      dbPath: FIXTURE_DIR,
      upsert: true,
    });
    expect(res?.success).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await shutdownBridge();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('reports "semantic" when the vector path really served the results', async () => {
    embedMode = 'ok';
    const res = await bridgeSearchEntries({
      query: 'JWT refresh token rotation for authentication',
      namespace: NS, dbPath: FIXTURE_DIR, limit: 5, threshold: 0.1,
    });
    expect(res?.searchMethod).toBe('semantic');
    expect(res?.fallbackReason).toBeUndefined();
    expect((res?.results ?? []).map(r => r.key)).toContain('jwt-auth');
    expect(res?.results[0].provenance?.startsWith('semantic:')).toBe(true);
  }, 60_000);

  it('reports "keyword-fallback" (not semantic) when embedding generation fails mid-search', async () => {
    embedMode = 'extract-fails';
    const res = await bridgeSearchEntries({
      query: 'jwt authentication', namespace: NS, dbPath: FIXTURE_DIR, limit: 5,
    });
    expect((res?.results ?? []).map(r => r.key)).toContain('jwt-auth');
    expect(res?.searchMethod).toBe('keyword-fallback');
    expect(res?.fallbackReason).toBe('embedding-failed');
    expect(res?.results[0].provenance?.startsWith('keyword:')).toBe(true);
  }, 60_000);

  it('reports "keyword" with no-embedding-model when the model never loaded', async () => {
    await shutdownBridge(); // drop the cached embedder so it is re-loaded
    embedMode = 'pipeline-fails';
    const res = await bridgeSearchEntries({
      query: 'jwt authentication', namespace: NS, dbPath: FIXTURE_DIR, limit: 5,
    });
    expect((res?.results ?? []).map(r => r.key)).toContain('jwt-auth');
    expect(res?.searchMethod).toBe('keyword');
    expect(res?.fallbackReason).toBe('no-embedding-model');
  }, 60_000);

  it('an empty query is reported as "empty-query", not as a missing embedding model', async () => {
    await shutdownBridge();
    embedMode = 'ok';
    // Warm the embedder with a real query so the model is demonstrably healthy.
    const warm = await bridgeSearchEntries({
      query: 'jwt authentication', namespace: NS, dbPath: FIXTURE_DIR, limit: 5, threshold: 0.1,
    });
    expect(warm?.searchMethod).toBe('semantic');

    const res = await bridgeSearchEntries({
      query: '', namespace: NS, dbPath: FIXTURE_DIR, limit: 5,
    });
    expect(res?.searchMethod).toBe('keyword');
    // The model is loaded and fine — blaming it would be a lie.
    expect(res?.fallbackReason).toBe('empty-query');
  }, 60_000);

  it('keyword scores are raw token-overlap fractions, not rescaled onto a cosine-looking band', async () => {
    await shutdownBridge();
    embedMode = 'pipeline-fails';

    // Both query tokens present -> 1.0 (the old rescale capped this at 0.90,
    // making a keyword hit outrank a genuine cosine match).
    const full = await bridgeSearchEntries({
      query: 'jwt authentication', namespace: NS, dbPath: FIXTURE_DIR, limit: 5,
    });
    expect(full?.results[0].score).toBeCloseTo(1, 5);

    // One of two tokens present -> 0.5 (the old rescale reported 0.60).
    const partial = await bridgeSearchEntries({
      query: 'jwt kubernetes', namespace: NS, dbPath: FIXTURE_DIR, limit: 5,
    });
    expect(partial?.results[0].score).toBeCloseTo(0.5, 5);
    // The old floor meant no keyword score could ever fall below 0.30.
    expect(partial?.results[0].score).toBeLessThan(0.6);
  }, 60_000);
});
