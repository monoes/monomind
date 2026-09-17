// packages/@monomind/cli/__tests__/orgrt/git-guard.test.ts
/**
 * #258: policy.git used to be enforced only by classifying Bash command TEXT,
 * so `echo "git push" | sh`, a script written in one call and run in the next,
 * or `node -e` reached git unseen. The git guard enforces the level where git
 * itself runs: every git process a role starts inherits the guard env. These
 * tests drive real git against a local bare remote — no network.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type GitLevel, gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';

const IDENT = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

/** process.env without a guard inherited from an outer role session: these
 *  tests install their own guard, and an inherited one would (correctly) stop
 *  the fixture from pushing to its local bare remote. Keeps the suite runnable
 *  inside a sandboxed role. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, ...IDENT };
  for (const k of Object.keys(env))
    if (/^(GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)|GIT_ASKPASS|SSH_ASKPASS|GIT_SSH_COMMAND|GIT_TERMINAL_PROMPT|MONOMIND_GIT_LEVEL)$/.test(k))
      delete env[k];
  return env;
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

let base: string;
let repo: string;
let remote: string;
let branch: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'git-guard-'));
  remote = join(base, 'remote.git');
  repo = join(base, 'repo');
  git(base, 'init', '-q', '--bare', remote);
  git(base, 'init', '-q', repo);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
});

const remoteHead = () => git(base, `--git-dir=${remote}`, 'rev-parse', `refs/heads/${branch}`);
const localHead = (cwd = repo) => git(cwd, 'rev-parse', 'HEAD');

/** Run `cmd` through sh the way a role's shell tool would: the runner's env
 *  is process.env with the session env (including the guard) laid over it. */
function roleShell(level: GitLevel, cmd: string, cwd = repo) {
  const guard = prepareGitGuard({
    level,
    stateDir: join(base, 'guard', level),
    protectedGitDirs: [gitCommonDir(repo)!],
  });
  const r = spawnSync('sh', ['-c', cmd], {
    cwd,
    encoding: 'utf8',
    env: { ...cleanEnv(), ...(guard?.env ?? {}) },
  });
  return { ...r, guard };
}

/** Run `cmd` with exactly this guard env over a clean base — no inherited guard. */
function roleShellWithEnv(env: Record<string, string>, cmd: string) {
  return spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8', env: { ...cleanEnv(), ...env } });
}

describe('git guard — commit level cannot push', () => {
  const PUSH = `git push origin HEAD:refs/heads/BRANCH`;
  it.each([
    ['a plain git push', PUSH],
    ['sh -c', `sh -c '${PUSH}'`],
    ['git piped into an interpreter', `echo "${PUSH}" | sh`],
    ['a script file run in a later command', `printf '%s\\n' "${PUSH}" > p.sh && sh p.sh`],
    [
      'node child_process',
      `node -e "require('child_process').execFileSync('sh', ['-c', process.argv[1]], { stdio: 'inherit' })" "${PUSH}"`,
    ],
    ['--no-verify', `git push --no-verify origin HEAD:refs/heads/BRANCH`],
    ['the git binary by absolute path', `"$(command -v git)" push origin HEAD:refs/heads/BRANCH`],
    ['send-pack plumbing', `git send-pack REMOTE HEAD:refs/heads/BRANCH`],
  ])('%s does not update the bare remote', (_label, template) => {
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'work');
    const before = remoteHead();
    const cmd = template.replaceAll('BRANCH', branch).replaceAll('REMOTE', remote);
    const r = roleShell('commit', cmd);
    expect(r.status, r.stderr).not.toBe(0);
    expect(remoteHead()).toBe(before);
  });

  it('still commits in the protected repo, and the repo’s own hooks keep running', () => {
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho ran > .pre-commit-ran\n');
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    const before = localHead();
    const r = roleShell('commit', 'git commit -q --allow-empty -m work && cat .pre-commit-ran');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('ran');
    expect(localHead()).not.toBe(before);
  });

  it('withholds push credentials: helpers reset, askpass fails, no prompts, tokens blank', () => {
    git(repo, 'config', 'credential.helper', 'store');
    const r = roleShell(
      'commit',
      [
        'echo "helpers=[$(git config --get-all credential.helper | tr "\\n" ,)]"',
        '"$GIT_ASKPASS" Username >/dev/null 2>&1; echo "askpass=$?"',
        'echo "prompt=$GIT_TERMINAL_PROMPT gh=[$GH_TOKEN] github=[$GITHUB_TOKEN] agent=[$SSH_AUTH_SOCK]"',
      ].join('; '),
    );
    expect(r.status, r.stderr).toBe(0);
    // `credential.helper=` from the guard resets the list, so git uses none
    expect(r.stdout).toMatch(/helpers=\[store,,+\]/); // the guard resets the list; an outer guard may add one more empty entry
    expect(r.stdout).toContain('askpass=1');
    expect(r.stdout).toContain('prompt=0 gh=[] github=[] agent=[]');
  });
});

describe('git guard — the config block stands on its own', () => {
  it("re-emits the operator's own GIT_CONFIG entries ahead of the guard's", () => {
    const guard = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard', 'selfcontained'),
      protectedGitDirs: [gitCommonDir(repo)!],
      baseEnv: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'operator',
      },
    })!;
    // numbering starts at 0 and covers every entry, so a child that does not
    // inherit the operator's pairs still gets a valid block
    const count = Number(guard.env.GIT_CONFIG_COUNT);
    expect(guard.env.GIT_CONFIG_KEY_0).toBe('user.name');
    for (let i = 0; i < count; i++) expect(guard.env[`GIT_CONFIG_KEY_${i}`], `key ${i}`).toBeDefined();
    expect(Object.keys(guard.env).filter((k) => k.startsWith('GIT_CONFIG_KEY_'))).toHaveLength(count);
    // and the guard's own entries are last, so they win
    expect(guard.env[`GIT_CONFIG_KEY_${count - 1}`]).toBe('core.sshCommand');
  });

  it('a stale inherited count with missing pairs cannot break git', () => {
    const guard = prepareGitGuard({
      level: 'read',
      stateDir: join(base, 'guard', 'stale'),
      protectedGitDirs: [gitCommonDir(repo)!],
      baseEnv: { GIT_CONFIG_COUNT: '5' },
    })!;
    const r = roleShellWithEnv(guard.env, 'git config --get core.hooksPath');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(guard.hooksDir);
  });
});

describe('git guard — sandbox placeholders stay out of the working tree', () => {
  // The SDK sandbox creates zero-byte, read-only placeholder files in the
  // role's cwd for its own cwd-relative deny entries (.bashrc, .gitconfig,
  // .idea, .claude/hooks, …). In a repository they show up as untracked, and a
  // 'commit' role running `git add -A` would stage them — into a release, for
  // a repo that ships .claude/.
  const placeholders = ['.bashrc', '.gitconfig', '.idea', '.ripgreprc', '.claude/hooks', '.claude/loop.md'];

  const guardWithExcludes = (operatorExcludes?: string) =>
    prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard', `excl-${Math.random().toString(36).slice(2)}`),
      protectedGitDirs: [gitCommonDir(repo)!],
      excludeSandboxPlaceholders: true,
      baseEnv: operatorExcludes
        ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.excludesFile', GIT_CONFIG_VALUE_0: operatorExcludes }
        : {},
    })!;

  it('leaves `git status` clean and `git add -A` staging nothing', () => {
    const guard = guardWithExcludes();
    for (const rel of placeholders) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      writeFileSync(join(repo, rel), '');
    }
    const status = roleShellWithEnv(guard.env, 'git status --porcelain');
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout.trim()).toBe('');
    const add = roleShellWithEnv(guard.env, 'git add -A && git diff --cached --name-only');
    expect(add.status, add.stderr).toBe(0);
    expect(add.stdout.trim()).toBe('');
    for (const rel of placeholders) rmSync(join(repo, rel), { recursive: true });
  });

  it('never hides a tracked file — git ignores nothing that is already tracked', () => {
    writeFileSync(join(repo, '.gitconfig'), 'tracked content\n');
    const guard = guardWithExcludes();
    roleShellWithEnv(guard.env, 'git add -f .gitconfig && git commit -q -m tracked');
    writeFileSync(join(repo, '.gitconfig'), 'changed\n');
    const status = roleShellWithEnv(guard.env, 'git status --porcelain');
    expect(status.stdout).toContain('.gitconfig');
    roleShellWithEnv(guard.env, 'git rm -q --cached .gitconfig && git commit -q -m untrack');
    rmSync(join(repo, '.gitconfig'));
  });

  it("keeps the operator's own excludes working, since git honours only one file", () => {
    const operator = join(base, 'operator-excludes');
    writeFileSync(operator, '# operator\nscratch-notes.txt\n');
    const guard = guardWithExcludes(operator);
    writeFileSync(join(repo, 'scratch-notes.txt'), 'notes');
    writeFileSync(join(repo, '.bashrc'), '');
    const status = roleShellWithEnv(guard.env, 'git status --porcelain');
    expect(status.stdout.trim()).toBe('');
    rmSync(join(repo, 'scratch-notes.txt'));
    rmSync(join(repo, '.bashrc'));
  });

  it('is not installed when the role runs without the sandbox', () => {
    const guard = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard', 'no-excludes'),
      protectedGitDirs: [gitCommonDir(repo)!],
      baseEnv: {},
    })!;
    expect(Object.values(guard.env)).not.toContain('core.excludesFile');
  });
});

describe('git guard — nested sessions', () => {
  // A role that runs a tool which installs its own guard (monomind's own test
  // suite does) leaves both core.hooksPath values in the config. Each
  // dispatcher used to pick the other as "the repository's own hook" and exec
  // it, so the two ping-ponged forever and every git command hung.
  it('never chains to another guard, so two of them cannot exec each other forever', () => {
    const outer = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard', 'outer'),
      protectedGitDirs: [gitCommonDir(repo)!],
    })!;
    const inner = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard', 'inner'),
      protectedGitDirs: [gitCommonDir(repo)!],
      baseEnv: { ...outer.env },
    })!;
    const r = spawnSync('sh', ['-c', 'git commit -q --allow-empty -m nested && echo committed'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...cleanEnv(), ...inner.env },
      timeout: 15_000,
    });
    expect(r.signal, 'timed out — the dispatchers are chaining to each other').toBeNull();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('committed');
  });

  it("still chains to the repository's own hook", () => {
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-commit'), '#!/bin/sh\necho own-hook-ran > .post-commit-ran\n');
    chmodSync(join(hooks, 'post-commit'), 0o755);
    const r = roleShell('commit', 'git commit -q --allow-empty -m chained && cat .post-commit-ran');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('own-hook-ran');
  });
});

describe('git guard — read level cannot commit to the protected repo', () => {
  it.each([
    ['git commit', 'git commit -q --allow-empty -m nope'],
    ['a script', `printf 'git commit -q --allow-empty -m nope\\n' > c.sh && sh c.sh`],
    ['--no-verify', 'git commit -q --no-verify --allow-empty -m nope'],
    ['commit-tree + update-ref', 'git update-ref HEAD "$(git commit-tree -m nope "HEAD^{tree}" -p HEAD)"'],
    ['a git dir given explicitly', `cd .. && git --git-dir=repo/.git --work-tree=repo commit -q --allow-empty -m nope`],
  ])('%s does not move HEAD', (_label, cmd) => {
    const before = localHead();
    roleShell('read', cmd);
    expect(localHead()).toBe(before);
  });

  it('still allows reads', () => {
    const r = roleShell('read', 'git status --short && git log --oneline -1 && git diff HEAD');
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not block commits in unprotected scratch repos (test fixtures in TMPDIR)', () => {
    const scratch = join(base, 'scratch');
    git(base, 'init', '-q', scratch);
    const r = roleShell('read', 'git commit -q --allow-empty -m fixture && git rev-parse HEAD', scratch);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('git guard — push level is unaffected', () => {
  it('installs nothing, so commit and push both succeed', () => {
    const r = roleShell('push', `git commit -q --allow-empty -m ship && git push -q origin HEAD:refs/heads/${branch}`);
    expect(r.guard).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(remoteHead()).toBe(localHead());
  });
});

describe('git guard — residual risk without the OS sandbox', () => {
  it('explicit -c overrides of the guard config still bypass the git layer (only the sandbox stops this)', () => {
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'work');
    const r = roleShell(
      'commit',
      `git -c core.hooksPath=/dev/null -c protocol.file.allow=always push -q origin HEAD:refs/heads/${branch}`,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(remoteHead()).toBe(localHead());
  });
});
