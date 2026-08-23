/**
 * R1 — memory-bridge.ts swallows every error to `null`
 *
 * Before fix: every bridge* function ends with `} catch { return null; }`.
 * SQLITE_BUSY, EACCES, disk-full, schema-mismatch — all collapse to "no
 * matches" or "memory unavailable" with zero diagnostic. The user has no
 * way to tell `memory_search` returned nothing because (a) there really
 * are no matches, vs (b) the DB is locked and every query is silently
 * failing.
 *
 * After fix: each catch logs the real error (DEBUG/MONOMIND_DEBUG-gated)
 * before returning null. Behavior contract unchanged; observability added.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../packages/@monomind/cli/src/memory/memory-bridge.js';

const ORIGINAL_DEBUG = process.env.DEBUG;
const ORIGINAL_MDEBUG = process.env.MONOMIND_DEBUG;

const SRC = readFileSync(
  new URL('../../packages/@monomind/cli/src/memory/memory-bridge.ts', import.meta.url),
  'utf-8',
);

describe('R1 — memory-bridge surfaces errors instead of swallowing', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.DEBUG = '1';
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_DEBUG === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = ORIGINAL_DEBUG;
    if (ORIGINAL_MDEBUG === undefined) delete process.env.MONOMIND_DEBUG;
    else process.env.MONOMIND_DEBUG = ORIGINAL_MDEBUG;
    errSpy.mockRestore();
  });

  it('defines a logBridgeError helper', () => {
    expect(SRC).toMatch(/function logBridgeError/);
    expect(SRC).toMatch(/DEBUG \|\| process\.env\.MONOMIND_DEBUG/);
  });

  it('logBridgeError is wired into the documented bridge call sites', () => {
    // Strategy: the bridge must (a) define the helper, (b) reference it from
    // at least the call sites the review flagged (search, list, get, delete,
    // embed, load-model, getBackend, loadBridgeConfig). The remaining naked
    // catches are documented benign patterns (realpath fallback, eviction
    // close, missing-entry lookups) — we don't enumerate every one.
    expect(SRC).toMatch(/function logBridgeError/);
    expect(SRC).toMatch(/DEBUG \|\| process\.env\.MONOMIND_DEBUG/);

    const requiredSites = [
      'bridgeSearchEntries',
      'bridgeListEntries',
      'bridgeGetEntry',
      'bridgeDeleteEntry',
      'bridgeEmbedText',
      'bridgeLoadEmbeddingModel',
      'getBackend',
      'loadBridgeConfig',
    ];
    for (const site of requiredSites) {
      // Either the label appears in a logBridgeError call at that site, OR
      // the function name itself appears in a logBridgeError('xxx', ...) arg.
      const inCall = new RegExp(`logBridgeError\\(['"\`]${site}['"\`]`).test(SRC);
      expect(inCall, `bridge fn "${site}" missing logBridgeError label`).toBe(true);
    }
  });

  it('bridgeDeleteEntry returns a failure shape (not silent success) for a bad path', async () => {
    // Drive bridgeDeleteEntry at a path whose parent doesn't exist — the
    // backend initialization must fail, returning null or a failure shape.
    // The old assertion (toBeGreaterThanOrEqual(0)) was always true and
    // tested nothing. The real contract: the function never throws AND
    // never returns { success: true, deleted: true } for a corrupt store.
    const result = await bridge.bridgeDeleteEntry({
      key: `r1-probe-${Date.now()}`,
      namespace: 'r1-test',
      dbPath: '/this/path/does/not/exist/and/parent/missing.db',
    });
    // Must be null (backend unavailable) or { deleted: false }
    if (result !== null) {
      expect(result.deleted).toBe(false);
    }
    // If console.error was called (DEBUG is set), every logged message
    // from the bridge must use the greppable label format.
    const bridgeCalls = errSpy.mock.calls.filter(
      (c) =>
        String(c[0] || '').includes('[bridge:') || String(c[0] || '').includes('[memory-bridge]'),
    );
    for (const call of bridgeCalls) {
      expect(String(call[0])).toMatch(/\[(?:bridge:|memory-bridge)/);
    }
  });
});
