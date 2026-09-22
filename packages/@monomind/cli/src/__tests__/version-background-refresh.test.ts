/**
 * `monomind --version` wiring for the background update-cache refresh: the
 * refresh is kicked off only after the version line is written, never changes
 * that line, and is skipped for `--version --json` (machine handshake, no
 * tagline) and `--no-update` (the same flag that disables the startup check).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('../update/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../update/index.js')>();
  return {
    ...actual,
    getUpdateTagline: vi.fn(() => '  ✓ up to date'),
    refreshUpdateCacheInBackground: vi.fn(() => {
      calls.push('refresh');
      return true;
    }),
    runStartupUpdateCheck: vi.fn(async () => ({
      checked: false,
      updatesAvailable: [],
      updatesApplied: [],
    })),
  };
});

import { CLI, VERSION } from '../index.js';
import { refreshUpdateCacheInBackground } from '../update/index.js';

describe('monomind --version background refresh', () => {
  let out: string[];

  beforeEach(() => {
    out = [];
    calls.length = 0;
    vi.mocked(refreshUpdateCacheInBackground).mockClear();
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      calls.push('write');
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the unchanged version line, then starts the refresh', async () => {
    await new CLI({ interactive: false }).run(['--version']);
    expect(out.join('')).toBe(`monomind v${VERSION}  ✓ up to date\n`);
    expect(refreshUpdateCacheInBackground).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['write', 'refresh']);
  });

  it('does not refresh for --version --json', async () => {
    await new CLI({ interactive: false }).run(['--version', '--json']);
    expect(refreshUpdateCacheInBackground).not.toHaveBeenCalled();
  });

  it('does not refresh with --no-update', async () => {
    await new CLI({ interactive: false }).run(['--version', '--no-update']);
    expect(out.join('')).toBe(`monomind v${VERSION}  ✓ up to date\n`);
    expect(refreshUpdateCacheInBackground).not.toHaveBeenCalled();
  });
});
