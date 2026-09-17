// packages/@monomind/cli/__tests__/orgrt/git-guard.test.ts
/**
 * #258: policy.git used to be enforced only by classifying Bash command TEXT,
 * so `echo "git push" | sh`, a script written in one call and run in the next,
 * or `node -e` reached git unseen. The git guard enforces the level where git
 * itself runs: every git process a role starts inherits the guard env. These
 * tests drive real git against a local bare remote — no network.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type GitLevel, gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';

const IDENT = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENT } });
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
    env: { ...process.env, ...IDENT, ...(guard?.env ?? {}) },
  });
  return { ...r, guard };
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
    expect(r.stdout).toMatch(/helpers=\[store,,\]/);
    expect(r.stdout).toContain('askpass=1');
    expect(r.stdout).toContain('prompt=0 gh=[] github=[] agent=[]');
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
