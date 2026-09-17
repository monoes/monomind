/**
 * #264: `org serve` must not act on control files left by a previous run.
 *
 * `org run` clears a lingering stop/reload request before it starts waiting
 * (see runAction). `org serve` cleared nothing — so an `org stop` that landed
 * after the last daemon exited was picked up by the *next* daemon's first poll
 * pass, killing or reloading an org nobody had asked it to touch.
 *
 * The scope question these tests pin down: `pollStopfiles`/`pollReloadfiles`
 * enumerate `daemon.listRunning()`, which is empty when serve starts, so
 * clearing by that would clear nothing. The orgs serve *serves* are the org
 * config files — that is what must be swept.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStaleControlFiles, pollStopfiles } from '../commands/org.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';

describe('org serve discards stale control files (#264)', () => {
  let cwd: string;

  const orgsDir = () => join(cwd, ORG_DIR);
  const control = (name: string, kind: string) => join(orgsDir(), name, kind);

  /** An org serve would serve: a config file plus its state directory. */
  const defineOrg = (name: string) => {
    mkdirSync(join(orgsDir(), name), { recursive: true });
    writeFileSync(join(orgsDir(), `${name}.json`), JSON.stringify({ name, roles: [] }));
  };
  const request = (name: string, kind: string) => {
    mkdirSync(join(orgsDir(), name), { recursive: true });
    writeFileSync(control(name, kind), new Date().toISOString());
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-serve-stale-'));
    mkdirSync(orgsDir(), { recursive: true });
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('clears a stop request left behind for a configured org', () => {
    defineOrg('alpha');
    request('alpha', 'stop');

    expect(clearStaleControlFiles(cwd)).toEqual(['alpha']);
    expect(existsSync(control('alpha', 'stop'))).toBe(false);
  });

  it('clears a reload request left behind for a configured org', () => {
    defineOrg('alpha');
    request('alpha', 'reload');

    expect(clearStaleControlFiles(cwd)).toEqual(['alpha']);
    expect(existsSync(control('alpha', 'reload'))).toBe(false);
  });

  it('sweeps every org serve can serve, not just one', () => {
    defineOrg('alpha');
    defineOrg('beta');
    defineOrg('gamma');
    request('alpha', 'stop');
    request('gamma', 'reload');

    expect(clearStaleControlFiles(cwd).sort()).toEqual(['alpha', 'gamma']);
    expect(existsSync(control('alpha', 'stop'))).toBe(false);
    expect(existsSync(control('gamma', 'reload'))).toBe(false);
  });

  it('leaves a pending run request alone', () => {
    // `org run` writes the runfile and then waits for the daemon to consume
    // it, reading its disappearance as "the run was taken". Clearing it here
    // would report success to that caller and start nothing.
    defineOrg('alpha');
    request('alpha', 'run');

    expect(clearStaleControlFiles(cwd)).toEqual([]);
    expect(existsSync(control('alpha', 'run'))).toBe(true);
  });

  it('reports nothing when there is nothing stale', () => {
    defineOrg('alpha');
    expect(clearStaleControlFiles(cwd)).toEqual([]);
  });

  it('does not fail when the project has no orgs directory at all', () => {
    rmSync(orgsDir(), { recursive: true, force: true });
    expect(clearStaleControlFiles(cwd)).toEqual([]);
  });

  it('stops the next daemon from acting on the previous run stop request', async () => {
    // End to end over the real poll: a stop left by a previous run used to
    // kill the org the moment the new daemon started it.
    defineOrg('alpha');
    request('alpha', 'stop');

    clearStaleControlFiles(cwd);

    const stopped: string[] = [];
    const daemon = {
      listRunning: () => ['alpha'],
      stopOrg: async (name: string) => {
        stopped.push(name);
      },
    } as unknown as OrgDaemon;

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual([]);
    expect(stopped).toEqual([]);
  });
});
