/**
 * `.monomind/orgs/<name>/run` is how anything asks a live `org serve` daemon to
 * start an org off-cycle. Before it existed, a scheduled org could only be run
 * early by killing and restarting the daemon — which resets the schedule and
 * kills any in-flight work — because `org run` against a served org would spawn
 * a second daemon competing for the same runtime.json and broker lease.
 *
 * Mirrors org-stopfile-poll.test.ts, including its stub-daemon approach: the
 * contract under test is which orgs get started and what happens to the file,
 * not agent orchestration.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pollRunfiles } from '../commands/org.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';

function stubDaemon(running: string[], onStart?: (name: string) => void) {
  const started: string[] = [];
  const daemon = {
    listRunning: () => running,
    startOrg: async (name: string) => {
      started.push(name);
      onStart?.(name);
      return {} as never;
    },
  } as unknown as OrgDaemon;
  return { daemon, started };
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'runfile-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function defineOrg(name: string): void {
  mkdirSync(join(cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(cwd, ORG_DIR, `${name}.json`), JSON.stringify({ name, roles: [] }), 'utf8');
}
const runfile = (name: string): string => join(cwd, ORG_DIR, name, 'run');

describe('pollRunfiles', () => {
  it('starts an org whose runfile is present, and consumes the file', async () => {
    defineOrg('alpha');
    writeFileSync(runfile('alpha'), String(Date.now()), 'utf8');
    const { daemon, started } = stubDaemon([]);
    expect(await pollRunfiles(cwd, daemon)).toEqual(['alpha']);
    expect(started).toEqual(['alpha']);
    expect(existsSync(runfile('alpha'))).toBe(false);
  });

  it('leaves orgs alone when no runfile is present', async () => {
    defineOrg('alpha');
    const { daemon, started } = stubDaemon([]);
    expect(await pollRunfiles(cwd, daemon)).toEqual([]);
    expect(started).toEqual([]);
  });

  it('clears the runfile without restarting an org that is already running', async () => {
    defineOrg('alpha');
    writeFileSync(runfile('alpha'), String(Date.now()), 'utf8');
    const { daemon, started } = stubDaemon(['alpha']);
    expect(await pollRunfiles(cwd, daemon)).toEqual([]);
    expect(started).toEqual([]); // "start now" on something started is satisfied, not an error
    expect(existsSync(runfile('alpha'))).toBe(false);
  });

  it('consumes the runfile even when the start throws, so a failure cannot wedge a restart loop', async () => {
    defineOrg('alpha');
    writeFileSync(runfile('alpha'), String(Date.now()), 'utf8');
    const daemon = {
      listRunning: () => [],
      startOrg: async () => {
        throw new Error('boom');
      },
    } as unknown as OrgDaemon;
    expect(await pollRunfiles(cwd, daemon)).toEqual([]);
    expect(existsSync(runfile('alpha'))).toBe(false);
  });

  it('forwards the task from the runfile body to startOrg', async () => {
    defineOrg('alpha');
    writeFileSync(
      runfile('alpha'),
      JSON.stringify({ ts: Date.now(), task: 'Cycle 9: do the thing' }),
      'utf8',
    );
    const seen: (string | undefined)[] = [];
    const daemon = {
      listRunning: () => [],
      startOrg: async (_n: string, task?: string) => {
        seen.push(task);
        return {} as never;
      },
    } as unknown as OrgDaemon;
    await pollRunfiles(cwd, daemon);
    expect(seen).toEqual(['Cycle 9: do the thing']);
  });

  it('starts with no task when the runfile body is a bare timestamp or unparseable', async () => {
    defineOrg('alpha');
    writeFileSync(runfile('alpha'), String(Date.now()), 'utf8'); // pre-JSON writer / hand-touched
    const seen: (string | undefined)[] = [];
    const daemon = {
      listRunning: () => [],
      startOrg: async (_n: string, task?: string) => {
        seen.push(task);
        return {} as never;
      },
    } as unknown as OrgDaemon;
    await pollRunfiles(cwd, daemon);
    expect(seen).toEqual([undefined]); // starts on the org's own goal, not an error
  });

  it('ignores a runfile for a name with no org config', async () => {
    mkdirSync(join(cwd, ORG_DIR, 'ghost'), { recursive: true });
    writeFileSync(runfile('ghost'), String(Date.now()), 'utf8');
    const { daemon, started } = stubDaemon([]);
    expect(await pollRunfiles(cwd, daemon)).toEqual([]);
    expect(started).toEqual([]);
  });
});
