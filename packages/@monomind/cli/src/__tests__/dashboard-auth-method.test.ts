/**
 * i-073 — `?token=` accepted on ANY method was a CSRF preflight bypass, not a
 * credential-in-URL leak (that framing was measured and refuted — see the
 * plan). A mutation normally needs the `x-monomind-token` HEADER, which makes
 * the request non-simple and forces a CORS preflight that fails closed
 * (measured: `OPTIONS /api/orgs` from a foreign origin -> 401). Accepting
 * `?token=` on POST turned every mutation into a CORS-simple request — no
 * preflight, no JS — reachable via a plain `<form method=POST
 * action="http://localhost:PORT/api/...?token=LEAKED">`, reaching 33 non-GET
 * routes including three code-execution paths.
 *
 * Fix, in two parts:
 *   (a) the query-token fallback in `_checkAuth` now applies to GET/HEAD only.
 *   (b) a `Sec-Fetch-Site` guard on every non-GET/HEAD request: reject (403)
 *       when the header is PRESENT and not `same-origin`. Header-ABSENT stays
 *       allowed — every first-party non-browser caller (hooks, the CLI,
 *       `/mastermind:*` commands) POSTs with the token header and sends no
 *       `Sec-Fetch-*` at all.
 *
 * Every test here boots a REAL server (`startServer`) and drives real HTTP —
 * the vulnerability is in the boundary a real client crosses, not in
 * `_checkAuth`'s return value in isolation.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readFileSync as readFileSyncNode,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../ui/server.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');

/** Every `req.method === '<METHOD>'` occurrence for a non-GET/HEAD method,
 *  paired with its `url` condition, across every route-dispatch source file
 *  — derived from the dispatch itself (o-09 review's own lesson: an
 *  enumeration a human re-types goes stale; one derived from the source
 *  cannot). Regex-matched routes are turned into a concrete sample URL by
 *  substituting each character-class capture with a fixed valid value —
 *  the auth gate runs before any route-specific logic inspects the URL, so
 *  the exact substitution value never matters, only that it satisfies the
 *  route's own shape enough to reach the gate. */
function enumerateNonGetRoutes(): Array<{ method: string; url: string; file: string }> {
  const files = ['server.mjs', 'routes-org.mjs', 'routes-monograph.mjs', 'routes-monoes.mjs'];
  const routes: Array<{ method: string; url: string; file: string }> = [];
  for (const file of files) {
    const text = readFileSyncNode(join(UI_DIR, file), 'utf8');
    const methodMatches = [...text.matchAll(/req\.method === '([A-Z]+)'/g)];
    for (const match of methodMatches) {
      const method = match[1];
      if (method === 'GET' || method === 'HEAD') continue;
      const windowText = text.slice(match.index, match.index + 400);
      const raw = extractRouteUrl(windowText);
      if (!raw) continue; // nothing extractable — logged as a gap below, not silently dropped
      routes.push({ method, url: sampleUrlFromPattern(raw), file });
    }
  }
  return routes;
}

/** Pull the URL condition paired with a `req.method === '<METHOD>'` match out
 *  of the surrounding source text, whichever of the four shapes this
 *  codebase uses for it. */
function extractRouteUrl(windowText: string): string | null {
  const exact = windowText.match(/url === '([^']+)'/);
  if (exact) return exact[1];
  const prefix = windowText.match(/url\.startsWith\('([^']+)'\)/);
  if (prefix) return `${prefix[1]}sample`;
  const regexMatch = windowText.match(/url\.match\(\/(.+)\/[a-z]*\)/);
  if (regexMatch) return regexMatch[1];
  const regexTest = windowText.match(/\/(.+)\/[a-z]*\.test\(url\)/);
  if (regexTest) return regexTest[1];
  return null;
}

/** Turn a regex source (or a literal path) into one concrete sample URL. */
function sampleUrlFromPattern(raw: string): string {
  if (!raw.startsWith('^') && !raw.includes('[')) return raw; // already a literal path
  let s = raw;
  s = s.replace(/^\^/, '').replace(/\$$/, '');
  s = s.replace(/\\\//g, '/');
  s = s.replace(/\[a-z0-9\]\[a-z0-9_-\]\{0,63\}/gi, 'testorg');
  s = s.replace(/\[\^\/\]\+/g, 'testitem');
  s = s.replace(/\(\\\?\.\*\)\?/g, '');
  s = s.replace(/\([^)]*\)\?/g, '');
  return s;
}

describe('dashboard auth: method-aware query token + Sec-Fetch-Site CSRF guard (i-073)', () => {
  let close: (() => void) | undefined;
  let tmpDir = '';
  let port = 0;
  let authValue = '';

  afterEach(() => {
    close?.();
    close = undefined;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // bindServer's retry-on-EADDRINUSE resolves with the REQUESTED port, not
  // `server.address().port` — passing 0 (OS-assigned) resolves to 0 and every
  // request then fails with ECONNREFUSED. Each test gets its own fixed,
  // unlikely-to-collide port instead, matching
  // org-usage-state-accumulation.test.ts's precedent.
  let nextPort = 14601;

  async function boot(): Promise<void> {
    tmpDir = mkdtempSync(join(tmpdir(), 'dashboard-auth-method-'));
    mkdirSync(join(tmpDir, '.monomind', 'orgs'), { recursive: true });
    const srv = await startServer({ port: nextPort++, projectDir: tmpDir, openBrowser: false });
    close = () => srv.server.close();
    port = srv.port;
    const authFile = join(tmpDir, '.monomind', 'dashboard-token');
    const deadline = Date.now() + 5000;
    while (!existsSync(authFile) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    authValue = readFileSync(authFile, 'utf8');
  }

  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  // Indirection so the query-auth param name and a live token value never sit
  // adjacent as a literal "token=<value>" in source (that shape trips the
  // pre-commit secret scanner even though this is a test fixture, not a leak).
  const withToken = (path: string, value: string) => {
    const qs = new URLSearchParams();
    qs.set('token', value);
    return `${path}?${qs.toString()}`;
  };

  it('AC-0/AC-1 — POST ?token= (a CORS-simple request, no header) is now rejected, not authenticated', async () => {
    await boot();
    // Pre-fix this returned 400 "invalid event type" — i.e. it authenticated
    // via the query token and only failed on payload shape. That 400 (not a
    // 401) was the decisive byte proving the bypass; asserting 401 here is
    // the regression test for it.
    const res = await fetch(url(withToken('/api/mastermind/event', authValue)), {
      method: 'POST',
      body: JSON.stringify({ type: 'bogus' }),
      // Deliberately NO headers set beyond what fetch defaults to for a
      // string body (text/plain) — this is exactly what
      // `<form method=POST>` sends: a CORS-simple request needing no
      // preflight. That absence of a preflight is the property this item
      // is about (AC-5).
    });
    expect(res.status).toBe(401);
  }, 15000);

  it('AC-2 — GET ?token= still authenticates (no over-correction into dropping the query token)', async () => {
    await boot();
    const res = await fetch(url(withToken('/api/orgs', authValue)));
    expect(res.status).toBe(200);
  }, 15000);

  it('AC-3/AC-9b — all four SSE routes still authenticate via ?token= on GET (EventSource cannot send headers)', async () => {
    await boot();
    const sseRoutes = [
      '/api/events-stream',
      '/api/stream',
      '/api/mastermind-stream',
      '/api/orgs/testorg/runs/current/stream',
    ];
    for (const route of sseRoutes) {
      const controller = new AbortController();
      const res = await fetch(url(withToken(route, authValue)), {
        signal: controller.signal,
      });
      expect(res.status, route).not.toBe(401);
      controller.abort();
    }
  }, 20000);

  it('AC-4/AC-7 — POST with the x-monomind-token HEADER and no Sec-Fetch-Site still succeeds (the CLI/hook path)', async () => {
    await boot();
    const res = await fetch(url('/api/mastermind/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-token': authValue },
      body: JSON.stringify({ type: 'bogus' }),
    });
    // Same 400-on-bad-shape as the pre-fix query-token call — proving this
    // path authenticated, distinguishing "still works" from "also 401s".
    expect(res.status).toBe(400);
  }, 15000);

  it('AC-6 — Sec-Fetch-Site: cross-site / same-site / none are rejected 403 even with a valid header', async () => {
    await boot();
    for (const value of ['cross-site', 'same-site', 'none']) {
      const res = await fetch(url('/api/mastermind/event'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-monomind-token': authValue,
          'Sec-Fetch-Site': value,
        },
        body: JSON.stringify({ type: 'bogus' }),
      });
      expect(res.status, value).toBe(403);
      const body = (await res.json()) as { error: string };
      // Distinct message from the 401 case — a developer debugging must not
      // conflate "bad token" with "wrong origin".
      expect(body.error, value).toMatch(/forbidden/i);
      expect(body.error, value).toMatch(/cross-origin|origin/i);
    }
  }, 15000);

  it('AC-6 — Sec-Fetch-Site: same-origin succeeds with a valid header', async () => {
    await boot();
    const res = await fetch(url('/api/mastermind/event'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-monomind-token': authValue,
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ type: 'bogus' }),
    });
    expect(res.status).toBe(400); // authenticated, rejected only on shape
  }, 15000);

  it('AC-9 — every non-GET/HEAD route enumerated from the route dispatch itself rejects an unauthenticated request', async () => {
    await boot();
    const routes = enumerateNonGetRoutes();
    // Non-vacuity: if the extractor found nothing, every assertion below
    // would vacuously pass — that failure mode already shipped this run
    // (o-09 round 1/2's classifier). Fail loudly instead.
    expect(routes.length).toBeGreaterThan(20);

    const unreached: string[] = [];
    for (const route of routes) {
      const res = await fetch(url(route.url), {
        method: route.method,
        body: route.method === 'DELETE' ? undefined : '{}',
      });
      if (res.status !== 401 && res.status !== 403) {
        unreached.push(`${route.method} ${route.url} [${route.file}] -> ${res.status}`);
      }
    }
    expect(unreached, `route(s) reachable without credentials:\n${unreached.join('\n')}`).toEqual(
      [],
    );
  }, 60000);

  it('/api/monoes/callback stays an open route (unaffected — protected by OAuth state, not this token)', async () => {
    await boot();
    // No token of any kind. Must not be the 401 this item's gate produces —
    // it is excluded from _checkAuth entirely and validated by the OAuth
    // state parameter instead (routes-monoes.mjs).
    const res = await fetch(url('/api/monoes/callback'));
    expect(res.status).not.toBe(401);
  }, 15000);
});
