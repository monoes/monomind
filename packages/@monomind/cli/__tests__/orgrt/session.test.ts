// packages/@monomind/cli/__tests__/orgrt/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import {
  runAgentSession,
  buildOrgTools,
  buildRolePrompt,
  type SessionOpts,
} from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess-'));

describe('buildOrgTools', () => {
  it('only exposes task tools whose callbacks are available', () => {
    const tools = buildOrgTools({
      org: 'o',
      role: { id: 'coder', title: 'Coder', type: 'specialist', responsibilities: [] } as any,
      bus: {} as OrgBus,
      policy: {} as PolicyEngine,
      mailbox: {} as Mailbox,
      cwd: '/work',
      deliver: async () => 'delivered',
      createTask: () => 'created',
    } satisfies SessionOpts);

    expect(tools.map((tool) => tool.name)).toContain('org_task');
    expect(tools.map((tool) => tool.name)).not.toContain('org_task_done');
    expect(tools.map((tool) => tool.name)).not.toContain('org_tasks');
  });
});

describe('runAgentSession', () => {
  it('emits chat events for assistant text and usage on result', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const events: string[] = [];
    bus.subscribe(e => events.push(e.type));
    const mailbox = new Mailbox();
    mailbox.push('do the thing'); mailbox.close();

    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      // drain input like the real SDK does
      for await (const _ of prompt) break;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    expect(events).toContain('chat');
    expect(events).toContain('usage');
    expect(policy.usage).toBe(15);
  });

  it('restarts the SDK session when it ends on its own (maxTurns) while the mailbox is still open, instead of deadlocking', async () => {
    // Regression: maxTurns bounds ONE query() call's total turns, and that one
    // call stays open across every mailbox message for the role's whole life —
    // so hitting the limit used to end the session for good (status 'ended',
    // no crash, no alert) while deliver() kept queuing into a mailbox nobody
    // was reading anymore. Simulate that by having the fake SDK consume
    // exactly one message per invocation and then end, as if maxTurns had cut
    // it off after a single turn — a real fix must call queryFn again.
    const bus = new OrgBus('o', 'r', dir());
    const chats: string[] = [];
    const statuses: string[] = [];
    bus.subscribe(e => {
      if (e.type === 'chat') chats.push(e.msg ?? '');
      if (e.type === 'status') statuses.push(e.msg ?? '');
    });
    const mailbox = new Mailbox();
    mailbox.push('m1');

    let callCount = 0;
    const fakeQuery = ({ prompt }: any) => (async function* () {
      callCount++;
      const it = prompt[Symbol.asyncIterator]();
      const { value } = await it.next(); // consume exactly one message, like a maxTurns-truncated session
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `reply-${callCount}: ${value.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      // generator ends here without draining further input — session "ended" on its own
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    // let the first (truncated) session run to completion and the restart fire
    await new Promise(r => setTimeout(r, 20));
    expect(mailbox.isClosed).toBe(false); // still open — deliver() would still be accepted
    mailbox.push('m2');
    mailbox.close();
    await donePromise;

    expect(callCount).toBe(2); // queryFn was invoked twice — proves an actual restart, not a stall
    expect(chats).toEqual(['reply-1: m1', 'reply-2: m2']);
    expect(statuses).toContain('session restarting (turn limit reached, mailbox still open)');
  });

  it('resumes the SDK conversation on maxTurns restart instead of starting fresh', async () => {
    // Regression: runOneSession's restart used to call queryFn again with no
    // memory of the prior SDK session, so the role lost all in-progress
    // reasoning/context on every maxTurns cutoff. The fix must capture the
    // session_id the SDK reports and pass it back as `resume` on the next call.
    const bus = new OrgBus('o', 'r', dir());
    const mailbox = new Mailbox();
    mailbox.push('m1');

    const seenResumeOptions: (string | undefined)[] = [];
    let callCount = 0;
    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      callCount++;
      seenResumeOptions.push(options.resume);
      const it = prompt[Symbol.asyncIterator]();
      await it.next(); // consume exactly one message, like a maxTurns-truncated session
      yield { type: 'result', subtype: 'error_max_turns', usage: { input_tokens: 1, output_tokens: 1 }, session_id: 'sdk-session-abc' };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    // Let the first session (m1) run and the turn-limit continuation drive a
    // restart that resumes the SDK session id, then close to stop the loop.
    await new Promise(r => setTimeout(r, 20));
    mailbox.close();
    await donePromise;

    expect(callCount).toBeGreaterThanOrEqual(2); // at least one restart happened
    expect(seenResumeOptions[0]).toBeUndefined(); // first call: no prior session to resume
    expect(seenResumeOptions[1]).toBe('sdk-session-abc'); // restart resumes the SDK's own session id
  });

  it('pushes a turn-limit continuation so a capped role resumes instead of parking idle', async () => {
    // The fix for the 10-minute stall: a session that ends on maxTurns (mailbox
    // still open) gets a continuation pushed so the restarted query() has input
    // to act on immediately, instead of blocking on an empty mailbox until the
    // idle watchdog.
    const bus = new OrgBus('o', 'r', dir());
    const statuses: string[] = [];
    bus.subscribe(e => { if (e.type === 'status') statuses.push(e.reason ?? e.msg ?? ''); });
    const mailbox = new Mailbox();
    mailbox.push('m1');

    const fakeQuery = ({ prompt }: any) => (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const { value } = await it.next();
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `got ${value?.message?.content}` }] } };
      yield { type: 'result', subtype: 'error_max_turns', usage: { input_tokens: 1, output_tokens: 1 } };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    await new Promise(r => setTimeout(r, 20));
    mailbox.close();
    await donePromise;

    expect(statuses).toContain('turn-limit-resume'); // continuation was pushed
  });

  it('bounds self-continuation when a role spins on the turn limit without new input', async () => {
    // Safety: a role that hits maxTurns every turn and gets no real message must
    // not re-engage forever on its own continuation pushes (a token-burn loop).
    // After a few no-progress continuations it parks for the idle watchdog.
    const bus = new OrgBus('o', 'r', dir());
    const mailbox = new Mailbox();
    mailbox.push('m1'); // the only real message

    let callCount = 0;
    const fakeQuery = ({ prompt }: any) => (async function* () {
      callCount++;
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: 'result', subtype: 'error_max_turns', usage: { input_tokens: 1, output_tokens: 1 } };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    await new Promise(r => setTimeout(r, 30)); // long enough to spin through continuations and park
    expect(mailbox.isClosed).toBe(false); // parked (waiting for the watchdog), not crashed/closed
    mailbox.close();
    await donePromise;

    // m1 + at most MAX_CONTINUATIONS(3) no-progress continuations + 1 parked call.
    // Without the bound this hangs (unbounded self-continuation).
    expect(callCount).toBeLessThanOrEqual(6);
  });

  it('aborts a silent SDK session instead of hanging on it forever (issue #59: scheduled cycles opened a stream and got zero messages back)', async () => {
    // Regression for orgrt#59: 9 of 11 scheduled cycles opened an SDK stream
    // that never yielded anything - no assistant message, no result, no
    // error, no end - and the only recovery was the org-wide idle watchdog
    // 20 minutes later, which kills the whole run. A stalled first pull must
    // instead be treated as a failure so the caller's crash-retry-with-backoff
    // loop gets a chance to recover within the same cycle.
    vi.useFakeTimers();
    try {
      const bus = new OrgBus('o', 'r', dir());
      const audits: string[] = [];
      bus.subscribe(e => { if (e.type === 'audit') audits.push(e.reason ?? ''); });
      const mailbox = new Mailbox();
      mailbox.push('do the thing');

      // Fake SDK that opens a stream and never yields anything, ever - the
      // exact failure mode reported in the issue.
      const fakeQuery = () => (async function* () {
        await new Promise<void>(() => { /* never resolves */ });
      })();

      const policy = new PolicyEngine('coder', {}, bus, '/work');
      const donePromise = runAgentSession({
        org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
        bus, policy, mailbox, cwd: '/work',
        deliver: async () => 'delivered',
        queryFn: fakeQuery as any,
      });
      donePromise.catch(() => { /* asserted via rejects below */ });

      await vi.advanceTimersByTimeAsync(4 * 60_000 + 3_000);

      expect(audits).toContain('session-silent');
      await expect(donePromise).rejects.toThrow(/silent/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits per-result cost DELTAS, not the SDK\'s cumulative session total_cost_usd', async () => {
    // Regression: in streaming-input mode one query() call emits one result
    // per mailbox message, and each result's total_cost_usd is the CUMULATIVE
    // cost of the whole SDK session. daemon.ts and reporting.ts sum usage
    // events, so forwarding the raw cumulative value re-charged every previous
    // turn on each new message (~10-20x inflation on long org runs). The
    // emitted cost_usd must be the delta since the previous result.
    const bus = new OrgBus('o', 'r', dir());
    const costs: (number | undefined)[] = [];
    bus.subscribe(e => { if (e.type === 'usage') costs.push((e.data as { cost_usd?: number }).cost_usd); });
    const mailbox = new Mailbox();
    mailbox.push('m1');
    mailbox.push('m2');
    mailbox.push('m3');
    mailbox.close();

    const fakeQuery = ({ prompt }: any) => (async function* () {
      let cumulative = 0;
      for await (const _ of prompt) {
        cumulative += 0.5;
        yield { type: 'result', subtype: 'success', session_id: 'sdk-sess-1', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: cumulative };
      }
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    expect(costs).toEqual([0.5, 0.5, 0.5]); // deltas summing to 1.5, not cumulative 0.5+1.0+1.5=3.0
  });

  it('treats a fresh SDK session id as a new cost baseline (no negative deltas)', async () => {
    // A maxTurns restart resumes the same session id (cumulative continues),
    // but a genuinely new session id starts its own cumulative total — the
    // first result of the new session must count in full.
    const bus = new OrgBus('o', 'r', dir());
    const costs: (number | undefined)[] = [];
    bus.subscribe(e => { if (e.type === 'usage') costs.push((e.data as { cost_usd?: number }).cost_usd); });
    const mailbox = new Mailbox();
    mailbox.push('m1');

    let callCount = 0;
    const fakeQuery = ({ prompt }: any) => (async function* () {
      callCount++;
      const it = prompt[Symbol.asyncIterator]();
      await it.next(); // consume one message, then the session "ends" like a crash/maxTurns cutoff
      // Each query() call is its own SDK session with its own cumulative total.
      yield { type: 'result', subtype: 'success', session_id: `sdk-sess-${callCount}`, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.5 };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    await new Promise(r => setTimeout(r, 20)); // first session ends, restart fires
    mailbox.push('m2');
    mailbox.close();
    await donePromise;

    expect(costs.reduce((a, c) => (a ?? 0) + (c ?? 0), 0)).toBeCloseTo(1.0); // 0.5 per session, both counted
  });

  it('floors the delta at 0 on a same-session cost dip instead of re-adding the full cumulative value', async () => {
    // Regression (mastermind:review finding): the SAME session_id can report
    // a total_cost_usd that ticks down between results (float rounding, a
    // provider-side cost correction) without the session having restarted.
    // The old code treated any decrease as "session restarted" and re-added
    // the full cumulative value as the delta — since this feeds real USD
    // budget enforcement (ORG-7, policy.addUsageUsd -> overBudgetUsd closes
    // the mailbox), that could massively over-count usage and incorrectly
    // kill a well-behaved, still-under-budget session.
    const bus = new OrgBus('o', 'r', dir());
    const costs: (number | undefined)[] = [];
    bus.subscribe(e => { if (e.type === 'usage') costs.push((e.data as { cost_usd?: number }).cost_usd); });
    const mailbox = new Mailbox();
    mailbox.push('m1');
    mailbox.push('m2');
    mailbox.close();

    const totals = [1.0, 0.9999999999]; // same sid, tiny float-rounding dip on the 2nd result
    let i = 0;
    const fakeQuery = ({ prompt }: any) => (async function* () {
      for await (const _ of prompt) {
        yield { type: 'result', subtype: 'success', session_id: 'sdk-sess-stable', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: totals[i++] };
      }
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    expect(costs[0]).toBeCloseTo(1.0); // first result: full cumulative
    expect(costs[1]).toBe(0); // dip floored at 0, NOT re-added as ~1.0 (which would ~double-count usage)
  });

  it('buildRolePrompt names the role, goal, and org_send protocol', () => {
    const p = buildRolePrompt(
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: ['write code'] } as any,
      { name: 'my-org', goal: 'ship v2' } as any,
      ['boss', 'coder', 'tester'],
    );
    expect(p).toContain('coder');
    expect(p).toContain('ship v2');
    expect(p).toContain('org_send');
    expect(p).toContain('boss, coder, tester');
    expect(p).toContain('ask_human');
  });

  it('buildRolePrompt includes extraGuidance when provided, between responsibilities and the communication protocol', () => {
    const p = buildRolePrompt(
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: ['write code'] } as any,
      { name: 'my-org', goal: 'ship v2' } as any,
      ['boss', 'coder'],
      undefined,
      'ALWAYS write tests first.',
    );
    expect(p).toContain('ALWAYS write tests first.');
    expect(p.indexOf('ALWAYS write tests first.')).toBeLessThan(p.indexOf('## Communication protocol'));
  });

  it('buildRolePrompt omits any extraGuidance block when not provided', () => {
    const p = buildRolePrompt(
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      { name: 'my-org', goal: 'ship v2' } as any,
      ['boss', 'coder'],
    );
    // no stray blank paragraph from a falsy extraGuidance slot
    expect(p).not.toMatch(/\n\n\n/);
  });
});

describe('resolveRoleExtraGuidance', () => {
  it('returns the built-in archetype skill when role.ui.icon matches a bundled file', async () => {
    const { resolveRoleExtraGuidance } = await import('../../src/orgrt/session.js');
    // "coder" is one of the 111 bundled archetypes shipped in src/orgrt/role-skills/.
    const text = resolveRoleExtraGuidance({ id: 'x', ui: { icon: 'coder' } } as any);
    expect(text).toBeTruthy();
    expect(text).toContain('Best Practices');
  });

  it('returns undefined for a role with no ui.icon and no instructions_file', async () => {
    const { resolveRoleExtraGuidance } = await import('../../src/orgrt/session.js');
    expect(resolveRoleExtraGuidance({ id: 'x' } as any)).toBeUndefined();
  });

  it('returns undefined (not a throw) for an unknown ui.icon', async () => {
    const { resolveRoleExtraGuidance } = await import('../../src/orgrt/session.js');
    expect(resolveRoleExtraGuidance({ id: 'x', ui: { icon: 'totally-not-a-real-archetype' } } as any)).toBeUndefined();
  });

  it('includes instructions_file content, and combines it with the built-in skill when both are present', async () => {
    const { resolveRoleExtraGuidance } = await import('../../src/orgrt/session.js');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'instr-')), 'notes.md');
    writeFileSync(path, 'Follow the client\'s custom style guide.');

    const both = resolveRoleExtraGuidance({ id: 'x', ui: { icon: 'coder' }, instructions_file: path } as any);
    expect(both).toContain('Best Practices');
    expect(both).toContain('Follow the client');

    const customOnly = resolveRoleExtraGuidance({ id: 'x', instructions_file: path } as any);
    expect(customOnly).toContain('Follow the client');
    expect(customOnly).not.toContain('Best Practices');
  });

  it('does not throw when instructions_file points at a nonexistent path — just skips it', async () => {
    const { resolveRoleExtraGuidance } = await import('../../src/orgrt/session.js');
    expect(() =>
      resolveRoleExtraGuidance({ id: 'x', instructions_file: '/nonexistent/path/notes.md' } as any),
    ).not.toThrow();
    expect(resolveRoleExtraGuidance({ id: 'x', instructions_file: '/nonexistent/path/notes.md' } as any)).toBeUndefined();
  });
});
