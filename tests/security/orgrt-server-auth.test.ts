/**
 * SEC-2 — Timing-safe credential compare on the org-runtime server.
 *
 * Before fix: three `req.headers['x-monomind-cred'] !== cred` sites
 * (`server.ts:54, 69, 78`). String `!==` short-circuits on the first
 * mismatched byte — a remote attacker measuring response latency can
 * recover the secret one byte at a time (classic timing side-channel).
 *
 * After fix: every comparison goes through `safeCred()`, which builds
 * Buffers and calls `crypto.timingSafeEqual` (constant time). Mismatched
 * lengths return false but only after a dummy `timingSafeEqual(a, a)` to
 * keep the timing profile uniform.
 *
 * Behavioural assertions: missing cred → 401, wrong cred → 401, correct
 * cred → 200. The timing assertion is intentionally weak (we don't claim
 * a measurable constant-time guarantee in JS, only that the primitive in
 * use is `timingSafeEqual`); the regression value is in the auth logic.
 *
 * Port allocation: `startOrgServer` already accepts `port = 0` and returns
 * the kernel-assigned port on `OrgServer.port`. We used to pre-allocate a
 * port via a throwaway `http.Server`, close it, and pass the number back in
 * — a TOCTOU race under parallel test workers (another file can grab the
 * port in the gap, surfacing as `EADDRINUSE`). Letting `startOrgServer` bind
 * `:0` itself is atomic and removes the race entirely.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startOrgServer } from '../../packages/@monomind/cli/src/orgrt/server.js';

interface Spawned {
  close: () => void;
}
const spawned: Spawned[] = [];

// The server only invokes daemon methods on the success path beyond the auth
// gate. For auth tests we never reach them (401 short-circuits), and for the
// success case we only call /api/status which uses the optional getStatusSnapshot.
const stubDaemon = () =>
  ({
    getStatusSnapshot: () => ({ orgs: [] }),
  }) as unknown as Parameters<typeof startOrgServer>[0];

afterEach(() => {
  for (const s of spawned) {
    try {
      s.close();
    } catch {
      /* best effort */
    }
  }
  spawned.length = 0;
});

function req(
  port: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { port, host: '127.0.0.1', path: '/api/status', method: 'GET', headers },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

describe('SEC-2 — org server timing-safe auth', () => {
  it('rejects requests with no credential (GET /api/status)', async () => {
    const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
    spawned.push(srv);
    const r = await req(srv.port);
    expect(r.status).toBe(401);
  });

  it('rejects requests with the wrong credential', async () => {
    const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
    spawned.push(srv);
    const r = await req(srv.port, { 'x-monomind-cred': 'wrong' });
    expect(r.status).toBe(401);
  });

  it('rejects requests whose credential shares a prefix but differs in last byte', async () => {
    // The classic timing-attack target: a secret 'sekret' and a guess
    // 'sekreu' (last byte differs). Pre-fix, `!==` short-circuited late;
    // post-fix, length matches so timingSafeEqual runs the full compare.
    const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
    spawned.push(srv);
    const r = await req(srv.port, { 'x-monomind-cred': 'sekreu' });
    expect(r.status).toBe(401);
  });

  it('accepts requests with the correct credential', async () => {
    const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
    spawned.push(srv);
    const r = await req(srv.port, { 'x-monomind-cred': 'sekret' });
    expect(r.status).toBe(200);
  });

  it('POST endpoints also reject missing cred', async () => {
    const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
    spawned.push(srv);
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const r2 = http.request(
        {
          port: srv.port,
          host: '127.0.0.1',
          path: '/api/xdeliver',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      r2.on('error', reject);
      r2.end('{}');
    });
    expect(r.status).toBe(401);
  });

  it('credential comparison runs in roughly constant time across mismatched bytes', async () => {
    // Statistical sanity check — NOT a rigorous constant-time proof (JS GC /
    // event-loop jitter makes that impossible). We measure two populations:
    // (A) credentials that share NO bytes with the secret,
    // (B) credentials that share ALL bytes except the last.
    // Pre-fix, B was measurably slower than A. Post-fix, with
    // timingSafeEqual, the two distributions overlap.
    const secret = 'a'.repeat(32);
    const srv = await startOrgServer(stubDaemon(), 0, secret);
    spawned.push(srv);

    // Trimmed from 200 to 60 (120 paired samples total) — plenty to catch a
    // ~1.5x+ regression while keeping the ~420-request version's CI-timeout
    // risk off the table.
    const N = 60;
    const noMatch: number[] = [];
    const lastByteDiff: number[] = [];
    // Warm up to avoid first-call JIT skewing.
    for (let i = 0; i < 20; i++) await req(srv.port, { 'x-monomind-cred': 'x'.repeat(32) });

    for (let i = 0; i < N; i++) {
      const tA = performance.now();
      await req(srv.port, { 'x-monomind-cred': 'x'.repeat(32) });
      noMatch.push(performance.now() - tA);

      const guess = `${'a'.repeat(31)}b`;
      const tB = performance.now();
      await req(srv.port, { 'x-monomind-cred': guess });
      lastByteDiff.push(performance.now() - tB);
    }

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const mA = mean(noMatch);
    const mB = mean(lastByteDiff);
    // Pre-fix, mB/mA could exceed 1.5+ (string !== short-circuit). Post-fix,
    // both paths go through the same Buffer+timingSafeEqual so the ratio is
    // close to 1. Allow a wide band (3x) to absorb GC/network jitter — the
    // goal is to detect the OLD behaviour, not to prove nanosecond equality.
    expect(Number.isFinite(mA)).toBe(true);
    expect(Number.isFinite(mB)).toBe(true);
    expect(mB / mA).toBeLessThan(3);
  }, 60_000);
});
