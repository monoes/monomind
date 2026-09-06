// packages/@monomind/cli/src/__tests__/memory-bridge-record-usage.test.ts
// Carried item: bridgeRecordUsage silently skipped ids it could not resolve.
//
// bridgeApplyFeedback was fixed to report `skipped: [{id, reason}]` so that
// `applied: 0` is explainable. bridgeRecordUsage kept the old behaviour — it
// `continue`d past every unresolvable id and returned only a count, so a caller
// handing it five stale ids got `{success: true, updated: 0}` with nothing to
// distinguish "these entries were deleted" from "the write silently failed".

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { bridgeRecordUsage, bridgeStoreEntry } from '../memory/memory-bridge.js';

// The bridge's traversal guard only allows dbPaths under cwd.
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-record-usage-'));
const NS = 'kg:record-usage';

describe('bridgeRecordUsage reports unresolvable ids', () => {
  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('names the ids that trained nothing instead of dropping them silently', async () => {
    const stored = await bridgeStoreEntry({
      key: 'entity:auth-service',
      value: 'The auth service issues JWTs.',
      namespace: NS,
      generateEmbeddingFlag: false,
      dbPath: FIXTURE_DIR,
      upsert: true,
    });
    expect(stored?.success).toBe(true);

    const res = await bridgeRecordUsage({
      entryIds: [stored!.id, 'entry-that-was-deleted'],
      dbPath: FIXTURE_DIR,
    });

    expect(res?.success).toBe(true);
    expect(res?.updated).toBe(1);
    expect(res?.skipped).toEqual([{ id: 'entry-that-was-deleted', reason: 'not_found' }]);
  });

  it('omits skipped entirely when every id resolved', async () => {
    const stored = await bridgeStoreEntry({
      key: 'entity:billing-service',
      value: 'The billing service reconciles invoices.',
      namespace: NS,
      generateEmbeddingFlag: false,
      dbPath: FIXTURE_DIR,
      upsert: true,
    });

    const res = await bridgeRecordUsage({ entryIds: [stored!.id], dbPath: FIXTURE_DIR });
    expect(res?.updated).toBe(1);
    expect(res?.skipped).toBeUndefined();
  });
});
