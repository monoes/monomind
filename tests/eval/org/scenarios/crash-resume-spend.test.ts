// Invariant (spec section 10): known recorded spend survives crash and resume.
// A role that spent part of its cap before the org stopped does not get the
// whole cap back on resume, and its restarted query carries only what is left.
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { projectWithOrg, scriptedSdk, waitUntil } from '../support/scripted.js';

const daemons: OrgDaemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll()));
});

describe('scenario: crash and resume with charged work', () => {
  it("keeps the role's recorded spend across a stop and resume, and re-bounds its next query", async () => {
    const sdk = scriptedSdk((role) =>
      role === 'worker' ? { cost: 0.6, calls: [{ id: `r${Math.random()}`, input: 5 }] } : {},
    );
    const { root } = projectWithOrg({
      name: 'o',
      goal: 'g',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'worker', title: 'W', type: 'specialist', reports_to: 'boss', budget_usd: 1 },
      ],
    });
    const opts = {
      queryFn: sdk.queryFn,
      forward: false,
      stopWaitMs: 100,
      crashBackoffsMs: [],
      crossProcess: false,
    };

    const first = new OrgDaemon(root, opts);
    daemons.push(first);
    const running = await first.startOrg('o');
    await first.deliver('o', 'boss', 'worker', 't', 'work');
    expect(await waitUntil(() => sdk.turns.get('worker') === 1)).toBe(true);
    expect(await waitUntil(() => (running.agents.get('worker')?.policy.usageUsd ?? 0) > 0)).toBe(
      true,
    );
    await first.stopOrg('o');

    const second = new OrgDaemon(root, opts);
    daemons.push(second);
    const resumed = await second.startOrg('o', undefined, { resume: true });
    await second.deliver('o', 'boss', 'worker', 't', 'more work');
    expect(await waitUntil(() => (sdk.options.get('worker')?.length ?? 0) >= 2)).toBe(true);

    // The recorded $0.6 is still on the books, and the new query is bounded by the $0.4 left.
    expect(resumed.agents.get('worker')!.policy.usageUsd).toBeGreaterThanOrEqual(0.6 - 1e-9);
    const budgets = (sdk.options.get('worker') ?? []).map((o) => o.maxBudgetUsd);
    expect(budgets[0]).toBeCloseTo(1);
    expect(budgets.at(-1)).toBeCloseTo(0.4);
  });
});
