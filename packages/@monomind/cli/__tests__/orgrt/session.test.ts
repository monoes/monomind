// packages/@monomind/cli/__tests__/orgrt/session.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession, buildRolePrompt } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess-'));

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

    await new Promise(r => setTimeout(r, 20));
    mailbox.push('m2');
    mailbox.close();
    await donePromise;

    expect(callCount).toBe(2);
    expect(seenResumeOptions[0]).toBeUndefined(); // first call: no prior session to resume
    expect(seenResumeOptions[1]).toBe('sdk-session-abc'); // restart: resumes the SDK's own session id
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
});
