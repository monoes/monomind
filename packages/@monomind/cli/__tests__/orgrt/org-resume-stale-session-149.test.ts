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
});
