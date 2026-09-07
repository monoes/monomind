import { describe, it, expect } from 'vitest';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

function baseOpts(externalAbort: AbortController, signalSeen: AbortSignal[]): SessionOpts {
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
    runner: {
      run: async function* (args: any) {
        signalSeen.push(args.signal!);
        // Park until the mailbox stream ends (drain) or abort fires.
        for await (const _m of args.prompt) {
          /* drain the prompt without yielding any SDK messages */
        }
      },
    } as any,
  } as unknown as SessionOpts;
}

describe('SessionOpts.externalAbort', () => {
  it("passes the SAME AbortController's signal through to the runner instead of an internal one", async () => {
    const external = new AbortController();
    const signalSeen: AbortSignal[] = [];
    const opts = baseOpts(external, signalSeen);
    const p = runAgentSession(opts);
    opts.mailbox.beginDrain();
    await p;
    expect(signalSeen).toHaveLength(1);
    expect(signalSeen[0]).toBe(external.signal);
  });
});
