// packages/@monomind/cli/__tests__/update/update-executor.test.ts
//
// Tests for the update executor's security boundary:
//   - Uses execFile (not exec) — no shell
//   - Validates package name + version before constructing npm args
//   - Runs npm with --save-exact and -g flags
//   - History file sanitization (rejects tampered entries)
//   - History file size cap (rejects oversized files)
//   - Rate limiter: daily cap, interval enforcement, CI skip
//
// NOTE: The executor does NOT pass --ignore-scripts to npm install, and
// execFileAsync does NOT include a timeout. Both are security gaps
// documented in the findings section of this issue.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() runs BEFORE vi.mock hoisting, so refs are valid
// ---------------------------------------------------------------------------

const { execFileMock, fsMock } = vi.hoisted(() => {
  const execFileMock = vi.fn();
  const fsMock = {
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ size: 100 })),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { execFileMock, fsMock };
});

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock('fs', () => ({
  default: fsMock,
  ...fsMock,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  executeUpdate,
  loadHistory,
  rollbackUpdate,
  clearHistory,
} from '../../packages/@monomind/cli/src/update/executor.js';
import type { UpdateCheckResult } from '../../packages/@monomind/cli/src/update/checker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUpdate(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    package: 'monomind',
    currentVersion: '2.8.4',
    latestVersion: '2.8.5',
    updateType: 'patch',
    shouldAutoUpdate: true,
    priority: 'high',
    ...overrides,
  };
}

/** Make execFile resolve successfully. */
function execFileResolves() {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)
  );
}

/** Make execFile reject with an error. */
function execFileRejects(msg = 'npm failed') {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) =>
      cb(new Error(msg))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeUpdate — security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
  });

  // ---- execFile, not exec ----

  it('calls child_process.execFile (not exec) to avoid shell injection', async () => {
    execFileResolves();
    await executeUpdate(makeUpdate(), {});
    expect(execFileMock).toHaveBeenCalled();
    // First arg is 'npm', second is the args array
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('npm');
    expect(Array.isArray(args)).toBe(true);
  });

  // ---- --save-exact flag ----

  it('passes --save-exact to npm install', async () => {
    execFileResolves();
    await executeUpdate(makeUpdate(), {});
    const args: string[] = execFileMock.mock.calls[0][1];
    expect(args).toContain('--save-exact');
  });

  // ---- global install (-g) ----

  it('installs globally with -g flag', async () => {
    execFileResolves();
    await executeUpdate(makeUpdate(), {});
    const args: string[] = execFileMock.mock.calls[0][1];
    expect(args).toContain('-g');
  });

  // ---- validates package name before exec ----

  it('rejects a package name with shell metacharacters before calling npm', async () => {
    const result = await executeUpdate(
      makeUpdate({ package: 'pkg;rm -rf /' }),
      {}
    );
    expect(result.success).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects a package name with backticks', async () => {
    const result = await executeUpdate(
      makeUpdate({ package: '`whoami`' }),
      {}
    );
    expect(result.success).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  // ---- validates version before exec ----

  it('rejects a version string containing path traversal', async () => {
    const result = await executeUpdate(
      makeUpdate({ latestVersion: '../../etc/passwd' }),
      {}
    );
    expect(result.success).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects a version string that is a URL', async () => {
    const result = await executeUpdate(
      makeUpdate({ latestVersion: 'https://evil.com/malware.tgz' }),
      {}
    );
    expect(result.success).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  // ---- dry run does not call npm ----

  it('does not call npm when dryRun is true', async () => {
    const result = await executeUpdate(makeUpdate(), {}, true);
    expect(result.success).toBe(true);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  // ---- NOTE: missing --ignore-scripts ----

  it('SECURITY GAP: does NOT pass --ignore-scripts to npm install', async () => {
    execFileResolves();
    await executeUpdate(makeUpdate(), {});
    const args: string[] = execFileMock.mock.calls[0][1];
    // This test documents the gap. When the fix lands, flip the assertion.
    expect(args).not.toContain('--ignore-scripts');
  });

  // ---- NOTE: missing timeout ----

  it('SECURITY GAP: execFile callback has no timeout option', async () => {
    // execFileAsync wraps execFile without a timeout option object.
    // This test documents the gap. When the fix lands, verify the timeout.
    execFileResolves();
    await executeUpdate(makeUpdate(), {});
    // execFile receives (cmd, args, callback) — no options object with timeout
    const callArgs = execFileMock.mock.calls[0];
    // The third argument should be the callback (function), not an options object
    expect(typeof callArgs[2]).toBe('function');
    // If a timeout were added, the call would be execFile(cmd, args, {timeout}, cb)
    // and callArgs[2] would be an object, not a function.
  });
});

// ---------------------------------------------------------------------------
// History file sanitization
// ---------------------------------------------------------------------------

describe('loadHistory — tamper resistance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects history entries with invalid package names', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          timestamp: new Date().toISOString(),
          package: '; rm -rf /',
          fromVersion: '1.0.0',
          toVersion: '1.0.1',
          success: true,
          rollbackAvailable: true,
        },
      ])
    );
    const history = loadHistory();
    expect(history).toHaveLength(0);
  });

  it('rejects history entries with invalid version strings', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          timestamp: new Date().toISOString(),
          package: 'monomind',
          fromVersion: '../../etc/passwd',
          toVersion: '1.0.1',
          success: true,
          rollbackAvailable: true,
        },
      ])
    );
    const history = loadHistory();
    expect(history).toHaveLength(0);
  });

  it('accepts valid history entries', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 200 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          timestamp: new Date().toISOString(),
          package: 'monomind',
          fromVersion: '2.8.4',
          toVersion: '2.8.5',
          success: true,
          rollbackAvailable: true,
        },
      ])
    );
    const history = loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].package).toBe('monomind');
  });

  it('returns empty array when history file exceeds 1 MB', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 2 * 1024 * 1024 });
    const history = loadHistory();
    expect(history).toHaveLength(0);
    // readFileSync should NOT have been called
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it('returns empty array on corrupted JSON', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 50 });
    fsMock.readFileSync.mockReturnValue('not json{{{');
    const history = loadHistory();
    expect(history).toHaveLength(0);
  });

  it('returns empty array when file contains a non-array', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 50 });
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ hack: true }));
    const history = loadHistory();
    expect(history).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rollback — validates version before execFile
// ---------------------------------------------------------------------------

describe('rollbackUpdate — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates version before calling execFile', async () => {
    // Set up a valid history entry so rollback has something to work with
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 200 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          timestamp: new Date().toISOString(),
          package: 'monomind',
          fromVersion: '2.8.4',
          toVersion: '2.8.5',
          success: true,
          rollbackAvailable: true,
        },
      ])
    );
    execFileResolves();

    const result = await rollbackUpdate('monomind');
    expect(result.success).toBe(true);
    // Verify execFile was called with the validated fromVersion
    const args: string[] = execFileMock.mock.calls[0][1];
    expect(args).toContain('monomind@2.8.4');
  });
});

// ---------------------------------------------------------------------------
// Rate limiter integration
// ---------------------------------------------------------------------------

describe('rate limiter — cooldown and daily cap', () => {
  // These tests import the rate limiter directly to verify its security properties.

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Reset env vars
    delete process.env.CI;
    delete process.env.CONTINUOUS_INTEGRATION;
    delete process.env.MONOMIND_AUTO_UPDATE;
    delete process.env.MONOMIND_FORCE_UPDATE;
  });

  afterEach(() => {
    delete process.env.CI;
    delete process.env.CONTINUOUS_INTEGRATION;
    delete process.env.MONOMIND_AUTO_UPDATE;
    delete process.env.MONOMIND_FORCE_UPDATE;
  });

  it('blocks checks in CI environments', async () => {
    process.env.CI = 'true';
    const { reserveCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const result = reserveCheck();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('CI');
  });

  it('blocks checks when auto-update is disabled via env', async () => {
    process.env.MONOMIND_AUTO_UPDATE = 'false';
    const { reserveCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const result = reserveCheck();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('blocks when daily check limit is reached', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: new Date().toISOString(),
        checksToday: 10,
        date: new Date().toISOString().split('T')[0],
        packageVersions: {},
      })
    );
    const { reserveCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const result = reserveCheck();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily check limit');
  });

  it('blocks when last check was within the cooldown interval', async () => {
    const recentCheck = new Date(Date.now() - 1000 * 60 * 30).toISOString(); // 30 min ago
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: recentCheck,
        checksToday: 1,
        date: new Date().toISOString().split('T')[0],
        packageVersions: {},
      })
    );
    const { reserveCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const result = reserveCheck(24); // 24-hour interval
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Last check was');
  });

  it('allows check when cooldown has elapsed', async () => {
    const oldCheck = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: oldCheck,
        checksToday: 1,
        date: new Date().toISOString().split('T')[0],
        packageVersions: {},
      })
    );
    const { reserveCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const result = reserveCheck(24);
    expect(result.allowed).toBe(true);
  });

  it('discards oversized state file and starts fresh', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 2 * 1024 * 1024 }); // 2 MB > 1 MB cap
    const { loadState } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const state = loadState();
    // Should return default state (checksToday=0, empty packageVersions)
    expect(state.checksToday).toBe(0);
    expect(Object.keys(state.packageVersions)).toHaveLength(0);
  });

  it('blocks prototype pollution keys in JSON.parse', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 200 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: '',
        checksToday: 0,
        date: new Date().toISOString().split('T')[0],
        packageVersions: {},
        __proto__: { polluted: true },
      })
    );
    const { loadState } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const state = loadState();
    // __proto__ should have been stripped by the reviver
    expect((state as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('caps packageVersions at MAX_PACKAGE_VERSIONS (100)', async () => {
    const versions: Record<string, string> = {};
    for (let i = 0; i < 120; i++) {
      versions[`pkg-${i}`] = '1.0.0';
    }
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 5000 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: '',
        checksToday: 0,
        date: new Date().toISOString().split('T')[0],
        packageVersions: versions,
      })
    );
    const { loadState } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    const state = loadState();
    expect(Object.keys(state.packageVersions).length).toBeLessThanOrEqual(100);
  });

  it('recordCheck rejects prototype pollution keys', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 100 });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        lastCheck: '',
        checksToday: 0,
        date: new Date().toISOString().split('T')[0],
        packageVersions: {},
      })
    );
    const { recordCheck } = await import('../../packages/@monomind/cli/src/update/rate-limiter.js');
    recordCheck({
      '__proto__': '1.0.0',
      'constructor': '1.0.0',
      'prototype': '1.0.0',
      'monomind': '2.8.5',
    });
    // The saveState call should have been made; check the written JSON
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    const written = fsMock.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    // Forbidden keys should not appear as own properties
    expect(Object.hasOwn(parsed.packageVersions, '__proto__')).toBe(false);
    expect(Object.hasOwn(parsed.packageVersions, 'constructor')).toBe(false);
    expect(Object.hasOwn(parsed.packageVersions, 'prototype')).toBe(false);
    // Valid key should appear
    expect(parsed.packageVersions.monomind).toBe('2.8.5');
  });
});
