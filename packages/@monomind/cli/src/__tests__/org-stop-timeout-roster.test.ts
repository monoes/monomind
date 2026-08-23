/**
 * #152: when stopOrg()'s drain window (finishStop in daemon.ts) expires with
 * agent sessions still mid-turn, the audit event used to say only "proceeding
 * anyway" — no way for a run reviewer to tell whether real, in-progress work
 * (a mid-build, a mid-write) got force-stopped, or the window simply outlived
 * a couple of already-idle sessions.
 *
 * A real OrgDaemon + real OrgBus/Mailbox are used with a directly-injected
 * RunningOrg (`daemon.orgs` is `@internal`, not private) so the drain-timeout
 * roster logic runs for real — only the two AgentRuntime.done promises are
 * faked, since standing up real agent sessions would test the SDK instead of
 * this behaviour (same rationale as org-stopfile-poll.test.ts).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import { Mailbox } from '../orgrt/mailbox.js';
import type { BusEvent, OrgDef } from '../orgrt/types.js';

function fakeAgent(status: AgentRuntime['status'], done: Promise<void>): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    // finishStop() doesn't read policy/scrollback — untyped stand-ins are fine here.
    policy: {} as AgentRuntime['policy'],
    done,
    status,
    metrics: { tokens: 0, costUsd: 0 },
    scrollback: {
      push: () => {},
      all: () => [],
      snapshot: () => [],
    } as unknown as AgentRuntime['scrollback'],
  };
}

describe('finishStop reports which roles were still active at the drain timeout (#152)', () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('names the still-running role in the stop-timeout audit event, not the already-ended one', async () => {
    dir = mkdtempSync(join(tmpdir(), 'org-stop-roster-'));
    const daemon = new OrgDaemon(dir, { stopWaitMs: 30 });
    const bus = new OrgBus('testorg', 'run1', dir);
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    // 'busy-worker' never resolves within the 30ms drain window — mid-turn,
    // exactly the case a real still-building agent looks like. 'done-worker'
    // already resolved and flipped to 'ended' before stop was even called.
    const running: RunningOrg = {
      def: { name: 'testorg', roles: [] } as unknown as OrgDef,
      run: 'run1',
      bus,
      agents: new Map([
        ['busy-worker', fakeAgent('running', new Promise<void>(() => {}))],
        ['done-worker', fakeAgent('ended', Promise.resolve())],
      ]),
      busEvents: () => events,
    };
    daemon.orgs.set('testorg', running);

    await daemon.stopOrg('testorg');

    const timeoutEvent = events.find((e) => e.reason === 'stop-timeout');
    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.msg).toContain('busy-worker');
    expect(timeoutEvent?.msg).not.toContain('done-worker');
    expect((timeoutEvent?.data as { stillActive?: string[] } | undefined)?.stillActive).toEqual([
      'busy-worker',
    ]);
  });

  it('omits the roster suffix entirely when every role already ended before the timeout fires', async () => {
    dir = mkdtempSync(join(tmpdir(), 'org-stop-roster-'));
    const daemon = new OrgDaemon(dir, { stopWaitMs: 30 });
    const bus = new OrgBus('testorg2', 'run1', dir);
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    // Both agents are already 'ended', but their `done` promises resolve
    // just past the 30ms drain window — a timeout still fires (the drain
    // race lost by a hair), but nothing was actually cut off mid-work.
    const running: RunningOrg = {
      def: { name: 'testorg2', roles: [] } as unknown as OrgDef,
      run: 'run1',
      bus,
      agents: new Map([
        ['worker-a', fakeAgent('ended', new Promise<void>((r) => setTimeout(r, 200)))],
      ]),
      busEvents: () => events,
    };
    daemon.orgs.set('testorg2', running);

    await daemon.stopOrg('testorg2');

    const timeoutEvent = events.find((e) => e.reason === 'stop-timeout');
    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.msg).not.toContain('still active');
    expect((timeoutEvent?.data as { stillActive?: string[] } | undefined)?.stillActive).toEqual([]);
  });
});
