/**
 * ui/human-auth.mjs — the dashboard's proof that a human is at the browser:
 * one-time, short-lived login nonces and a session cookie derived from a
 * secret in the (role-masked) ~/.monomind/dashboard-auth/.
 */
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  consumeLoginNonce,
  humanAuthDir,
  humanSessionCookie,
  isHumanRequest,
  issueLoginNonce,
  revokeAllSessions,
  revokeSession,
} from '../ui/human-auth.mjs';

const made: string[] = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), 'human-auth-'));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('human-auth', () => {
  it('keeps its secret and nonces owner-only', () => {
    const h = home();
    issueLoginNonce(h);
    expect(statSync(humanAuthDir(h)).mode & 0o777).toBe(0o700);
    expect(statSync(join(humanAuthDir(h), 'secret')).mode & 0o777).toBe(0o600);
  });

  it('accepts a login nonce once, and not after ten minutes', () => {
    const h = home();
    const n = issueLoginNonce(h);
    expect(consumeLoginNonce(n, h)).toBe(true);
    expect(consumeLoginNonce(n, h)).toBe(false);
    const old = issueLoginNonce(h);
    const past = new Date(Date.now() - 11 * 60_000);
    utimesSync(join(humanAuthDir(h), 'login', old), past, past);
    expect(consumeLoginNonce(old, h)).toBe(false);
    expect(consumeLoginNonce('../secret', h)).toBe(false);
  });

  it('recognises only the cookie derived from this home’s secret', () => {
    const h = home();
    const cookie = humanSessionCookie(h).split(';')[0];
    expect(isHumanRequest({ headers: { cookie: `a=b; ${cookie}` } }, h)).toBe(true);
    expect(
      isHumanRequest({ headers: { cookie: humanSessionCookie(home()).split(';')[0] } }, h),
    ).toBe(false);
    expect(isHumanRequest({ headers: {} }, h)).toBe(false);
  });

  it('issues a fresh random session per login, not a constant cookie', () => {
    const h = home();
    expect(humanSessionCookie(h).split(';')[0]).not.toBe(humanSessionCookie(h).split(';')[0]);
  });

  it('rejects an expired session', () => {
    const h = home();
    const cookie = humanSessionCookie(h).split(';')[0];
    const dir = join(humanAuthDir(h), 'sessions');
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), String(Date.now() - 1));
    expect(isHumanRequest({ headers: { cookie } }, h)).toBe(false);
  });

  it('revokes one session or all sessions', () => {
    const h = home();
    const a = { headers: { cookie: humanSessionCookie(h).split(';')[0] } };
    const b = { headers: { cookie: humanSessionCookie(h).split(';')[0] } };
    expect(revokeSession(a, h)).toBe(true);
    expect(isHumanRequest(a, h)).toBe(false);
    expect(isHumanRequest(b, h)).toBe(true);
    expect(revokeAllSessions(h)).toBe(1);
    expect(isHumanRequest(b, h)).toBe(false);
  });
});
