// Invariant (spec section 10): capacity contention never runs more roles than
// max_concurrent_agents, and no role is lost: a role deferred for want of a
// slot runs once one frees, and the deferral is on the record.
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { runMetrics } from '../lib/metrics.js';
import { projectWithOrg, scriptedSdk, waitUntil } from '../support/scripted.js';

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

describe('scenario: capacity contention', () => {
  it('never exceeds the cap, defers the extra role, and runs it when a slot frees', async () => {
    // workerA does one turn and then crashes, which frees its slot.
    const sdk = scriptedSdk((role) =>
      role === 'workerA' ? { crash: 'workerA crashes to free its slot' } : {},
    );
    const { root } = projectWithOrg({
      name: 'o',
      goal: 'g',
      run_config: { max_concurrent_agents: 2 },
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'workerA', title: 'A', type: 'specialist', reports_to: 'boss' },
        { id: 'workerB', title: 'B', type: 'specialist', reports_to: 'boss' },
      ],
    });
    daemon = new OrgDaemon(root, {
      queryFn: sdk.queryFn,
      forward: false,
      stopWaitMs: 100,
      crashBackoffsMs: [],
      concurrencyDeferPollMs: 30,
      concurrencyDeferMaxAttempts: 10_000,
    });
    const running = await daemon.startOrg('o');

    // Sample live roles throughout; the cap must hold at every instant.
    let peak = 0;
    const sampler = setInterval(() => {
      peak = Math.max(
        peak,
        [...running.agents.values()].filter((a) => a.status === 'running').length,
      );
    }, 5);
    try {
      await daemon.deliver('o', 'boss', 'workerA', 't', 'go'); // boss + workerA fill the cap
      await daemon.deliver('o', 'boss', 'workerB', 't', 'go'); // no slot: deferred
      expect(await waitUntil(() => sdk.turns.get('workerB') === 1, 8000)).toBe(true);
    } finally {
      clearInterval(sampler);
    }

    expect(peak).toBeLessThanOrEqual(2);
    await running.bus.flush();
    expect(runMetrics(running.bus.dir).concurrency_deferrals).toBeGreaterThanOrEqual(1);
  });
});
