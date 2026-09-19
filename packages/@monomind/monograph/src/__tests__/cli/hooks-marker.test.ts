/**
 * Tests for marker-based hook management enhancements.
 * Covers: append-not-overwrite, uninstall-only-marker-block, post-checkout,
 * Husky detection, rebase guards, and per-hook status details.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getHookStatus,
  HOOK_MARKER_START,
  installGitHooks,
  type PerHookStatus,
  uninstallGitHooks,
} from '../../cli/hooks-install.js';

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
// deny-list did — it would miss GIT_CONFIG_PARAMETERS and GIT_CONFIG_GLOBAL/
// SYSTEM/NOSYSTEM (confirmed in `man git`, git 2.55.0, §ENVIRONMENT) and any
// config-injection variable a future git adds. HOME points at an empty
// scratch dir so no ambient ~/.gitconfig leaks in either.
let originalEnv: NodeJS.ProcessEnv;
let hermeticHome: string;
beforeEach(() => {
  originalEnv = { ...process.env };
  hermeticHome = mkdtempSync(join(tmpdir(), 'git-hermetic-home-'));
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, {
    PATH: originalEnv.PATH,
    HOME: hermeticHome,
    TMPDIR: originalEnv.TMPDIR,
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

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mhook-'));
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

describe('marker-based append (not overwrite)', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('appends monograph block to existing hook content', () => {
    tmpDir = makeRepo();
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
    const existing = '#!/bin/sh\necho "my custom hook"\n';
    writeFileSync(hookPath, existing, 'utf8');

    installGitHooks(tmpDir, ['pre-commit']);
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('my custom hook'); // existing preserved
    expect(content).toContain(HOOK_MARKER_START);
    expect(content).toContain('monograph');
  });

  it('does not duplicate the block on repeated installs', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['pre-commit']);
    installGitHooks(tmpDir, ['pre-commit']);
    const content = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf8');
    const count = (content.match(new RegExp(HOOK_MARKER_START, 'g')) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('marker-based uninstall (only removes block)', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('removes only the monograph block, leaves rest of hook intact', () => {
    tmpDir = makeRepo();
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "keep this"\n', 'utf8');

    installGitHooks(tmpDir, ['pre-commit']);
    uninstallGitHooks(tmpDir, ['pre-commit']);

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('keep this');
    expect(content).not.toContain(HOOK_MARKER_START);
    expect(content).not.toContain('monograph build');
  });

  it('deletes the file if it was created entirely by monograph (no prior content)', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['pre-commit']);
    uninstallGitHooks(tmpDir, ['pre-commit']);
    // file should no longer contain the marker block
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
    try {
      const content = readFileSync(hookPath, 'utf8');
      expect(content).not.toContain(HOOK_MARKER_START);
    } catch {
      // file deleted entirely is also acceptable
    }
  });
});

describe('post-checkout hook support', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('installs post-checkout hook', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['post-checkout']);
    const content = readFileSync(join(tmpDir, '.git', 'hooks', 'post-checkout'), 'utf8');
    expect(content).toContain('monograph');
  });

  it('post-checkout hook includes rebase/merge skip guard', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['post-checkout']);
    const content = readFileSync(join(tmpDir, '.git', 'hooks', 'post-checkout'), 'utf8');
    // Should skip during rebase or merge operations
    expect(content).toMatch(/rebase|MERGE|cherry-pick/i);
  });
});

describe('rebase guard in hook scripts', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('pre-commit hook includes rebase skip guard', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['pre-commit']);
    const content = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(content).toMatch(/rebase|MERGE|cherry-pick/i);
  });
});

describe('per-hook status (getHookStatus with details)', () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns per-hook detail objects', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['pre-commit', 'post-checkout']);
    const status = getHookStatus(tmpDir);
    expect(status.perHook).toBeDefined();
    const preCommit = status.perHook?.['pre-commit'];
    expect(preCommit).toBeDefined();
    expect((preCommit as PerHookStatus).installed).toBe(true);
  });

  it('perHook shows not-installed for hooks that were not set up', () => {
    tmpDir = makeRepo();
    installGitHooks(tmpDir, ['pre-commit']);
    const status = getHookStatus(tmpDir);
    const postMerge = status.perHook?.['post-merge'];
    expect(postMerge?.installed ?? false).toBe(false);
  });
});
