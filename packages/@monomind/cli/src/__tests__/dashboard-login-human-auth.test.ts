/** Login-nonce sweep, the long-lived session cookie and loginNonceUsed (ui/human-auth.mjs). */
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  consumeLoginNonce,
  humanAuthDir,
  humanSessionCookie,
  issueLoginNonce,
  loginNonceUsed,
  loginRequiredPage,
  SESSION_MAX_AGE_S,
} from '../ui/human-auth.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'dash-login-'));
const pendingDir = (h: string) => join(humanAuthDir(h), 'login');

describe('dashboard login', () => {
  it('sweeps expired nonces when issuing a new one', () => {
    const h = home();
    const old = issueLoginNonce(h);
    const past = new Date(Date.now() - 11 * 60_000);
    utimesSync(join(pendingDir(h), old), past, past);
    const fresh = issueLoginNonce(h);
    expect(readdirSync(pendingDir(h))).toEqual([fresh]);
  });

  it('never deletes a link that is still inside its TTL, however many are pending', () => {
    const h = home();
    const fresh: string[] = [];
    mkdirSync(pendingDir(h), { recursive: true });
    for (let i = 0; i < 60; i++) {
      const name = i.toString(16).padStart(64, '0');
      writeFileSync(join(pendingDir(h), name), '');
      const t = new Date(Date.now() - 5 * 60_000 + i * 1000);
      utimesSync(join(pendingDir(h), name), t, t);
      fresh.push(name);
    }
    const last = issueLoginNonce(h);
    const left = readdirSync(pendingDir(h));
    expect(left).toHaveLength(61);
    expect(left).toContain(last);
    for (const name of fresh) expect(left).toContain(name);
  });

  it('reports a nonce as used once it is consumed', () => {
    const h = home();
    const n = issueLoginNonce(h);
    expect(loginNonceUsed(n, h)).toBe(false);
    consumeLoginNonce(n, h);
    expect(loginNonceUsed(n, h)).toBe(true);
  });

  it('sets a 400-day cookie and no longer says 30 days', () => {
    expect(SESSION_MAX_AGE_S).toBe(34560000);
    expect(humanSessionCookie(home())).toContain('Max-Age=34560000');
    expect(loginRequiredPage()).not.toContain('30 days');
    expect(loginRequiredPage()).toContain('stays logged in');
  });
});
