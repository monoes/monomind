// Invariant (spec section 10): in the MVP no role starts or continues after its
// own recorded cap is exhausted. Cost arrives only when a turn ends, so each
// query is also handed the SDK's own budget stop, set to what the role has left.
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { runMetrics } from '../lib/metrics.js';
import { projectWithOrg, scriptedSdk, waitUntil } from '../support/scripted.js';

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

describe('scenario: role exhaustion', () => {
  it('a role stops at its cap, starts no further query, and its spend is what was reported', async () => {
    const sdk = scriptedSdk((role, turn) =>
      role === 'worker'
        ? { cost: 0.6, calls: [{ id: `w${turn}`, input: 10, cache_read: 1000 }] }
        : {},
    );
    const { root } = projectWithOrg({
      name: 'o',
      goal: 'g',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'worker', title: 'W', type: 'specialist', reports_to: 'boss', budget_usd: 1 },
      ],
    });
    daemon = new OrgDaemon(root, {
      queryFn: sdk.queryFn,
      forward: false,
      stopWaitMs: 100,
      crashBackoffsMs: [],
    });
    const running = await daemon.startOrg('o');
    await daemon.deliver('o', 'boss', 'worker', 't', 'one'); // spawns the worker on first mail
    const worker = running.agents.get('worker')!;
    expect(await waitUntil(() => sdk.turns.get('worker') === 1)).toBe(true);
    await daemon.deliver('o', 'boss', 'worker', 't', 'two');
    expect(await waitUntil(() => worker.mailbox.isClosed)).toBe(true);

    // $0.6 then $0.6 against a $1 cap: the second turn ran, and nothing ran after it.
    expect(worker.mailbox.closeReason).toBe('usd-budget');
    await daemon.deliver('o', 'boss', 'worker', 't', 'three').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    expect(sdk.turns.get('worker')).toBe(2);

    // One streaming query served both messages. It carries the budget left at
    // its start; the SDK measures cost from the same start, so the cap holds.
    // (A restarted query carries what remains: see the crash-resume scenario.)
    const budgets = (sdk.options.get('worker') ?? []).map((o) => o.maxBudgetUsd);
    expect(budgets).toEqual([1]);

    await running.bus.flush();
    const m = runMetrics(running.bus.dir);
    expect(m.usd_reported).toBeCloseTo(1.2);
    expect(m.budget_closures.usd).toBe(1);
    expect(m.roles.worker.usd).toBeCloseTo(1.2);
  });
});
