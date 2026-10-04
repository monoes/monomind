// packages/@monomind/cli/__tests__/orgrt/error-result-ends-session.test.ts
//
// run-20261004195437-tzfx (2026-10-04): release-captain's turn ended with a
// result {subtype: 'success', is_error: true, result: 'API Error: Server error
// mid-response...'}. The runtime counted it as a normal end of turn and went
// idle, while the Claude CLI process stayed alive; the SDK only threw "returned
// an error result" when that process exited, 600 s later, and only then did the
// agent-restart start. An is_error result is a crashed turn: end the session at
// once so the restart path runs.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const role = { id: 'captain', title: 'Captain', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any;
const API_ERROR = 'API Error: Server error mid-response. The response above may be incomplete.';

/** A query whose CLI process outlives its error result until it is aborted. */
async function runWithErrorResult(result: Record<string, unknown>) {
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'err-result-')));
  const events: { type: string; reason?: string }[] = [];
  bus.subscribe((e) => events.push(e as { type: string; reason?: string }));
  const mailbox = new Mailbox();
  mailbox.push('m0');
  let signal: AbortSignal | undefined;
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      signal = options.abortController.signal;
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'result', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 }, ...result };
      // Stands in for the real 600 s wait: far longer than the test allows.
      await new Promise<void>((resolve) => setTimeout(resolve, 20_000).unref());
    })();
  const policy = new PolicyEngine('coder', {}, bus, '/work');
  const started = Date.now();
  let error: unknown;
  await runAgentSession({
    org: 'o', role, bus, policy, mailbox, cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
  } as any).catch((e) => { error = e; });
  return { error, events, elapsedMs: Date.now() - started, aborted: signal?.aborted === true };
}

describe('an is_error result ends the session at once', () => {
  it('throws the result text so the daemon restarts the role, without waiting for the CLI to exit', async () => {
    const { error, elapsedMs, aborted } = await runWithErrorResult({
      subtype: 'success', is_error: true, result: API_ERROR, total_cost_usd: 0.3,
    });
    expect(String((error as Error)?.message)).toContain(API_ERROR);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(aborted).toBe(true);
  }, 10_000);

  it('records the failed turn on the bus', async () => {
    const { events } = await runWithErrorResult({ subtype: 'success', is_error: true, result: API_ERROR });
    expect(events.some((e) => e.reason === 'session-result-error')).toBe(true);
  }, 10_000);
});
