// packages/@monomind/cli/__tests__/orgrt/interrupt-cost.test.ts
//
// When an org stops, a role mid-query was killed outright and its query never
// reported a result, so its cost was never recorded: a trial's meter showed
// $1.46 where its session transcripts put the spend near $5.65. The Claude
// runner now interrupts the query first; the SDK then answers with a result
// carrying the cost so far (probed against the real SDK: interrupt() gave an
// error_during_execution result with total_cost_usd). The result reaches the
// meter as an 'interrupted' stop, not a failed turn, and a query that does
// not answer within the grace period is aborted as before.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner-claude.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession } from '../../src/orgrt/session.js';

/** A fake SDK query: one assistant message, then it waits. `interrupt()` makes
 *  it answer with a cost-bearing error result, as the real SDK does. */
function fakeQuery(opts: { answersInterrupt: boolean }) {
  const seen: { abortedAtResult?: boolean; interrupts: number; options?: any } = { interrupts: 0 };
  let release: () => void = () => {};
  const waiting = new Promise<void>((r) => (release = r));
  const queryFn = ((q: { options: any }) => {
    seen.options = q.options;
    const gen = (async function* () {
      yield { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { id: 'm1', content: [], usage: { input_tokens: 10, output_tokens: 5 } } };
      await waiting;
      if (!opts.answersInterrupt) {
        // Never answers the interrupt; like the real SDK, it throws once aborted.
        await new Promise<never>((_, reject) =>
          q.options.abortController.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Claude Code process aborted by user'), { name: 'AbortError' })), { once: true }),
        );
      }
      seen.abortedAtResult = q.options.abortController.signal.aborted;
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0.37 };
    })() as AsyncGenerator<any> & { interrupt?: () => Promise<void> };
    gen.interrupt = vi.fn(async () => {
      seen.interrupts++;
      release();
    });
    return gen;
  }) as never;
  return { queryFn, seen };
}

async function runUntilStopped(opts: { answersInterrupt: boolean; graceMs?: number }) {
  const { queryFn, seen } = fakeQuery(opts);
  const stop = new AbortController();
  const out: any[] = [];
  let error: unknown;
  try {
    for await (const m of new ClaudeAgentRunner(queryFn).run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/',
      env: {},
      maxTurns: 1,
      signal: stop.signal,
      interruptGraceMs: opts.graceMs ?? 2000,
    } as any)) {
      out.push(m);
      if (m.type === 'assistant') stop.abort(); // the org stops mid-query
    }
  } catch (e) {
    error = e;
  }
  return { out, seen, error };
}

describe('Claude runner: org stop interrupts the query to recover its cost', () => {
  it('interrupts instead of aborting, and yields the cost-bearing result as an interrupted stop', async () => {
    const { out, seen } = await runUntilStopped({ answersInterrupt: true });
    expect(seen.interrupts).toBe(1);
    expect(seen.abortedAtResult).toBe(false); // the process was not killed first
    const result = out.find((m) => m.type === 'result');
    expect(result).toMatchObject({ subtype: 'interrupted', cost_usd: 0.37 });
  });

  it('aborts after the grace period when the query never answers the interrupt', async () => {
    const { seen, error } = await runUntilStopped({ answersInterrupt: false, graceMs: 50 });
    expect(seen.interrupts).toBe(1);
    expect(seen.options.abortController.signal.aborted).toBe(true);
    expect(error === undefined || error instanceof Error).toBe(true);
  });
});

describe('session: an interrupted result is counted, not a failure', () => {
  it('adds the interrupted query\'s cost to the role\'s spend without tripping the circuit breaker', async () => {
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'int-cost-')));
    const mailbox = new Mailbox();
    mailbox.push('m0');
    const runner = {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          yield { type: 'result', subtype: 'interrupted', is_error: true, session_id: 's1', input_tokens: 0, output_tokens: 0, cost_usd: 0.37 };
          mailbox.close();
        }
      },
    };
    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const circuitBreaker = { state: { failures: 0, tripped: false }, threshold: 3 };
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work', deliver: async () => 'delivered', runner, circuitBreaker,
    } as any);
    expect(policy.usageUsd).toBeCloseTo(0.37);
    expect(circuitBreaker.state.failures).toBe(0);
  });
});
