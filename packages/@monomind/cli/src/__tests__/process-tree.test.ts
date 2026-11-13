/**
 * Unit tests for orgrt/process-tree.ts (#359 — Coder mode: Stop/timeout/
 * budget must kill the whole agent process tree).
 *
 * Uses REAL short-lived processes (the issue's own guidance: "spawn
 * `sh -c 'sleep 1000 & sleep 1000'` ... record PIDs, never pkill -f
 * patterns") — never `pkill -f`, only PIDs this test itself spawned and
 * recorded. Every test kills its own leader/members in `afterEach` as a
 * safety net even when an assertion fails mid-test.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { listGroupMembers, signalGroup } from '../orgrt/process-tree.js';

/** macOS ships no `setsid` binary; perl's POSIX::setsid is the equivalent. */
const SETSID =
  process.platform === 'darwin' ? "perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV'" : 'setsid';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('process-tree: listGroupMembers / signalGroup (real processes, Linux/POSIX)', () => {
  let leader: ChildProcess | undefined;

  afterEach(() => {
    // Safety net: if an assertion threw mid-test, make sure nothing this
    // test spawned survives it. Best effort — the leader/members are almost
    // always already dead by the time a test's own signalGroup call ran.
    if (leader?.pid) {
      try {
        signalGroup(leader.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    leader = undefined;
  });

  /** Spawns `sh -c script` as the leader of its own process group (mirrors
   *  `fullAccessClaudeSpawn`'s `detached: true`), returning its pid once
   *  `spawn()` has assigned one. */
  function spawnGroupLeader(script: string): number {
    leader = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' });
    if (typeof leader.pid !== 'number') throw new Error('spawn did not assign a pid');
    // A detached child would otherwise keep this test process alive.
    leader.unref();
    return leader.pid;
  }

  it('finds background jobs (`cmd &`) as live group members, even after their parent shell exits', async () => {
    // Exactly the issue's own example: two backgrounded jobs and nothing
    // else — the leading `sh` has no foreground command left to wait on,
    // so it exits almost immediately, orphaning both `sleep`s. Reparenting
    // changes their PPID, never their PGID, so this also exercises the
    // reparented-orphan case the module doc calls out as the reason a
    // process-GROUP walk was chosen over a PPID walk.
    const pid = spawnGroupLeader('sleep 1000 & sleep 1000 &');

    await waitFor(() => listGroupMembers(pid).pids.length >= 2, 3000);
    const { pids, supported } = listGroupMembers(pid);
    expect(supported).toBe(true);
    expect(pids.length).toBeGreaterThanOrEqual(2);
    for (const p of pids) expect(isAlive(p)).toBe(true);

    // cleanup for this test (afterEach is a backstop, not the primary path)
    signalGroup(pid, 'SIGKILL');
    await waitFor(() => pids.every((p) => !isAlive(p)), 3000);
  }, 10_000);

  it('signalGroup(SIGKILL) leaves zero descendants — the whole group is gone', async () => {
    const pid = spawnGroupLeader('sleep 1000 & sleep 1000 & sleep 1000 &');
    await waitFor(() => listGroupMembers(pid).pids.length >= 3, 3000);
    const recordedPids = [pid, ...listGroupMembers(pid).pids];
    expect(recordedPids.length).toBeGreaterThanOrEqual(4);

    signalGroup(pid, 'SIGKILL');

    await waitFor(() => recordedPids.every((p) => !isAlive(p)), 3000);
    for (const p of recordedPids) expect(isAlive(p)).toBe(false);
    expect(listGroupMembers(pid).pids).toHaveLength(0);
  }, 10_000);

  it('SIGTERM-then-SIGKILL ladder (mirrors killOnAbort): a TERM-ignoring job still dies on KILL', async () => {
    // `trap '' TERM` makes the background job ignore SIGTERM outright —
    // the same "wedged" case the runner's 5s grace/SIGKILL escalation
    // exists for.
    const pid = spawnGroupLeader('sh -c "trap \'\' TERM; sleep 1000" &');
    await waitFor(() => listGroupMembers(pid).pids.length >= 1, 3000);
    const member = listGroupMembers(pid).pids[0];

    signalGroup(pid, 'SIGTERM');
    // Give it a moment — it should still be alive (SIGTERM trapped/ignored).
    await new Promise((r) => setTimeout(r, 200));
    expect(isAlive(member)).toBe(true);

    signalGroup(pid, 'SIGKILL');
    await waitFor(() => !isAlive(member), 3000);
    expect(isAlive(member)).toBe(false);
  }, 10_000);

  it('finds a NESTED process group — a sub-shell that started its own session/group, exactly like the real Claude Code CLI Bash tool does per shell call (live-verified against an installed `claude` 2.1.x during #359)', async () => {
    // `setsid` makes the inner `sh` the leader of a BRAND NEW session and
    // process group — a different pgid from `pid` (the outer leader)
    // entirely, unreachable by a plain top-level pgid match. Both shells
    // stay alive on their own foreground `sleep N` (not just the
    // backgrounded jobs) so the PPID edge from `pid` to the inner shell
    // is still there when this test polls for it — mirroring the moment
    // agent-runner-claude.ts's cancel/timeout ladder actually fires
    // (promptly, while the CLI's own per-call shell is still running),
    // not the harder "already exited" case documented as a known gap in
    // process-tree.ts's module doc.
    const pid = spawnGroupLeader(`${SETSID} sh -c 'sleep 1000 & sleep 1000 & sleep 2' & sleep 2`);

    // outer leader (foreground sleep 2) + inner setsid shell (foreground
    // sleep 2) + two backgrounded sleep 1000s = at least 3 group members.
    await waitFor(() => listGroupMembers(pid).pids.length >= 3, 3000);
    const { pids, supported } = listGroupMembers(pid);
    expect(supported).toBe(true);
    expect(pids.length).toBeGreaterThanOrEqual(3);
    for (const p of pids) expect(isAlive(p)).toBe(true);

    signalGroup(pid, 'SIGKILL');
    await waitFor(() => pids.every((p) => !isAlive(p)), 3000);
    for (const p of pids) expect(isAlive(p)).toBe(false);
  }, 10_000);

  it('signalGroup is a harmless no-op once the group is already gone', () => {
    const pid = spawnGroupLeader('true');
    expect(() => {
      signalGroup(pid, 'SIGTERM');
      signalGroup(pid, 'SIGKILL');
    }).not.toThrow();
  });
});

describe('process-tree: win32 (no POSIX process groups, #359 v1 gap)', () => {
  it('listGroupMembers reports unsupported instead of a false "none running"', () => {
    const result = listGroupMembers(12345, 'win32');
    expect(result).toEqual({ pids: [], supported: false });
  });

  it('signalGroup on win32 never throws even when the pid/taskkill is unavailable', () => {
    expect(() => signalGroup(999_999, 'SIGTERM', 'win32')).not.toThrow();
    expect(() => signalGroup(999_999, 'SIGKILL', 'win32')).not.toThrow();
  });
});
