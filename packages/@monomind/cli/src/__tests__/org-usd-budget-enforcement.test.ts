/**
 * ORG-7 regression: USD budgets (OrgRole.budget_usd) were displayed in the
 * dashboard (red rows, warnings) but nothing enforced them — only token
 * budgets (budget_tokens / policy.overBudget) actually closed a role's
 * mailbox. This verifies:
 *  - RoleSchema now accepts budget_usd (schema change, types.ts).
 *  - PolicyEngine tracks USD spend and denies once it meets/exceeds maxUsd,
 *    mirroring overBudget (tokens) exactly.
 *  - A live session (runAgentSession) whose accumulated cost crosses
 *    policy.overBudgetUsd closes the mailbox and emits a 'budget-exhausted'
 *    event, the same pattern the token-budget-exhausted path already uses.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoleSchema } from '../orgrt/types.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { runAgentSession, type SessionOpts } from '../orgrt/session.js';
import type { AgentRunner, AgentMessage } from '../orgrt/agent-runner.js';
import type { OrgRole } from '../orgrt/types.js';

describe('RoleSchema.budget_usd', () => {
  it('accepts a positive budget_usd override', () => {
    const role = RoleSchema.parse({ id: 'dev', budget_usd: 2.5 });
    expect(role.budget_usd).toBe(2.5);
  });

  it('leaves budget_usd undefined when absent', () => {
    const role = RoleSchema.parse({ id: 'dev' });
    expect(role.budget_usd).toBeUndefined();
  });

  it('rejects non-positive budget_usd', () => {
    expect(() => RoleSchema.parse({ id: 'dev', budget_usd: 0 })).toThrow();
    expect(() => RoleSchema.parse({ id: 'dev', budget_usd: -1 })).toThrow();
  });
});

describe('PolicyEngine — USD budget enforcement', () => {
  it('overBudgetUsd is false until accumulated cost meets maxUsd, then decide() denies', async () => {
    const bus = { emit: () => {} } as unknown as OrgBus;
    const policy = new PolicyEngine('dev', { maxUsd: 5 } as any, bus, '/tmp');
    expect(policy.overBudgetUsd).toBe(false);

    policy.addUsageUsd(3);
    expect(policy.overBudgetUsd).toBe(false);
    let decision = await policy.decide('Read', { file_path: 'x' });
    expect(decision.behavior).toBe('allow');

    policy.addUsageUsd(2.5); // total 5.5 >= maxUsd 5
    expect(policy.overBudgetUsd).toBe(true);
    decision = await policy.decide('Read', { file_path: 'x' });
    expect(decision.behavior).toBe('deny');
    expect((decision as { message: string }).message).toMatch(/USD budget exhausted/);
  });

  it('a role with no maxUsd set is never USD-budget-denied, regardless of spend', () => {
    const bus = { emit: () => {} } as unknown as OrgBus;
    const policy = new PolicyEngine('dev', {} as any, bus, '/tmp');
    policy.addUsageUsd(1_000_000);
    expect(policy.overBudgetUsd).toBe(false);
  });
});

describe('ORG-7: a live session closes its mailbox and emits budget-exhausted when USD spend exceeds budget_usd', () => {
  it('closes the mailbox and emits a budget-exhausted status event', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'org-usd-budget-'));
    try {
      const bus = new OrgBus('alpha', 'run-1', join(tmp, 'run'));
      const emitted: unknown[] = [];
      bus.subscribe(e => emitted.push(e));

      const mailbox = new Mailbox();
      const policy = new PolicyEngine('coder', { maxUsd: 1 } as any, bus, tmp);
      const role = { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' } as unknown as OrgRole;

      // Fake runner: yields one 'result' message whose cost exceeds the $1 budget_usd,
      // then ends the stream — exercises the exact enforcement path in session.ts.
      const fakeRunner: AgentRunner = {
        async *run(): AsyncIterable<AgentMessage> {
          yield { type: 'result', subtype: 'success', input_tokens: 10, output_tokens: 10, cost_usd: 1.5 };
        },
      };

      const opts: SessionOpts = {
        org: 'alpha', role, bus, policy, mailbox, cwd: tmp,
        deliver: async () => 'ok',
        runner: fakeRunner,
        maxTurns: 5,
      };

      await runAgentSession(opts);

      expect(mailbox.isClosed).toBe(true);
      const budgetEvent = emitted.find((e: any) => e.type === 'status' && e.reason === 'budget-exhausted');
      expect(budgetEvent).toBeTruthy();
      expect((budgetEvent as any).msg).toMatch(/USD budget exhausted/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does NOT close the mailbox when spend stays under budget_usd', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'org-usd-budget-'));
    try {
      const bus = new OrgBus('alpha', 'run-1', join(tmp, 'run'));
      const mailbox = new Mailbox();
      const policy = new PolicyEngine('coder', { maxUsd: 10 } as any, bus, tmp);
      const role = { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' } as unknown as OrgRole;

      let calls = 0;
      const fakeRunner: AgentRunner = {
        async *run(): AsyncIterable<AgentMessage> {
          calls++;
          yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, cost_usd: 0.5 };
        },
      };

      const opts: SessionOpts = {
        org: 'alpha', role, bus, policy, mailbox, cwd: tmp,
        deliver: async () => 'ok',
        runner: fakeRunner,
        maxTurns: 5,
      };

      // mailbox never closes here on its own since the fake runner doesn't drive
      // the mailbox stream — close it manually after one pass so runAgentSession's
      // outer loop terminates instead of restarting forever.
      const originalRun = fakeRunner.run.bind(fakeRunner);
      fakeRunner.run = function (...args) {
        mailbox.close();
        return originalRun(...args);
      };

      await runAgentSession(opts);
      expect(calls).toBe(1);
      expect(policy.overBudgetUsd).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
