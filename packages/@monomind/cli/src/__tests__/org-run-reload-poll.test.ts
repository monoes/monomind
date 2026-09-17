/**
 * `monomind org reload` must reach an org hosted by a foreground `org run`.
 *
 * The original defect: `org reload` wrote `.monomind/orgs/<name>/reload` and
 * printed "the daemon picks it up within ~2s", but only `org serve` polled
 * that file. Against `org run` — the way mono-agent starts orgs — the command
 * exited 0 and nothing reloaded, so a rotated automation-role endpoint kept
 * receiving deliveries at the old URL until that URL went dead (found in a
 * no-model mono-agent run against 2.11.0).
 *
 * A stub daemon is used, as in org-stopfile-poll.test.ts: the behaviour under
 * test is the run loop's file contract, not agent orchestration.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orgCommand, waitForRunEnd } from '../commands/org.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';

// Only runAction (the last describe) constructs an OrgDaemon; the waitForRunEnd
// tests pass their own stub, so this mock does not affect them.
const fakeDaemon = vi.hoisted(() => ({ ticksRunning: 0, reloads: 0 }));
vi.mock('../orgrt/daemon.js', () => ({
  OrgDaemon: class {
    startOrg = async () => ({ def: { roles: [] }, run: 'run-1' });
    // Hosts the org for `ticksRunning` wait-loop ticks, then reports it gone.
    getOrg = () => (fakeDaemon.ticksRunning-- > 0 ? {} : undefined);
    listRunning = () => ['growth'];
    reloadOrgDef = () => {
      fakeDaemon.reloads++;
      return { changed: [], newRoles: [], removedRoles: [] };
    };
    stopAll = async () => {};
    persistCrashStateAll = () => {};
  },
}));

const TICK = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubDaemon(name: string, opts: { failReload?: boolean } = {}) {
  const state = { running: true, reloads: 0 };
  const daemon = {
    getOrg: (n: string) => (state.running && n === name ? ({} as never) : undefined),
    listRunning: () => (state.running ? [name] : []),
    reloadOrgDef: (n: string) => {
      if (opts.failReload) throw new Error('org def invalid');
      state.reloads++;
      return { changed: [`role:${n}-bot:endpoint`], newRoles: [], removedRoles: [] };
    },
  };
  return { daemon: daemon as unknown as OrgDaemon, state };
}

describe('org run applies org reload', () => {
  let cwd: string;
  const signal = (name: string, file: 'reload' | 'stop') => {
    mkdirSync(join(cwd, ORG_DIR, name), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, name, file), new Date().toISOString());
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-run-reload-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('reloads the running org once per request and consumes the file', async () => {
    const { daemon, state } = stubDaemon('growth');
    const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);

    signal('growth', 'reload');
    await sleep(TICK * 6);
    expect(state.reloads).toBe(1);
    expect(existsSync(join(cwd, ORG_DIR, 'growth', 'reload'))).toBe(false);

    signal('growth', 'reload');
    await sleep(TICK * 6);
    expect(state.reloads).toBe(2);

    state.running = false;
    await expect(wait).resolves.toEqual({ stoppedManually: false });
  });

  it('does not reload when no request was written', async () => {
    const { daemon, state } = stubDaemon('growth');
    const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);
    await sleep(TICK * 5);
    state.running = false;
    await wait;
    expect(state.reloads).toBe(0);
  });

  it('keeps running when a reload fails, and still consumes the request', async () => {
    const { daemon, state } = stubDaemon('growth', { failReload: true });
    const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);
    signal('growth', 'reload');
    await sleep(TICK * 6);
    expect(existsSync(join(cwd, ORG_DIR, 'growth', 'reload'))).toBe(false);
    state.running = false;
    await expect(wait).resolves.toEqual({ stoppedManually: false });
  });

  it('still ends on org stop, reporting a manual stop', async () => {
    const { daemon } = stubDaemon('growth');
    const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);
    signal('growth', 'stop');
    await expect(wait).resolves.toEqual({ stoppedManually: true });
  });

  it('ends on SIGINT as a non-manual stop and removes both signal listeners', async () => {
    // Detach anything else listening (the test runner) so emitting SIGINT only
    // reaches the wait loop, and so the counts below are exactly ours.
    const others = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    try {
      const { daemon, state } = stubDaemon('growth');
      const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);
      expect(process.listenerCount('SIGINT')).toBe(1);
      expect(process.listenerCount('SIGTERM')).toBe(1);

      process.emit('SIGINT');
      await expect(wait).resolves.toEqual({ stoppedManually: false });
      expect(process.listenerCount('SIGINT')).toBe(0);
      expect(process.listenerCount('SIGTERM')).toBe(0);
      expect(state.reloads).toBe(0);
    } finally {
      for (const l of others.SIGINT) process.on('SIGINT', l as NodeJS.SignalsListener);
      for (const l of others.SIGTERM) process.on('SIGTERM', l as NodeJS.SignalsListener);
    }
  });

  it('lets the stop win when stop and reload arrive in the same tick', async () => {
    const { daemon, state } = stubDaemon('growth');
    signal('growth', 'reload');
    signal('growth', 'stop');
    await expect(waitForRunEnd(cwd, 'growth', daemon, TICK)).resolves.toEqual({
      stoppedManually: true,
    });
    expect(state.reloads).toBe(0);
    // The request is left behind — the next `org run` must clear it at start
    // (covered below).
    expect(existsSync(join(cwd, ORG_DIR, 'growth', 'reload'))).toBe(true);
  });

  it('does not leave signal listeners behind', async () => {
    const before = process.listenerCount('SIGINT');
    const { daemon, state } = stubDaemon('growth');
    const wait = waitForRunEnd(cwd, 'growth', daemon, TICK);
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    state.running = false;
    await wait;
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});

describe('org run start', () => {
  let cwd: string;
  const savedEnv = {
    MONOMIND_NO_LOCAL_EMBEDDINGS: process.env.MONOMIND_NO_LOCAL_EMBEDDINGS,
    MONOMIND_RERANKER: process.env.MONOMIND_RERANKER,
  };
  let savedListeners: { uncaught: unknown[]; unhandled: unknown[] };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-run-start-'));
    savedListeners = {
      uncaught: process.listeners('uncaughtException'),
      unhandled: process.listeners('unhandledRejection'),
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // runAction installs process-exiting crash handlers; don't leak them into the worker.
    for (const l of process.listeners('uncaughtException'))
      if (!savedListeners.uncaught.includes(l)) process.removeListener('uncaughtException', l);
    for (const l of process.listeners('unhandledRejection'))
      if (!savedListeners.unhandled.includes(l)) process.removeListener('unhandledRejection', l);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('clears a reload request left by a previous run instead of applying it', async () => {
    mkdirSync(join(cwd, ORG_DIR, 'growth'), { recursive: true });
    writeFileSync(
      join(cwd, ORG_DIR, 'growth.json'),
      JSON.stringify({ name: 'growth', roles: [{ id: 'boss', reports_to: null }] }),
    );
    // e.g. the previous run was stopped in the same tick an `org reload` landed.
    writeFileSync(join(cwd, ORG_DIR, 'growth', 'reload'), new Date().toISOString());
    fakeDaemon.ticksRunning = 1;
    fakeDaemon.reloads = 0;

    // Fake only the wait loop's interval; file I/O and the rest stay real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = orgCommand.subcommands?.find((c) => c.name === 'run');
    let settled = false;
    const result = run
      ?.action?.({ args: ['growth'], flags: { crossProcess: false, yes: true }, cwd } as never)
      .finally(() => {
        settled = true;
      });
    for (let i = 0; i < 200 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(2000);
      await sleep(5);
    }

    expect(settled).toBe(true);
    await result;
    expect(fakeDaemon.reloads).toBe(0);
    expect(existsSync(join(cwd, ORG_DIR, 'growth', 'reload'))).toBe(false);
  });
});
