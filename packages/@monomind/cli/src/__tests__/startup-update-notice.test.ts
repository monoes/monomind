/**
 * The "update available" notice must go to stderr: `--json` commands (agent
 * scan, doctor, org observe) promise that stdout holds only their JSON, and
 * the notice fires on the first run of any command after a release — which
 * broke mono-agent's `agent scan --json` parse in a fresh HOME.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../update/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../update/index.js')>();
  return {
    ...actual,
    runStartupUpdateCheck: vi.fn(async () => ({
      checked: true,
      updatesAvailable: [{ package: 'monomind', latestVersion: '9.9.9', updateType: 'patch' }],
      updatesApplied: [],
    })),
  };
});

import { CLI } from '../index.js';

describe('startup update notice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is written to stderr, never stdout', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
      stderr.push(String(s));
      return true;
    });
    const cli = new CLI({ interactive: false }) as unknown as {
      checkForUpdatesOnStartup(): Promise<void>;
    };
    await cli.checkForUpdatesOnStartup();
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('monomind v9.9.9 available');
  });
});
