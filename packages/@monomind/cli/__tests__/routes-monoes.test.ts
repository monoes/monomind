/**
 * routes-monoes.mjs — the monoes.me connection (OAuth) route handlers.
 *
 * Pure-logic coverage only: PKCE pair correctness and the
 * getValidMonoesToken() refresh-vs-reuse decision. The actual OAuth
 * exchange against monoes.me is verified manually (see the design spec's
 * Testing section) — this repo has no existing e2e/Playwright
 * infrastructure for the dashboard to build on for that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// routes-monoes.mjs is plain ESM shipped as-is; import it directly.
// @ts-expect-error — .mjs sibling has no type declarations
import { createPkcePair, readMonoesConnection, getValidMonoesToken, handleMonoesRoutes, __resetMonoesLeakThrottle } from '../src/ui/routes-monoes.mjs';

/** Minimal fake http.IncomingMessage/ServerResponse pair — routes-monoes.mjs
 * only uses .method/.url/.on('data'|'end') on the request and
 * .writeHead()/.end() on the response, so a full Node http server isn't
 * needed to exercise the route logic. */
function fakeRequestResponse(method: string, url: string, jsonBody?: unknown) {
  const dataListeners: Array<(chunk: string) => void> = [];
  const endListeners: Array<() => void> = [];
  const req = {
    method,
    url,
    on(event: string, cb: (...args: any[]) => void) {
      if (event === 'data') dataListeners.push(cb);
      if (event === 'end') endListeners.push(cb);
      return req;
    },
  };
  let statusCode = 0;
  let responseBody = '';
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(body?: string) {
      if (body) responseBody = body;
      // Fire the body-parsing chain synchronously, matching how a real
      // socket delivers 'data' then 'end' on the same tick for a small body.
    },
  };
  async function send() {
    if (jsonBody !== undefined) {
      for (const cb of dataListeners) cb(JSON.stringify(jsonBody));
    }
    for (const cb of endListeners) await cb();
  }
  return { req, res, send, getStatus: () => statusCode, getBody: () => (responseBody ? JSON.parse(responseBody) : null) };
}

let monomindHome = '';

beforeEach(() => {
  monomindHome = mkdtempSync(join(tmpdir(), 'monomind-monoes-test-'));
  // i-066 follow-up finding 10: the leak-check throttle is a module-level
  // scalar shared across every test in this file — reset it before each
  // test so an earlier test's status poll can never suppress a later one's
  // leak check for an unrelated reason.
  __resetMonoesLeakThrottle();
});

afterEach(() => {
  rmSync(monomindHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function writeConnection(data: Record<string, unknown>) {
  const { mkdirSync, writeFileSync } = require('node:fs');
  const dir = join(monomindHome, '.monomind');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'monoes-connection.json'), JSON.stringify(data));
}

describe('createPkcePair', () => {
  it('produces a challenge that is the SHA-256/base64url of the verifier', () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('produces a URL-safe verifier with no padding', () => {
    const { verifier } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces distinct pairs across calls', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('readMonoesConnection', () => {
  it('returns null when no connection file exists', () => {
    expect(readMonoesConnection(monomindHome)).toBeNull();
  });

  it('returns the parsed connection when one exists', () => {
    writeConnection({ accessToken: /* value */ 'abc', connectedUsername: 'someone' });
    expect(readMonoesConnection(monomindHome)).toEqual({ accessToken: 'abc', connectedUsername: 'someone' });
  });
});

describe('getValidMonoesToken', () => {
  it('returns null when there is no connection', async () => {
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
  });

  it('returns the stored access token directly when it is not close to expiring', async () => {
    writeConnection({ accessToken: /* value */ 'still-good', expiresAt: Date.now() + 10 * 60 * 1000 });
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBe('still-good');
  });

  it('refreshes when the token is expired, and persists the new token', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'new', refresh_token: 'refresh-2', expires_in: 3600 }),
      })),
    );

    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBe('new');

    const persisted = readMonoesConnection(monomindHome);
    expect(persisted.accessToken).toBe('new');
    expect(persisted.refreshToken).toBe('refresh-2');
  });

  it('deletes the connection and returns null when refresh fails', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));

    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
    expect(readMonoesConnection(monomindHome)).toBeNull();
    expect(existsSync(join(monomindHome, '.monomind', 'monoes-connection.json'))).toBe(false);
  });

  it('deletes the connection and returns null when there is no refresh token to use', async () => {
    writeConnection({ accessToken: /* value */ 'old', expiresAt: Date.now() - 1000 });
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
    expect(existsSync(join(monomindHome, '.monomind', 'monoes-connection.json'))).toBe(false);
  });
});

describe('POST /api/monoes/upload-org', () => {
  const baseCtx = () => ({
    MONOMIND_HOME: monomindHome,
    dashboardPort: 4000,
    projectDir: monomindHome,
    _resolveOrgProjectDir: () => monomindHome,
  });

  it('returns 400 for an invalid org name', async () => {
    const { req, res, send, getStatus } = fakeRequestResponse('POST', '/api/monoes/upload-org', {
      orgName: 'not valid!',
    });
    const handled = await handleMonoesRoutes(req, res, req.url, undefined, baseCtx());
    await send();
    expect(handled).toBe(true);
    expect(getStatus()).toBe(400);
  });

  it('returns 401 not_connected when there is no stored connection', async () => {
    const { req, res, send, getStatus, getBody } = fakeRequestResponse('POST', '/api/monoes/upload-org', {
      orgName: 'my-org',
    });
    await handleMonoesRoutes(req, res, req.url, undefined, baseCtx());
    await send();
    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'not_connected' });
  });

  it('returns 404 when the org file does not exist on disk', async () => {
    writeConnection({ accessToken: /* value */ 'good', expiresAt: Date.now() + 120_000 });
    const { req, res, send, getStatus } = fakeRequestResponse('POST', '/api/monoes/upload-org', {
      orgName: 'missing-org',
    });
    await handleMonoesRoutes(req, res, req.url, undefined, baseCtx());
    await send();
    expect(getStatus()).toBe(404);
  });

  it('uploads the org file and returns the created org with a monoes.me link', async () => {
    writeConnection({ accessToken: /* value */ 'good', expiresAt: Date.now() + 120_000 });
    const { mkdirSync, writeFileSync } = require('node:fs');
    const orgsDir = join(monomindHome, '.monomind', 'orgs');
    mkdirSync(orgsDir, { recursive: true });
    writeFileSync(join(orgsDir, 'my-org.json'), JSON.stringify({ name: 'my-org', roles: [{ id: 'boss' }] }));

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'org-abc', name: 'my-org' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res, send, getStatus, getBody } = fakeRequestResponse('POST', '/api/monoes/upload-org', {
      orgName: 'my-org',
    });
    await handleMonoesRoutes(req, res, req.url, undefined, baseCtx());
    await send();

    expect(getStatus()).toBe(201);
    expect(getBody()).toEqual({ id: 'org-abc', name: 'my-org', url: 'https://monoes.me/community/orgs/org-abc' });

    const [, uploadOpts] = fetchMock.mock.calls[0];
    expect(uploadOpts.headers.Authorization).toBe('Bearer good');
    expect(JSON.parse(uploadOpts.body).orgJson).toContain('my-org');
  });
});

describe('monoes.me connection → .mcp.json sync', () => {
  const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');

  const STDIO_MONOES_ENTRY = {
    command: 'npx',
    args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
    env: {},
  };

  function writeMcpJson(projectDir: string, contents: Record<string, unknown>) {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify(contents));
  }

  function readMcpJson(projectDir: string) {
    return JSON.parse(readFileSync(join(projectDir, '.mcp.json'), 'utf8'));
  }

  // T1
  it('_syncMonoesMcpEntry writes no access-token substring into .mcp.json', async () => {
    writeMcpJson(monomindHome, { mcpServers: { monomind: { command: 'npx' } } });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const connectReq = fakeRequestResponse('POST', '/api/monoes/connect');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/oauth2/register')) {
          return { ok: true, json: async () => ({ client_id: 'client-1' }) };
        }
        throw new Error(`unexpected fetch in connect step: ${url}`);
      }),
    );
    await handleMonoesRoutes(connectReq.req, connectReq.res, connectReq.req.url, undefined, ctx);
    await connectReq.send();
    const { authorizeUrl } = connectReq.getBody();
    const state = new URL(authorizeUrl).searchParams.get('state');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/oauth2/token')) {
          return { ok: true, json: async () => ({ access_token: /* value */ 'FAKE-AT-deadbeef', expires_in: 3600 }) };
        }
        if (String(url).includes('/api/community/me')) {
          return { ok: true, json: async () => ({ username: 'someone' }) };
        }
        throw new Error(`unexpected fetch in callback step: ${url}`);
      }),
    );
    const callbackReq = fakeRequestResponse('GET', `/api/monoes/callback?code=abc&state=${state}`);
    await handleMonoesRoutes(callbackReq.req, callbackReq.res, callbackReq.req.url, undefined, ctx);
    await callbackReq.send();

    // Read as raw text, not parsed JSON — the whole point is that the token
    // substring must not appear anywhere in the file, not just outside a
    // particular field.
    const raw = readFileSync(join(monomindHome, '.mcp.json'), 'utf8') as string;
    expect(raw).not.toContain('FAKE-AT-deadbeef');

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monomind).toEqual({ command: 'npx' });
    expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
  });

  it('removes the monoes entry from .mcp.json on disconnect', async () => {
    mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
    writeFileSync(join(monomindHome, '.monomind', 'monoes-connection.json'), JSON.stringify({ accessToken: 'x' }));
    writeMcpJson(monomindHome, {
      mcpServers: { monomind: { command: 'npx' }, monoes: STDIO_MONOES_ENTRY },
    });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const { req, res, send } = fakeRequestResponse('POST', '/api/monoes/disconnect');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monomind).toEqual({ command: 'npx' });
    expect(mcpJson.mcpServers.monoes).toBeUndefined();
  });

  it('does nothing when the project has no .mcp.json yet', async () => {
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const { req, res, send } = fakeRequestResponse('POST', '/api/monoes/disconnect');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();
    expect(existsSync(join(monomindHome, '.mcp.json'))).toBe(false);
  });

  it('GET /api/monoes/status keeps the connected stdio entry across a silent token refresh (no literal token ever appears)', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
      connectedUsername: 'someone',
    });
    writeMcpJson(monomindHome, { mcpServers: { monoes: STDIO_MONOES_ENTRY } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: /* value */ 'FAKE-AT-refreshed', refresh_token: 'refresh-2', expires_in: 3600 }),
      })),
    );

    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const { req, res, send, getBody } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    expect(getBody()).toEqual({ connected: true, username: 'someone' });
    const raw = readFileSync(join(monomindHome, '.mcp.json'), 'utf8') as string;
    expect(raw).not.toContain('FAKE-AT-refreshed');
    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
  });

  it('GET /api/monoes/status removes the .mcp.json entry when refresh fails', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    writeMcpJson(monomindHome, { mcpServers: { monoes: STDIO_MONOES_ENTRY } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));

    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const { req, res, send, getBody } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    expect(getBody()).toEqual({ connected: false, username: null });
    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toBeUndefined();
  });

  // T5
  it('re-syncs .mcp.json only when the connected state changes, not on every poll', async () => {
    // No .mcp.json entry yet — the first status call transitions
    // disconnected -> connected and must write it; the second call, with
    // the token still valid and unchanged, must not write again. Measured
    // via mtime rather than a writeFileSync spy, since routes-monoes.mjs's
    // ESM `import fs from 'node:fs'` binding is not guaranteed to be the
    // same object identity as a CJS `require('node:fs')` spy target under
    // Vitest's SSR transform.
    writeConnection({ accessToken: /* value */ 'stays-good', expiresAt: Date.now() + 10 * 60 * 1000 });
    writeMcpJson(monomindHome, { mcpServers: {} });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const mcpJsonPath = join(monomindHome, '.mcp.json');
    const { statSync } = require('node:fs');
    const mtimeNs = () => statSync(mcpJsonPath, { bigint: true }).mtimeNs;

    const first = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(first.req, first.res, first.req.url, undefined, ctx);
    await first.send();
    expect(readMcpJson(monomindHome).mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
    const afterFirst = mtimeNs();

    // A couple ms so a spurious second write would be observable in mtime
    // even on filesystems with coarse timestamp resolution.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(second.req, second.res, second.req.url, undefined, ctx);
    await second.send();
    expect(mtimeNs()).toBe(afterFirst); // unchanged: no second write
    expect(readMcpJson(monomindHome).mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
  });

  // i-066 reviewer finding 2 — the priority finding: a project that already
  // leaked the token must be migrated, not just warned about forever.
  it('migrates a pre-fix leaked entry (literal bearer header) to the tokenless stdio shape while still connected', async () => {
    // Exactly the victim population finding 2 named: a pre-fix .mcp.json
    // still carrying `headers.Authorization: Bearer <token>`, and the user
    // is STILL CONNECTED (isConnected=true). A presence-only comparison
    // (`hasEntry`) sees isConnected===hasEntry===true and never re-syncs,
    // so the live credential stays in the committable file indefinitely.
    const leakedToken = /* value */ 'FAKE-AT-leaked-pre-fix-should-be-migrated';
    writeConnection({
      accessToken: /* value */ 'stays-good',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    writeMcpJson(monomindHome, {
      mcpServers: {
        monoes: {
          type: 'http',
          url: 'https://monoes.me/api/mcp',
          headers: { Authorization: `Bearer ${leakedToken}` },
        },
      },
    });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const { req, res, send } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
    const raw = readFileSync(join(monomindHome, '.mcp.json'), 'utf8') as string;
    expect(raw).not.toContain(leakedToken);
  });

  // i-066 reviewer finding 8 [BLOCKER]: `'headers' in entry` throws a
  // TypeError when entry isn't an object (a string/number/boolean from a
  // typo, hand edit, or bad merge resolution — .mcp.json is designed to be
  // committed and merged). That throw escapes the request handler's
  // try/catch scope and, since ui/server.mjs's http.createServer callback
  // has no enclosing try/catch, terminates the whole dashboard process —
  // "the dashboard died" from a teammate's hand edit. Must self-heal
  // instead: a non-object value is non-conforming, so it gets re-synced to
  // the correct shape.
  it('does not crash the dashboard, and self-heals, when mcpServers.monoes is a malformed non-object value', async () => {
    writeConnection({ accessToken: /* value */ 'stays-good', expiresAt: Date.now() + 10 * 60 * 1000 });
    writeMcpJson(monomindHome, {
      mcpServers: { monoes: 'this-should-be-an-object-not-a-string' },
    });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const { req, res, send } = fakeRequestResponse('GET', '/api/monoes/status');
    // If handleMonoesRoutes throws/rejects here (the bug), this test fails
    // with that exact error — which is the point: ui/server.mjs's request
    // handler has no enclosing try/catch, so an uncaught throw here is
    // precisely what takes the whole dashboard process down.
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
  });

  // An array is `typeof 'object'` but not a plain config object — `'headers'
  // in ['npx']` doesn't throw (arrays support `in`), so this row wouldn't
  // have crashed, but it would have wrongly reported conforming=true and
  // never been repaired without the explicit Array.isArray() exclusion.
  it('self-heals when mcpServers.monoes is an array instead of an object', async () => {
    writeConnection({ accessToken: /* value */ 'stays-good', expiresAt: Date.now() + 10 * 60 * 1000 });
    writeMcpJson(monomindHome, { mcpServers: { monoes: ['npx', '-y', 'monomind@latest'] } });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const { req, res, send } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
  });

  // i-066 reviewer finding U5 [BLOCKER] — AC-U5-R2 (state-shaped, binding):
  // a connected victim's FIRST status poll must emit the revoke warning on
  // stderr AND leave .mcp.json free of the literal token, IN THE SAME RUN.
  // Round 1 had the warning working but never migrated; round 2 (the
  // shape-aware re-sync) migrates but the migration runs BEFORE the leak
  // check, which re-reads .mcp.json from disk — so by the time the check
  // runs it inspects the already-migrated file and always finds nothing.
  // A test asserting either property alone would have passed at either of
  // the last two SHAs; only asserting both together catches the ordering bug.
  it('warns AND migrates on the very first poll for a connected victim (AC-U5-R2)', async () => {
    const leakedToken = /* value */ 'FAKE-AT-u5-should-warn-before-migrating';
    writeConnection({
      accessToken: /* value */ 'stays-good',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    writeMcpJson(monomindHome, {
      mcpServers: {
        monoes: {
          type: 'http',
          url: 'https://monoes.me/api/mcp',
          headers: { Authorization: `Bearer ${leakedToken}` },
        },
      },
    });
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // i-066 follow-up finding 10: the leak-check throttle (module-level
    // _lastLeakCheckAt, i-066 finding 4) is reset in this file's top-level
    // beforeEach via __resetMonoesLeakThrottle(), so this "first poll"
    // scenario doesn't need fake timers to defeat state left over from
    // earlier tests.
    try {
      const { req, res, send } = fakeRequestResponse('GET', '/api/monoes/status');
      await handleMonoesRoutes(req, res, req.url, undefined, ctx);
      await send();

      // Property 1: the warning fired, on THIS poll, naming compromise + revoke.
      const printed = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      expect(printed.toLowerCase()).toContain('revoke');

      // Property 2: .mcp.json is ALSO already migrated by this same poll.
      const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
      expect(mcpJson.mcpServers.monoes).toEqual(STDIO_MONOES_ENTRY);
      const raw = readFileSync(join(monomindHome, '.mcp.json'), 'utf8') as string;
      expect(raw).not.toContain(leakedToken);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// #307: the registered client is bound to ONE redirect_uri (the port the
// dashboard happened to be on the first time anyone connected), but only
// `clientId` was cached — so a dashboard on any other port reused that
// client, monoes.me redirected to the port the client was registered for,
// and the browser landed on ERR_CONNECTION_REFUSED. Anyone whose dashboard
// ever fell back to another port (4242 busy -> 4243) hits this.
describe('POST /api/monoes/connect — cached client vs. dashboard port (#307)', () => {
  function stubRegister(clientIds: string[]) {
    const registered: string[] = [];
    let next = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url).includes('/oauth2/register')) {
          registered.push(JSON.parse(String(init?.body)).redirect_uris[0]);
          return { ok: true, json: async () => ({ client_id: clientIds[next++] }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    return registered;
  }

  async function connect(dashboardPort: number) {
    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort, projectDir: monomindHome };
    const { req, res, send, getBody } = fakeRequestResponse('POST', '/api/monoes/connect');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();
    return new URL(getBody().authorizeUrl).searchParams;
  }

  it('re-registers when the dashboard is on a different port than the cached client', async () => {
    const registered = stubRegister(['client-4242', 'client-4243']);

    const first = await connect(4242);
    expect(first.get('client_id')).toBe('client-4242');

    // Same machine, same home, dashboard fell back to 4243.
    const second = await connect(4243);
    expect(registered).toEqual([
      'http://127.0.0.1:4242/api/monoes/callback',
      'http://127.0.0.1:4243/api/monoes/callback',
    ]);
    // The authorize request must carry the client that was registered FOR
    // this port — otherwise monoes.me redirects back to 4242 and the
    // connection never completes.
    expect(second.get('client_id')).toBe('client-4243');
    expect(second.get('redirect_uri')).toBe('http://127.0.0.1:4243/api/monoes/callback');
    expect(readMonoesConnection(monomindHome)).toMatchObject({
      clientId: 'client-4243',
      redirectUri: 'http://127.0.0.1:4243/api/monoes/callback',
    });
  });

  it('reuses the cached client when the port is unchanged', async () => {
    const registered = stubRegister(['client-4242', 'client-should-not-be-used']);

    await connect(4242);
    const second = await connect(4242);

    expect(registered).toEqual(['http://127.0.0.1:4242/api/monoes/callback']);
    expect(second.get('client_id')).toBe('client-4242');
  });

  it('drops a cached client the OAuth server rejects, so the next connect registers a fresh one', async () => {
    stubRegister(['client-stale']);
    const state = (await connect(4242)).get('state');

    // monoes.me no longer knows this client (revoked, server re-provisioned,
    // registration expired) — the token exchange comes back 400. Keeping the
    // dead id cached makes every later attempt fail the same way forever.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400 })));
    const cb = fakeRequestResponse('GET', `/api/monoes/callback?code=abc&state=${state}`);
    await handleMonoesRoutes(cb.req, cb.res, cb.req.url, undefined, {
      MONOMIND_HOME: monomindHome,
      dashboardPort: 4242,
      projectDir: monomindHome,
    });
    await cb.send();

    expect(readMonoesConnection(monomindHome)?.clientId).toBeUndefined();

    const registered = stubRegister(['client-fresh']);
    expect((await connect(4242)).get('client_id')).toBe('client-fresh');
    expect(registered).toEqual(['http://127.0.0.1:4242/api/monoes/callback']);
  });
});
