/**
 * ADR-O001 D3 — cycle the process, keep the model session warm.
 *
 * Drives runAgentSession with a fake SDK that behaves like the real one in
 * the respects that matter here: it pulls one mailbox message per turn,
 * reports a session_id per query(), keeps a resumed session's id, and reports
 * total_cost_usd cumulatively per session.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { SessionLedger } from '../../src/orgrt/session-ledger.js';

const dir = () => mkdtempSync(join(tmpdir(), 'd3-sess-'));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await tick(5);
  }
}

interface Call {
  resume?: string;
  seen: string[];
}

/** Fake SDK: one session id per query() unless resumed; cost is cumulative per session. */
function fakeSdk(opts: { failResume?: Set<string> } = {}) {
  const calls: Call[] = [];
  const cost = new Map<string, number>();
  let n = 0;
  const queryFn = ({ prompt, options }: any) =>
    (async function* () {
      const call: Call = { resume: options?.resume, seen: [] };
      calls.push(call);
      if (options?.resume && opts.failResume?.has(options.resume)) throw new Error('session not found');
      const sid = options?.resume ?? `sid-${++n}`;
      yield { type: 'system', subtype: 'init', session_id: sid };
      for await (const msg of prompt) {
        call.seen.push(msg.message.content);
        const total = (cost.get(sid) ?? 0) + 1;
        cost.set(sid, total);
        yield { type: 'assistant', session_id: sid, message: { content: [{ type: 'text', text: 'ok' }] } };
        yield {
          type: 'result',
          subtype: 'success',
          session_id: sid,
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: total,
        };
      }
    })();
  return { queryFn, calls };
}

function opts(mailbox: Mailbox, queryFn: any, extra: Record<string, unknown> = {}) {
  const bus = new OrgBus('o', 'r', dir());
  const policy = new PolicyEngine('dev', {}, bus, '/work');
  return {
    bus,
    policy,
    sessionOpts: {
      org: 'o',
      role: { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss', responsibilities: [] } as any,
      bus,
      policy,
      mailbox,
      cwd: '/work',
      deliver: async () => 'delivered',
      queryFn,
      ...extra,
    },
  };
}

describe('D3 default (role scope) — no behaviour change', () => {
  it('serves every message, tagged or not, from ONE query() exactly as before', async () => {
    const sdk = fakeSdk();
    const mailbox = new Mailbox();
    mailbox.push('[task:task-1] a');
    mailbox.push('[task:task-2] b');
    mailbox.push('[task:task-1] a again');
    const { sessionOpts } = opts(mailbox, sdk.queryFn);
    const done = runAgentSession(sessionOpts);
    await tick();
    mailbox.close();
    await done;
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.calls[0].resume).toBeUndefined();
    expect(sdk.calls[0].seen).toEqual(['[task:task-1] a', '[task:task-2] b', '[task:task-1] a again']);
  });

  it('still records the session run (before/after) for audit', async () => {
    const sdk = fakeSdk();
    const mailbox = new Mailbox();
    mailbox.push('hello');
    const ledger = new SessionLedger();
    const { sessionOpts } = opts(mailbox, sdk.queryFn, { sessionLedger: ledger, resumeSessionId: undefined });
    const done = runAgentSession(sessionOpts);
    await tick();
    mailbox.close();
    await done;
    expect(ledger.runs()).toHaveLength(1);
    expect(ledger.runs()[0]).toMatchObject({ role: 'dev', taskKey: '_role', sessionIdAfter: 'sid-1' });
  });
});

describe("D3 task scope (run_config.session_scope: 'task')", () => {
  const def = {
    name: 'o',
    goal: 'g',
    roles: [{ id: 'boss' }, { id: 'dev', reports_to: 'boss' }],
    run_config: { session_scope: 'task' },
  } as any;

  it('one task across several dispatches gets ONE session; another task gets its own', async () => {
    const sdk = fakeSdk();
    const mailbox = new Mailbox();
    const ledger = new SessionLedger();
    mailbox.push('[task:task-1] a');
    mailbox.push('note about a');
    mailbox.push('[task:task-2] b');
    mailbox.push('[task:task-1] retry a');
    const { sessionOpts } = opts(mailbox, sdk.queryFn, { def, sessionLedger: ledger });
    const done = runAgentSession(sessionOpts);
    await tick(40);
    mailbox.close();
    await done;

    expect(sdk.calls.map((c) => c.seen)).toEqual([
      ['[task:task-1] a', 'note about a'],
      ['[task:task-2] b'],
      ['[task:task-1] retry a'],
    ]);
    expect(sdk.calls.map((c) => c.resume)).toEqual([undefined, undefined, 'sid-1']);
    const runs = ledger.runs();
    expect(runs.map((r) => [r.taskKey, r.sessionIdBefore, r.sessionIdAfter, r.resumed])).toEqual([
      ['task-1', undefined, 'sid-1', false],
      ['task-2', undefined, 'sid-2', false],
      ['task-1', 'sid-1', 'sid-1', true],
    ]);
  });

  it('meters cost as per-session deltas across session switches (no double count)', async () => {
    const sdk = fakeSdk();
    const mailbox = new Mailbox();
    mailbox.push('[task:task-1] a');
    mailbox.push('[task:task-2] b');
    mailbox.push('[task:task-1] a2');
    const { sessionOpts, policy } = opts(mailbox, sdk.queryFn, { def, sessionLedger: new SessionLedger() });
    const done = runAgentSession(sessionOpts);
    await tick(40);
    mailbox.close();
    await done;
    // Three results, each one real $1 of work — cumulative per session is 1, 1, then 2 on sid-1.
    expect(policy.usedUsd).toBe(3);
  });

  it('a stale resume for one task falls back to a fresh session without losing the message', async () => {
    const sdk = fakeSdk({ failResume: new Set(['gone']) });
    const mailbox = new Mailbox();
    const ledger = new SessionLedger();
    ledger.set({ role: 'dev', runtime: 'claude', taskKey: 'task-1', cwd: '/work', promptHash: '*', sessionId: 'gone' });
    mailbox.push('[task:task-1] a');
    const { sessionOpts, bus } = opts(mailbox, sdk.queryFn, { def, sessionLedger: ledger });
    const statuses: string[] = [];
    bus.subscribe((e) => {
      if (e.type === 'status' && e.reason) statuses.push(e.reason);
    });
    const done = runAgentSession(sessionOpts);
    await tick(40);
    mailbox.close();
    await done;
    expect(sdk.calls.map((c) => c.resume)).toEqual(['gone', undefined]);
    expect(sdk.calls[1].seen).toEqual(['[task:task-1] a']);
    expect(statuses).toContain('resume-session-stale');
  });

  it('never re-opens a query() while the mailbox is idle', async () => {
    const sdk = fakeSdk();
    const mailbox = new Mailbox();
    mailbox.push('[task:task-1] a');
    const { sessionOpts } = opts(mailbox, sdk.queryFn, {
      def: { ...def, run_config: { session_scope: 'task', session_idle_exit_ms: 10 } },
      sessionLedger: new SessionLedger(),
    });
    let cycled = 0;
    sessionOpts.bus.subscribe((e) => {
      if (e.reason === 'session-cycled') cycled++;
    });
    const done = runAgentSession(sessionOpts);
    await until(() => cycled === 1);
    await tick(40);
    expect(sdk.calls).toHaveLength(1); // exited on idle, did NOT respawn to park
    mailbox.push('more on a');
    await until(() => sdk.calls.length === 2 && sdk.calls[1].seen.length === 1);
    mailbox.close();
    await done;
    expect(sdk.calls.map((c) => c.resume)).toEqual([undefined, 'sid-1']); // woke and resumed the same session
    expect(sdk.calls[1].seen).toEqual(['more on a']);
  });
});
