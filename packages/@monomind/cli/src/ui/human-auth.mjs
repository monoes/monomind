// Proof that a human is at the browser, for the dashboard.
//
// The dashboard token (<project>/.monomind/dashboard-token) is a machine
// credential: hooks, the CLI and the org forwarder send it. It must not be
// enough to act as the human who supervises an org — approve a tool call,
// resolve a gate, answer a question, message a role, change an org's config —
// because anything running as this user, org roles included, can reach the
// dashboard's port, and the page used to hand the token to any GET /.
//
// Human authority is instead a browser session cookie holding a random id whose
// SHA-256 names a server-side session file in ~/.monomind/dashboard-auth/sessions/
// (bounded TTL, revocable), a directory every org role is masked from
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
// A session lasts 30 days, server-side and in the cookie; `monomind dashboard
// logout` revokes every session at once.
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SESSION_ID_RE = /^[0-9a-f]{64}$/;

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

function sessionsDir(home) {
  return path.join(humanAuthDir(home), 'sessions');
}

function sessionFile(id, home) {
  return path.join(sessionsDir(home), crypto.createHash('sha256').update(id).digest('hex'));
}

/** Create a random server-side session; returns its id (the cookie value). */
function createSession(home) {
  secret(home); // the dir exists, owner-only
  const dir = sessionsDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  sweepSessions(home);
  const id = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(sessionFile(id, home), String(Date.now() + SESSION_MAX_AGE_S * 1000), {
    mode: 0o600,
    flag: 'wx',
  });
  return id;
}

function sweepSessions(home) {
  const dir = sessionsDir(home);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (Number(fs.readFileSync(file, 'utf8')) <= Date.now()) fs.unlinkSync(file);
    } catch {
      /* swept by another process */
    }
  }
}

/** Revoke every dashboard session; returns how many were removed. */
export function revokeAllSessions(home = os.homedir()) {
  const dir = sessionsDir(home);
  let n = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      fs.unlinkSync(path.join(dir, name));
      n++;
    } catch {
      /* already gone */
    }
  }
  return n;
}

/** Revoke the session carried by `req`'s cookie, if any. */
export function revokeSession(req, home = os.homedir()) {
  const id = cookieSessionId(req);
  if (!id) return false;
  try {
    fs.unlinkSync(sessionFile(id, home));
    return true;
  } catch {
    return false;
  }
}

function cookieSessionId(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === HUMAN_COOKIE) {
      const id = v.join('=');
      if (SESSION_ID_RE.test(id)) return id;
    }
  }
  return null;
}

/** A new one-time login nonce (the `?login=` of a login link). */
export function issueLoginNonce(home = os.homedir()) {
  secret(home); // the dir exists, owner-only
  const pending = path.join(humanAuthDir(home), 'login');
  fs.mkdirSync(pending, { recursive: true, mode: 0o700 });
  sweepLoginNonces(pending);
  const nonce = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(pending, nonce), '', { mode: 0o600, flag: 'wx' });
  return nonce;
}

/** Delete nonces past their TTL so unused links don't pile up. A link still inside its TTL is never
 *  touched, so another `ui open` cannot spend a fresh one (the TTL already bounds how many exist). */
function sweepLoginNonces(pending) {
  for (const name of fs.readdirSync(pending)) {
    const file = path.join(pending, name);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > NONCE_TTL_MS) fs.unlinkSync(file);
    } catch {
      /* spent or swept by another process */
    }
  }
}

/** Whether a login nonce has been spent (its file is gone). */
export function loginNonceUsed(nonce, home = os.homedir()) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) return false;
  return !fs.existsSync(path.join(humanAuthDir(home), 'login', nonce));
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

/** Set-Cookie value that marks this browser as the human's (starts a new session). */
export function humanSessionCookie(home = os.homedir()) {
  return `${HUMAN_COOKIE}=${createSession(home)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}`;
}

/** Whether `req` carries a live (unrevoked, unexpired) human session cookie. */
export function isHumanRequest(req, home = os.homedir()) {
  const id = cookieSessionId(req);
  if (!id) return false;
  const file = sessionFile(id, home);
  try {
    if (Number(fs.readFileSync(file, 'utf8')) > Date.now()) return true;
    fs.unlinkSync(file);
  } catch {
    /* unknown or revoked */
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
<p>It opens a one-time login link. This browser then stays logged in for 30 days; run it again after that, after <code>monomind dashboard logout</code>, or if you clear the browser's cookies.</p>
<p style="color:#888;font-size:13px">The dashboard can approve and answer for you, so it only trusts a browser you logged in yourself — not every program that can reach this port.</p></main>`;
}
