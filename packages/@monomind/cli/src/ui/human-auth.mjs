// Proof that a human is at the browser, for the dashboard.
//
// The dashboard token (<project>/.monomind/dashboard-token) is a machine
// credential: hooks, the CLI and the org forwarder send it. It must not be
// enough to act as the human who supervises an org — approve a tool call,
// resolve a gate, answer a question, message a role, change an org's config —
// because anything running as this user, org roles included, can reach the
// dashboard's port, and the page used to hand the token to any GET /.
//
// Human authority is instead a browser session cookie derived from a secret
// in ~/.monomind/dashboard-auth/, a directory every org role is masked from
// (orgrt/authority-mask.ts). A browser gets the cookie by opening a one-time
// login link — `monomind dashboard open`, or the tab the dashboard opens when
// it starts — whose nonce is a file in that same directory, used once and
// short-lived, so a copy left in browser history is worthless.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HUMAN_COOKIE = 'mm_human';
const NONCE_TTL_MS = 10 * 60_000;
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export function humanAuthDir(home = os.homedir()) {
  return path.join(home, '.monomind', 'dashboard-auth');
}

/** The per-user secret, created owner-only on first use. */
function secret(home) {
  const dir = humanAuthDir(home);
  const file = path.join(dir, 'secret');
  try {
    return fs.readFileSync(file);
  } catch {
    /* create below */
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err; // another process created it first
  }
  return fs.readFileSync(file);
}

function sessionValue(home) {
  return crypto.createHmac('sha256', secret(home)).update('dashboard-session-v1').digest('hex');
}

/** A new one-time login nonce (the `?login=` of a login link). */
export function issueLoginNonce(home = os.homedir()) {
  secret(home); // the dir exists, owner-only
  const pending = path.join(humanAuthDir(home), 'login');
  fs.mkdirSync(pending, { recursive: true, mode: 0o700 });
  const nonce = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(pending, nonce), '', { mode: 0o600, flag: 'wx' });
  return nonce;
}

/** Spend a login nonce: true once, for a nonce issued in the last 10 minutes. */
export function consumeLoginNonce(nonce, home = os.homedir()) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) return false;
  const file = path.join(humanAuthDir(home), 'login', nonce);
  let st;
  try {
    st = fs.statSync(file);
    fs.unlinkSync(file); // used once, whatever the outcome below
  } catch {
    return false;
  }
  return Date.now() - st.mtimeMs <= NONCE_TTL_MS;
}

/** Set-Cookie value that marks this browser as the human's. */
export function humanSessionCookie(home = os.homedir()) {
  return `${HUMAN_COOKIE}=${sessionValue(home)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}`;
}

/** Whether `req` carries the human session cookie. */
export function isHumanRequest(req, home = os.homedir()) {
  const header = req.headers?.cookie;
  if (!header) return false;
  const want = Buffer.from(sessionValue(home));
  for (const part of String(header).split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== HUMAN_COOKIE) continue;
    const got = Buffer.from(v.join('='));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return true;
  }
  return false;
}

/** Page for a browser without the session: how to get a login link. */
export function loginRequiredPage() {
  return `<!doctype html><meta charset="utf-8"><title>monomind dashboard</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#0b0b0c;color:#ddd;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:34rem;padding:2rem}code{background:#222;padding:.15em .4em;border-radius:4px}</style>
<main><h1 style="font-size:1.2rem">Open the dashboard from your terminal</h1>
<p>This browser has no dashboard session. Run</p><p><code>monomind dashboard open</code></p>
<p>It opens a one-time login link. The session then lasts 30 days in this browser.</p>
<p style="color:#888;font-size:13px">The dashboard can approve and answer for you, so it only trusts a browser you logged in yourself — not every program that can reach this port.</p></main>`;
}
