/**
 * A Bash result that starts "bwrap: " is the OS sandbox failing to start, not
 * the command failing. On the 2.16.0 release run a QA role lost its shell for
 * ~7 minutes that way (31 such results in the run). Two in a row end the
 * role's process — a new one builds a new sandbox — and the session resumes;
 * once the restarts for a task are spent, the coordinator is told instead.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { MAX_SANDBOX_RESTARTS, isSandboxFault } from '../../src/orgrt/sandbox-fault.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const FAULT = "bwrap: Can't create file at /org/.gitconfig: Read-only file system";
const bash = (text: string) => ({ type: 'tool_result', tool: 'Bash', text, session_id: 'sess-1' });

type Script = (call: number) => { type: string; [k: string]: unknown }[];

/** Each process takes one message, then plays its script; `endAfter` closes
 *  the mailbox at the end of that call so the loop finishes. */
function scriptedRunner(script: Script, endAfter: number, mailbox: Mailbox) {
  const calls: { resume?: string; signal: AbortSignal; first?: string }[] = [];
  const runner = {
    run: async function* (args: any) {
      const call = calls.length;
      const it = args.prompt[Symbol.asyncIterator]();
      const first = await it.next();
      calls.push({ resume: args.resume, signal: args.signal, first: first.value?.message?.content });
      for (const m of script(call)) yield m;
      yield { type: 'result', subtype: 'success', session_id: 'sess-1' };
      if (call === endAfter) mailbox.close();
    },
  };
  return { runner, calls };
}

function setup(script: Script, endAfter: number, taskScope = false) {
  const def = OrgDefSchema.parse({
    name: 'x',
    ...(taskScope ? { run_config: { session_scope: 'task' } } : {}),
    roles: [{ id: 'boss' }, { id: 'qa', reports_to: 'boss' }],
  });
  const bus = new OrgBus('x', 'run-1', mkdtempSync(join(tmpdir(), 'sbx-')));
  const events: { type: string; reason?: string; data?: any }[] = [];
  bus.subscribe((e) => events.push(e as any));
  const mailbox = new Mailbox();
  mailbox.push(taskScope ? '[task:task-4] run the checks' : 'run the checks');
  const sent: { to: string; subject: string; body: string }[] = [];
  const { runner, calls } = scriptedRunner(script, endAfter, mailbox);
  const opts = {
    org: 'x', role: def.roles[1], bus, policy: new PolicyEngine('qa', {}, bus, '/tmp'), mailbox, cwd: '/tmp', def,
    deliver: async (_from: string, to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
      return 'ok';
    },
    runner,
  } as unknown as SessionOpts;
  return { opts, events, calls, sent };
}

const reasons = (events: { reason?: string }[], r: string) => events.filter((e) => e.reason === r);

describe('Bash sandbox faults', () => {
  it('recognises only a Bash result that starts with bwrap', () => {
    expect(isSandboxFault({ tool: 'Bash', text: FAULT })).toBe(true);
    expect(isSandboxFault({ tool: 'Bash', text: `ok\n${FAULT}` })).toBe(false);
    expect(isSandboxFault({ tool: 'Read', text: FAULT })).toBe(false);
  });

  it('two in a row end the process and resume the same session with a continuation', async () => {
    const { opts, events, calls } = setup((c) => (c === 0 ? [bash(FAULT), bash(FAULT), bash('never seen')] : [bash('ok')]), 1);
    await runAgentSession(opts);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true); // the first process was ended
    expect(calls[1].resume).toBe('sess-1');
    expect(calls[1].first).toMatch(/^\[system:turn-continue\].*sandbox/);
    expect(reasons(events, 'sandbox-fault')).toHaveLength(2);
    expect(reasons(events, 'sandbox-restart')).toHaveLength(1);
    expect(reasons(events, 'session-error')).toHaveLength(0);
    // the result after the second fault was never processed by the dead process
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(3);
  });

  it('in task scope, restarts that task’s session and resumes it', async () => {
    const { opts, events, calls } = setup((c) => (c === 0 ? [bash(FAULT), bash(FAULT)] : [bash('ok')]), 1, true);
    await runAgentSession(opts);
    expect(calls).toHaveLength(2);
    expect(calls[1].resume).toBe('sess-1');
    expect(reasons(events, 'sandbox-restart')[0].data.taskKey).toBe('task-4');
  });

  it('a working Bash call in between resets the count', async () => {
    const { opts, events, calls } = setup(() => [bash(FAULT), bash('ok'), bash(FAULT)], 0);
    await runAgentSession(opts);
    expect(calls).toHaveLength(1);
    expect(reasons(events, 'sandbox-fault')).toHaveLength(2);
    expect(reasons(events, 'sandbox-restart')).toHaveLength(0);
  });

  it('is bounded: after the restarts are spent the coordinator is told, once', async () => {
    const { opts, events, calls, sent } = setup(() => [bash(FAULT), bash(FAULT), bash(FAULT), bash(FAULT)], MAX_SANDBOX_RESTARTS);
    await runAgentSession(opts);
    expect(calls).toHaveLength(MAX_SANDBOX_RESTARTS + 1);
    expect(reasons(events, 'sandbox-restart')).toHaveLength(MAX_SANDBOX_RESTARTS);
    expect(reasons(events, 'sandbox-fault-exhausted')).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('boss');
    expect(sent[0].body).toMatch(/sandbox/);
  });
});
