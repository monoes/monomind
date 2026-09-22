/**
 * Test that reapOrphanedSdkProcesses only kills truly orphaned processes,
 * not live children of running daemons.
 *
 * Issue: cleanup --force was calling reapOrphanedSdkProcesses(new Set()) with
 * no ownerPid, causing it to kill ALL SDK processes machine-wide, including
 * live org agents.
 *
 * Fix: When ownerPid is undefined, only kill processes that are genuinely
 * orphaned (ppid === 1 OR parent is an init/subreaper like systemd --user).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();
const killMock = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

let platformMock = vi.fn(() => 'linux');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => platformMock() };
});

// Mock process.kill
const originalKill = process.kill;

describe('resource-governor — orphan detection', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    killMock.mockReset();
    process.kill = killMock as unknown as typeof process.kill;
    vi.resetModules();
  });

  afterEach(() => {
    process.kill = originalKill;
  });

  it('reapOrphanedSdkProcesses without ownerPid kills only orphaned processes (ppid=1)', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with:
    // - PID 1234, PPID 5000 (live parent) - should survive
    // - PID 5678, PPID 1 (orphaned - init adopted it) - should be killed
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 1234  5000 node /path/to/claude-agent-sdk --output-format json
 5678     1 node /path/to/claude-agent-sdk --output-format json
 9999  2000 some-other-process
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
    expect(killMock).not.toHaveBeenCalledWith(1234, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses without ownerPid kills processes parented by systemd --user', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with process parented by systemd --user (typical subreaper)
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 1486     1 /usr/lib/systemd/systemd --user
 1234  1486 node /path/to/claude-agent-sdk --output-format json
 5000  2000 node /path/to/monomind-daemon
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(1234, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses without ownerPid preserves processes with live monomind daemon parent', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with SDK process parented by live monomind org daemon
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 5000  1486 node /path/to/monomind org daemon start
 1234  5000 node /path/to/claude-agent-sdk --output-format json
 1486     1 /usr/lib/systemd/systemd --user
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('reapOrphanedSdkProcesses without ownerPid preserves processes with any other live parent', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with SDK process parented by some other live node app
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 5000  1486 node /path/to/some-other-app
 1234  5000 node /path/to/claude-agent-sdk --output-format json
 1486     1 /usr/lib/systemd/systemd --user
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('reapOrphanedSdkProcesses without ownerPid preserves a live process whose ppid is 1 only because the invoking shell IS pid 1 (PID-namespace sandbox)', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output as seen from inside a `bwrap --unshare-pid`-style
    // sandbox: the invoking shell is pid 1 of its own namespace (not an
    // init/subreaper), and it has a live, non-orphaned SDK-pattern child
    // whose ppid therefore reads as 1 too.
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
    1     0 -bash
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('reapOrphanedSdkProcesses without ownerPid still kills a process whose visible pid-1 parent really is an init/subreaper', async () => {
    platformMock = vi.fn(() => 'linux');
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
    1     0 /sbin/init
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses without ownerPid preserves a live process whose ppid is 1 because pid 1 is a zsh/sh login shell too (shell deny-list, not just bash)', async () => {
    platformMock = vi.fn(() => 'linux');
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
    1     0 -zsh
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
  });

  // Round 2 regression: cli-qa found that after the round-1 fix above, a
  // GENUINE orphan (double-fork+setsid, reparented to a real pid-1 subreaper,
  // ppid === 1 confirmed live via `ps`) was no longer reaped at all when
  // pid 1's own command didn't match the systemd/init allow-list — e.g. a
  // sandbox wrapper like `bwrap` acting as the namespace's subreaper, or
  // `tini`/`dumb-init` in a container with no systemd. That's a broad class
  // of real deployment environments, not just this test sandbox. The fix is
  // a deny-list (isShellLikeCmd) instead of an allow-list (isInitSubreaperCmd)
  // for the pid1 === ppid check: trust ppid === 1 for ANY pid 1 that doesn't
  // look like the live invoking shell, not only for systemd/init by name.
  it('reapOrphanedSdkProcesses without ownerPid kills a genuine orphan whose pid-1 subreaper is a sandbox wrapper (bwrap), not systemd/init', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output as seen from inside a `bwrap --unshare-pid` sandbox
    // where bwrap itself (not a live shell) is acting as pid 1's subreaper,
    // and the SDK process is a genuine orphan reparented to it.
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
    1     0 bwrap --unshare-pid --dev-bind / /
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses without ownerPid kills a genuine orphan whose pid-1 subreaper is tini, not systemd/init', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output as seen from inside a container that uses tini as its
    // pid-1 init/subreaper instead of systemd — a common case for CI
    // runners and minimal container images with no real init process.
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
    1     0 /usr/bin/tini -- node app.js
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses with ownerPid kills only children of that owner', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with multiple processes
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 1234  5000 node /path/to/claude-agent-sdk --output-format json
 5678  6000 node /path/to/claude-agent-sdk --output-format json
 9999  5000 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set(), 5000);

    expect(reaped).toBe(2);
    expect(killMock).toHaveBeenCalledTimes(2);
    expect(killMock).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(killMock).toHaveBeenCalledWith(9999, 'SIGTERM');
    expect(killMock).not.toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('reapOrphanedSdkProcesses respects protectedPids', async () => {
    platformMock = vi.fn(() => 'linux');
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 1234     1 node /path/to/claude-agent-sdk --output-format json
 5678     1 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set([1234]));

    expect(reaped).toBe(1);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(killMock).toHaveBeenCalledWith(5678, 'SIGTERM');
    expect(killMock).not.toHaveBeenCalledWith(1234, 'SIGTERM');
  });
});
