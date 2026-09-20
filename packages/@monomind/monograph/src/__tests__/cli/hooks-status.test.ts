import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHookStatus, installGitHooks } from '../../cli/hooks-install.js';

// #298: an org role below policy.git 'push' gets the git guard's own
// GIT_CONFIG_COUNT + GIT_CONFIG_KEY_n/VALUE_n as process-global env
// (git-guard.ts), so `getHooksDir`'s `git config core.hooksPath` sees the
// guard's hooksPath instead of falling through to this fixture's `.git/hooks`
// — this is a checked-in test controlling its own fixture, not a role
// editing its env guard (policy-git.ts's ENV_SETTERS governs the latter).
//
// Built as an ALLOWLIST from scratch, not by inheriting process.env and
// subtracting known GIT_CONFIG_* keys: a subtraction is a deny-list over a
// set GIT defines, and it fails open the same way #299's original reflog
// deny-list did. It would miss GIT_CONFIG_GLOBAL/SYSTEM/NOSYSTEM (`man
// git`, git 2.55.0, §ENVIRONMENT), GIT_CONFIG_COUNT/KEY_n/VALUE_n — the
// guard's own mechanism — (`man git-config`, §ENVIRONMENT, NOT `man git`),
// and GIT_CONFIG_PARAMETERS: git's internal channel for propagating `-c`
// overrides to subprocesses, honoured but undocumented in EITHER man page
// — precisely why a deny-list can't be trusted here: you cannot enumerate
// what the manual doesn't list. HOME points at an empty scratch dir so no
// ambient ~/.gitconfig leaks in either.
let originalEnv: NodeJS.ProcessEnv;
let hermeticHome: string;
beforeEach(() => {
  originalEnv = { ...process.env };
  hermeticHome = mkdtempSync(join(tmpdir(), 'git-hermetic-home-'));
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, {
    PATH: originalEnv.PATH,
    HOME: hermeticHome,
    // Spread, not a plain key: assigning an absent TMPDIR writes the STRING
    // "undefined" into the env (process.env coerces every value), and
    // os.tmpdir() then hands back "undefined" — every mkdtempSync below
    // fails with ENOENT. Only reachable where TMPDIR is unset, which is the
    // default on CI, so this passes on a machine that sets it.
    ...(originalEnv.TMPDIR ? { TMPDIR: originalEnv.TMPDIR } : {}),
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  });
});
afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, originalEnv);
  rmSync(hermeticHome, { recursive: true, force: true });
});

describe('getHookStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hook-status-'));
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns installed=false when no hooks present', () => {
    const status = getHookStatus(tmpDir);
    expect(status.installed).toBe(false);
    expect(status.hooks).toEqual([]);
  });

  it('returns installed=true when hooks are present', () => {
    installGitHooks(tmpDir, ['pre-commit', 'post-merge']);
    const status = getHookStatus(tmpDir);
    expect(status.installed).toBe(true);
    expect(status.hooks).toContain('pre-commit');
    expect(status.hooks).toContain('post-merge');
  });

  it('returns hooksDir path', () => {
    const status = getHookStatus(tmpDir);
    expect(status.hooksDir).toContain('.git/hooks');
  });

  it('returns installed=false when .git dir missing', () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'no-git-'));
    const status = getHookStatus(noGitDir);
    expect(status.installed).toBe(false);
    rmSync(noGitDir, { recursive: true, force: true });
  });
});
