/**
 * An org_complete or org stop aborts every live session. That is a normal
 * stop: session.ts used to announce it as "session ended with an error", and
 * the turn in flight never got a usage event because its 'result' never came.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

/** Answers the first message with one metered turn, then works until aborted. */
function midTurnRunner(started: () => void) {
  return {
    run: async function* (args: any) {
      for await (const _ of args.prompt) {
        yield { type: 'assistant', text: 'on it', input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000 };
        started();
        await new Promise<void>((r) => args.signal.addEventListener('abort', () => r(), { once: true }));
        const err = new Error('Claude Code process aborted by user');
        err.name = 'AbortError';
        throw err;
      }
    },
  };
}

function setup(runner: unknown) {
  const def = OrgDefSchema.parse({ name: 'x', roles: [{ id: 'worker' }] });
  const bus = new OrgBus('x', 'run-1', mkdtempSync(join(tmpdir(), 'stop-abort-')));
  const events: { type: string; reason?: string; msg?: string; data?: any }[] = [];
  bus.subscribe((e) => events.push(e as any));
  const mailbox = new Mailbox();
  mailbox.push('do the thing');
  const external = new AbortController();
  const policy = new PolicyEngine('worker', {}, bus, '/tmp');
  const opts = {
    org: 'x', role: def.roles[0], bus, policy, mailbox, cwd: '/tmp', def,
    deliver: async () => 'ok', externalAbort: external, runner,
  } as unknown as SessionOpts;
  return { opts, events, mailbox, external, policy };
}

describe('a session aborted by the org stopping', () => {
  it('is reported as a normal stop and still records the aborted turn’s usage', async () => {
    let started = false;
    const { opts, events, mailbox, external, policy } = setup(midTurnRunner(() => (started = true)));
    const p = runAgentSession(opts);
    p.catch(() => {});
    await vi.waitFor(() => expect(started).toBe(true));
    mailbox.close();
    external.abort();
    await expect(p).rejects.toThrow(/aborted/);
    expect(events.some((e) => e.reason === 'session-error')).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.reason === 'session-stopped')).toBe(true);
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0].data).toMatchObject({ tokens: 1120, tokens_in: 100, tokens_out: 20, cache_read: 1000, subtype: 'aborted' });
    expect(policy.usage).toBe(1120); // counted once, not again by the usage event
  });

  it('a genuine crash is still an error breadcrumb, and its partial turn is recorded too', async () => {
    const runner = {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          yield { type: 'assistant', text: 'on it', input_tokens: 5, output_tokens: 5 };
          throw new Error('socket hang up');
        }
      },
    };
    const { opts, events } = setup(runner);
    await expect(runAgentSession(opts)).rejects.toThrow(/socket hang up/);
    expect(events.some((e) => e.reason === 'session-error')).toBe(true);
    expect(events.some((e) => e.reason === 'session-stopped')).toBe(false);
    expect(events.filter((e) => e.type === 'usage').map((e) => e.data.tokens)).toEqual([10]);
  });
});
