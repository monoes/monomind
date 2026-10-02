// Invariants (spec section 10): the meter counts each model response once, an
// interrupted query still reports its cost, and every model call is logged
// once. Scripted behaviour, so the arithmetic is exact.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../../../packages/@monomind/cli/src/orgrt/bus.js';
import { Mailbox } from '../../../../packages/@monomind/cli/src/orgrt/mailbox.js';
import { PolicyEngine } from '../../../../packages/@monomind/cli/src/orgrt/policy.js';
import { runAgentSession } from '../../../../packages/@monomind/cli/src/orgrt/session.js';
import { runMetrics } from '../lib/metrics.js';
import { scriptedSdk } from '../support/scripted.js';

async function session(turns: Parameters<typeof scriptedSdk>[0]) {
  const sdk = scriptedSdk(turns);
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'eval-meter-')));
  const mailbox = new Mailbox();
  mailbox.push('m0');
  const policy = new PolicyEngine('worker', {}, bus, '/work');
  bus.subscribe((e) => e.type === 'usage' && mailbox.close());
  await runAgentSession({
    org: 'o',
    role: {
      id: 'worker',
      title: 'W',
      type: 'specialist',
      reports_to: 'boss',
      responsibilities: [],
    } as never,
    bus,
    policy,
    mailbox,
    cwd: '/work',
    deliver: async () => 'ok',
    queryFn: sdk.queryFn,
  } as never);
  await bus.flush();
  return { bus, policy, metrics: runMetrics(bus.dir) };
}

describe('scenario: meter invariants', () => {
  it('counts a response split across messages once, and logs it once', async () => {
    const split = { id: 'a', input: 10, cache_read: 1000, cache_creation: 100, output: 5 };
    const { metrics } = await session(() => ({
      calls: [split, split, split, { id: 'b', input: 10, cache_read: 1100, output: 5 }],
      cost: 0.02,
    }));
    // Two distinct responses: (10+1000+100+5) + (10+1100+5)
    expect(metrics.tokens_total).toBe(1115 + 1115);
    expect(metrics.context[0].calls).toBe(2);
    expect(metrics.usd_reported).toBeCloseTo(0.02);
  });

  it('records the cost of every turn of a session, summed once', async () => {
    const { metrics, policy } = await session(() => ({
      calls: [{ id: 'x', input: 1 }],
      cost: 0.5,
    }));
    expect(metrics.usd_reported).toBeCloseTo(0.5);
    expect(policy.usageUsd).toBeCloseTo(0.5);
  });
});
