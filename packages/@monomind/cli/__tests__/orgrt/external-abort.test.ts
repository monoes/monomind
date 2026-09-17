import { describe, it, expect, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

function baseOpts(externalAbort: AbortController, runner: unknown): SessionOpts {
  const def = OrgDefSchema.parse({ name: 'x', roles: [{ id: 'worker' }] });
  const mailbox = new Mailbox();
  const bus = new OrgBus('x', 'run-1', '/tmp');
  const policy = new PolicyEngine('worker', { maxTokens: 1000 }, bus, '/tmp');
  return {
    org: 'x',
    role: def.roles[0],
    bus,
    policy,
    mailbox,
    cwd: '/tmp',
    def,
    deliver: async () => 'ok',
    externalAbort,
    runner,
  } as unknown as SessionOpts;
}

/** A subprocess-style runner: the first `silentAttempts` attempts never yield
 *  and only unblock when their abort signal fires; later attempts echo. */
function recordingRunner(signalSeen: AbortSignal[], silentAttempts: number) {
  return {
    run: async function* (args: any) {
      signalSeen.push(args.signal!);
      if (signalSeen.length <= silentAttempts) {
        await new Promise<void>((r) => args.signal.addEventListener('abort', () => r(), { once: true }));
        throw new Error('child killed');
      }
      for await (const m of args.prompt) {
        yield { type: 'assistant', text: `echo: ${m.message.content}` };
      }
    },
  };
}

describe('SessionOpts.externalAbort', () => {
  it("aborting the caller's controller (org stop / forced respawn) aborts the in-flight attempt's signal", async () => {
    const external = new AbortController();
    const signalSeen: AbortSignal[] = [];
    const opts = baseOpts(external, recordingRunner(signalSeen, 1));
    const p = runAgentSession(opts);
    p.catch(() => {
      /* asserted below */
    });
    await vi.waitFor(() => expect(signalSeen).toHaveLength(1));
    expect(signalSeen[0].aborted).toBe(false);
    external.abort();
    expect(signalSeen[0].aborted).toBe(true);
    await expect(p).rejects.toThrow(/child killed/);
  });

  it("a silent attempt aborts only its own signal: the caller's controller stays live and the retry starts with a live signal (#256)", async () => {
    vi.useFakeTimers();
    try {
      const external = new AbortController();
      const signalSeen: AbortSignal[] = [];
      const opts = baseOpts(external, recordingRunner(signalSeen, 1));
      opts.mailbox.push('do the thing');

      const first = runAgentSession(opts);
      first.catch(() => {
        /* asserted below */
      });
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 3_000);
      await expect(first).rejects.toThrow(/silent/i);
      expect(signalSeen[0].aborted).toBe(true);
      expect(external.signal.aborted).toBe(false);

      // The daemon's crash-retry calls runAgentSession again with the same
      // externalAbort - that attempt must not inherit the silent abort.
      const chats: string[] = [];
      opts.bus.subscribe((e) => {
        if (e.type === 'chat') chats.push(e.msg ?? '');
      });
      const second = runAgentSession(opts);
      await vi.advanceTimersByTimeAsync(10);
      expect(signalSeen).toHaveLength(2);
      expect(signalSeen[1].aborted).toBe(false);
      expect(chats).toContain('echo: do the thing');
      opts.mailbox.beginDrain();
      await vi.advanceTimersByTimeAsync(10);
      await second;
      expect(external.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave abort listeners on the caller's controller across attempts", async () => {
    vi.useFakeTimers();
    try {
      const external = new AbortController();
      const signalSeen: AbortSignal[] = [];
      const opts = baseOpts(external, recordingRunner(signalSeen, 3));
      opts.mailbox.push('do the thing');
      for (let i = 0; i < 3; i++) {
        const attempt = runAgentSession(opts);
        attempt.catch(() => {
          /* asserted below */
        });
        await vi.advanceTimersByTimeAsync(4 * 60_000 + 3_000);
        await expect(attempt).rejects.toThrow(/silent/i);
      }
      expect(signalSeen).toHaveLength(3);
      expect(getEventListeners(external.signal, 'abort')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
