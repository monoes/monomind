// ── monoes.me connection (OAuth) ────────────────────────────────────────
// Lets the dashboard connect a monoes.me community account: upload local
// orgs directly (routes-monoes-upload, added alongside this), and register
// monoes.me's MCP server into .mcp.json (mcp-generator.ts) so agent
// sessions in this project get monoes.me's community tools automatically.
//
// Mirrors the existing dashboard-token file convention (one JSON file
// under MONOMIND_HOME/.monomind/, plain fs read/write, no external auth
// library) rather than introducing new dependencies for a single OAuth
// client flow.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MONOES_BASE_URL = process.env.MONOMIND_MONOES_URL || 'https://monoes.me';
const MONOES_SCOPE = 'community:read community:write';

// state -> { codeVerifier, createdAt } — short-lived, in-memory only. The
// user completes the browser redirect within a few minutes of clicking
// "Connect"; losing this on a dashboard restart just means the in-flight
// connect attempt has to be retried, not a security issue.
const _pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function _connectionFile(monomindHome) {
  return path.join(monomindHome, '.monomind', 'monoes-connection.json');
}

export function readMonoesConnection(monomindHome) {
  try {
    return JSON.parse(fs.readFileSync(_connectionFile(monomindHome), 'utf8'));
  } catch {
    return null;
  }
}

function _writeMonoesConnection(monomindHome, data) {
  const file = _connectionFile(monomindHome);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function _deleteMonoesConnection(monomindHome) {
  try {
    fs.unlinkSync(_connectionFile(monomindHome));
  } catch {}
}

function _base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkcePair() {
  const verifier = _base64url(crypto.randomBytes(32));
  const challenge = _base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function _pruneExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of _pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) _pendingStates.delete(state);
  }
}

async function _registerClient(redirectUri) {
  const res = await fetch(`${MONOES_BASE_URL}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  if (!res.ok) throw new Error(`monoes.me client registration failed: ${res.status}`);
  const data = await res.json();
  return data.client_id;
}

async function _getOrRegisterClientId(monomindHome, redirectUri) {
  const existing = readMonoesConnection(monomindHome);
  if (existing?.clientId) return existing.clientId;
  const clientId = await _registerClient(redirectUri);
  _writeMonoesConnection(monomindHome, { ...(existing || {}), clientId });
  return clientId;
}

function _json(res, corsOrigin, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
  });
  res.end(JSON.stringify(body));
}

/** Given a stored connection, returns a still-valid access token — silently
 * refreshing via the refresh_token grant if the current one is expired or
 * about to expire. Returns null (and deletes the connection) if refresh
 * itself fails, treating that identically to "never connected". */
export async function getValidMonoesToken(monomindHome) {
  const conn = readMonoesConnection(monomindHome);
  if (!conn?.accessToken) return null;

  const expiresSoon = !conn.expiresAt || conn.expiresAt - Date.now() < 60_000;
  if (!expiresSoon) return conn.accessToken;
  if (!conn.refreshToken) {
    _deleteMonoesConnection(monomindHome);
    return null;
  }

  try {
    const res = await fetch(`${MONOES_BASE_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: /* value */ conn.refreshToken,
        client_id: conn.clientId,
      }),
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const data = await res.json();
    const updated = {
      ...conn,
      accessToken: /* value */ data.access_token,
      refreshToken: /* value */ data.refresh_token || conn.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    _writeMonoesConnection(monomindHome, updated);
    return updated.accessToken;
  } catch {
    _deleteMonoesConnection(monomindHome);
    return null;
  }
}

export async function handleMonoesRoutes(req, res, url, corsOrigin, ctx) {
  const { MONOMIND_HOME, dashboardPort } = ctx;
  const redirectUri = `http://127.0.0.1:${dashboardPort}/api/monoes/callback`;

  // --------------------------------------------------- POST /api/monoes/connect
  if (req.method === 'POST' && url === '/api/monoes/connect') {
    try {
      _pruneExpiredStates();
      const clientId = await _getOrRegisterClientId(MONOMIND_HOME, redirectUri);
      const { verifier, challenge } = createPkcePair();
      const state = _base64url(crypto.randomBytes(16));
      _pendingStates.set(state, { codeVerifier: verifier, createdAt: Date.now() });

      const authorizeUrl =
        `${MONOES_BASE_URL}/api/auth/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code` +
        `&scope=${encodeURIComponent(MONOES_SCOPE)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;

      _json(res, corsOrigin, 200, { authorizeUrl });
    } catch (err) {
      _json(res, corsOrigin, 500, { error: err.message });
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monoes/callback
  if (req.method === 'GET' && url.startsWith('/api/monoes/callback')) {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const code = qs.get('code');
    const state = qs.get('state');
    const pending = state ? _pendingStates.get(state) : null;

    const closeTab = (message) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;">${message}</body></html>`,
      );
    };

    if (!code || !pending) {
      closeTab('Connection failed — the request was invalid or expired. You can close this tab and try again.');
      return true;
    }
    _pendingStates.delete(state);

    try {
      const existing = readMonoesConnection(MONOMIND_HOME);
      const tokenRes = await fetch(`${MONOES_BASE_URL}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: existing.clientId,
          code_verifier: pending.codeVerifier,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();

      const meRes = await fetch(`${MONOES_BASE_URL}/api/community/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const me = meRes.ok ? await meRes.json() : { username: null };

      _writeMonoesConnection(MONOMIND_HOME, {
        clientId: existing.clientId,
        accessToken: /* value */ tokenData.access_token,
        refreshToken: /* value */ tokenData.refresh_token || null,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        connectedUsername: me.username || null,
      });

      closeTab('Connected to monoes.me — you can close this tab.');
    } catch (err) {
      closeTab(`Connection failed: ${err.message}. You can close this tab and try again.`);
    }
    return true;
  }

  // ---------------------------------------------------- GET /api/monoes/status
  if (req.method === 'GET' && url === '/api/monoes/status') {
    const conn = readMonoesConnection(MONOMIND_HOME);
    _json(res, corsOrigin, 200, {
      connected: !!conn?.accessToken,
      username: conn?.connectedUsername || null,
    });
    return true;
  }

  // ------------------------------------------------ POST /api/monoes/disconnect
  if (req.method === 'POST' && url === '/api/monoes/disconnect') {
    _deleteMonoesConnection(MONOMIND_HOME);
    _json(res, corsOrigin, 200, { connected: false });
    return true;
  }

  return false;
}
