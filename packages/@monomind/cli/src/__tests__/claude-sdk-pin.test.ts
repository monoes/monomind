/**
 * #526 review, with #530/#522: the bundled Claude binary is pinned at every
 * query; an installed Claude Code that #522 selected is passed as is, with
 * no pin check on it.
 */
import type { Stats } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkCalls: Array<Record<string, unknown>> = [];
const fakeSdk = {
  query: (p: { options?: Record<string, unknown> }) => {
    sdkCalls.push(p.options ?? {});
    return 'stream';
  },
  tool: () => undefined,
  createSdkMcpServer: () => undefined,
};
const pinned = vi.hoisted(() => ({
  bin: undefined as { path: string; sha256: string } | undefined,
}));
const checks: string[] = [];

vi.mock('../utils/optional-deps.js', async (orig) => ({
  ...(await orig<typeof import('../utils/optional-deps.js')>()),
  ensureOptionalDependency: async () => fakeSdk,
}));
vi.mock('../utils/optional-deps-verify.js', async (orig) => ({
  ...(await orig<typeof import('../utils/optional-deps-verify.js')>()),
  verifiedBinary: () => pinned.bin,
  assertStillVerified: (file: string) => {
    checks.push(file);
  },
}));

type Probe = import('../orgrt/claude-sdk.js').ClaudeProbe;

/** A probe that finds nothing, or a root-owned installed Claude Code. */
function probe(installed?: string): Probe {
  return {
    env: installed ? { MONOMIND_CLAUDE_PATH: installed } : { MONOMIND_CLAUDE_PATH: 'bundled' },
    home: '/home/op',
    platform: 'linux',
    uid: 1000,
    roleWritableRoots: ['/home/op', '/tmp'],
    realpath: (p) => p,
    stat: () => ({ uid: 0, mode: 0o755, isFile: () => true }) as unknown as Stats,
    isExecutable: () => true,
    head: () => '\x7fE',
    version: async () => '2.1.999 (Claude Code)\n',
    log: () => {},
  };
}

// loadClaudeSdk caches the SDK per process; each case needs a fresh module.
const fresh = async () => {
  vi.resetModules();
  return (await import('../orgrt/claude-sdk.js')).loadClaudeSdk;
};

let dir: string;
let installed: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mm-pin-sdk-'));
  installed = join(dir, 'claude'); // queryWithExecutable needs it to exist
  writeFileSync(installed, '');
  sdkCalls.length = 0;
  checks.length = 0;
  pinned.bin = { path: '/deps/sdk/claude-agent-sdk-linux-x64/claude', sha256: 'a'.repeat(64) };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('which Claude binary a query runs', () => {
  it('bundled: the verified binary, checked before every query', async () => {
    const load = await fresh();
    const sdk = await load(probe());
    expect(sdk.executable).toBe(pinned.bin?.path);
    (sdk.query as unknown as (p: unknown) => unknown)({ prompt: 'a' });
    (sdk.query as unknown as (p: unknown) => unknown)({ prompt: 'b' });
    expect(sdkCalls.map((o) => o.pathToClaudeCodeExecutable)).toEqual([
      pinned.bin?.path,
      pinned.bin?.path,
    ]);
    expect(checks).toEqual([pinned.bin?.path, pinned.bin?.path]);
  });

  it('installed Claude Code (#522): its path, and no pin check on it', async () => {
    const load = await fresh();
    const sdk = await load(probe(installed));
    expect(sdk.executable).toBe(installed);
    (sdk.query as unknown as (p: unknown) => unknown)({ prompt: 'a' });
    expect(sdkCalls.at(-1)?.pathToClaudeCodeExecutable).toBe(installed);
    expect(checks).toEqual([]);
  });
});
