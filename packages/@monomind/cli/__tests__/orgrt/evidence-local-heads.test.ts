// localHeads(): the facts the completion evidence gate is fed — every
// worktree's HEAD and every local branch tip of the workspace's repository.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTaskEvidence } from '../../src/orgrt/completion-gate.js';
import { localHeads } from '../../src/orgrt/decisions.js';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'heads-')));
  const main = join(root, 'main');
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  writeFileSync(join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-qm', 'a');
  const wt = join(root, 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'release/x', wt);
  writeFileSync(join(wt, 'b.txt'), 'b');
  git(wt, 'add', 'b.txt');
  git(wt, 'commit', '-qm', 'b');
  git(main, 'branch', 'dev/idle', 'main');
  return { main, wt, mainSha: git(main, 'rev-parse', 'HEAD'), wtSha: git(wt, 'rev-parse', 'HEAD') };
}

describe('localHeads', () => {
  it("lists every worktree HEAD (the workspace's own first) and local branch tips", () => {
    const r = repo();
    const heads = localHeads(r.main);
    expect(heads[0]).toMatchObject({ sha: r.mainSha, worktree: r.main, branch: 'main' });
    expect(heads).toContainEqual(expect.objectContaining({ sha: r.wtSha, worktree: r.wt, branch: 'release/x' }));
    expect(heads).toContainEqual({ sha: r.mainSha, branch: 'dev/idle' });
  });

  it('feeds the gate: evidence from the release worktree closes; once it moves on, the old sha is stale', () => {
    const r = repo();
    const facts = (headSha: string, worktree?: string) => ({
      required: true,
      caller: 'dev',
      assignee: 'dev',
      headSha: r.mainSha,
      heads: localHeads(r.main),
      evidence: { headSha, worktree, checks: [{ command: 'pnpm test', exitCode: 0 }] },
    });
    expect(checkTaskEvidence(facts(r.wtSha, r.wt))).toBeNull();
    writeFileSync(join(r.wt, 'c.txt'), 'c');
    git(r.wt, 'add', 'c.txt');
    git(r.wt, 'commit', '-qm', 'c');
    expect(checkTaskEvidence(facts(r.wtSha, r.wt))).toMatch(/stale/i);
    expect(checkTaskEvidence(facts(r.wtSha))).toMatch(/stale/i);
  });

  it('is empty outside a git repository', () => {
    expect(localHeads(realpathSync(mkdtempSync(join(tmpdir(), 'nogit-'))))).toEqual([]);
  });
});
