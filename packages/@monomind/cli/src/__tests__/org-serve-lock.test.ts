/**
 * `org serve` had no mutual-exclusion check preventing two daemon processes
 * from running against the same project root at once. Each process builds
 * its own in-memory OrgDaemon with zero visibility into the other, so both
 * independently decide which orgs are "due now" and both call
 * daemon.startOrg(name) for anything they share — a guaranteed cross-process
 * double-run writing to the same on-disk state (runtime.json,
 * decisions.jsonl, history.jsonl, .mail/) with real multi-writer corruption
 * risk.
 *
 * checkServeLock() is the guard serveAction now calls before constructing
 * its daemon/server/scheduler. It reuses the existing serve-heartbeat.json
 * pidfile (pid + timestamp, already written every 30s and cleared on clean
 * shutdown by daemon.clearHeartbeat()) rather than inventing a second file.
 *
 * These tests exercise the guard directly, mirroring org-runfile-poll.test.ts's
 * approach of testing org.ts's exported helpers against a real temp dir
 * instead of driving the full `org serve` CLI action (which blocks on
 * SIGINT/SIGTERM and stands up a real daemon).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkServeLock } from '../commands/org.js';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'serve-lock-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const heartbeatPath = (): string => join(cwd, '.monomind', 'serve-heartbeat.json');
const writeHeartbeat = (pid: number, updatedAt = new Date().toISOString()): void => {
  mkdirSync(join(cwd, '.monomind'), { recursive: true });
  writeFileSync(heartbeatPath(), JSON.stringify({ pid, updatedAt }), 'utf8');
};

describe('checkServeLock', () => {
  it('allows starting when no heartbeat file exists', () => {
    expect(checkServeLock(cwd)).toEqual({ ok: true, staleHeartbeatRemoved: false });
  });

  it('refuses to start a second daemon while a live one holds a fresh heartbeat', () => {
    // process.ppid is a real, live pid distinct from this test process — the
    // parent that launched the test runner. Using process.pid itself would
    // hit liveServeDaemonPid's own self-exclusion branch (a pid can't lock
    // out itself), so this is the reliable way to simulate "another live
    // process" without spawning a child.
    const otherPid = process.ppid;
    writeHeartbeat(otherPid);
    expect(checkServeLock(cwd)).toEqual({ ok: false, pid: otherPid });
    // A refusal must not touch the heartbeat it refused to override.
    expect(existsSync(heartbeatPath())).toBe(true);
  });

  it('does not block a fresh start when the heartbeat pid is not alive (stale)', () => {
    // Extremely unlikely to be a live pid on any test machine.
    const deadPid = 999_999_999;
    writeHeartbeat(deadPid);
    expect(checkServeLock(cwd)).toEqual({ ok: true, staleHeartbeatRemoved: true });
    // The stale pidfile is cleaned up so it can't be misread before this
    // daemon's own writeHeartbeat() lands.
    expect(existsSync(heartbeatPath())).toBe(false);
  });

  it('does not block a fresh start when the heartbeat is aged past a few missed beats', () => {
    // A live pid, but a timestamp old enough (> 3 missed 30s beats) that
    // liveServeDaemonPid treats it as wedged/gone rather than trust the pid
    // alone — a pid can be recycled onto an unrelated process.
    writeHeartbeat(process.ppid, new Date(Date.now() - 4 * 60_000).toISOString());
    expect(checkServeLock(cwd)).toEqual({ ok: true, staleHeartbeatRemoved: true });
    expect(existsSync(heartbeatPath())).toBe(false);
  });
});
