/**
 * Unit tests for `trackDescendants` (orgrt/process-tree.ts) — #359's
 * follow-up fix. A single point-in-time `groupClosure` snapshot cannot
 * reach a background job once its launching shell has already exited: the
 * real, installed Claude Code CLI spawns each Bash-tool shell call as the
 * leader of its OWN process group (live-verified during #359), and that
 * shell typically exits within milliseconds of backgrounding a job — by
 * the time a user hits Stop "minutes later", there is no live PPID edge
 * left to the shell, and its pgid was never recorded anywhere durable.
 * `trackDescendants` samples the tree every `intervalMs` for the turn's
 * lifetime specifically to catch that shell (and record its pgid) WHILE
 * it's still connected, so a later `signal()`/`liveMembers()` call can
 * still reach the orphaned job through that recorded pgid.
 *
 * Uses REAL short-lived processes — never `pkill -f`, only PIDs this test
 * itself discovered and recorded.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { trackDescendants } from '../orgrt/process-tree.js';
import { EXEC_TREE_ENV, pidsWithMarker } from '../orgrt/process-tree-marker.js';

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
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** macOS ships no `setsid` binary; perl's POSIX::setsid is the equivalent. */
const SETSID =
  process.platform === 'darwin' ? "perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV'" : 'setsid';

/** A long-running job whose environment the marker scan can read. macOS hides
 *  the environment of SIP-protected platform binaries (`ps -E` shows nothing
 *  for /bin/sleep), so there the job is a node process — the marker logic
 *  under test is identical, only the executable differs. `tag` is a unique
 *  number that `pgrep` can anchor on. */
const jobCmd = (tag: number): string =>
  process.platform === 'darwin'
    ? `${process.execPath} -e "setInterval(Object,${tag}e6)"`
    : `sleep ${tag}`;
const jobPattern = (tag: number): string =>
  process.platform === 'darwin'
    ? `^${process.execPath} -e setInterval\\(Object,${tag}e6\\)$`
    : `^sleep ${tag}$`;

/** Spawns a leader that runs a NESTED shell in its own session/process
 *  group (`setsid`) — exactly like the real Claude Code CLI's Bash tool
 *  per shell call — which backgrounds `sleep 1000`, lingers briefly on its
 *  own foreground sleep (long enough for a fast sampler to reliably
 *  observe it — this is the deterministic stand-in for "whatever brief
 *  window a real fork/exec chain leaves"), then exits for good. Both the
 *  outer leader and the nested shell disappear on their own; only the
 *  orphaned `sleep 1000` — reparented, carrying the now-dead nested
 *  shell's pgid — is left running. */
function spawnLeaderWithFleetingNestedJob(): number {
  const leader = spawn('sh', ['-c', `${SETSID} sh -c 'sleep 1000 & sleep 0.2' & sleep 0.2`], {
    detached: true,
    stdio: 'ignore',
  });
  if (typeof leader.pid !== 'number') throw new Error('spawn did not assign a pid');
  leader.unref();
  return leader.pid;
}

describe('trackDescendants: continuous sampling reaches a job whose launching shell has ALREADY exited', () => {
  let spawnedPids: number[] = [];

  afterEach(() => {
    // Safety net: kill anything this test discovered but a mid-test
    // assertion failure left alive, by explicit recorded pid.
    for (const pid of spawnedPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    spawnedPids = [];
  });

  it('(a) signal(): kills the orphaned job even after the launching shell is fully gone — the scenario a plain closure cannot reach', async () => {
    const leaderPid = spawnLeaderWithFleetingNestedJob();
    const tracker = trackDescendants(leaderPid, { intervalMs: 20 });

    // The sampler must catch the job while the nested shell still connects
    // it to leaderPid. (The set seen at this instant also includes
    // short-lived scaffolding — the outer/nested shells' own keep-alive
    // sleeps — that is EXPECTED to exit on its own shortly; only the real
    // background job is meant to still be running afterward.)
    await waitFor(() => tracker.liveMembers().pids.length >= 1, 3000);

    // Now wait for EVERYTHING above the job — the outer leader AND the
    // nested shell — to be fully gone, simulating "the user hits Stop
    // minutes later": nothing but the orphan itself is left running, and
    // a fresh point-in-time closure from leaderPid would find nothing.
    await waitFor(() => !isAlive(leaderPid), 3000);
    await new Promise((r) => setTimeout(r, 250)); // let the nested shell fully exit too

    // Re-query AFTER teardown: `liveMembers()` only returns pids that are
    // BOTH recorded (seen during sampling) AND still alive right now — the
    // real assertion this test exists for is that the actual background
    // job survives this filter (i.e. is still discoverable) even though
    // its whole launching chain is gone.
    const survivors = tracker.liveMembers().pids;
    spawnedPids = [leaderPid, ...survivors];
    expect(survivors.length).toBeGreaterThanOrEqual(1);
    for (const p of survivors) expect(isAlive(p)).toBe(true);

    tracker.stop();
    tracker.signal('SIGKILL');

    await waitFor(() => survivors.every((p) => !isAlive(p)), 3000);
    for (const p of survivors) expect(isAlive(p)).toBe(false);
  }, 10_000);

  it('(b) liveMembers(): reports the orphaned job as a background survivor on a normal end_turn (nohup-style)', async () => {
    const leaderPid = spawnLeaderWithFleetingNestedJob();
    const tracker = trackDescendants(leaderPid, { intervalMs: 20 });

    await waitFor(() => tracker.liveMembers().pids.length >= 1, 3000);
    await waitFor(() => !isAlive(leaderPid), 3000);
    await new Promise((r) => setTimeout(r, 250));

    const { pids, supported } = tracker.liveMembers();
    spawnedPids = [leaderPid, ...pids];
    expect(supported).toBe(true);
    expect(pids.length).toBeGreaterThanOrEqual(1);
    for (const p of pids) expect(isAlive(p)).toBe(true);

    tracker.stop();
    // Test cleanup, by explicit recorded pid (afterEach is the backstop).
    for (const p of pids) {
      try {
        process.kill(p, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, 10_000);

  it("(c) the sampler interval is unref'd — it never keeps a process alive on its own", () => {
    const scratch = mkdtempSync(join(tmpdir(), 'monomind-359-tracker-'));
    try {
      const modulePath = join(__dirname, '..', 'orgrt', 'process-tree.ts').replace(/\\/g, '/');
      const scriptPath = join(scratch, 'script.cjs');
      // No stop() call, no other work: if the interval holds the event loop
      // open, this process hangs until spawnSync's own timeout kills it.
      writeFileSync(
        scriptPath,
        `const { trackDescendants } = require(${JSON.stringify(modulePath)});\n` +
          `const t = trackDescendants(process.pid, { intervalMs: 20 });\n` +
          `t.sampleNow();\n`,
      );
      const tsxCjs = require.resolve('tsx/cjs');
      const res = spawnSync(process.execPath, ['-r', tsxCjs, scriptPath], {
        timeout: 3000,
        stdio: 'ignore',
      });
      // spawnSync sets `.signal` when ITS OWN timeout had to kill the
      // child — that would mean an interval kept the process alive.
      expect(res.signal).toBeNull();
      expect(res.error).toBeUndefined();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 8_000);

  it.skipIf(process.platform === 'win32')(
    '(d) the env marker reaches a job whose whole launching chain exited before any sample ran',
    async () => {
      const token = randomUUID();
      // The nested shell backgrounds the job and exits at once; the tracker
      // is only created after the whole chain is gone, with no timer tick,
      // so the sampled closure can never have seen it — only the marker can.
      const leader = spawn('sh', ['-c', `${SETSID} sh -c '${jobCmd(1000)} & exit' & exit`], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, [EXEC_TREE_ENV]: token },
      });
      const leaderPid = leader.pid as number;
      leader.unref();
      await waitFor(() => !isAlive(leaderPid) && pidsWithMarker(token).length === 1, 5_000);
      const [jobPid] = pidsWithMarker(token);
      spawnedPids = [jobPid];
      expect(pidsWithMarker(randomUUID())).toEqual([]);

      const tracker = trackDescendants(leaderPid, { intervalMs: 60_000, marker: token });
      try {
        expect(tracker.liveMembers().pids).toContain(jobPid);
        tracker.signal('SIGKILL');
        await waitFor(() => !isAlive(jobPid), 5_000);
        expect(tracker.liveMembers().pids).toEqual([]);
      } finally {
        tracker.stop();
      }
    },
    10_000,
  );

  it.skipIf(process.platform === 'win32')(
    '(e) a process that left the tree (MONOMIND_EXEC_TREE set to another value, #366) is never reported or killed',
    async () => {
      const token = randomUUID();
      const findByArg = (arg: string): number[] =>
        spawnSync('pgrep', ['-f', jobPattern(Number(arg))], { encoding: 'utf8' })
          .stdout.split('\n')
          .filter(Boolean)
          .map(Number);
      // A hook-style setup daemon (env marker cleared) and a real background
      // job, both started from nested setsid shells that stay long enough for
      // the sampler to record them.
      const leader = spawn(
        'sh',
        [
          '-c',
          `MONOMIND_EXEC_TREE= ${SETSID} sh -c '${jobCmd(1366)} & sleep 0.3' & ${SETSID} sh -c '${jobCmd(1367)} & sleep 0.3' & sleep 0.4`,
        ],
        { detached: true, stdio: 'ignore', env: { ...process.env, [EXEC_TREE_ENV]: token } },
      );
      const leaderPid = leader.pid as number;
      leader.unref();
      const tracker = trackDescendants(leaderPid, { intervalMs: 20, marker: token });
      try {
        await waitFor(
          () => findByArg('1366').length === 1 && findByArg('1367').length === 1,
          5_000,
        );
        const [daemon] = findByArg('1366');
        const [job] = findByArg('1367');
        spawnedPids = [daemon, job];
        await waitFor(() => !isAlive(leaderPid), 5_000);
        await new Promise((r) => setTimeout(r, 400)); // nested shells exit too
        const { pids } = tracker.liveMembers();
        expect(pids).toContain(job);
        expect(pids).not.toContain(daemon);
        tracker.signal('SIGKILL');
        await waitFor(() => !isAlive(job), 5_000);
        expect(isAlive(daemon)).toBe(true);
      } finally {
        tracker.stop();
      }
    },
    10_000,
  );
});
