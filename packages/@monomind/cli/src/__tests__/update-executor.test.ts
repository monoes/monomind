/**
 * Coverage for the CLI update subsystem fixes:
 *
 *  - GitHub #83: update installs must target the global CLI (`-g`), never the
 *    user's project, and the startup path must be notify-only.
 *  - GitHub #84: npm must be spawned as `npm.cmd` on Windows (execFile of the
 *    bare `npm` .cmd shim throws EINVAL on Node >= 18.20.2).
 *
 * child_process and fs are mocked so the suite never runs a real npm install
 * or touches ~/.monomind/update-history.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The production code calls execFile(cmd, args, { timeout }, cb) — the
// callback is the LAST argument, not the third. A mock that assumes
// (cmd, args, cb) picks up the options object as `cb` and throws
// "cb is not a function", which executeUpdate catches and reports as a
// failed update (success: false) — a mock-shape bug, not a product bug.
const execFileMock = vi.fn((...args: unknown[]) => {
  const cb = args[args.length - 1] as (err: Error | null) => void;
  cb(null);
});

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) =>
    (execFileMock as (...a: unknown[]) => void)(...args),
  execFileSync: vi.fn(() => '/usr/local\n'),
}));

const fsState = {
  historyJson: null as string | null,
};

vi.mock('fs', () => ({
  existsSync: vi.fn(() => fsState.historyJson !== null),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 128 })),
  readFileSync: vi.fn(() => fsState.historyJson),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(() => {
    fsState.historyJson = null;
  }),
}));

import { npmCommand } from '../utils/npm-command.js';
import { executeUpdate, rollbackUpdate } from '../update/executor.js';
import type { UpdateCheckResult } from '../update/checker.js';

function makeUpdate(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    package: '@monoes/monomindcli',
    currentVersion: '1.11.0',
    latestVersion: '1.11.1',
    updateType: 'patch',
    shouldAutoUpdate: true,
    priority: 'normal',
    ...overrides,
  } as UpdateCheckResult;
}

describe('npmCommand() (#84)', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns bare "npm" on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(npmCommand()).toBe('npm');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(npmCommand()).toBe('npm');
  });

  it('returns "npm.cmd" on win32 so execFile does not throw EINVAL', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(npmCommand()).toBe('npm.cmd');
  });
});

describe('executeUpdate (#83)', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    fsState.historyJson = null;
  });

  it('installs globally with -g so the user project is never touched', async () => {
    const result = await executeUpdate(makeUpdate(), {});
    expect(result.success).toBe(true);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe(npmCommand());
    expect(args[0]).toBe('install');
    expect(args).toContain('-g');
    expect(args).toContain('@monoes/monomindcli@1.11.1');
    // No cwd option is passed, but -g makes cwd irrelevant to the target.
    expect(args.join(' ')).not.toMatch(/\s--prefix\s/);
  });

  it('does not invoke npm at all in dry-run mode', async () => {
    const result = await executeUpdate(makeUpdate(), {}, true);
    expect(result.success).toBe(true);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe('rollbackUpdate (#83/#84)', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    fsState.historyJson = JSON.stringify([
      {
        timestamp: new Date().toISOString(),
        package: '@monoes/monomindcli',
        fromVersion: '1.11.0',
        toVersion: '1.11.1',
        success: true,
        rollbackAvailable: true,
      },
    ]);
  });

  it('reinstalls the previous version globally with -g', async () => {
    const result = await rollbackUpdate('@monoes/monomindcli');
    expect(result.success).toBe(true);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe(npmCommand());
    expect(args[0]).toBe('install');
    expect(args).toContain('-g');
    expect(args).toContain('@monoes/monomindcli@1.11.0');
  });
});

describe('runStartupUpdateCheck (#83 notify-only)', () => {
  it('never applies updates on startup — only reports them', async () => {
    vi.resetModules();
    execFileMock.mockClear();

    vi.doMock('../update/checker.js', () => ({
      DEFAULT_CONFIG: {},
      checkForUpdates: vi.fn(async () => ({
        results: [makeUpdate()],
        skipped: false,
      })),
    }));
    vi.doMock('../update/rate-limiter.js', () => ({
      getCachedVersions: vi.fn(() => ({})),
    }));

    const { runStartupUpdateCheck } = await import('../update/index.js');
    const result = await runStartupUpdateCheck({ autoUpdate: true });

    expect(result.checked).toBe(true);
    expect(result.updatesAvailable).toHaveLength(1);
    expect(result.updatesApplied).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();

    vi.doUnmock('../update/checker.js');
    vi.doUnmock('../update/rate-limiter.js');
  });
});
