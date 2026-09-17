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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitForRunEnd } from '../commands/org.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';

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
