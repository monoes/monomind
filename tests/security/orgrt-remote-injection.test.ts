/**
 * SEC-4 — SSH command injection in orgrt/remote.ts.
 *
 * Before fix: `execSync(\`ssh ${args.map(a => JSON.stringify(a)).join(' ')}\`)`.
 * `JSON.stringify` does NOT escape $(), backticks, or ${} inside double
 * quotes — a malicious `host.cwd`, `host.host`, or `host.user` from
 * `.monomind/orgs/remote-hosts.json` (which a cloned repo can ship) RCEs
 * on the operator's machine via the SSH remote command.
 *
 * After fix: `execFileSync('ssh', argsArray, ...)` — no shell, so none
 * of the metacharacters can expand. The remote command stays a single
 * argv element after `--` so ssh receives it verbatim.
 *
 * Probe: mock `node:child_process` and capture the execFileSync call.
 * Assert (1) the function called is `execFileSync` (not `execSync`), (2)
 * the command is the literal string `'ssh'` (not a shell template), and
 * (3) the argv contains the malicious value as a plain string element —
 * never as part of a shell string that could be expanded. Also assert
 * `execSync` is NEVER invoked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock's factory. Captured call state lives here
// so the mock can write to it and the test body can read from it.
const capture = vi.hoisted(() => ({
  execFileSyncCalls: [] as Array<{ cmd: unknown; args: unknown[]; opts: unknown }>,
  execSyncCalls: [] as Array<{ cmd: unknown; args: unknown[]; opts: unknown }>,
}));

// Mock the entire node:child_process module. Both execFileSync and execSync
// are replaced with capture-only stubs. The factory cannot reference outer
// state directly, so it closes over the hoisted `capture` object.
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => {
    capture.execFileSyncCalls.push({
      cmd: args[0],
      args: (args[1] as unknown[]) ?? [],
      opts: args[2],
    });
    return 'mocked-ssh-output';
  },
  execSync: (...args: unknown[]) => {
    capture.execSyncCalls.push({ cmd: args[0], args: (args[1] as unknown[]) ?? [], opts: args[2] });
    return 'mocked-shell-output';
  },
}));

import type { RemoteHost } from '../../packages/@monomind/cli/src/orgrt/remote.js';
// Import AFTER vi.mock so the dynamic import inside remote.ts picks up the
// mocked module.
import { deliverRemote, pingRemote } from '../../packages/@monomind/cli/src/orgrt/remote.js';

beforeEach(() => {
  capture.execFileSyncCalls.length = 0;
  capture.execSyncCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const maliciousHost = (overrides: Partial<RemoteHost> = {}): RemoteHost => ({
  host: 'example.com',
  cwd: '$(touch /tmp/mono-sec4-pwned)',
  user: 'operator',
  ...overrides,
});

describe('SEC-4 — orgrt/remote.ts SSH invocation uses argv, not shell', () => {
  it('deliverRemote calls execFileSync (not execSync) with ssh as a literal cmd', async () => {
    await deliverRemote('myorg', 'from', 'subject', 'body', maliciousHost());
    expect(
      capture.execFileSyncCalls,
      'execFileSync was not called — check the import swap',
    ).toHaveLength(1);
    expect(capture.execFileSyncCalls[0].cmd).toBe('ssh');
    // Array form: args is an array, NOT a shell string.
    expect(Array.isArray(capture.execFileSyncCalls[0].args)).toBe(true);
  });

  it('deliverRemote passes host.cwd as a literal argv element (no shell expansion)', async () => {
    await deliverRemote(
      'myorg',
      'from',
      'subject',
      'body',
      maliciousHost({
        cwd: '$(touch /tmp/mono-sec4-pwned)',
      }),
    );
    expect(capture.execFileSyncCalls).toHaveLength(1);
    // The malicious payload must appear verbatim in some argv element — it
    // must NOT be split, expanded, or interpolated into a shell string.
    const allArgs = capture.execFileSyncCalls[0].args.map(String);
    const joined = allArgs.join(' ');
    // The literal substring is present (somewhere in the remote command),
    // proving no shell saw it.
    expect(joined).toContain('$(touch /tmp/mono-sec4-pwned)');
  });

  it('deliverRemote injects `--` before the remote command so ssh treats it as one argv element', async () => {
    await deliverRemote('myorg', 'from', 'subject', 'body', maliciousHost());
    expect(capture.execFileSyncCalls).toHaveLength(1);
    const args = capture.execFileSyncCalls[0].args;
    const dashIdx = args.indexOf('--');
    expect(dashIdx, 'expected "--" separator in ssh argv').toBeGreaterThan(-1);
    // Exactly one element after `--`: the remote command string.
    expect(args.slice(dashIdx + 1)).toHaveLength(1);
  });

  it('deliverRemote survives a malicious host.host (no shell eval of the target)', async () => {
    await deliverRemote(
      'myorg',
      'from',
      'subject',
      'body',
      maliciousHost({
        host: 'evil.com$(touch /tmp/mono-sec4-pwned)',
      }),
    );
    expect(capture.execFileSyncCalls).toHaveLength(1);
    // The user@target token must be present verbatim — no expansion.
    const allArgs = capture.execFileSyncCalls[0].args.map(String);
    expect(allArgs.some((a) => a.includes('evil.com$(touch /tmp/mono-sec4-pwned)'))).toBe(true);
  });

  it('pingRemote uses execFileSync with argv form', async () => {
    await pingRemote(maliciousHost());
    expect(capture.execFileSyncCalls).toHaveLength(1);
    expect(capture.execFileSyncCalls[0].cmd).toBe('ssh');
    expect(Array.isArray(capture.execFileSyncCalls[0].args)).toBe(true);
    // pingRemote pushes '--', 'echo ok' — verify the `--` separator.
    const args = capture.execFileSyncCalls[0].args;
    const dashIdx = args.indexOf('--');
    expect(dashIdx).toBeGreaterThan(-1);
    expect(args.slice(dashIdx + 1)).toEqual(['echo ok']);
  });

  it('no call site passes a shell-string template to execSync', async () => {
    // Defensive: assert execSync is NEVER called by remote.ts. If the SEC-4
    // fix regresses to execSync, this fires immediately.
    await deliverRemote('myorg', 'from', 'subject', 'body', maliciousHost()).catch(() => {});
    await pingRemote(maliciousHost()).catch(() => {});
    expect(
      capture.execSyncCalls,
      'SEC-4 regression: execSync was called from remote.ts',
    ).toHaveLength(0);
  });
});
