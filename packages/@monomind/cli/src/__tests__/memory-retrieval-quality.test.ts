// packages/@monomind/cli/src/__tests__/memory-retrieval-quality.test.ts
// Retrieval-quality golden set for the Second Brain memory path.
//
// Two tiers:
//  1. Always-run: tokenized keyword fallback + namespace scoping + persistence,
//     via the bridge with embeddings disabled (works in any CI).
//  2. Semantic tier: runs only when @huggingface/transformers and its local
//     model actually load — asserts paraphrase recall that keyword search
//     cannot deliver. Skipped (not faked) when the model is unavailable.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bridgeStoreEntry,
  bridgeSearchEntries,
  bridgeGetDbPath,
} from '../memory/memory-bridge.js';

// The bridge resolves custom dbPaths through a traversal guard that only
// allows paths under cwd or the per-project data dir — so the fixture store
// must live inside cwd, not in os.tmpdir().
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-retrieval-quality-'));

/** Golden set: notes written in one vocabulary, queried in another. */
const GOLDEN: Array<{ key: string; note: string; paraphrase: string; keywordQuery: string }> = [
  {
    key: 'anchoring-checkout',
    note: 'Anchoring effects in checkout flows: showing the annual price first makes the monthly price feel cheap.',
    paraphrase: 'that thing about pricing psychology in the purchase funnel',
    keywordQuery: 'anchoring checkout',
  },
  {
    key: 'mailbox-shutdown-race',
    note: 'Fixed the race where closing an agent mailbox during delivery silently dropped the message.',
    paraphrase: 'bug when shutting down agents while a message was in flight',
    keywordQuery: 'mailbox race',
  },
  {
    key: 'garden-soil-ph',
    note: 'Blueberries need acidic soil, pH between 4.5 and 5.5; add sulfur in autumn.',
    paraphrase: 'how to make the ground right for growing blueberries',
    keywordQuery: 'blueberries soil',
  },
  {
    key: 'grpc-deadline-propagation',
    note: 'Always propagate gRPC deadlines from the edge; per-hop fixed timeouts amplify tail latency.',
    paraphrase: 'why setting the same timeout on every service is bad',
    keywordQuery: 'grpc deadline',
  },
  {
    key: 'vitamin-d-winter',
    note: 'Take vitamin D supplements from October to March; food alone is not enough at this latitude.',
    paraphrase: 'what supplement to take during the dark months',
    keywordQuery: 'vitamin d winter',
  },
];

const NS = 'knowledge:golden';

describe('memory retrieval quality (Second Brain golden set)', () => {
  let semanticAvailable = false;

  beforeAll(async () => {
    for (const g of GOLDEN) {
      const res = await bridgeStoreEntry({
        key: g.key, value: g.note, namespace: NS, dbPath: FIXTURE_DIR, upsert: true,
      });
      expect(res?.success).toBe(true);
      if (res?.embedding) semanticAvailable = true;
    }
  }, 180_000);

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('persists the store on disk (survives process death, unlike pure in-memory WASM)', () => {
    expect(existsSync(join(bridgeGetDbPath(FIXTURE_DIR), 'memory.db'))).toBe(true);
  });

  it('keyword queries hit their note even with hyphen/space token differences', async () => {
    for (const g of GOLDEN) {
      const res = await bridgeSearchEntries({
        query: g.keywordQuery, namespace: NS, dbPath: FIXTURE_DIR, limit: 3,
      });
      expect(res?.success).toBe(true);
      const keys = (res?.results ?? []).map(r => r.key);
      expect(keys, `keyword query "${g.keywordQuery}" should surface ${g.key}`).toContain(g.key);
    }
  }, 120_000);

  it('regression: "semantic test" style queries match "semantic-test" style keys', async () => {
    await bridgeStoreEntry({ key: 'semantic-test', value: 'x', namespace: NS, dbPath: FIXTURE_DIR, upsert: true, generateEmbeddingFlag: false });
    const res = await bridgeSearchEntries({ query: 'semantic test', namespace: NS, dbPath: FIXTURE_DIR, limit: 10 });
    expect((res?.results ?? []).map(r => r.key)).toContain('semantic-test');
  }, 60_000);

  it('namespace scoping: results never leak across namespaces', async () => {
    await bridgeStoreEntry({ key: 'other-ns-note', value: 'blueberries acidic soil sulfur', namespace: 'knowledge:other', dbPath: FIXTURE_DIR, upsert: true });
    const res = await bridgeSearchEntries({ query: 'blueberries soil', namespace: NS, dbPath: FIXTURE_DIR, limit: 10 });
    expect((res?.results ?? []).every(r => r.namespace === NS)).toBe(true);
  }, 60_000);

  it('semantic tier: paraphrase queries recall the right note (requires local model)', async (ctx) => {
    if (!semanticAvailable) {
      ctx.skip(); // model not available in this environment — do not fake a pass
      return;
    }
    let hits = 0;
    for (const g of GOLDEN) {
      const res = await bridgeSearchEntries({
        query: g.paraphrase, namespace: NS, dbPath: FIXTURE_DIR, limit: 3, threshold: 0.2,
      });
      const keys = (res?.results ?? []).map(r => r.key);
      if (keys.includes(g.key)) hits++;
      expect(res?.searchMethod, `paraphrase "${g.paraphrase}" must use the vector path`).toBe('semantic');
    }
    // Recall@3 ≥ 4/5 on paraphrases — the bar that keyword search cannot meet.
    expect(hits, `paraphrase recall@3 was ${hits}/${GOLDEN.length}`).toBeGreaterThanOrEqual(4);
  }, 300_000);
});
