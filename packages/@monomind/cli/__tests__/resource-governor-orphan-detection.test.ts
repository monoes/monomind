/**
 * Test that reapOrphanedSdkProcesses only kills truly orphaned processes,
 * not live children of running daemons.
 *
 * Issue: cleanup --force was calling reapOrphanedSdkProcesses(new Set()) with
 * no ownerPid, causing it to kill ALL SDK processes machine-wide, including
 * live org agents.
 *
 * Fix: When ownerPid is undefined, only kill processes that are genuinely
 * orphaned (ppid === 1 or parent process doesn't exist).
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

  it('reapOrphanedSdkProcesses without ownerPid preserves processes with live parents', async () => {
    platformMock = vi.fn(() => 'linux');
    // Mock ps output with only live-parented processes
    execSyncMock.mockReturnValue(`  PID  PPID COMMAND
 1234  5000 node /path/to/claude-agent-sdk --output-format json
 5678  6000 node /path/to/claude-agent-sdk --output-format json
`);

    const { reapOrphanedSdkProcesses } = await import('../src/utils/resource-governor.js');
    const reaped = reapOrphanedSdkProcesses(new Set());

    expect(reaped).toBe(0);
    expect(killMock).not.toHaveBeenCalled();
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
