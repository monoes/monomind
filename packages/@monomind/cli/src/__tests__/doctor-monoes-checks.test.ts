import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// findMonoesIssues() shells out to `brew`, `xattr`, `curl` (GitHub API), and
// applies fixes via a real `execSync` with `sudo`/network calls — none of
// that is safe or deterministic to run for real in a test. We mock the
// `runCommand` helper the module calls through (from doctor-env-checks.js)
// and `child_process.execSync` (used only by fixMonoesTools to apply a fix).
// `existsSync` is mocked too, since the module probes fixed absolute paths
// (`/Applications/MonoClip.app`, a real Homebrew Cellar dir) that vary by
// machine — real filesystem state there would make the suite flaky on any
// dev's actual Mac.
const runCommandMock = vi.fn<(cmd: string, timeoutMs?: number) => Promise<string>>();
vi.mock('../commands/doctor-env-checks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/doctor-env-checks.js')>();
  return {
    ...actual,
    runCommand: (cmd: string, timeoutMs?: number) => runCommandMock(cmd, timeoutMs),
  };
});

const execSyncMock = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: (...args: unknown[]) => execSyncMock(...args) };
});

const existsSyncMock = vi.fn<(p: string) => boolean>(() => false);
const readFileSyncMock = vi.fn<(p: string, enc?: string) => string>(() => {
  throw new Error('ENOENT');
});
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (p: string) => existsSyncMock(p as string),
    readFileSync: (p: string, enc?: string) => readFileSyncMock(p as string, enc),
  };
});

import {
  checkMonoesTokenExposure,
  checkMonoesTools,
  fixMonoesTools,
} from '../commands/doctor-monoes-checks.js';

/** Reject every command by default; individual tests override matching commands. */
function rejectAll() {
  runCommandMock.mockImplementation(async () => {
    throw new Error('command not found');
  });
}

describe('checkMonoesTools', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    runCommandMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    rejectAll();
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('skips entirely on non-macOS platforms without touching brew/curl at all', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const result = await checkMonoesTools();
    expect(result).toEqual({
      name: 'monoes Tools',
      status: 'pass',
      message: 'Skipped (macOS-only — monotask/mono-agent/mono-clip are macOS tools)',
    });
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('reports pass with no issues when brew/tools are absent', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const result = await checkMonoesTools();
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No known monotask/mono-agent/mono-clip install issues detected');
  });

  it('flags ambiguous taps when both nokhodian/tap and monoes/tap are tapped', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew tap') return 'nokhodian/tap\nmonoes/tap\nhomebrew/core\n';
      throw new Error('not found');
    });
    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('formula/cask lookups are ambiguous');
    expect(result.fix).toContain('brew untap --force nokhodian/tap');
  });

  it('flags the old tap-name when only nokhodian/tap is present (renamed upstream)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew tap') return 'nokhodian/tap\n';
      throw new Error('not found');
    });
    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('was renamed to monoes/tap');
    expect(result.fix).toBe('brew untap --force nokhodian/tap && brew tap monoes/tap');
  });

  it('flags monotask formula installed but not linked on PATH', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --cellar') return '/opt/homebrew/Cellar';
      if (cmd === 'command -v monotask') throw new Error('not found');
      throw new Error('not found');
    });
    existsSyncMock.mockImplementation((p: string) => p === '/opt/homebrew/Cellar/monotask');

    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain("'monotask' isn't on PATH");
    expect(result.fix).toContain('monotaskcli');
  });

  it('does not flag monotask when it is already linked on PATH', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --cellar') return '/opt/homebrew/Cellar';
      if (cmd === 'command -v monotask') return '/opt/homebrew/bin/monotask';
      throw new Error('not found');
    });
    existsSyncMock.mockImplementation((p: string) => p === '/opt/homebrew/Cellar/monotask');

    const result = await checkMonoesTools();
    expect(result.status).toBe('pass');
  });

  it('flags a quarantined MonoClip.app install', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    existsSyncMock.mockImplementation((p: string) => p === '/Applications/MonoClip.app');
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'xattr -p com.apple.quarantine "/Applications/MonoClip.app"')
        return 'com.apple.quarantine';
      throw new Error('not found');
    });

    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('MonoClip.app is quarantined');
    expect(result.fix).toContain('codesign --force --deep --sign -');
  });

  it('does not flag MonoClip.app when the quarantine attribute is absent', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    existsSyncMock.mockImplementation((p: string) => p === '/Applications/MonoClip.app');
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('xattr -p')) throw new Error('attribute not found');
      throw new Error('not found');
    });

    const result = await checkMonoesTools();
    expect(result.status).toBe('pass');
  });

  it('flags an outdated monoagentcli against the latest GitHub release', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'command -v monoagentcli') return '/usr/local/bin/monoagentcli';
      if (cmd === 'monoagentcli version') return 'monoagentcli v1.2.3';
      if (
        cmd.startsWith('curl -fsSL https://api.github.com/repos/monoes/mono-agent/releases/latest')
      ) {
        return JSON.stringify({ tag_name: 'v1.3.0' });
      }
      throw new Error('not found');
    });

    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('monoagentcli is v1.2.3, latest release is v1.3.0');
  });

  it('does not flag monoagentcli when already at the latest release', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'command -v monoagentcli') return '/usr/local/bin/monoagentcli';
      if (cmd === 'monoagentcli version') return 'monoagentcli v1.3.0';
      if (
        cmd.startsWith('curl -fsSL https://api.github.com/repos/monoes/mono-agent/releases/latest')
      ) {
        return JSON.stringify({ tag_name: 'v1.3.0' });
      }
      throw new Error('not found');
    });

    const result = await checkMonoesTools();
    expect(result.status).toBe('pass');
  });

  it('combines multiple simultaneous issues into one warn with joined messages/fixes', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew tap') return 'nokhodian/tap\nmonoes/tap\n';
      if (cmd === 'brew --cellar') return '/opt/homebrew/Cellar';
      if (cmd === 'command -v monotask') throw new Error('not found');
      throw new Error('not found');
    });
    existsSyncMock.mockImplementation((p: string) => p === '/opt/homebrew/Cellar/monotask');

    const result = await checkMonoesTools();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('ambiguous');
    expect(result.message).toContain("'monotask' isn't on PATH");
    expect(result.message.split('; ').length).toBe(2);
    expect(result.fix).toContain('  |  ');
  });
});

describe('fixMonoesTools', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    runCommandMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    execSyncMock.mockReset();
    rejectAll();
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('reports nothing-to-fix and never calls execSync when there are no issues', async () => {
    const result = await fixMonoesTools();
    expect(result).toBe(true);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('applies every fix command and returns true when all succeed', async () => {
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew tap') return 'nokhodian/tap\nmonoes/tap\n';
      throw new Error('not found');
    });
    execSyncMock.mockReturnValue('');

    const result = await fixMonoesTools();
    expect(result).toBe(true);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0][0]).toBe('brew untap --force nokhodian/tap');
  });

  it('returns false when a fix command throws', async () => {
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew tap') return 'nokhodian/tap\nmonoes/tap\n';
      throw new Error('not found');
    });
    execSyncMock.mockImplementation(() => {
      throw new Error('brew untap failed');
    });

    const result = await fixMonoesTools();
    expect(result).toBe(false);
  });
});

describe('checkMonoesTokenExposure', () => {
  const MCP_JSON = '/project/.mcp.json';
  const CONNECTION_JSON = '/project/.monomind/monoes-connection.json';
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runCommandMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReset();
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    rejectAll();
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  it('passes with no exposure detected when neither file exists', async () => {
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No monoes.me token exposure detected');
  });

  it('i-055 follow-up finding 4a (regression guard): outside a git work tree, an existing connection file does not produce a fail', async () => {
    // The harm this pins: a project with zero exposure (not even a git
    // repo, so nothing to leak through) must never be told to revoke a
    // credential. `git rev-parse --is-inside-work-tree` rejecting is the
    // non-git signal; runCommandMock rejects everything by default (rejectAll()).
    existsSyncMock.mockImplementation((p: string) => p === CONNECTION_JSON);
    const result = await checkMonoesTokenExposure();
    expect(result.status).not.toBe('fail');
    expect(result.status).toBe('pass');
  });

  it('fails, mentions revoke AND Disconnect, when a connected, git-tracked connection file is exposed', async () => {
    existsSyncMock.mockImplementation((p: string) => p === CONNECTION_JSON);
    runCommandMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'git rev-parse --is-inside-work-tree') return 'true';
      if (cmd.startsWith('git check-ignore')) throw new Error('not ignored');
      if (cmd.startsWith('git ls-files --error-unmatch')) return CONNECTION_JSON;
      throw new Error('not found');
    });
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('is tracked by git');
    expect(result.message.toLowerCase()).toContain('revoke');
    expect(result.message).toContain('Disconnect');
  });

  it('i-055 follow-up finding 4b (revised per review finding 13): a .mcp.json bearer-token exposure with no connection file still says revoke, but never Disconnect', async () => {
    // A real credential exposure — hasLegacyMonoesBearerEntry() only
    // matches mcpServers.monoes.headers.Authorization specifically, so this
    // is a genuine monoes.me token, however it got there (a teammate's
    // commit, an older install, a pulled branch). Revoking it is required
    // regardless of whether THIS user has ever been through monoes.me's
    // connect flow — a token you didn't create and can't rotate yourself is
    // MORE urgent to escalate, not less. But there is no connection file
    // here, so there is nothing to disconnect from: "Disconnect -> Connect"
    // would describe an action this user has never taken.
    existsSyncMock.mockImplementation((p: string) => p === MCP_JSON);
    readFileSyncMock.mockImplementation((p: string) => {
      if (p === MCP_JSON) {
        return JSON.stringify({
          mcpServers: { monoes: { headers: { Authorization: 'Bearer abc123def456' } } },
        });
      }
      throw new Error('ENOENT');
    });
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('fail');
    expect(result.message.toLowerCase()).toContain('revoke');
    expect(result.message).not.toContain('Disconnect');
    // This function never reads the connection file's content (only
    // existsSync plus git tracked/ignored status), so it can never
    // truthfully claim anything about a file being unreadable — pinned so
    // that sentence can't come back (review finding 13a).
    expect(result.message.toLowerCase()).not.toContain('unreadable');
  });

  it('never interpolates a caught error or the token value into either failure message', async () => {
    existsSyncMock.mockImplementation((p: string) => p === MCP_JSON);
    readFileSyncMock.mockImplementation((p: string) => {
      if (p === MCP_JSON) {
        return JSON.stringify({
          mcpServers: { monoes: { headers: { Authorization: 'Bearer super-secret-value-xyz' } } },
        });
      }
      throw new Error('ENOENT');
    });
    const result = await checkMonoesTokenExposure();
    expect(result.message).not.toContain('super-secret-value-xyz');
  });
});
