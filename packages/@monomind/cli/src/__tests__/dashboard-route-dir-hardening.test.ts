/**
 * Dashboard routes a token holder must not turn into arbitrary file reads,
 * file writes or code execution. The dashboard token is copied into every
 * known project's control.json, so org agents running in a project can read
 * it: `?dir=`, body `dir` and URL segments are attacker-controlled input.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { humanSessionCookie } from '../ui/human-auth.mjs';

const tmp = (p: string) => mkdtempSync(join(process.env.TMPDIR || tmpdir(), p));

let dir: string;
let other: string;
let started: Array<{ server: http.Server }> = [];
let port: number;
const token = () => readFileSync(join(dir, '.monomind', 'dashboard-token'), 'utf-8').trim();

/** node:http, not fetch: fetch normalizes `..` segments away before sending. */
function send(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'x-monomind-token': token(),
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

beforeEach(async () => {
  dir = tmp('dash-route-srv-');
  other = tmp('dash-route-other-');
  mkdirSync(join(dir, '.monomind'), { recursive: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { startServer } = await import('../ui/server.mjs');
  const res = await startServer({
    port: 0,
    projectDir: dir,
    projectDirExplicit: true,
    openBrowser: false,
  });
  started.push(res);
  port = (res as { port: number }).port;
});

afterEach(() => {
  for (const s of started) {
    s.server?.closeAllConnections?.();
    s.server?.close();
  }
  started = [];
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

const knowOther = () => {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'known-projects.json'), JSON.stringify([other]));
};

describe('GET /api/mastermind/session/:id', () => {
  it('rejects a traversal id with 400 and does not read the file', async () => {
    writeFileSync(
      join(dir, 'outside.json'),
      JSON.stringify({ planted: 'PLANTED-OUTSIDE-SESSIONS' }),
    );
    for (const p of [
      '/api/mastermind/session/../../outside',
      '/api/mastermind/session/..%2F..%2Foutside',
      '/api/mastermind/session/a/b',
    ]) {
      const r = await send('GET', p);
      expect(r.status, p).toBe(400);
      expect(r.text, p).not.toContain('PLANTED-OUTSIDE-SESSIONS');
    }
  }, 30_000);

  it('the trace route rejects an id outside the session-id pattern', async () => {
    const r = await send('GET', '/api/mastermind/session/%2E%2E/trace');
    expect(r.status).toBe(400);
  }, 30_000);

  it('still serves a session by a valid id', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'mastermind-sessions.json'),
      JSON.stringify([{ id: 'sess-1', status: 'done', ts: 1, events: [] }]),
    );
    const r = await send('GET', '/api/mastermind/session/sess-1');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ id: 'sess-1', status: 'done' });
    const t = await send('GET', '/api/mastermind/session/sess-1/trace');
    expect(t.status).toBe(200);
    expect(t.text).toContain('sess-1');
  }, 30_000);
});

describe('GET /api/token-usage', () => {
  const plantTracker = (root: string) => {
    const helpers = join(root, '.claude', 'helpers');
    mkdirSync(helpers, { recursive: true });
    const marker = join(root, 'tracker-ran');
    writeFileSync(
      join(helpers, 'token-tracker.cjs'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n` +
        'module.exports = { getDateRange: () => ({}), parseAllSessions: () => [] };\n',
    );
    return marker;
  };

  it('never runs a tracker from ?dir= or the project, and still answers 200 JSON', async () => {
    const otherMarker = plantTracker(other);
    const ownMarker = plantTracker(dir);
    for (const p of [
      `/api/token-usage?period=today&dir=${encodeURIComponent(other)}`,
      '/api/token-usage?period=week',
    ]) {
      const r = await send('GET', p);
      expect(r.status, p).toBe(200);
      const body = JSON.parse(r.text);
      expect(body).toHaveProperty('summary');
      expect(Array.isArray(body.models)).toBe(true);
    }
    expect(existsSync(otherMarker)).toBe(false);
    expect(existsSync(ownMarker)).toBe(false);
  }, 30_000);

  it('loads the tracker that ships with the CLI package', async () => {
    const { bundledTokenTrackerPath } = await import('../ui/server-routes-misc.mjs' as string);
    const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
    expect(bundledTokenTrackerPath()).toBe(
      join(pkgRoot, '.claude', 'helpers', 'token-tracker.cjs'),
    );
  });
});

describe('the dashboard page, which embeds the token', () => {
  it('sends Cache-Control: no-store', async () => {
    const cookie = humanSessionCookie().split(';')[0];
    const r = await send('GET', '/', { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.text).toContain('mm-token');
    expect(String(r.headers['cache-control'])).toContain('no-store');
  }, 30_000);
});

describe('?dir= outside the server project and known projects is refused', () => {
  it('POST /api/loops/stop', async () => {
    const r = await send('POST', `/api/loops/stop?dir=${encodeURIComponent(other)}`, {
      body: { id: 'loop-abc' },
    });
    expect(r.status).toBe(403);
    expect(existsSync(join(other, '.monomind'))).toBe(false);
  }, 30_000);

  it('POST /api/orgs/:name/stop', async () => {
    const r = await send('POST', `/api/orgs/acme/stop?dir=${encodeURIComponent(other)}`);
    expect(r.status).toBe(403);
    expect(existsSync(join(other, '.monomind'))).toBe(false);
    expect(existsSync(join(other, 'data'))).toBe(false);
  }, 30_000);

  it('POST /api/orgs/:name/mark-complete', async () => {
    const r = await send('POST', `/api/orgs/acme/mark-complete?dir=${encodeURIComponent(other)}`);
    expect(r.status).toBe(403);
  }, 30_000);

  it('POST /api/mcp/call, by query or by body', async () => {
    mkdirSync(join(other, '.monomind'), { recursive: true });
    writeFileSync(join(other, '.monomind', 'monograph.db'), '');
    const byQuery = await send('POST', `/api/mcp/call?dir=${encodeURIComponent(other)}`, {
      body: { tool: 'monograph_stats' },
    });
    expect(byQuery.status).toBe(403);
    const byBody = await send('POST', '/api/mcp/call', {
      body: { tool: 'monograph_stats', args: { dir: other } },
    });
    expect(byBody.status).toBe(403);
  }, 30_000);

  it('GET /api/monograph-benchmark', async () => {
    mkdirSync(join(other, '.monomind', 'graph'), { recursive: true });
    writeFileSync(join(other, '.monomind', 'graph', 'graph.json'), '{}');
    const r = await send('GET', `/api/monograph-benchmark?dir=${encodeURIComponent(other)}`);
    expect(r.status).toBe(403);
  }, 30_000);
});

describe('?dir= naming a known project is honored', () => {
  it('stop writes the stop file in that project', async () => {
    knowOther();
    const r = await send('POST', `/api/orgs/acme/stop?dir=${encodeURIComponent(other)}`);
    expect(r.status).toBe(200);
    expect(existsSync(join(other, '.monomind', 'orgs', 'acme', 'stop'))).toBe(true);
    expect(existsSync(join(dir, '.monomind', 'orgs', 'acme', 'stop'))).toBe(false);
  }, 30_000);

  it('mark-complete acts on that project, not the server project', async () => {
    knowOther();
    const orgs = join(other, '.monomind', 'orgs');
    mkdirSync(join(orgs, 'acme', 'runs'), { recursive: true });
    writeFileSync(join(orgs, 'acme.json'), JSON.stringify({ name: 'acme' }));
    writeFileSync(join(orgs, 'acme-runstate.json'), JSON.stringify({ runId: 'run-1' }));
    writeFileSync(join(orgs, 'acme', 'runs', 'run-1.jsonl'), '');
    const r = await send('POST', `/api/orgs/acme/mark-complete?dir=${encodeURIComponent(other)}`);
    expect(r.status).toBe(200);
    const lines = readFileSync(join(orgs, 'acme', 'runs', 'run-1.jsonl'), 'utf8');
    expect(lines).toContain('"run:complete"');
  }, 30_000);
});
