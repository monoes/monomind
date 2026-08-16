/**
 * countSdkProcesses() and reapOrphanedSdkProcesses() unconditionally shelled
 * out to `pgrep`/`ps`, which don't exist on native Windows. The failure was
 * caught (both wrapped the call in try/catch, returning 0), so nothing threw
 * — but execSync inherits stderr by default, so every single call still
 * printed "'pgrep' is not recognized as an internal or external command." to
 * the console. Since countSdkProcesses runs on every lazy role spawn (via
 * checkResources), a fresh org run with several roles kicking off at once
 * printed a wall of these on Windows, on every single run.
 *
 * Fix: skip the shell-out entirely on win32 and return 0 (unknown), and
 * silence inherited stderr on the platforms where the command does exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));

let platformMock = vi.fn(() => 'win32');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => platformMock() };
});

describe('resource-governor — Windows never shells out to pgrep/ps', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    vi.resetModules();
  });

  it('countSdkProcesses() on win32 returns 0 without calling execSync', async () => {
    platformMock = vi.fn(() => 'win32');
    const { countSdkProcesses } = await import('../utils/resource-governor.js');
    expect(countSdkProcesses()).toBe(0);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('reapOrphanedSdkProcesses() on win32 returns 0 without calling execSync', async () => {
    platformMock = vi.fn(() => 'win32');
    const { reapOrphanedSdkProcesses } = await import('../utils/resource-governor.js');
    expect(reapOrphanedSdkProcesses(new Set())).toBe(0);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('countSdkProcesses() on linux still calls execSync (pgrep) with stderr silenced', async () => {
    platformMock = vi.fn(() => 'linux');
    execSyncMock.mockReturnValue('123\n456\n');
    const { countSdkProcesses } = await import('../utils/resource-governor.js');
    const result = countSdkProcesses();
    expect(result).toBe(2);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, opts] = execSyncMock.mock.calls[0] as [string, { stdio?: unknown[] }];
    expect(cmd).toContain('pgrep');
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'ignore']);
  });
});
