// packages/@monomind/cli/__tests__/orgrt/worktree-prune.test.ts
/**
 * #301: roles create their own linked worktrees with Bash (paths the daemon
 * never recorded — `org.worktreePath`/`agent.worktreePath` are only ever set
 * for `workspace: 'worktree'`/`'worktree-per-role'`, empty for the common
 * `workspace: 'repo'` shape monomind-dev itself runs). Deleting the working
 * directory from inside a role sandbox leaves `.git/worktrees/<name>` behind
 * — `git worktree list` then hides it, and nothing ever cleaned it up.
 *
 * These tests use a REAL git repo in a temp dir with no mocking of
 * `child_process` — the whole point is the real `git worktree prune` command.
 * Observation is by LISTING `.git/worktrees` on disk, never by asserting
 * `execFileSync` was called: a mocked-spawn unit test is green precisely in
 * the configuration that fails, since inside a role `.git/worktrees` is
 * read-only and the real call would error there. Never mutates the owner's
 * repo — every fixture below is its own throwaway `git init`.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A throwaway repo with one commit (a worktree needs a HEAD to attach to). */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'wt-prune-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  writeFileSync(join(repo, 'README.md'), 'x');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}

/** Simulates the reported bug exactly: `git worktree add`, then `rm -rf` the
 *  directory directly (NOT `git worktree remove`), leaving
 *  `.git/worktrees/<name>` behind with nothing pointing at it. */
function addThenOrphan(repo: string, name: string): void {
  const wtPath = join(repo, name);
  git(repo, 'worktree', 'add', wtPath, 'HEAD', '--detach');
  rmSync(wtPath, { recursive: true, force: true });
}

/** A live worktree whose directory still exists — the negative/safety case
 *  every test below must confirm survives whatever prune ran. */
function addLive(repo: string, name: string): string {
  const wtPath = join(repo, name);
  git(repo, 'worktree', 'add', wtPath, 'HEAD', '--detach');
  return wtPath;
}

function orgFixture(repo: string, name: string, runConfig?: Record<string, unknown>) {
  mkdirSync(join(repo, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(repo, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    run_config: runConfig,
    roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
  }));
}

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('OrgDaemon — git worktree prune (#301)', () => {
  it('stop-side backstop: a worktree the daemon never recorded (workspace: repo) is pruned on stop, without touching a live sibling', async () => {
    const repo = makeRepo();
    orgFixture(repo, 'alpha'); // default workspace: 'repo' — daemon records NO worktreePath
    addThenOrphan(repo, 'wt-orphan');
    const liveDir = addLive(repo, 'wt-live');
    expect(existsSync(join(repo, '.git/worktrees/wt-orphan')), 'fixture precondition').toBe(true);
    expect(existsSync(join(repo, '.git/worktrees/wt-live')), 'fixture precondition').toBe(true);

    const d = new OrgDaemon(repo, { queryFn: echoQuery as any, forward: false, stopWaitMs: 200, crashBackoffsMs: [] });
    await d.startOrg('alpha');
    await d.stopOrg('alpha');

    // FAILS pre-fix: the daemon has no record of wt-orphan (workspace: 'repo'
    // never sets org.worktreePath/agent.worktreePath), so nothing ever
    // removes its metadata.
    expect(existsSync(join(repo, '.git/worktrees/wt-orphan'))).toBe(false);
    // Negative/safety row: the live worktree — directory AND metadata — must
    // survive. This is the assertion that proves the backstop cannot eat a
    // worktree still in use, including the owner's own. Passes before and
    // after the fix; it must stay green.
    expect(existsSync(join(repo, '.git/worktrees/wt-live'))).toBe(true);
    expect(existsSync(liveDir)).toBe(true);
  }, 15_000);

  it('AC6 (primary deliverable): prune at run START recovers a worktree orphaned before this daemon process ever started (the SIGKILL/leaked-run case)', async () => {
    const repo = makeRepo();
    orgFixture(repo, 'alpha');
    // Simulates the state a SIGKILLed prior run (or nine leaked worktrees
    // from before this fix existed) leaves behind: metadata with no daemon
    // in memory to have recorded it, before this daemon process even exists.
    addThenOrphan(repo, 'wt-precrash');
    const liveDir = addLive(repo, 'wt-live');
    expect(existsSync(join(repo, '.git/worktrees/wt-precrash'))).toBe(true);

    const d = new OrgDaemon(repo, { queryFn: echoQuery as any, forward: false, stopWaitMs: 200, crashBackoffsMs: [] });
    await d.startOrg('alpha'); // no stop yet — this is what must have pruned it

    // FAILS pre-fix: nothing runs `git worktree prune` at start, so a
    // stop-only backstop can never recover a leak that predates this process.
    expect(existsSync(join(repo, '.git/worktrees/wt-precrash'))).toBe(false);
    // Safety: a live worktree must survive the start-time prune too.
    expect(existsSync(join(repo, '.git/worktrees/wt-live'))).toBe(true);
    expect(existsSync(liveDir)).toBe(true);

    await d.stopOrg('alpha');
  }, 15_000);

  it('AC5 (path coverage): the process-exit backstop (crashCleanup) prunes independently of finishStop, for the paths that reach process.exit() without ever calling stopOrg', async () => {
    const repo = makeRepo();
    orgFixture(repo, 'alpha');
    const d = new OrgDaemon(repo, { queryFn: echoQuery as any, forward: false, stopWaitMs: 200, crashBackoffsMs: [] });
    const running = await d.startOrg('alpha');

    // A role creates and orphans a worktree mid-run — after start, before any
    // stop. Simulates the shape the issue reports actually happening live.
    addThenOrphan(repo, 'wt-midrun');
    const liveDir = addLive(repo, 'wt-live');
    expect(existsSync(join(repo, '.git/worktrees/wt-midrun'))).toBe(true);

    // Invoke the SAME function object `process.on('exit', crashCleanup)`
    // would call — this is the exact code path daemon.ts:1184 registers, not
    // a reimplementation of it. Does not call stopOrg/finishStop at all, so
    // this isolates the exit-path backstop from the stop-side one tested above.
    const crashCleanup = (running as unknown as { _crashCleanup?: () => void })._crashCleanup;
    expect(crashCleanup, 'daemon.ts must expose _crashCleanup on the running org').toBeTypeOf('function');
    crashCleanup!();

    // FAILS pre-fix: crashCleanup only reaped SDK processes, never pruned —
    // SIGTERM/SIGINT/uncaughtException/unhandledRejection (org.ts's handlers,
    // which call process.exit() directly) never ran finishStop's cleanup at all.
    expect(existsSync(join(repo, '.git/worktrees/wt-midrun'))).toBe(false);
    expect(existsSync(join(repo, '.git/worktrees/wt-live'))).toBe(true);
    expect(existsSync(liveDir)).toBe(true);

    await d.stopOrg('alpha');
  }, 15_000);

  it('regression guard: the existing daemon-managed removal (workspace: worktree) is unaffected by adding prune', async () => {
    const repo = makeRepo();
    orgFixture(repo, 'alpha', { workspace: 'worktree' });
    const d = new OrgDaemon(repo, { queryFn: echoQuery as any, forward: false, stopWaitMs: 200, crashBackoffsMs: [] });
    const running = await d.startOrg('alpha');
    expect(running.worktreePath, 'daemon must have created and recorded its own worktree').toBeTruthy();
    expect(existsSync(running.worktreePath!)).toBe(true);

    await d.stopOrg('alpha');

    // The pre-existing `:2592-2602` removal loop still removes the
    // daemon-managed worktree by path — unchanged by this item.
    expect(existsSync(running.worktreePath!)).toBe(false);
  }, 15_000);

  it('robustness: stopping an org whose root is not a git repo at all does not throw and does not fail the stop', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'wt-prune-notgit-'));
    orgFixture(notARepo, 'alpha');
    const d = new OrgDaemon(notARepo, { queryFn: echoQuery as any, forward: false, stopWaitMs: 200, crashBackoffsMs: [] });
    await d.startOrg('alpha'); // prune-at-start must also swallow "not a git repo"
    await expect(d.stopOrg('alpha')).resolves.toBeUndefined();
  }, 15_000);
});
