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
import { createPkcePair, readMonoesConnection, getValidMonoesToken, handleMonoesRoutes } from '../src/ui/routes-monoes.mjs';

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

  function writeMcpJson(projectDir: string, contents: Record<string, unknown>) {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify(contents));
  }

  function readMcpJson(projectDir: string) {
    return JSON.parse(readFileSync(join(projectDir, '.mcp.json'), 'utf8'));
  }

  it('adds a monoes entry to .mcp.json once the OAuth callback completes', async () => {
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
          return { ok: true, json: async () => ({ access_token: 'access-1', expires_in: 3600 }) };
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

    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monomind).toEqual({ command: 'npx' });
    expect(mcpJson.mcpServers.monoes).toEqual({
      type: 'http',
      url: 'https://monoes.me/api/mcp',
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('removes the monoes entry from .mcp.json on disconnect', async () => {
    mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
    writeFileSync(join(monomindHome, '.monomind', 'monoes-connection.json'), JSON.stringify({ accessToken: 'x' }));
    writeMcpJson(monomindHome, {
      mcpServers: {
        monomind: { command: 'npx' },
        monoes: { type: 'http', url: 'https://monoes.me/api/mcp', headers: { Authorization: 'Bearer x' } },
      },
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

  it('GET /api/monoes/status refreshes an expiring token and re-syncs .mcp.json with the new one', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
      connectedUsername: 'someone',
    });
    writeMcpJson(monomindHome, {
      mcpServers: {
        monoes: { type: 'http', url: 'https://monoes.me/api/mcp', headers: { Authorization: 'Bearer old' } },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'refreshed', refresh_token: 'refresh-2', expires_in: 3600 }),
      })),
    );

    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const { req, res, send, getBody } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    expect(getBody()).toEqual({ connected: true, username: 'someone' });
    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toEqual({
      type: 'http',
      url: 'https://monoes.me/api/mcp',
      headers: { Authorization: 'Bearer refreshed' },
    });
  });

  it('GET /api/monoes/status removes the stale .mcp.json entry when refresh fails', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    writeMcpJson(monomindHome, {
      mcpServers: {
        monoes: { type: 'http', url: 'https://monoes.me/api/mcp', headers: { Authorization: 'Bearer old' } },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));

    const ctx = { MONOMIND_HOME: monomindHome, dashboardPort: 4000, projectDir: monomindHome };
    const { req, res, send, getBody } = fakeRequestResponse('GET', '/api/monoes/status');
    await handleMonoesRoutes(req, res, req.url, undefined, ctx);
    await send();

    expect(getBody()).toEqual({ connected: false, username: null });
    const mcpJson = readMcpJson(monomindHome) as { mcpServers: Record<string, unknown> };
    expect(mcpJson.mcpServers.monoes).toBeUndefined();
  });
});
