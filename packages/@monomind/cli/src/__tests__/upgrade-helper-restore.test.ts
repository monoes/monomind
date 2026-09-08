// Issue #225: `init upgrade` restored .claude/helpers/handlers/ recursively but
// could only ever (re)create TOP-LEVEL helpers that were on the force-sync
// list. audit-log-writer.cjs is not on it, and handlers/gates-handler.cjs
// require()s it at module load — so an upgrade on a project missing it
// produced a gates handler that threw MODULE_NOT_FOUND on every PreToolUse
// hook. hook-handler.cjs fails closed, which deadlocked every Bash and Write
// call for the rest of the session, including the write that would fix it.
//
// Two independent guards, because either one alone still leaves a live
// deadlock: the upgrade must put the file back, AND the gate must survive its
// absence.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findSourceHelpersDir } from '../init/shared.js';
import { executeUpgrade } from '../init/upgrade.js';

const TMP: string[] = [];
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMP.push(d);
  return d;
}

afterAll(() => {
  for (const d of TMP) rmSync(d, { recursive: true, force: true });
});

describe('init upgrade restores non-force-synced top-level helpers (#225)', () => {
  it('recreates audit-log-writer.cjs when the project is missing it', async () => {
    const source = findSourceHelpersDir();
    expect(source, 'bundled helpers dir must resolve in-repo').toBeTruthy();

    // The reported starting state: settings + handlers present, one top-level
    // helper absent. Handlers are what makes the absence fatal.
    const target = scratch('mm-upgrade-');
    const helpers = join(target, '.claude', 'helpers');
    mkdirSync(join(helpers, 'handlers'), { recursive: true });
    writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }, null, 2));
    copyFileSync(
      join(source as string, 'handlers', 'gates-handler.cjs'),
      join(helpers, 'handlers', 'gates-handler.cjs'),
    );
    expect(existsSync(join(helpers, 'audit-log-writer.cjs'))).toBe(false);

    await executeUpgrade(target);

    expect(existsSync(join(helpers, 'audit-log-writer.cjs'))).toBe(true);
  }, 120_000);

  it('never overwrites a top-level helper the project already has', async () => {
    const target = scratch('mm-upgrade-keep-');
    const helpers = join(target, '.claude', 'helpers');
    mkdirSync(helpers, { recursive: true });
    writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }, null, 2));
    // memory.cjs is a deliberately user-editable scaffold — the create-if-
    // missing pass must not behave like force-sync and clobber local edits.
    const edited = '// user edit\n';
    writeFileSync(join(helpers, 'memory.cjs'), edited);

    await executeUpgrade(target);

    expect((await import('node:fs')).readFileSync(join(helpers, 'memory.cjs'), 'utf8')).toBe(edited);
  }, 120_000);
});

describe('gates-handler survives a missing audit-log-writer.cjs (#225)', () => {
  it('loads and keeps enforcing instead of failing the hook closed', () => {
    const source = findSourceHelpersDir();
    expect(source).toBeTruthy();
    const dir = scratch('mm-gates-');
    mkdirSync(join(dir, 'handlers'), { recursive: true });
    copyFileSync(
      join(source as string, 'handlers', 'gates-handler.cjs'),
      join(dir, 'handlers', 'gates-handler.cjs'),
    );
    // Load in a child process: a MODULE_NOT_FOUND at require time is what used
    // to brick the hook, and that is only observable at module load.
    const out = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(join(dir, 'handlers', 'gates-handler.cjs'))}); console.log('loaded')`],
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('loaded');
  });
});
