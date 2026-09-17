import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess149-'));

describe('runAgentSession: stale checkpoint-resume session falls back to fresh (#149)', () => {
  it('retries once with a fresh session when the resumed session id fails, instead of crashing', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const statuses: string[] = [];
    bus.subscribe(e => { if (e.type === 'status') statuses.push(e.msg ?? ''); });
    const mailbox = new Mailbox();
    mailbox.push('resumed task');

    let callCount = 0;
    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      callCount++;
      if (options?.resume) {
        // Simulates the SDK rejecting a checkpoint-provided session id that
        // no longer exists on the provider's side (hours after `org stop`).
        throw new Error('session not found');
      }
      const it = prompt[Symbol.asyncIterator]();
      const { value, done } = await it.next();
      if (done) return; // no message yet — a real session would just wait
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `reply: ${value.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();

    const policy = new PolicyEngine('boss', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'boss', title: 'Boss', type: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
      resumeSessionId: 'stale-session-from-checkpoint',
    });

    await new Promise(r => setTimeout(r, 20));
    mailbox.close();
    await donePromise;

    expect(callCount).toBeGreaterThanOrEqual(2); // failed resume attempt, then a fresh retry
    expect(mailbox.isClosed).toBe(true); // closed because we closed it, not a crash
    expect(statuses.some(m => m.includes('retrying with a fresh session'))).toBe(true);
  });

  it('crashes normally (does not loop) if the fresh-session retry also fails', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const mailbox = new Mailbox();
    mailbox.push('resumed task');

    let callCount = 0;
    const fakeQuery = () => (async function* () {
      callCount++;
      throw new Error('provider unavailable');
    })();

    const policy = new PolicyEngine('boss', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'boss', title: 'Boss', type: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
      resumeSessionId: 'stale-session-from-checkpoint',
    });

    await expect(donePromise).rejects.toThrow('provider unavailable');
    expect(callCount).toBe(2); // one resume attempt, one fresh retry, then a real throw — no infinite loop
  });

  it('does not silently restart cold when the resumed session was live (replied) before it crashed (#247)', async () => {
    // A resume that worked and later crashed is a real crash, not a stale
    // session id: it must reach the daemon's crash-restart (which resumes
    // again) instead of being swallowed into a context-less fresh session.
    const bus = new OrgBus('o', 'r', dir());
    const mailbox = new Mailbox();
    mailbox.push('resumed task');

    const resumes: Array<string | undefined> = [];
    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      resumes.push(options?.resume);
      for await (const m of prompt) {
        yield { type: 'assistant', session_id: 'live-session', message: { content: [{ type: 'text', text: `reply: ${m.message.content}` }] } };
        throw new Error('connection reset mid-session');
      }
    })();

    const policy = new PolicyEngine('boss', {}, bus, '/work');
    const donePromise = runAgentSession({
      org: 'o', role: { id: 'boss', title: 'Boss', type: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
      resumeSessionId: 'live-session',
    });

    await expect(donePromise).rejects.toThrow('connection reset mid-session');
    expect(resumes).toEqual(['live-session']);
  });
});
