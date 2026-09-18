/**
 * i-066: the monoes.me OAuth token must never be written into `.mcp.json`,
 * the stdio proxy must fail fast (never hang) when it cannot authenticate,
 * and any exposure that already happened must be flagged loudly — without
 * ever echoing the secret value itself.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMonoesTokenExposure } from '../commands/doctor-monoes-checks.js';
import { detectMonoesTokenLeak, formatMonoesLeakWarning } from '../mcp/monoes-mcp-entry.mjs';
import {
  formatAuthFailureMessage,
  resolveAuthHeader,
  resolveMonomindHome,
  runMonoesProxy,
} from '../mcp/monoes-proxy.js';

let monomindHome = '';

beforeEach(() => {
  monomindHome = mkdtempSync(join(tmpdir(), 'monomind-monoes-proxy-test-'));
});

afterEach(() => {
  rmSync(monomindHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function writeConnection(data: Record<string, unknown>) {
  mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
  writeFileSync(join(monomindHome, '.monomind', 'monoes-connection.json'), JSON.stringify(data));
}

// ── T6: the proxy resolves the Authorization header at request time, never
// from a serialized copy ───────────────────────────────────────────────────
describe('resolveAuthHeader — resolves at request time, never from a file it wrote', () => {
  it('reflects the currently-stored token on each call, not a snapshot from the first call', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-first',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const first = await resolveAuthHeader(monomindHome);
    expect(first).toEqual({ ok: true, headers: { Authorization: 'Bearer FAKE-AT-first' } });

    // Simulate the token having moved on (e.g. a refresh that happened via
    // another process/request) by mutating the on-disk connection directly —
    // resolveAuthHeader must reflect it immediately, proving it re-reads
    // rather than caching the header from the first call.
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-second',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const second = await resolveAuthHeader(monomindHome);
    expect(second).toEqual({ ok: true, headers: { Authorization: 'Bearer FAKE-AT-second' } });
  });

  it('never writes the resolved header/token to any file', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-neverwritten',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    await resolveAuthHeader(monomindHome);
    await resolveAuthHeader(monomindHome);

    // The only file resolveAuthHeader is allowed to touch is the pre-existing
    // monoes-connection.json it read — and only readMonoesConnection's own
    // refresh path writes that, which does not run here (token not expiring).
    // No .mcp.json (or any other file) must exist as a side effect.
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(monomindHome, '.mcp.json'))).toBe(false);
  });
});

describe('runMonoesProxy — end-to-end stdio<->HTTP forwarding', () => {
  it('forwards a JSON-RPC line to monoes.me with a freshly-resolved bearer header, and never touches .mcp.json', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-e2e',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
    }));

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (c) => chunks.push(c.toString()));
    const exitMock = vi.fn();

    const proxyDone = runMonoesProxy({
      monomindHome,
      stdin,
      stdout,
      stderr: new PassThrough(),
      exit: exitMock,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    // Let the startup auth check resolve before writing a request line.
    await proxyDone;
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('"result"');
    });

    expect(exitMock).not.toHaveBeenCalled();
    const [, fetchOpts] = fetchMock.mock.calls[0];
    expect((fetchOpts as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer FAKE-AT-e2e',
    });
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(monomindHome, '.mcp.json'))).toBe(false);
  });

  // T6b (reviewer): the test above's writeConnection() fixture used a
  // 10-minute expiresAt, so the refresh branch was never actually
  // exercised — this one starts with an EXPIRED token so
  // getValidMonoesToken() must refresh before the proxy can forward
  // anything, and the forwarded request must carry the newly-refreshed
  // token, not the stale one.
  it('refreshes an expired token before forwarding, and forwards with the newly-refreshed token', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-stale-e2e',
      refreshToken: /* value */ 'FAKE-RT-stale-e2e',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000, // already expired -> forces a refresh
    });

    // getValidMonoesToken()'s own refresh call uses the ambient global
    // fetch, not the proxy's injectable fetchImpl (that one is only used
    // for the actual proxied MCP request after auth resolves).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: /* value */ 'FAKE-AT-refreshed-e2e',
          refresh_token: /* value */ 'FAKE-RT-refreshed-e2e',
          expires_in: 3600,
        }),
      })),
    );

    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
    }));

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (c) => chunks.push(c.toString()));
    const exitMock = vi.fn();

    const proxyDone = runMonoesProxy({
      monomindHome,
      stdin,
      stdout,
      stderr: new PassThrough(),
      exit: exitMock,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await proxyDone; // startup auth check refreshes the token
    expect(exitMock).not.toHaveBeenCalled();

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('"result"');
    });

    const [, refreshedFetchOpts] = fetchMock.mock.calls[0];
    expect((refreshedFetchOpts as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer FAKE-AT-refreshed-e2e',
    });
  });
});

// i-066 reviewer finding 7: the per-line forward's .then() writes to
// stdout with no .catch() — if that write throws (e.g. EPIPE once Claude
// Code has closed the pipe), it becomes an unhandled rejection, which
// terminates the whole process under Node >= 15. That is a worse outcome
// than the bug this proxy exists to prevent: one failed request taking
// down the rest of the user's session.
describe('runMonoesProxy — a failing stdout.write never becomes an unhandled rejection', () => {
  it('does not crash the process when stdout.write throws on the response for a forwarded request', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-write-fail',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
    }));

    const stdin = new PassThrough();
    // A stdout that throws synchronously on write, simulating EPIPE.
    const stdout = {
      write: vi.fn(() => {
        throw new Error('EPIPE (simulated)');
      }),
    };
    const exitMock = vi.fn();

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    try {
      const proxyDone = runMonoesProxy({
        monomindHome,
        stdin,
        stdout: stdout as unknown as NodeJS.WritableStream,
        stderr: new PassThrough(),
        exit: exitMock,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await proxyDone;

      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);

      // Give the forwardMessage().then(write-that-throws).catch(...) chain
      // time to run and settle.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(stdout.write).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(rejections, 'a throwing stdout.write leaked an unhandled rejection').toEqual([]);
  });
});

// ── Fail-fast: the proxy sits in Claude Code's MCP startup path, so it must
// never hang and must exit non-zero within ~2s with a named, actionable,
// token-free message ────────────────────────────────────────────────────
describe('runMonoesProxy — fails fast, never hangs, never logs the token', () => {
  it('exits non-zero immediately (no network call) when there is no connection at all', async () => {
    // No monoes-connection.json written — this is the "never connected" /
    // "disconnected out from under an entry" case.
    const stderr = new PassThrough();
    let stderrText = '';
    stderr.on('data', (c) => {
      stderrText += c.toString();
    });
    const exitMock = vi.fn();
    const started = Date.now();

    await runMonoesProxy({
      monomindHome,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      exit: exitMock,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(Date.now() - started).toBeLessThan(500); // no network call was even attempted
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(stderrText).toContain('monoes MCP proxy');
    expect(stderrText).toContain('monomind ui');
    expect(stderrText).not.toContain('Bearer'); // nothing to leak, but assert the shape never appears
  });

  it('exits non-zero fast when monoes-connection.json is corrupted JSON', async () => {
    mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
    writeFileSync(join(monomindHome, '.monomind', 'monoes-connection.json'), '{ this is not json');

    const stderr = new PassThrough();
    let stderrText = '';
    stderr.on('data', (c) => {
      stderrText += c.toString();
    });
    const exitMock = vi.fn();
    const started = Date.now();

    await runMonoesProxy({
      monomindHome,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      exit: exitMock,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(stderrText).toContain('monomind ui');
  });

  it('exits non-zero within its configured bound when monoes.me is unreachable during a forced refresh — never hangs', async () => {
    writeConnection({
      accessToken: /* value */ 'FAKE-AT-stale',
      refreshToken: /* value */ 'FAKE-RT-stale',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000, // forces a refresh attempt
    });

    // Simulate an unreachable monoes.me: fetch never settles. getValidMonoesToken
    // (called internally to resolve auth) uses the ambient global `fetch`, not
    // the proxy's injectable fetchImpl (that one is only used for the actual
    // proxied MCP request after auth succeeds) — stub it globally.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const exitMock = vi.fn();
    const stderr = new PassThrough();
    let stderrText = '';
    stderr.on('data', (c) => {
      stderrText += c.toString();
    });
    const started = Date.now();

    await runMonoesProxy({
      monomindHome,
      timeoutMs: 100, // bound tight so this test stays fast; production default is ~2000ms
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      exit: exitMock,
    });

    // Without the timeout bound this would hang forever (hangingFetch never
    // settles). Prove it doesn't: startup must have returned well under 1s.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(stderrText).toContain('monomind ui');
  });

  it('the default auth timeout bounds a never-resolving getToken to ~2s, not forever', async () => {
    vi.useFakeTimers();
    const neverResolves = () => new Promise<string | null>(() => {});

    const pending = resolveAuthHeader(monomindHome, { getToken: /* fn */ neverResolves });
    let settled: Awaited<ReturnType<typeof resolveAuthHeader>> | undefined;
    pending.then((v) => {
      settled = v;
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBeUndefined(); // must not have resolved before the bound

    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toEqual({ ok: false, reason: 'timeout' });
  });

  it('formatAuthFailureMessage never interpolates a caught error or token value', () => {
    expect(formatAuthFailureMessage('not_connected')).toBe(
      'monoes MCP proxy: not connected to monoes.me. Run `monomind ui`, then monoes.me -> Disconnect -> Connect to reconnect.',
    );
    expect(formatAuthFailureMessage('timeout')).toContain('Run `monomind ui`');
    for (const reason of ['not_connected', 'timeout'] as const) {
      expect(formatAuthFailureMessage(reason)).not.toMatch(/Bearer\s+\S/);
    }
  });
});

describe('resolveMonomindHome', () => {
  it('honors MONOMIND_HOME when set', () => {
    const prev = process.env.MONOMIND_HOME;
    process.env.MONOMIND_HOME = monomindHome;
    try {
      expect(resolveMonomindHome('/somewhere/else')).toBe(monomindHome);
    } finally {
      if (prev === undefined) delete process.env.MONOMIND_HOME;
      else process.env.MONOMIND_HOME = prev;
    }
  });

  it('walks up from cwd to find .monomind/control.json', () => {
    mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
    writeFileSync(join(monomindHome, '.monomind', 'control.json'), '{}');
    const nested = join(monomindHome, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(resolveMonomindHome(nested)).toBe(monomindHome);
  });
});

// ── T7: doctor check fails and names the file (never the token value) when
// a literal bearer token is planted ─────────────────────────────────────
describe('checkMonoesTokenExposure (doctor check)', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'monomind-doctor-monoes-token-'));
    process.chdir(dir);
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when .mcp.json has the tokenless stdio entry and no connection file exists', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: {
            command: 'npx',
            args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
            env: {},
          },
        },
      }),
    );
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('pass');
  });

  it('fails and names the file — without echoing the token value — when a legacy literal bearer token is planted', async () => {
    const planted = 'FAKE-AT-deadbeef-should-never-print';
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: {
            type: 'http',
            url: 'https://monoes.me/api/mcp',
            headers: { Authorization: `Bearer ${planted}` },
          },
        },
      }),
    );

    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('.mcp.json');
    expect(result.message.toLowerCase()).toContain('revoke');
    expect(result.message).not.toContain(planted);
  });

  it('fails and names the file when monoes-connection.json is tracked by git', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    const connPath = join(dir, '.monomind', 'monoes-connection.json');
    writeFileSync(
      connPath,
      JSON.stringify({
        accessToken: /* value */ 'FAKE-AT-tracked',
        refreshToken: /* value */ 'FAKE-RT-tracked',
      }),
    );
    execFileSync('git', ['add', '.monomind/monoes-connection.json'], { cwd: dir });

    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('monoes-connection.json');
    expect(result.message).not.toContain('FAKE-AT-tracked');
    expect(result.message).not.toContain('FAKE-RT-tracked');
  });

  it('fails when monoes-connection.json exists but is not gitignored', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(
      join(dir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: 'x' }),
    );
    // No .gitignore at all — the file is untracked but also unprotected.
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('monoes-connection.json');
  });

  it('passes when monoes-connection.json exists, is gitignored, and is untracked', async () => {
    writeFileSync(join(dir, '.gitignore'), '.monomind/monoes-connection.json\n');
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(
      join(dir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: 'x' }),
    );
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('pass');
  });

  // i-066 reviewer finding 6
  it('does not false-positive on an unrelated MCP server configured with its own bearer header', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: { command: 'npx', args: [], env: {} },
          'some-other-server': {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer unrelated-service-token-not-ours' },
          },
        },
      }),
    );
    const result = await checkMonoesTokenExposure();
    expect(result.status).toBe('pass');
  });
});

// i-066 reviewer finding 5
describe('checkMonoesTokenExposure — outside a git work tree', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'monomind-doctor-monoes-token-nogit-'));
    process.chdir(dir);
    // Deliberately NOT `git init` — this is the whole point of the test.
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not fail a zero-exposure project just because it has no git repo at all', async () => {
    // Before the fix: git check-ignore and git ls-files both exit non-zero
    // outside a work tree for reasons that have nothing to do with
    // exposure (there is no git to leak through) — tracked=false,
    // ignored=false was read as "not covered by .gitignore" and this
    // permanently failed a user who was never at risk.
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(
      join(dir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: 'x' }),
    );
    const result = await checkMonoesTokenExposure();
    expect(result.status).not.toBe('fail');
  });
});

// ── T8: the loud remediation warning — fires, names the file, says
// "compromised", never echoes the token value ────────────────────────────
describe('detectMonoesTokenLeak / formatMonoesLeakWarning (§3.5 remediation warning)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monomind-leak-warn-'));
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects nothing and warns nothing for a clean, tokenless project', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { monoes: { command: 'npx', args: [], env: {} } } }),
    );
    const reasons = await detectMonoesTokenLeak(dir);
    expect(reasons).toEqual([]);
    expect(formatMonoesLeakWarning(reasons)).toBeNull();
  });

  it('warns loudly, naming the file and the word "compromised", when monoes-connection.json is git-tracked', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    const connPath = join(dir, '.monomind', 'monoes-connection.json');
    const secret = /* value */ 'FAKE-RT-committed-should-never-print';
    writeFileSync(connPath, JSON.stringify({ refreshToken: secret }));
    execFileSync('git', ['add', '.monomind/monoes-connection.json'], { cwd: dir });

    const reasons = await detectMonoesTokenLeak(dir);
    expect(reasons.some((r) => r.includes('monoes-connection.json'))).toBe(true);

    const warning = formatMonoesLeakWarning(reasons);
    expect(warning).toBeTruthy();
    expect(warning).toContain('monoes-connection.json');
    expect(warning!.toLowerCase()).toContain('compromised');
    expect(warning!.toLowerCase()).toContain('revoke');
    expect(warning).not.toContain(secret);
  });

  it('warns when .mcp.json still has a literal legacy bearer entry', async () => {
    const secret = /* value */ 'FAKE-AT-legacy-should-never-print';
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: {
            type: 'http',
            url: 'https://monoes.me/api/mcp',
            headers: { Authorization: `Bearer ${secret}` },
          },
        },
      }),
    );
    const reasons = await detectMonoesTokenLeak(dir);
    expect(reasons.some((r) => r.includes('.mcp.json'))).toBe(true);
    const warning = formatMonoesLeakWarning(reasons);
    expect(warning!.toLowerCase()).toContain('compromised');
    expect(warning).not.toContain(secret);
  });

  // i-066 reviewer finding 6
  it('does not false-positive on an unrelated MCP server configured with its own bearer header', async () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: { command: 'npx', args: [], env: {} }, // tokenless, correct shape
          'some-other-server': {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer unrelated-service-token-not-ours' },
          },
        },
      }),
    );
    const reasons = await detectMonoesTokenLeak(dir);
    expect(reasons).toEqual([]);
  });

  it('falls back to the raw regex when .mcp.json fails to parse as JSON, so a corrupted file cannot hide a real leak', async () => {
    const secret = /* value */ 'FAKE-AT-corrupted-file-should-never-print';
    writeFileSync(
      join(dir, '.mcp.json'),
      `{ this is not valid JSON but still contains "Authorization": "Bearer ${secret}" somewhere`,
    );
    const reasons = await detectMonoesTokenLeak(dir);
    expect(reasons.some((r) => r.includes('.mcp.json'))).toBe(true);
  });
});
