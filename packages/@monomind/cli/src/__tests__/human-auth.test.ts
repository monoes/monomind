/**
 * ui/human-auth.mjs — the dashboard's proof that a human is at the browser:
 * one-time, short-lived login nonces and a session cookie derived from a
 * secret in the (role-masked) ~/.monomind/dashboard-auth/.
 */
import { mkdtempSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  consumeLoginNonce,
  humanAuthDir,
  humanSessionCookie,
  isHumanRequest,
  issueLoginNonce,
} from '../ui/human-auth.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'human-auth-'));

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
});
