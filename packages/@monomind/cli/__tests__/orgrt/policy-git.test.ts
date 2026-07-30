/**
 * `policy.git` is a security boundary — it is what stops an autonomous org from
 * committing to or pushing a repository on its own. It shipped with no tests,
 * and a naive subcommand regex let three commands straight through:
 *
 *   git -C /repo push               no regex match at all → allowed
 *   git -c user.name=x commit -m y  no regex match at all → allowed
 *   GIT_DIR=.git git push           matched as subcommand "git" → allowed at 'commit'
 *
 * Every case below that begins `git -C`, `git -c`, or with an env prefix exists
 * because it was once a live bypass.
 */
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../../src/orgrt/policy.js';

type Level = 'none' | 'read' | 'commit' | 'push';

const noopBus = { emit: () => { /* assertions read decide()'s return, not the bus */ } };

async function allows(level: Level, command: string): Promise<boolean> {
  // Signature is (role, policy, bus, cwd) — maxTokens must be generous or every
  // decision short-circuits on the budget check before git is ever consulted.
  const p = new PolicyEngine('coder', { git: level, maxTokens: 1_000_000 } as never, noopBus as never, process.cwd());
  return (await p.decide('Bash', { command })).behavior === 'allow';
}

describe('policy.git', () => {
  it("'read' permits inspection", async () => {
    for (const c of ['git status', 'git log --oneline -5', 'git diff HEAD', 'git rev-parse HEAD']) {
      expect(await allows('read', c), c).toBe(true);
    }
  });

  it("'read' blocks mutation and publication", async () => {
    for (const c of ['git commit -m x', 'git add .', 'git push', 'git checkout main']) {
      expect(await allows('read', c), c).toBe(false);
    }
  });

  it("'commit' permits local mutation but still blocks publication", async () => {
    expect(await allows('commit', 'git commit -m x')).toBe(true);
    expect(await allows('commit', 'git add -A')).toBe(true);
    expect(await allows('commit', 'git push origin main')).toBe(false);
    expect(await allows('commit', 'git pull')).toBe(false);
  });

  it("'push' permits publication", async () => {
    expect(await allows('push', 'git push origin main')).toBe(true);
  });

  it("'none' blocks even a read", async () => {
    expect(await allows('none', 'git status')).toBe(false);
  });

  it('leaves non-git commands alone', async () => {
    for (const c of ['npm test', 'ls -la', 'node scripts/gitlab.js']) {
      expect(await allows('read', c), c).toBe(true);
    }
  });

  // ── the bypasses ────────────────────────────────────────────────────
  it('sees through global options placed before the subcommand', async () => {
    expect(await allows('commit', 'git -C /repo push')).toBe(false);
    expect(await allows('read', 'git -C /repo commit -m x')).toBe(false);
    expect(await allows('commit', 'git -c user.name=x commit -m y')).toBe(true); // commit allowed at 'commit'
    expect(await allows('commit', 'git -c user.name=x push')).toBe(false);       // ...push is not
    expect(await allows('commit', 'git --git-dir=/r/.git push')).toBe(false);
    expect(await allows('commit', 'git --work-tree /r -C /r push')).toBe(false);
  });

  it('sees through an env-var prefix', async () => {
    expect(await allows('commit', 'GIT_DIR=.git git push')).toBe(false);
    expect(await allows('read', 'GIT_AUTHOR_NAME=x git commit -m y')).toBe(false);
  });

  it('sees through an absolute path to the git binary', async () => {
    expect(await allows('commit', '/usr/bin/git push')).toBe(false);
  });

  it('checks every git call in a compound command, not just the first', async () => {
    expect(await allows('commit', 'git status && git push')).toBe(false);
    expect(await allows('commit', 'git add . ; git commit -m x ; git push')).toBe(false);
    expect(await allows('commit', 'git log | head -5')).toBe(true);
  });

  it('treats a bare `git` with no subcommand as harmless', async () => {
    expect(await allows('read', 'git')).toBe(true);
    expect(await allows('read', 'git --version')).toBe(true);
  });
});
