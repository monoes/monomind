// packages/@monomind/cli/src/__tests__/memory-bridge-upsert-identity.test.ts
// K5 regression: an upsert must not orphan the entry IDs it already handed out.
//
// The bridge used to mint a FRESH id on every upsert, store the new row, then
// delete the old one. Since upsert is how re-ingestion merges provenance, the
// normal path silently invalidated every id a caller was holding: feedback
// against a previously-returned id then found nothing and reported
// `success: true, applied: 0` — success while training nothing.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { bridgeApplyFeedback, bridgeGetEntry, bridgeStoreEntry } from '../memory/memory-bridge.js';

// The bridge resolves custom dbPaths through a traversal guard that only allows
// paths under cwd or the per-project data dir — the fixture store must live
// inside cwd, not in os.tmpdir().
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-upsert-identity-'));
const NS = 'kg:upsert-identity';

/** Store with embeddings off so the test runs anywhere (no model download). */
function store(key: string, value: string, metadata?: Record<string, unknown>) {
  return bridgeStoreEntry({
    key,
    value,
    namespace: NS,
    generateEmbeddingFlag: false,
    dbPath: FIXTURE_DIR,
    upsert: true,
    metadata,
  });
}

describe('bridge upsert identity (K5)', () => {
  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("keeps the entry id stable across a re-ingest, so feedback on the caller's original id still applies", async () => {
    // 1. Ingest, and keep the id the caller was handed.
    const first = await store('entity:auth-service', 'The auth service issues JWTs.');
    expect(first?.success).toBe(true);
    const originalId = first!.id;
    expect(originalId).toBeTruthy();

    // 2. Re-ingest the same identity (this is how provenance merges).
    const second = await store(
      'entity:auth-service',
      'The auth service issues JWTs and refresh tokens.',
    );
    expect(second?.success).toBe(true);

    // The identity must survive the merge.
    expect(second!.id).toBe(originalId);

    // 3. Rate the id obtained BEFORE the re-ingest. This is the reviewer's
    //    exact scenario: it used to return success:true, applied:0.
    const fb = await bridgeApplyFeedback({
      entryIds: [originalId],
      score: 1,
      dbPath: FIXTURE_DIR,
    });
    expect(fb?.success).toBe(true);
    expect(fb?.applied).toBe(1);
    expect(fb?.skipped ?? []).toEqual([]);

    // And the re-ingested content is what's stored — one row, updated in place.
    const got = await bridgeGetEntry({
      key: 'entity:auth-service',
      namespace: NS,
      dbPath: FIXTURE_DIR,
    });
    expect(got?.found).toBe(true);
    expect(got!.entry!.id).toBe(originalId);
    expect(got!.entry!.content).toContain('refresh tokens');
  });

  it('preserves learned feedback and usage weights across an upsert', async () => {
    const first = await store('entity:billing', 'Billing charges monthly.');
    const id = first!.id;

    // Train the entry away from the 0.5 default.
    await bridgeApplyFeedback({ entryIds: [id], score: 1, dbPath: FIXTURE_DIR });
    const trained = await bridgeGetEntry({
      key: 'entity:billing',
      namespace: NS,
      dbPath: FIXTURE_DIR,
    });
    const trainedWeight = trained!.entry!.metadata.feedback_weight as number;
    expect(trainedWeight).toBeGreaterThan(0.5);

    // Re-ingest with fresh metadata, as document re-ingestion does.
    await store('entity:billing', 'Billing charges monthly and annually.', {
      origin_refs: ['session-2'],
    });

    const after = await bridgeGetEntry({
      key: 'entity:billing',
      namespace: NS,
      dbPath: FIXTURE_DIR,
    });
    // Learned weight survived...
    expect(after!.entry!.metadata.feedback_weight).toBe(trainedWeight);
    // ...and the caller's new metadata was still applied.
    expect(after!.entry!.metadata.origin_refs).toEqual(['session-2']);
  });

  it('keeps the original createdAt so a rewritten entry does not jump the created_at DESC scan order', async () => {
    const first = await store('entity:ordering', 'v1');
    const before = await bridgeGetEntry({
      key: 'entity:ordering',
      namespace: NS,
      dbPath: FIXTURE_DIR,
    });
    const createdAt = before!.entry!.createdAt;

    await new Promise((r) => setTimeout(r, 5));
    await store('entity:ordering', 'v2');

    const after = await bridgeGetEntry({
      key: 'entity:ordering',
      namespace: NS,
      dbPath: FIXTURE_DIR,
    });
    expect(after!.entry!.id).toBe(first!.id);
    expect(after!.entry!.createdAt).toBe(createdAt);
    // updatedAt still moves — the revision is visible, the position is not.
    expect(new Date(after!.entry!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(createdAt).getTime(),
    );
  });

  it('reports unresolved feedback ids with a reason instead of hollow success', async () => {
    const live = await store('entity:reported', 'still here');
    const res = await bridgeApplyFeedback({
      entryIds: [live!.id, 'entry_does_not_exist_0000'],
      score: 0.9,
      dbPath: FIXTURE_DIR,
    });

    expect(res?.success).toBe(true);
    expect(res?.applied).toBe(1);
    expect(res?.skipped).toEqual([{ id: 'entry_does_not_exist_0000', reason: 'not_found' }]);
  });

  it('distinguishes "applied nothing" from "applied successfully"', async () => {
    const res = await bridgeApplyFeedback({
      entryIds: ['entry_gone_a', 'entry_gone_b'],
      score: 0.9,
      dbPath: FIXTURE_DIR,
    });

    expect(res?.applied).toBe(0);
    // A caller must be able to see its feedback did nothing, and why.
    expect(res?.skipped).toHaveLength(2);
    expect(res?.skipped?.every((s) => s.reason === 'not_found')).toBe(true);
  });
});
