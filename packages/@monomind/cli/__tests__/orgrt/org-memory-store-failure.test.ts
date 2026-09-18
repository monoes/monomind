// packages/@monomind/cli/__tests__/orgrt/org-memory-store-failure.test.ts
//
// GH #293: a failed cross-run memory store must not pass for a successful one.
//
// `bridgeStoreEntry` returns `null` when the memory backend cannot be resolved
// (an unbuilt or half-installed `@monoes/memory`, a corrupt store). storeRunMemory
// ignored that return and its caller sat in a `try` whose `catch` never fired,
// because nothing threw. The only trace was a `logBridgeError` line printed
// solely under MONOMIND_DEBUG=1 — so an org run completed normally, wrote
// runtime.json and history, and had saved nothing. Every later `org_recall`
// came back empty, pointing nowhere near the cause.
//
// The contract asserted here: storeRunMemory REPORTS the failure to its caller
// AND emits an `audit` bus event, without throwing (the run itself succeeded —
// failing it over post-run bookkeeping would be a worse outcome than a loud
// warning).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../../src/orgrt/reporting.js';
import type { BusEvent, OrgDef } from '../../src/orgrt/types.js';

/** What the mocked bridge's bridgeStoreEntry hands back on the next call.
 *  `null` is the real backend-unavailable return. */
let storeResult: { success: boolean; id: string; error?: string } | null = null;

vi.mock('../../src/memory/memory-bridge.js', () => ({
  // orgMemoryUsable() compares the guard's answer to the path it asked for —
  // echo it back so the guard passes and the test exercises the store itself.
  bridgeGetDbPath: vi.fn((p: string) => p),
  bridgeStoreEntry: async () => storeResult,
  bridgeApplyFeedback: async () => null,
}));

vi.mock('../../src/memory/memory-kg.js', () => ({
  heuristicExtract: () => ({ nodes: [], edges: [] }),
  kgIngest: async () => ({ nodes: 0, edges: 0 }),
}));

const { storeRunMemory } = await import('../../src/orgrt/org-memory.js');

const def = { goal: 'ship the thing', run_config: {} } as unknown as OrgDef;

const summary = (): RunSummary =>
  ({
    org: 'alpha',
    run: 'run-1',
    startedAt: 1000,
    endedAt: 61_000,
    events: 3,
    messages: 2,
    xorgMessages: 0,
    assets: [],
    crashes: [],
    cutShort: [],
    outcome: { status: 'achieved', summary: 'shipped it', by: 'boss' },
    roles: {},
    totalTokens: 0,
    totalCostUsd: 0,
  }) as RunSummary;

/** Minimal stand-in for the fields storeRunMemory touches on OrgDaemon. */
function fakeDaemon() {
  return {
    root: mkdtempSync(join(tmpdir(), 'org-mem-')),
    orgLearnedRuns: new Set<string>(),
    recallUsage: new Map<string, Set<string>>(),
  } as unknown as Parameters<typeof storeRunMemory>[0];
}

function fakeBus() {
  const events: Omit<BusEvent, 'id' | 'ts' | 'org' | 'run'>[] = [];
  return { events, emit: (e: (typeof events)[number]) => events.push(e) };
}

describe('storeRunMemory failure visibility (GH #293)', () => {
  beforeEach(() => {
    storeResult = null;
  });

  it('reports the failure to its caller when the backend cannot be loaded', async () => {
    storeResult = null; // bridgeStoreEntry's backend-unavailable return

    const res = await storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), fakeBus());

    expect(res.stored).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it('emits an audit bus event naming the loss, without the debug env var', async () => {
    storeResult = null;
    const bus = fakeBus();

    await storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), bus);

    const audit = bus.events.find((e) => e.type === 'audit');
    expect(audit, 'a dropped run memory must reach the org audit channel').toBeDefined();
    expect(audit?.reason).toBe('org-memory-store-failed');
    // The operator has to be able to connect this to the symptom they will
    // actually see later, which is an empty org_recall.
    expect(audit?.msg).toMatch(/recall/i);
  });

  it('does not throw — a completed run must not be failed by a bookkeeping loss', async () => {
    storeResult = null;

    await expect(
      storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), fakeBus()),
    ).resolves.toBeDefined();
  });

  it('reports the store-refused case too, not only a missing backend', async () => {
    storeResult = { success: false, id: '', error: 'value exceeds the cap' };
    const bus = fakeBus();

    const res = await storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), bus);

    expect(res.stored).toBe(false);
    expect(res.reason).toMatch(/value exceeds the cap/);
    expect(bus.events.some((e) => e.type === 'audit')).toBe(true);
  });

  it('stays silent on success', async () => {
    storeResult = { success: true, id: 'entry-1' };
    const bus = fakeBus();

    const res = await storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), bus);

    expect(res.stored).toBe(true);
    expect(bus.events.filter((e) => e.type === 'audit')).toEqual([]);
  });

  it('reports the unusable-path skip instead of returning as if it stored', async () => {
    storeResult = { success: true, id: 'entry-1' };
    const bus = fakeBus();
    // A root the bridge's traversal guard redirects elsewhere: org memory is
    // deliberately skipped there, but the run still saved nothing.
    const { bridgeGetDbPath } = await import('../../src/memory/memory-bridge.js');
    vi.mocked(bridgeGetDbPath).mockReturnValueOnce('/somewhere/else/.monomind/memory');

    const res = await storeRunMemory(fakeDaemon(), 'alpha', def, 'run-1', summary(), bus);

    expect(res.stored).toBe(false);
    expect(bus.events.some((e) => e.type === 'audit')).toBe(true);
  });
});
