// packages/@monomind/cli/__tests__/orgrt/usd-hard-stop.test.ts
//
// A role's budget_usd was a soft stop: cost arrives only on a turn's result,
// so a single long turn ran far past the cap (Phase 0 pilot, 2026-10-01: a
// $0.80 role spent $6.50, an org capped at $10 spent $27). Each Claude query
// now carries the SDK's own maxBudgetUsd set to what the role has left, the
// SDK's error_max_budget_usd stop closes the role for budget instead of
// counting as a failed turn, and a role with nothing left starts no query.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'usd-stop-'));
const role = { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any;

/** One session over one mailbox message. `results` are the raw SDK result
 *  messages the fake query answers with (one per call). */
async function session(
  maxUsd: number | undefined,
  spent: number,
  results: Record<string, unknown>[],
  throwAfter?: string,
) {
  const bus = new OrgBus('o', 'r', dir());
  const events: { type: string; reason?: string }[] = [];
  bus.subscribe((e) => events.push(e as { type: string; reason?: string }));
  const mailbox = new Mailbox();
  mailbox.push('m0');
  const options: Record<string, unknown>[] = [];
  let call = 0;
  const fakeQuery = ({ prompt, options: o }: any) =>
    (async function* () {
      options.push(o);
      const r = results[call++];
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'result', session_id: `s${call}`, usage: { input_tokens: 0, output_tokens: 0 }, ...r };
      // The SDK throws once the CLI exits after an error result.
      if (throwAfter) throw new Error(throwAfter);
      if (call >= results.length) mailbox.close();
    })();
  const policy = new PolicyEngine('coder', maxUsd == null ? {} : { maxUsd }, bus, '/work');
  if (spent) policy.addUsageUsd(spent);
  const circuitBreaker = { state: { failures: 0, tripped: false }, threshold: 3 };
  await runAgentSession({
    org: 'o', role, bus, policy, mailbox, cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
    circuitBreaker,
  } as any);
  return { options, events, mailbox, policy, circuitBreaker };
}

describe('budget_usd is a hard stop for Claude roles', () => {
  it('passes the role\'s remaining USD to the query as maxBudgetUsd', async () => {
    const { options } = await session(2, 0.5, [{ subtype: 'success', total_cost_usd: 0.1 }]);
    expect(options[0].maxBudgetUsd).toBeCloseTo(1.5);
  });

  it('sets no maxBudgetUsd for a role without a USD cap', async () => {
    const { options } = await session(undefined, 0, [{ subtype: 'success', total_cost_usd: 0.1 }]);
    expect(options[0]).not.toHaveProperty('maxBudgetUsd');
  });

  it('closes the role for budget on the SDK\'s error_max_budget_usd, without counting a failure', async () => {
    const { events, mailbox, circuitBreaker, policy } = await session(1, 0, [
      { subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 1.04 },
    ]);
    expect(mailbox.closeReason).toBe('usd-budget');
    expect(circuitBreaker.state.failures).toBe(0);
    expect(events.some((e) => e.reason === 'session-result-error')).toBe(false);
    expect(events.some((e) => e.reason === 'budget-exhausted')).toBe(true);
    expect(policy.usageUsd).toBeCloseTo(1.04);
  });

  it('starts no query for a role whose USD budget is already spent', async () => {
    const { options, mailbox } = await session(1, 1, [{ subtype: 'success', total_cost_usd: 0.5 }]);
    expect(options).toHaveLength(0);
    expect(mailbox.closeReason).toBe('usd-budget');
  });

  it('ends the session for budget, not as a crash, when the SDK throws after its budget stop', async () => {
    const { mailbox, events } = await session(
      1,
      0,
      [{ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 1.02 }],
      'Claude Code returned an error result: Reached maximum budget ($1)',
    );
    expect(mailbox.closeReason).toBe('usd-budget');
    expect(events.some((e) => e.reason === 'budget-exhausted')).toBe(true);
  });
});
