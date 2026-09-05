// packages/@monomind/cli/__tests__/orgrt/org-observe-resume-live-daemon.test.ts
//
// Regression test: `org resume-from <name>` (resumeFromAction, org-observe.ts)
// used to build a brand-new OrgDaemon unconditionally and call
// daemon.resumeOrg(name) -> startOrg(..., { resume: true }). startOrg's
// duplicate-start guard (`this.orgs.has(name)`) only checks the fresh
// daemon's own empty in-memory map, so it never noticed a live `org serve`
// daemon (a separate process) already owning the org — two processes would
// then race writes to the same runtime.json and spawn two independent sets
// of role sessions against the same shared git workspace. Fixed by checking
// for a live serve-daemon heartbeat first (mirroring runAction's guard in
// org.ts) and refusing instead of starting a second execution.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resumeFromAction } from '../../src/commands/org-observe.js';
import type { CommandContext } from '../../src/types.js';

function fixture(root: string, name: string) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs', `${name}.json`),
    JSON.stringify({
      name,
      goal: `goal of ${name}`,
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
      ],
    }),
  );
}

function makeCtx(root: string, args: string[]): CommandContext {
  return { args, flags: { _: [] }, cwd: root, interactive: false };
}

describe('org resume-from CLI action — refuses when a live serve daemon owns the org', () => {
  let child: ChildProcess | undefined;
  let root: string | undefined;

  afterEach(() => {
    if (child) {
      child.kill();
      child = undefined;
    }
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        /* best effort */
      }
      root = undefined;
    }
  });

  it('refuses to start a second execution when a live daemon heartbeat is fresh', async () => {
    root = mkdtempSync(join(tmpdir(), 'org-observe-resume-live-'));
    fixture(root, 'alpha');

    // A real, running process stands in for the live serve daemon's pid —
    // the guard calls process.kill(pid, 0), which needs a genuinely live pid.
    child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    await new Promise<void>((resolve) => child!.once('spawn', () => resolve()));

    writeFileSync(
      join(root, '.monomind', 'serve-heartbeat.json'),
      JSON.stringify({ pid: child.pid, updatedAt: new Date().toISOString() }),
    );

    const ctx = makeCtx(root, ['alpha']);
    const result = await resumeFromAction(ctx, 'alpha');

    expect(result.success).toBe(false);
    // Refused before ever reaching daemon.resumeOrg — that path's failure
    // message mentions "runtime.json checkpoint"; the live-daemon refusal
    // must not, since it never got that far (no OrgDaemon was constructed).
    expect(result.message).not.toContain('runtime.json checkpoint');
    expect(result.message).toContain('alpha');
    expect(result.message.toLowerCase()).toContain('live serve daemon');
    expect(result.message).toContain(String(child.pid));
  });

  it('falls through to the normal checkpoint-resume path when no live daemon is running', async () => {
    root = mkdtempSync(join(tmpdir(), 'org-observe-resume-nolive-'));
    fixture(root, 'alpha');

    // No serve-heartbeat.json at all — the new guard must not false-positive
    // and block a legitimate resume when nothing else owns the org.
    const ctx = makeCtx(root, ['alpha']);
    const result = await resumeFromAction(ctx, 'alpha');

    expect(result.success).toBe(false);
    expect(result.message).toContain('runtime.json checkpoint');
  });

  it('falls through when the heartbeat pid is stale/gone', async () => {
    root = mkdtempSync(join(tmpdir(), 'org-observe-resume-stale-'));
    fixture(root, 'alpha');

    // A pid essentially guaranteed not to be alive, with a fresh timestamp —
    // process.kill(pid, 0) throws, so this must be treated as no live daemon.
    writeFileSync(
      join(root, '.monomind', 'serve-heartbeat.json'),
      JSON.stringify({ pid: 999_999, updatedAt: new Date().toISOString() }),
    );

    const ctx = makeCtx(root, ['alpha']);
    const result = await resumeFromAction(ctx, 'alpha');

    expect(result.success).toBe(false);
    expect(result.message).toContain('runtime.json checkpoint');
  });
});
