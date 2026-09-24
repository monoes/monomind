/**
 * Orphan reaping for `cleanup --force` is decided by OWNERSHIP, not by the
 * name of pid 1.
 *
 * History: 0d8a93165 trusted ppid === 1 only when pid 1 was systemd/init by
 * name (broke tini/bwrap containers); 02eb480d5 flipped that to "pid 1 is a
 * shell => don't trust" — still wrong when Claude Code itself is a
 * container's pid 1 (`node .../claude`), whose live SDK children have ppid 1.
 * Reproduced with real processes in a PID namespace: 3/3 live children of a
 * `node /usr/local/bin/claude` pid 1 were SIGTERMed by the 2.15.6 build.
 *
 * Rules now (selectOrphanedSdkPids): never self/ancestor/descendant; never a
 * process in the invoking session or process group; never one with a live
 * claude/monomind process up its parent chain; and only when it is not in
 * its live parent's session (an orphan adopted by any subreaper is not).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcEntry } from '../src/utils/resource-governor.js';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));
let platformMock = vi.fn(() => 'darwin');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => platformMock() };
});

const { parseProcStat, selectOrphanedSdkPids } = await import('../src/utils/resource-governor.js');

const SDK = 'node /path/to/claude-agent-sdk/cli.js --output-format json';
const SELF = 9000;

/** The invoking `monomind cleanup` process, in session/group 8000 under a shell. */
const invoker: ProcEntry[] = [
  { pid: 8000, ppid: 1500, pgrp: 8000, sid: 8000, cmd: '-bash' },
  { pid: SELF, ppid: 8000, pgrp: SELF, sid: 8000, cmd: 'node /usr/bin/monomindcli cleanup --force' },
];
const init: ProcEntry = { pid: 1, ppid: 0, pgrp: 1, sid: 1, cmd: '/sbin/init' };
const userSystemd: ProcEntry = {
  pid: 1500,
  ppid: 1,
  pgrp: 1500,
  sid: 1500,
  cmd: '/usr/lib/systemd/systemd --user',
};

function select(table: ProcEntry[], protectedPids = new Set<number>(), ownerPid?: number) {
  return selectOrphanedSdkPids(table, SELF, protectedPids, ownerPid);
}

describe('selectOrphanedSdkPids — ownership, not pid-1 names', () => {
  it('reaps a genuine double-fork + setsid orphan adopted by systemd --user', () => {
    const orphan = { pid: 7000, ppid: 1500, pgrp: 6999, sid: 6999, cmd: SDK };
    expect(select([init, userSystemd, ...invoker, orphan])).toEqual([7000]);
  });

  it.each([
    ['/sbin/init'],
    ['bwrap --unshare-pid --dev-bind / /'],
    ['/usr/bin/tini -- node app.js'],
    ['-bash'],
  ])('reaps an orphan adopted by pid 1 = %s when it is in its own session', (pid1Cmd) => {
    const orphan = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: SDK };
    const pid1 = { ...init, cmd: pid1Cmd };
    expect(select([pid1, userSystemd, ...invoker, orphan])).toEqual([7000]);
  });

  it('keeps a live-parented child: same session as its live parent', () => {
    const parent = { pid: 6000, ppid: 1500, pgrp: 6000, sid: 6000, cmd: 'node /srv/app.js' };
    const child = { pid: 7000, ppid: 6000, pgrp: 6000, sid: 6000, cmd: SDK };
    expect(select([init, userSystemd, ...invoker, parent, child])).toEqual([]);
  });

  it('keeps a child of the invoking shell (shares the invoking session)', () => {
    const child = { pid: 7000, ppid: 8000, pgrp: 7000, sid: 8000, cmd: SDK };
    expect(select([init, userSystemd, ...invoker, child])).toEqual([]);
  });

  it('keeps a dummy whose parent is pid 1 but which shares the invoking session', () => {
    // PID namespace: the invoking shell IS pid 1, its child reads ppid 1.
    const shell1: ProcEntry = { pid: 1, ppid: 0, pgrp: 1, sid: 1, cmd: 'bwrap --unshare-pid' };
    const self: ProcEntry = { pid: SELF, ppid: 1, pgrp: SELF, sid: 1, cmd: 'node monomindcli' };
    const child = { pid: 7000, ppid: 1, pgrp: 7000, sid: 1, cmd: SDK };
    expect(select([shell1, self, child])).toEqual([]);
  });

  it('keeps live SDK children of Claude Code running as a container pid 1, even in their own session', () => {
    const claude1: ProcEntry = { pid: 1, ppid: 0, pgrp: 1, sid: 1, cmd: 'node /usr/local/bin/claude' };
    const self: ProcEntry = { pid: SELF, ppid: 50, pgrp: SELF, sid: 50, cmd: 'node monomindcli' };
    const execShell: ProcEntry = { pid: 50, ppid: 0, pgrp: 50, sid: 50, cmd: 'sh' };
    const child = { pid: 7000, ppid: 1, pgrp: 7000, sid: 7000, cmd: SDK };
    expect(select([claude1, execShell, self, child])).toEqual([]);
  });

  it('reaps a genuine orphan whose pid 1 is a bwrap wrapper bind-mounting claude/monomind paths', () => {
    // bwrap (the sandbox every org role's actual runtime is confined by)
    // stays resident as the sandbox's pid 1/subreaper, keeping its own
    // invocation — including --ro-bind paths that mention "claude" and
    // "monomind" — as pid 1's cmdline. That must not be mistaken for a live
    // claude/monomind session: the wrapped command (after bwrap's `--`) is
    // an unrelated shell, so the orphan should still be reaped.
    const bwrap1: ProcEntry = {
      pid: 1,
      ppid: 0,
      pgrp: 1,
      sid: 1,
      cmd: 'bwrap --ro-bind /home/user/.claude /home/user/.claude --ro-bind /home/user/.monomind /home/user/.monomind --dev /dev -- /bin/sh -c run.sh',
    };
    const orphan = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: SDK };
    expect(select([bwrap1, userSystemd, ...invoker, orphan])).toEqual([7000]);
  });

  it('still protects a live claude/monomind session bwrap execs after its bind-mount flags', () => {
    const bwrap1: ProcEntry = {
      pid: 1,
      ppid: 0,
      pgrp: 1,
      sid: 1,
      cmd: 'bwrap --ro-bind /home/user/.claude /home/user/.claude -- node /usr/local/bin/claude',
    };
    const child = { pid: 7000, ppid: 1, pgrp: 7000, sid: 7000, cmd: SDK };
    expect(select([bwrap1, userSystemd, ...invoker, child])).toEqual([]);
  });

  it('reaps an orphan behind a bwrap-wrapped shell script that only incidentally mentions .claude paths and a claude-http-*.sock name', () => {
    // Real repro (round-2 cli-qa, reapertest-36c79c6d): the wrapped command
    // after bwrap's `--` is not Claude Code or monomind at all — it's a
    // bash script that sources a Claude Code shell snapshot from
    // ~/.claude/shell-snapshots/... and opens a proxy socket named
    // claude-http-<hash>.sock, both for reasons unrelated to being a live
    // claude/monomind session. A raw word-boundary substring test against
    // the whole wrapped line matches ".claude" and "claude-http-...sock"
    // anyway and wrongly shields every orphan under this ancestor.
    const bwrap1: ProcEntry = {
      pid: 1,
      ppid: 0,
      pgrp: 1,
      sid: 1,
      cmd:
        'bwrap --ro-bind /home/user/.claude /home/user/.claude -- ' +
        '/bin/bash -c "source /home/user/.claude/shell-snapshots/snap-abc123.sh ' +
        '&& exec node server.js --socket /tmp/claude-http-9f3a2c.sock"',
    };
    const orphan = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: SDK };
    expect(select([bwrap1, userSystemd, ...invoker, orphan])).toEqual([7000]);
  });

  it('still protects a real live session even when the same bwrap-wrapped line also has incidental .claude/monomind path mentions', () => {
    // Same shape as above, but the wrapped command really does exec Claude
    // Code (a bare `claude` executable token) alongside the same kind of
    // incidental .claude path and claude-http-*.sock mentions — proving the
    // fix isn't a blanket "ignore bwrap-wrapped scripts" but a real
    // executable-name check that still fires on a genuine live session.
    const bwrap1: ProcEntry = {
      pid: 1,
      ppid: 0,
      pgrp: 1,
      sid: 1,
      cmd:
        'bwrap --ro-bind /home/user/.claude /home/user/.claude -- ' +
        '/bin/bash -c "source /home/user/.claude/shell-snapshots/snap-abc123.sh ' +
        '&& exec node /usr/local/bin/claude --socket /tmp/claude-http-9f3a2c.sock"',
    };
    const child = { pid: 7100, ppid: 1, pgrp: 7100, sid: 7100, cmd: SDK };
    expect(select([bwrap1, userSystemd, ...invoker, child])).toEqual([]);
  });

  it('keeps a process with a live claude/monomind ancestor further up the chain', () => {
    const daemon = { pid: 5000, ppid: 1500, pgrp: 5000, sid: 5000, cmd: 'node monomind org daemon' };
    const wrapper = { pid: 5100, ppid: 5000, pgrp: 5100, sid: 5100, cmd: 'sh -c run' };
    const child = { pid: 7000, ppid: 5100, pgrp: 7000, sid: 7000, cmd: SDK };
    expect(select([init, userSystemd, ...invoker, daemon, wrapper, child])).toEqual([]);
  });

  it('never selects the invoking process, its ancestors, or its descendants', () => {
    const sdkAncestor = { pid: 8000, ppid: 1, pgrp: 7777, sid: 7777, cmd: SDK };
    const self = { pid: SELF, ppid: 8000, pgrp: SELF, sid: 7777, cmd: SDK };
    const descendant = { pid: 9100, ppid: SELF, pgrp: 9100, sid: 9100, cmd: SDK };
    expect(select([init, sdkAncestor, self, descendant])).toEqual([]);
  });

  it('fails safe when the invoking process is not in the table', () => {
    const orphan = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: SDK };
    expect(selectOrphanedSdkPids([init, orphan], 424242, new Set())).toEqual([]);
  });

  it('keeps a process whose non-1 parent is not visible (raced away or outside the view)', () => {
    const child = { pid: 7000, ppid: 6000, pgrp: 6999, sid: 6999, cmd: SDK };
    expect(select([init, ...invoker, child])).toEqual([]);
  });

  it('respects protectedPids', () => {
    const a = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: SDK };
    const b = { pid: 7001, ppid: 1, pgrp: 6998, sid: 6998, cmd: SDK };
    expect(select([init, ...invoker, a, b], new Set([7000]))).toEqual([7001]);
  });

  it('with ownerPid selects only that owner’s direct SDK children', () => {
    const rows = [
      { pid: 1234, ppid: 5000, cmd: SDK },
      { pid: 5678, ppid: 6000, cmd: SDK },
      { pid: 9999, ppid: 5000, cmd: SDK },
    ];
    expect(select(rows, new Set(), 5000)).toEqual([1234, 9999]);
  });

  it('ignores processes that do not look like SDK agents', () => {
    const other = { pid: 7000, ppid: 1, pgrp: 6999, sid: 6999, cmd: 'node claude-agent-sdk' };
    expect(select([init, ...invoker, other])).toEqual([]);
  });
});

describe('parseProcStat', () => {
  it('reads ppid, pgrp, session and start time even when comm has spaces and parens', () => {
    const stat =
      '4242 (we ird) (name) S 1500 4241 4241 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10';
    expect(parseProcStat(stat)).toEqual({
      pid: 4242,
      ppid: 1500,
      pgrp: 4241,
      sid: 4241,
      start: 987654,
    });
  });

  it('returns null for garbage', () => {
    expect(parseProcStat('nonsense')).toBeNull();
  });
});

// ── ps fallback (macOS / no /proc): pid, ppid, pgid — no sessions ──────────

describe('reapOrphanedSdkProcesses — ps fallback', () => {
  const killMock = vi.fn();
  const originalKill = process.kill;
  const me = process.pid;

  beforeEach(() => {
    execSyncMock.mockReset();
    killMock.mockReset();
    process.kill = killMock as unknown as typeof process.kill;
    platformMock = vi.fn(() => 'darwin');
    vi.resetModules();
  });
  afterEach(() => {
    process.kill = originalKill;
  });

  const ps = (rows: string) => `  PID  PPID  PGID COMMAND\n    1     0     1 /sbin/launchd\n ${me}   800   800 node monomindcli cleanup\n${rows}`;

  it('reaps a launchd-adopted orphan in another process group', async () => {
    execSyncMock.mockReturnValue(ps(` 5678     1  5678 ${SDK}\n`));
    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    expect(reapOrphanedSdkProcesses(new Set())).toBe(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
    expect(execSyncMock.mock.calls[0]?.[0]).toBe('ps -eo pid,ppid,pgid,command');
  });

  it('keeps a live-parented process and one in the invoking process group', async () => {
    execSyncMock.mockReturnValue(
      ps(` 5000  4000  5000 node /srv/app.js\n 1234  5000  5000 ${SDK}\n 5679     1   800 ${SDK}\n`),
    );
    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    expect(reapOrphanedSdkProcesses(new Set())).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('with ownerPid kills only children of that owner', async () => {
    execSyncMock.mockReturnValue(
      ps(` 1234  5000  5000 ${SDK}\n 5678  6000  6000 ${SDK}\n 9999  5000  5000 ${SDK}\n`),
    );
    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    expect(reapOrphanedSdkProcesses(new Set(), 5000)).toBe(2);
    expect(killMock).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(killMock).toHaveBeenCalledWith(9999, 'SIGTERM');
    expect(killMock).not.toHaveBeenCalledWith(5678, 'SIGTERM');
  });
});
