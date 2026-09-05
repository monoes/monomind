/**
 * Dashboard server (src/ui/server.mjs, incl. the org routes it mounts from
 * src/ui/routes-org.mjs) — security and cost-reporting correctness.
 *
 * Five defects are pinned here:
 *
 *   (a) No Host-header validation. The server binds 127.0.0.1 and GET / embeds a
 *       live auth credential in the HTML. A page on attacker.example whose DNS
 *       points at 127.0.0.1 (DNS rebinding) reaches the server, is treated as
 *       same-origin by the browser, and can read that credential out of the
 *       <meta> tag — then drive every authenticated /api/* route. Verified by
 *       hand before the fix: `curl -H 'Host: evil.example.com' http://127.0.0.1:<p>/`
 *       served 200 with the credential in the body.
 *
 *   (b) A model absent from server.mjs's private pricing table was costed at
 *       exactly 0 and reported as an authoritative $0.00 — indistinguishable
 *       from a genuinely free session. The table is a hand-maintained snapshot,
 *       so every newly released model lands in this hole. Verified by hand:
 *       a session on `claude-opus-5` with 2M tokens reported totalCost 0 while a
 *       claude-sonnet-4-5 session with identical usage reported 18.
 *
 *   (c) `require('zlib')` inside this ESM module threw ReferenceError at runtime,
 *       swallowed by the surrounding catch, so cold-tier log compaction never
 *       ran. Verified by hand: a >24h-old .warm.jsonl was left untouched (no
 *       .cold.jsonl.gz) after POSTing a run:complete event.
 *
 *   (d) POST /api/orgs/:name/stop wrote a marker file at
 *       .monomind/orgs/.stops/<name>.stop — a path nothing in the CLI/daemon
 *       ever polled (org run polls .monomind/orgs/<name>/stop; org serve's
 *       pollStopfiles() watches the same path), so the dashboard's "Stop org"
 *       button never actually stopped a running org.
 *
 *   (e) GET /api/org/:name/artifact allowed reading any path under the project
 *       root or any data/known-projects.json entry, with no restriction to
 *       .monomind — any dashboard client could read .env, .git/config, or other
 *       arbitrary project files via this route.
 *
 * The Host and compaction cases run against a REAL bound server on a real socket
 * — a unit test of the predicate alone would not prove the check is actually
 * wired ahead of the open routes, which is the whole point of (a). (d) and (e)
 * do the same for the org routes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

// server.mjs is plain ESM shipped as-is; import it directly.
// @ts-expect-error — .mjs sibling has no type declarations
import * as uiServer from '../src/ui/server.mjs';

const { startServer, isAllowedHost, parseHostHeader, _sjHasPricing } = uiServer as any;
let httpServer: any = null;

/** Matches the per-process auth credential the server injects into the page. */
const CRED_RE = /mm-token" content="([a-f0-9]+)"/;

let baseUrl = '';
let port = 0;
let cred = '';
let projectDir = '';
let homeDir = '';
const prevHome = process.env.HOME;
const prevCwd = process.cwd();

/** Fixture project path; the server derives its ~/.claude/projects slug from this. */
const COST_FIXTURE_DIR = '/tmp/mmcostfixture';

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'mm-ui-server-'));
  projectDir = join(root, 'proj');
  homeDir = join(root, 'home');
  mkdirSync(join(projectDir, '.monomind'), { recursive: true });

  // ── (b) fixture: two sessions with identical usage, one on a model the
  // pricing table knows and one on a model it does not.
  const claudeProjects = join(homeDir, '.claude', 'projects', COST_FIXTURE_DIR.replace(/\//g, '-'));
  mkdirSync(claudeProjects, { recursive: true });
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  writeFileSync(
    join(claudeProjects, 'unknown-model.jsonl'),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-26T00:00:00Z', message: { model: 'totally-made-up-model-9', usage } }) + '\n',
  );
  writeFileSync(
    join(claudeProjects, 'known-model.jsonl'),
    JSON.stringify({ type: 'assistant', timestamp: '2026-07-26T00:00:00Z', message: { model: 'claude-sonnet-4-5', usage } }) + '\n',
  );

  // os.homedir() reads $HOME on POSIX — this is what points the cost endpoints
  // at the fixture instead of the developer's real session logs.
  process.env.HOME = homeDir;
  process.chdir(projectDir);

  const res = await startServer({ port: 4917, projectDir, openBrowser: false });
  httpServer = res.server;
  port = res.port;
  baseUrl = `http://127.0.0.1:${port}`;

  const html = await (await fetch(`${baseUrl}/`)).text();
  cred = (html.match(CRED_RE) || [])[1] || '';
}, 60_000);

afterAll(async () => {
  try { httpServer?.closeAllConnections?.(); httpServer?.close(); } catch { /* best effort */ }
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
});

const auth = () => ({ 'x-monomind-token': cred });

/**
 * Raw HTTP request. `fetch()` cannot be used for the Host cases: `Host` is a
 * forbidden header name in the Fetch spec, and undici silently DROPS it — a
 * fetch-based version of these tests passes against the unfixed server because
 * every request still carries `Host: 127.0.0.1:<port>`. node:http sends
 * whatever it is given.
 */
function raw(
  reqPath: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method, headers, setHost: false },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers as any, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('(a) DNS-rebinding: Host header validation', () => {
  it('serves the dashboard for a loopback Host — the legitimate path still works', async () => {
    // Guards the whole suite: if the page stopped serving, every "rejected"
    // assertion below would pass for the wrong reason.
    expect(cred, 'no credential recovered from GET / — server did not serve the page').toMatch(/^[a-f0-9]{16,}$/);
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      const r = await raw('/', { headers: { Host: host } });
      expect(r.status, `Host: ${host} must be served`).toBe(200);
      expect(r.body).toMatch(CRED_RE);
    }
  });

  it('rejects a foreign Host on GET / — nothing is handed to a rebound page', async () => {
    const r = await raw('/', { headers: { Host: 'evil.example.com' } });
    expect(r.status).toBe(403);
    expect(r.body).not.toMatch(CRED_RE);
    expect(r.body).not.toContain(cred);
  });

  it('rejects a foreign Host on an authenticated API route even with valid credentials', async () => {
    const r = await raw('/api/status', { headers: { ...auth(), Host: 'attacker.test' } });
    expect(r.status).toBe(403);
  });

  it('the same API route succeeds over loopback with the same credentials — 403 is the Host, not the auth', async () => {
    const r = await raw('/api/status', { headers: { ...auth(), Host: `127.0.0.1:${port}` } });
    expect(r.status).toBe(200);
  });

  it('does not attach a CORS header to the rejection', async () => {
    const r = await raw('/', {
      headers: { Host: 'evil.example.com', Origin: `http://127.0.0.1:${port}` },
    });
    expect(r.status).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('(a) isAllowedHost / parseHostHeader', () => {
  it('strips the port, including from bracketed IPv6 literals', () => {
    expect(parseHostHeader('localhost:4242')).toBe('localhost');
    expect(parseHostHeader('127.0.0.1')).toBe('127.0.0.1');
    expect(parseHostHeader('[::1]:4242')).toBe('[::1]');
    expect(parseHostHeader('[::1]')).toBe('[::1]');
    expect(parseHostHeader('EVIL.example.COM:80')).toBe('evil.example.com');
    expect(parseHostHeader(undefined)).toBe('');
  });

  it('allows every loopback spelling, including all of 127.0.0.0/8', () => {
    for (const h of ['localhost', '127.0.0.1', '127.0.0.1:4242', '[::1]:4242', '127.9.9.9', 'LOCALHOST:80']) {
      expect(isAllowedHost(h), h).toBe(true);
    }
  });

  it('rejects foreign names, including ones that merely embed a loopback name', () => {
    for (const h of [
      'evil.example.com',
      'localhost.evil.com',        // suffix trick
      'evil.com:4242',
      '127.0.0.1.evil.com',        // prefix trick
      'notlocalhost',
      '192.168.1.5:4242',
      '10.0.0.1',
    ]) {
      expect(isAllowedHost(h), h).toBe(false);
    }
  });

  it('honours an explicitly configured extra host, with or without a port', () => {
    expect(isAllowedHost('dash.internal:4242', ['dash.internal'])).toBe(true);
    expect(isAllowedHost('dash.internal', ['dash.internal:9999'])).toBe(true);
    expect(isAllowedHost('other.internal', ['dash.internal'])).toBe(false);
  });

  it('allows an absent Host — browsers always send one, so this is not a bypass', () => {
    expect(isAllowedHost('')).toBe(true);
    expect(isAllowedHost(undefined)).toBe(true);
  });
});

describe('(b) unknown-model cost is reported as unknown, not zero', () => {
  it('knows which models it can price', () => {
    expect(_sjHasPricing('claude-sonnet-4-5')).toBe(true);
    expect(_sjHasPricing('sonnet')).toBe(true);                      // alias
    expect(_sjHasPricing('claude-sonnet-4-5-20260101')).toBe(true);  // dated
    expect(_sjHasPricing('totally-made-up-model-9')).toBe(false);
    expect(_sjHasPricing('')).toBe(false);
  });

  it('/api/session-journal flags the unpriced session and leaves the priced one alone', async () => {
    const r = await fetch(
      `${baseUrl}/api/session-journal?dir=${encodeURIComponent(COST_FIXTURE_DIR)}`,
      { headers: auth() },
    );
    expect(r.status).toBe(200);
    const { sessions } = await r.json();

    const unknown = sessions.find((s: any) => s.id === 'unknown-model');
    const known = sessions.find((s: any) => s.id === 'known-model');
    expect(unknown, 'fixture session missing — the test would assert over nothing').toBeTruthy();
    expect(known).toBeTruthy();

    // The priced session proves the fixture is genuinely being costed.
    expect(known.totalCost).toBeGreaterThan(0);
    expect(known.costIncomplete).toBe(false);
    expect(known.unknownPricingModels).toEqual([]);
    expect(known.modelBreakdown['claude-sonnet-4-5'].unknownPricing).toBeUndefined();

    // The unpriced one still sums to 0 — but says so.
    expect(unknown.costIncomplete).toBe(true);
    expect(unknown.unknownPricingModels).toContain('totally-made-up-model-9');
    expect(unknown.modelBreakdown['totally-made-up-model-9'].unknownPricing).toBe(true);
    // and it did see the call, so this is not an empty-fixture pass
    expect(unknown.modelBreakdown['totally-made-up-model-9'].calls).toBe(1);
  });

  it('/api/project-costs keeps a project whose entire spend is unpriced instead of dropping it', async () => {
    const r = await fetch(`${baseUrl}/api/project-costs`, { headers: auth() });
    expect(r.status).toBe(200);
    const { projects } = await r.json();
    const p = projects.find((x: any) => String(x.path).includes('mmcostfixture'));
    expect(p, 'fixture project absent from /api/project-costs').toBeTruthy();
    expect(p.costIncomplete).toBe(true);
    expect(p.unknownPricingModels).toContain('totally-made-up-model-9');
  });
});

describe('(c) cold-tier compaction actually runs', () => {
  it('gzips a >24h-old warm run file when a run completes', async () => {
    const runDir = join(projectDir, '.monomind', 'orgs', 'ctest', 'runs');
    mkdirSync(runDir, { recursive: true });
    const warm = join(runDir, 'oldrun.warm.jsonl');
    writeFileSync(warm, '{"stale":true}\n');
    const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    utimesSync(warm, longAgo, longAgo);

    const r = await fetch(`${baseUrl}/api/mastermind/event`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:complete', org: 'ctest', runId: 'newrun' }),
    });
    expect(r.status).toBe(200);

    // Compaction is scheduled via setImmediate + an async gzip callback.
    const cold = join(runDir, 'oldrun.cold.jsonl.gz');
    for (let i = 0; i < 100 && !existsSync(cold); i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(
      existsSync(cold),
      `no cold file; run dir contains: ${readdirSync(runDir).join(', ')}`,
    ).toBe(true);
    // Warm file is removed once cold is written.
    expect(existsSync(warm)).toBe(false);
  }, 20_000);
});

describe('(d) POST /api/orgs/:name/stop writes the marker file the real poll loops watch', () => {
  // `org run`'s poll loop and `org serve`'s pollStopfiles() (commands/org.ts) both
  // watch .monomind/orgs/<name>/stop. The dashboard used to write
  // .monomind/orgs/.stops/<name>.stop instead — a path nothing ever polled, so the
  // "Stop org" button was a no-op against a real running org.
  it('writes .monomind/orgs/<name>/stop, not the old .stops/<name>.stop path', async () => {
    const orgName = 'stoptest';
    const orgsDir = join(projectDir, '.monomind', 'orgs');
    mkdirSync(orgsDir, { recursive: true });
    writeFileSync(
      join(orgsDir, `${orgName}.json`),
      JSON.stringify({ name: orgName, goal: 'test org', roles: [] }),
    );

    const r = await fetch(`${baseUrl}/api/orgs/${orgName}/stop`, {
      method: 'POST',
      headers: auth(),
    });
    expect(r.status).toBe(200);

    const realStopFile = join(orgsDir, orgName, 'stop');
    expect(
      existsSync(realStopFile),
      'the path org run / org serve actually poll must exist after Stop',
    ).toBe(true);

    const legacyStopFile = join(orgsDir, '.stops', `${orgName}.stop`);
    expect(existsSync(legacyStopFile), 'must not write the old, never-polled path').toBe(false);
  });

  it("GET /api/org/:name's running status flips to false at the same path Stop writes", async () => {
    const orgName = 'stoptest2';
    const orgsDir = join(projectDir, '.monomind', 'orgs');
    mkdirSync(orgsDir, { recursive: true });
    writeFileSync(
      join(orgsDir, `${orgName}.json`),
      JSON.stringify({ name: orgName, goal: 'test org', roles: [] }),
    );
    // Simulate an active run via runstate so `running` reads true before Stop —
    // otherwise a false-negative "not running" would pass this test for the
    // wrong reason (no stopfile checked at all).
    writeFileSync(
      join(orgsDir, `${orgName}-runstate.json`),
      JSON.stringify({ status: 'running', lastEventAt: Date.now() }),
    );

    const before = await fetch(`${baseUrl}/api/org/${orgName}`, { headers: auth() });
    expect((await before.json()).running, 'fixture must start running').toBe(true);

    const stopRes = await fetch(`${baseUrl}/api/orgs/${orgName}/stop`, {
      method: 'POST',
      headers: auth(),
    });
    expect(stopRes.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/org/${orgName}`, { headers: auth() });
    expect(
      (await after.json()).running,
      'status must observe the same stopfile path Stop just wrote',
    ).toBe(false);
  });
});

describe('(e) GET /api/org/:name/artifact is scoped to the org\'s own .monomind/orgs/<name>/ dir', () => {
  // The endpoint used to allow any path under the project root or any
  // data/known-projects.json entry, with no restriction to .monomind — any
  // dashboard client could read .env, .git/config, or other arbitrary project
  // files via this route.
  it("serves a file that lives inside the org's own .monomind/orgs/<name>/ directory", async () => {
    const orgName = 'artifacttest';
    const orgDir = join(projectDir, '.monomind', 'orgs', orgName);
    mkdirSync(orgDir, { recursive: true });
    const legitFile = join(orgDir, 'report.md');
    writeFileSync(legitFile, 'hello from the org runtime');

    const r = await fetch(
      `${baseUrl}/api/org/${orgName}/artifact?path=${encodeURIComponent(legitFile)}`,
      { headers: auth() },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.content).toBe('hello from the org runtime');
  });

  it('rejects a request for the project .env file', async () => {
    const orgName = 'artifacttest';
    const envFile = join(projectDir, '.env');
    writeFileSync(envFile, 'DUMMY_ENV_VALUE=must-not-be-readable-via-artifact-route');

    const r = await fetch(
      `${baseUrl}/api/org/${orgName}/artifact?path=${encodeURIComponent(envFile)}`,
      { headers: auth() },
    );
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('path not allowed');
  });

  it("rejects a request for a sibling org's own data file outside this org's directory", async () => {
    const orgName = 'artifacttest';
    const orgsDir = join(projectDir, '.monomind', 'orgs');
    mkdirSync(orgsDir, { recursive: true });
    const otherOrgSecrets = join(orgsDir, 'otherorg-secrets.json');
    writeFileSync(otherOrgSecrets, '{"token":"leak-me-not"}');

    const r = await fetch(
      `${baseUrl}/api/org/${orgName}/artifact?path=${encodeURIComponent(otherOrgSecrets)}`,
      { headers: auth() },
    );
    expect(r.status).toBe(403);
  });
});
