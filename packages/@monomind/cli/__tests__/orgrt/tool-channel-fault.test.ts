/**
 * #331: on the 2.16.1 release run the publisher's tool calls began failing
 * with "Tool permission request failed: AbortError: Stream closed" — every
 * org tool, Read, and every Bash call that needed a permission decision —
 * while Bash calls allowed by a static rule kept working. The role could not
 * report, block or close its task, and ended its turn with the task open.
 *
 * Root cause: the SDK writes each prompt message to the CLI's stdin as soon as
 * the prompt iterable yields it, and once the iterable ENDS it closes stdin.
 * Permission requests and in-process MCP tool calls travel over that same
 * stdio channel, so closing it mid-turn kills them. The mailbox stream ended
 * mid-turn: its session_idle_exit_ms timer started when the SDK pulled for the
 * next message — right after handing it the current one — so a turn running
 * longer than the idle window (the publisher's npm-propagation waits) was cut.
 * A task-scope boundary (mail for another task arriving mid-turn) did the same.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { MAX_SANDBOX_RESTARTS, isChannelFault } from '../../src/orgrt/sandbox-fault.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const CHANNEL = 'Tool permission request failed: AbortError: Stream closed';
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Mailbox.stream: a live turn keeps the stream open', () => {
  it('the idle timer does not end the stream until the turn settles', async () => {
    const box = new Mailbox();
    box.push('work');
    const it = box.stream('', { idleExitMs: 20 })[Symbol.asyncIterator]();
    expect((await it.next()).value.message.content).toBe('work');
    let ended = false;
    const next = it.next().then((r) => {
      ended = r.done === true;
    });
    await tick(80); // four idle windows into a turn that has not settled
    expect(ended).toBe(false);
    box.observeTurn('result');
    await tick(10);
    expect(ended).toBe(false); // the idle window restarts when the turn settles
    await next;
    expect(ended).toBe(true);
    expect(box.lastStreamEnd).toBe('idle');
  });

  it('a message for another session is held until the turn settles', async () => {
    const box = new Mailbox();
    box.push('[task:a] one');
    const it = box
      .stream('', { stopBefore: (m) => m.startsWith('[task:b]') })
      [Symbol.asyncIterator]();
    await it.next();
    let ended = false;
    const next = it.next().then((r) => {
      ended = r.done === true;
    });
    box.push('[task:b] two');
    await tick(30);
    expect(ended).toBe(false);
    box.observeTurn('result');
    await next;
    expect(ended).toBe(true);
    expect(box.lastStreamEnd).toBe('boundary');
    expect(box.peek()).toBe('[task:b] two');
  });

  it('activity after a result (a queued turn the runner started) counts as live', async () => {
    const box = new Mailbox();
    box.push('a');
    const it = box.stream('', { idleExitMs: 20 })[Symbol.asyncIterator]();
    await it.next();
    let ended = false;
    const next = it.next().then((r) => {
      ended = r.done === true;
    });
    box.observeTurn('result');
    box.observeTurn('assistant');
    await tick(80);
    expect(ended).toBe(false);
    box.observeTurn('result');
    await next;
    expect(ended).toBe(true);
  });
});

/** Behaves like the SDK in the one respect that matters: it drains the prompt
 *  concurrently, and a permission-gated tool call fails once the prompt has
 *  ended (the SDK closed the CLI's stdin). */
function sdkLikeRunner(turnMs: number, midTurn?: () => void) {
  /** Per process: whether its prompt ended, and whether that happened mid-turn. */
  const runs: { inputEnded: boolean; inputEndedMidTurn?: boolean }[] = [];
  const runner = {
    run: async function* (args: any) {
      const run: (typeof runs)[number] = { inputEnded: false };
      runs.push(run);
      const got: string[] = [];
      (async () => {
        for await (const m of args.prompt) got.push(m.message.content);
        run.inputEnded = true;
      })();
      while (got.length === 0 && !run.inputEnded) await tick(2);
      if (got.length === 0) return;
      yield { type: 'assistant', text: 'working', session_id: 'sess-1' };
      if (runs.length === 1) midTurn?.();
      await tick(turnMs);
      run.inputEndedMidTurn = run.inputEnded;
      yield {
        type: 'tool_result',
        tool: 'mcp__org__org_send',
        text: run.inputEnded ? CHANNEL : 'sent',
        session_id: 'sess-1',
      };
      yield { type: 'result', subtype: 'success', session_id: 'sess-1' };
      while (!run.inputEnded) await tick(2);
    },
  };
  return { runner, runs };
}

function sessionFor(
  runConfig: Record<string, unknown>,
  first: string,
  makeRunner: (mailbox: Mailbox) => unknown,
) {
  const def = OrgDefSchema.parse({
    name: 'x',
    run_config: runConfig,
    roles: [{ id: 'boss' }, { id: 'pub', reports_to: 'boss' }],
  });
  const bus = new OrgBus('x', 'run-1', mkdtempSync(join(tmpdir(), 'chan-')));
  const events: { type: string; reason?: string; data?: any }[] = [];
  bus.subscribe((e) => events.push(e as any));
  const mailbox = new Mailbox();
  mailbox.push(first);
  const sent: { to: string; subject: string; body: string }[] = [];
  const opts = {
    org: 'x', role: def.roles[1], bus, policy: new PolicyEngine('pub', {}, bus, '/tmp'), mailbox, cwd: '/tmp', def,
    deliver: async (_from: string, to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
      return 'ok';
    },
    runner: makeRunner(mailbox),
  } as unknown as SessionOpts;
  return { opts, events, mailbox, sent };
}

describe('#331 root cause: the prompt stream outlives the turn', () => {
  it('session_idle_exit_ms shorter than a turn does not close the tool channel mid-turn', async () => {
    const { runner, runs } = sdkLikeRunner(80);
    const { opts, events, mailbox } = sessionFor({ session_idle_exit_ms: 20 }, 'publish', () => runner);
    const done = runAgentSession(opts);
    while (!runs[0]?.inputEnded) await tick(5);
    mailbox.close();
    await done;
    expect(runs[0].inputEndedMidTurn).toBe(false);
    expect(events.filter((e) => e.type === 'tool_result').map((e: any) => e.data.output)).toEqual(['sent']);
  });

  it('mail for another task arriving mid-turn does not close it either (task scope)', async () => {
    let runs: ReturnType<typeof sdkLikeRunner>['runs'] = [];
    const { opts, mailbox } = sessionFor({ session_scope: 'task' }, '[task:task-4] publish', (box) => {
      const r = sdkLikeRunner(60, () => box.push('[task:task-9] next one'));
      runs = r.runs;
      return r.runner;
    });
    const done = runAgentSession(opts);
    // task-9 got its own process, and finished its turn
    while (runs[1]?.inputEndedMidTurn === undefined) await tick(5);
    mailbox.close();
    await done;
    expect(runs[0].inputEndedMidTurn).toBe(false);
  });
});

// ── Recovery when the channel does close ─────────────────────────────────

type Script = (call: number) => { type: string; [k: string]: unknown }[];
const result = (tool: string, text: string) => ({ type: 'tool_result', tool, text, is_error: text === CHANNEL, session_id: 'sess-1' });

function scriptedRunner(script: Script, endAfter: number, mailbox: Mailbox) {
  const calls: { resume?: string; signal: AbortSignal; first?: string }[] = [];
  const runner = {
    run: async function* (args: any) {
      const call = calls.length;
      const first = await args.prompt[Symbol.asyncIterator]().next();
      calls.push({ resume: args.resume, signal: args.signal, first: first.value?.message?.content });
      for (const m of script(call)) yield m;
      yield { type: 'result', subtype: 'success', session_id: 'sess-1' };
      if (call === endAfter) mailbox.close();
    },
  };
  return { runner, calls };
}

function setup(script: Script, endAfter: number) {
  let calls: ReturnType<typeof scriptedRunner>['calls'] = [];
  const s = sessionFor({ session_scope: 'task' }, '[task:task-18] publish', (box) => {
    const r = scriptedRunner(script, endAfter, box);
    calls = r.calls;
    return r.runner;
  });
  return { ...s, calls };
}

const reasons = (events: { reason?: string }[], r: string) => events.filter((e) => e.reason === r);

describe('tool permission channel faults (#331)', () => {
  it('recognises the permission-stream failure on any tool, and nothing else', () => {
    expect(isChannelFault({ tool: 'mcp__org__org_send', text: CHANNEL })).toBe(true);
    expect(isChannelFault({ tool: 'Bash', text: CHANNEL })).toBe(true);
    expect(isChannelFault({ tool: 'Read', text: 'Tool permission request failed: Error: Stream closed' })).toBe(true);
    expect(isChannelFault({ tool: 'Bash', text: `echo "${CHANNEL}"\n${CHANNEL}` })).toBe(false);
    expect(isChannelFault({ tool: 'Bash', text: 'Stream closed' })).toBe(false);
  });

  it('one fault ends the process and resumes the same task session with a continuation', async () => {
    const { opts, events, calls } = setup(
      (c) => (c === 0 ? [result('Bash', 'alive'), result('mcp__org__org_send', CHANNEL), result('Bash', 'never seen')] : [result('mcp__org__org_send', 'sent')]),
      1,
    );
    await runAgentSession(opts);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].resume).toBe('sess-1');
    expect(calls[1].first).toMatch(/^\[system:turn-continue\].*tool permission channel/i);
    expect(reasons(events, 'channel-fault')).toHaveLength(1);
    const restart = reasons(events, 'channel-restart');
    expect(restart).toHaveLength(1);
    expect(restart[0].data.taskKey).toBe('task-18');
    expect(reasons(events, 'sandbox-restart')).toHaveLength(0);
    expect(reasons(events, 'session-error')).toHaveLength(0);
  });

  it('is bounded: after the restarts are spent the coordinator is told, once', async () => {
    const { opts, events, calls, sent } = setup(
      () => [result('mcp__org__org_send', CHANNEL), result('Read', CHANNEL)],
      MAX_SANDBOX_RESTARTS,
    );
    await runAgentSession(opts);
    expect(calls).toHaveLength(MAX_SANDBOX_RESTARTS + 1);
    expect(reasons(events, 'channel-restart')).toHaveLength(MAX_SANDBOX_RESTARTS);
    expect(reasons(events, 'channel-fault-exhausted')).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('boss');
    expect(sent[0].body).toMatch(/tool permission channel/i);
  });

  it('keeps separate budgets: channel restarts do not spend the sandbox ones', async () => {
    const BWRAP = "bwrap: Can't create file at /org/.gitconfig: Read-only file system";
    const { opts, events, calls } = setup(
      (c) =>
        c === 0
          ? [result('mcp__org__org_send', CHANNEL)]
          : c === 1
            ? [result('Bash', BWRAP), result('Bash', BWRAP)]
            : [result('Bash', 'ok')],
      2,
    );
    await runAgentSession(opts);
    expect(calls).toHaveLength(3);
    expect(reasons(events, 'channel-restart')).toHaveLength(1);
    expect(reasons(events, 'sandbox-restart')).toHaveLength(1);
    expect(calls[2].first).toMatch(/sandbox/);
  });
});
