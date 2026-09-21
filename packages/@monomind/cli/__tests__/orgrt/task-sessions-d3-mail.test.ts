/**
 * ADR-O001 D3 follow-up: untagged mail in task scope.
 *
 * A task's dispatch carries `[task:<id>]`, but mail does not, so it used to go
 * to whichever task session happened to be current — a reply about task-1
 * arriving while the role worked task-2 landed in task-2's session. Now a
 * task-scoped session tags the subject of what it sends, and inbound mail is
 * routed by a subject tag, else by which task last wrote to that sender.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { SessionLedger, mailRouteKey } from '../../src/orgrt/session-ledger.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe('mailRouteKey', () => {
  const corr = new Map([['boss', 'task-1']]);
  it('prefers a leading task tag, then a subject tag, then the correspondent', () => {
    expect(mailRouteKey('[task:task-9] do it', corr)).toBe('task-9');
    expect(mailRouteKey('[message from boss] subject: re: [task:task-2] q\n\nbody', corr)).toBe('task-2');
    expect(mailRouteKey('[message from boss] subject: re: q\n\nbody', corr)).toBe('task-1');
    expect(mailRouteKey('[message from qa] subject: hi\n\nbody', corr)).toBeUndefined();
    expect(mailRouteKey('[system:turn-continue] go on', corr)).toBeUndefined();
  });
  it('only reads the subject line, not a tag quoted in the body', () => {
    expect(mailRouteKey('[message from qa] subject: hi\n\n[task:task-5] quoted', corr)).toBeUndefined();
  });
});

describe('task-scoped mail routing through the session loop', () => {
  function harness(onFirstOf: Record<string, (seam: any) => Promise<void>>) {
    const calls: { resume?: string; seen: string[] }[] = [];
    let n = 0;
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        const call = { resume: options?.resume, seen: [] as string[] };
        calls.push(call);
        const sid = options?.resume ?? `sid-${++n}`;
        yield { type: 'system', subtype: 'init', session_id: sid };
        for await (const m of prompt) {
          const text: string = m.message.content;
          call.seen.push(text);
          const hook = Object.entries(onFirstOf).find(([k]) => text.startsWith(k))?.[1];
          if (hook) await hook(options._orgTest);
          yield { type: 'result', subtype: 'success', session_id: sid, usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const sent: { to: string; subject: string }[] = [];
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'd3-mail-')));
    const mailbox = new Mailbox();
    const opts = {
      org: 'o',
      role: { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss', responsibilities: [] } as any,
      bus,
      policy: new PolicyEngine('dev', {}, bus, '/work'),
      mailbox,
      cwd: '/work',
      deliver: async (_from: string, to: string, subject: string) => {
        sent.push({ to, subject });
        return 'delivered';
      },
      queryFn: queryFn as any,
      sessionLedger: new SessionLedger(),
    };
    return { calls, sent, mailbox, opts };
  }
  const taskDef = {
    name: 'o',
    goal: 'g',
    roles: [{ id: 'boss' }, { id: 'dev', reports_to: 'boss' }],
    run_config: { session_scope: 'task' },
  } as any;

  it("routes the boss's reply to the task that asked, not the current one", async () => {
    const h = harness({ '[task:task-1]': (seam) => seam.deliver('boss', 'question', 'which file?') });
    const done = runAgentSession({ ...h.opts, def: taskDef } as any);
    h.mailbox.push('[task:task-1] a');
    await tick(40);
    h.mailbox.push('[task:task-2] b');
    await tick(40);
    h.mailbox.push('[message from boss] subject: re: question\n\nsrc/a.ts');
    await tick(40);
    h.mailbox.close();
    await done;
    expect(h.sent).toEqual([{ to: 'boss', subject: '[task:task-1] question' }]);
    expect(h.calls.map((c) => c.seen)).toEqual([
      ['[task:task-1] a'],
      ['[task:task-2] b'],
      ['[message from boss] subject: re: question\n\nsrc/a.ts'],
    ]);
    expect(h.calls[2].resume).toBe('sid-1');
  });

  it('role scope (default) sends subjects untouched', async () => {
    const h = harness({ '[task:task-1]': (seam) => seam.deliver('boss', 'question', 'which file?') });
    const done = runAgentSession({ ...h.opts, def: { ...taskDef, run_config: {} } } as any);
    h.mailbox.push('[task:task-1] a');
    await tick(40);
    h.mailbox.close();
    await done;
    expect(h.sent).toEqual([{ to: 'boss', subject: 'question' }]);
  });
});
