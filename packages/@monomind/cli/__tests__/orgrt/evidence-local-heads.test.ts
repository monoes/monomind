// localHeads(): the facts the completion evidence gate is fed — every
// worktree's HEAD and every local branch tip of the workspace's repository.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTaskEvidence } from '../../src/orgrt/completion-gate.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { dagCompleteTask, localHeads } from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

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

describe('dagCompleteTask refusal wording', () => {
  function close(workdir: string, headSha: string, worktree?: string) {
    const def = OrgDefSchema.parse({
      name: 'o',
      goal: 'g',
      run_config: { completion_evidence: true },
      roles: [
        { id: 'boss', title: 'B', type: 'b' },
        { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
      ],
    });
    const taskDag = new TaskDag();
    const task = taskDag.add('t', 'dev');
    taskDag.markRunning(task.id);
    const running = {
      def,
      taskDag,
      workdir,
      bus: new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'gate-bus-'))),
      agents: new Map([['dev', { mailbox: new Mailbox() }]]),
    } as any;
    const daemon = { orgs: new Map([['o', running]]), root: workdir } as any;
    const ev = { headSha, ...(worktree ? { worktree } : {}), checks: [{ command: 'true', exitCode: 0 }] };
    return JSON.parse(dagCompleteTask(daemon, 'o', 'dev', task.id, 'r', ev)).error as string;
  }

  it('says "unknown commit (typo?)" for a sha git does not have, and "tree moved" for a real old one', () => {
    const r = repo();
    const old = git(r.wt, 'rev-parse', 'HEAD~1');
    const typo = `${r.wtSha.slice(0, 39)}${r.wtSha[39] === '0' ? '1' : '0'}`;
    expect(close(r.main, typo, r.wt)).toMatch(/unknown commit \(typo\?\)/);
    expect(close(r.main, typo)).toMatch(/unknown commit \(typo\?\)/);
    expect(close(r.main, old, r.wt)).toMatch(/tree moved/);
  });

  it('names a literal placeholder worktree path', () => {
    const r = repo();
    expect(close(r.main, r.wtSha, join(r.main, '..', 'SRC'))).toMatch(/placeholder/);
  });
});
