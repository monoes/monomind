import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getHookStatus,
  installGitHooks,
  listInstalledHooks,
  uninstallGitHooks,
} from '../../cli/hooks-install.js';

// #298: this whole file's fixtures read/set `core.hooksPath` via `git config`.
// An org role below policy.git 'push' gets the git guard's own GIT_CONFIG_COUNT
// + GIT_CONFIG_KEY_n/VALUE_n as PROCESS-GLOBAL env (git-guard.ts), so every
// child `git` — including these tests' fixture repos, which have nothing to do
// with the guarded repo — sees the guard's core.hooksPath instead of its own.
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
// ambient ~/.gitconfig leaks in either. This is a checked-in test
// controlling its own fixture's ambient state, not a role editing its env
// guard: policy-git.ts's ENV_SETTERS rule governs shell commands a role
// WRITES.
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

describe('installGitHooks', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hooks-test-'));
    hooksDir = join(tmpDir, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates pre-commit hook with monograph build command', () => {
    installGitHooks(tmpDir, ['pre-commit']);
    const hookPath = join(hooksDir, 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('monograph');
    expect(content).toContain('#!/');
  });

  it('creates post-merge hook', () => {
    installGitHooks(tmpDir, ['post-merge']);
    expect(existsSync(join(hooksDir, 'post-merge'))).toBe(true);
  });

  it('creates both hooks when both specified', () => {
    installGitHooks(tmpDir, ['pre-commit', 'post-merge']);
    expect(existsSync(join(hooksDir, 'pre-commit'))).toBe(true);
    expect(existsSync(join(hooksDir, 'post-merge'))).toBe(true);
  });

  it('throws when .git directory does not exist', () => {
    expect(() => installGitHooks('/nonexistent/repo', ['pre-commit'])).toThrow();
  });

  it('lists installed hooks', () => {
    installGitHooks(tmpDir, ['pre-commit']);
    const installed = listInstalledHooks(tmpDir);
    expect(installed).toContain('pre-commit');
  });

  it('uninstalls a hook', () => {
    installGitHooks(tmpDir, ['pre-commit']);
    uninstallGitHooks(tmpDir, ['pre-commit']);
    expect(existsSync(join(hooksDir, 'pre-commit'))).toBe(false);
  });
});

// #298 A1: getHooksDir (via getHookStatus) mis-joined an already-absolute
// core.hooksPath onto repoPath — join('/fixture', '/abs/guard/hooks') yields
// '/fixture/abs/guard/hooks'. Any user with Husky or a global absolute
// core.hooksPath got a nonsense path from `monograph hooks install`/`status`.
describe('getHooksDir honours an absolute core.hooksPath (#298 A1)', () => {
  let repoDir: string;
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('returns an absolute core.hooksPath unchanged instead of joining it onto the repo path', () => {
    repoDir = mkdtempSync(join(tmpdir(), 'hooks-abs-'));
    execSync('git init -q', { cwd: repoDir });
    const absoluteHooksDir = join(tmpdir(), 'monograph-abs-hooks-test');
    execSync(`git config core.hooksPath ${JSON.stringify(absoluteHooksDir)}`, { cwd: repoDir });
    // FAILS pre-fix: returns join(repoDir, absoluteHooksDir), a nonsense concatenation
    expect(getHookStatus(repoDir).hooksDir).toBe(absoluteHooksDir);
  });

  it('still joins a RELATIVE core.hooksPath under the repo (the Husky shape, .husky/_) — guards against over-correcting', () => {
    repoDir = mkdtempSync(join(tmpdir(), 'hooks-rel-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config core.hooksPath .husky/_', { cwd: repoDir });
    expect(getHookStatus(repoDir).hooksDir).toBe(join(repoDir, '.husky/_'));
  });
});
