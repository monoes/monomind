/**
 * `monomind org stop` must actually stop an org hosted by `org serve`.
 *
 * The original defect: `org stop` wrote a stopfile and printed "the daemon
 * picks it up within ~2s", but only the foreground `org run` loop ever read
 * that file. Against a `serve` daemon it was a silent no-op — the command
 * exited 0, claimed the daemon was going down, and the org kept running.
 *
 * `pollStopfiles` fixed that and is exported with the comment "so callers/tests
 * don't have to guess" — but nothing ever called it from a test. The fix has
 * been shipping unverified since. These tests close that gap.
 *
 * A stub daemon is used deliberately: the behaviour under test is the stopfile
 * contract (which orgs get stopped, and what happens to the file afterwards),
 * not agent orchestration. Standing up real agents would test the SDK instead.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pollStopfiles } from '../commands/org.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { ORG_DIR } from '../orgrt/types.js';

/** Only the two members pollStopfiles touches. */
function stubDaemon(running: string[], onStop?: (name: string) => void) {
  const stopped: string[] = [];
  const daemon = {
    listRunning: () => running,
    stopOrg: async (name: string) => {
      onStop?.(name);
      stopped.push(name);
    },
  };
  return { daemon: daemon as unknown as OrgDaemon, stopped };
}

describe('org stop reaches a serve-hosted daemon', () => {
  let cwd: string;

  const stopfileFor = (name: string) => join(cwd, ORG_DIR, name, 'stop');
  const requestStop = (name: string) => {
    mkdirSync(join(cwd, ORG_DIR, name), { recursive: true });
    writeFileSync(stopfileFor(name), new Date().toISOString());
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-stopfile-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('stops a running org once its stopfile appears', async () => {
    const { daemon, stopped } = stubDaemon(['alpha']);
    requestStop('alpha');

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual(['alpha']);
    expect(stopped).toEqual(['alpha']);
  });

  it('clears the stopfile so the next scheduled run is not killed on sight', async () => {
    const { daemon } = stubDaemon(['alpha']);
    requestStop('alpha');

    await pollStopfiles(cwd, daemon);
    expect(existsSync(stopfileFor('alpha'))).toBe(false);
  });

  it('leaves running orgs alone when no stop was requested', async () => {
    const { daemon, stopped } = stubDaemon(['alpha', 'beta']);

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('stops only the org that was asked to stop', async () => {
    const { daemon, stopped } = stubDaemon(['alpha', 'beta']);
    requestStop('beta');

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual(['beta']);
    expect(stopped).toEqual(['beta']);
    // alpha's absence of a stopfile must not be disturbed either way.
    expect(existsSync(stopfileFor('alpha'))).toBe(false);
  });

  it('ignores a stopfile for an org that is not running', async () => {
    const { daemon, stopped } = stubDaemon([]);
    requestStop('ghost');

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('clears the stopfile even when the stop itself fails', async () => {
    // Otherwise a stop that throws leaves the file behind, and every later poll
    // re-attempts it — including killing the next scheduled iteration on sight.
    const { daemon } = stubDaemon(['alpha'], () => {
      throw new Error('stopOrg exploded');
    });
    requestStop('alpha');

    await expect(pollStopfiles(cwd, daemon)).resolves.toEqual([]);
    expect(existsSync(stopfileFor('alpha'))).toBe(false);
  });
});
