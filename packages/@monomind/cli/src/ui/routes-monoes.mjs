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
import {
  buildMonoesMcpEntry,
  detectMonoesTokenLeak,
  formatMonoesLeakWarning,
} from '../mcp/monoes-mcp-entry.mjs';

const MONOES_BASE_URL = process.env.MONOMIND_MONOES_URL || 'https://monoes.me';
const MONOES_SCOPE = 'community:read community:write offline_access';

// state -> { codeVerifier, createdAt } — short-lived, in-memory only. The
// user completes the browser redirect within a few minutes of clicking
// "Connect"; losing this on a dashboard restart just means the in-flight
// connect attempt has to be retried, not a security issue.
const _pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

// i-066 reviewer finding 4: detectMonoesTokenLeak() shells out to git;
// throttle it to at most once per this interval per process instead of
// once per dashboard status poll (the leak condition changes on the order
// of "never", not per poll — see the /api/monoes/status handler below).
let _lastLeakCheckAt = 0;
const _leakCheckIntervalMs = 60_000;

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
      // The dashboard's redirect_uri is http://127.0.0.1:<port>/... — the
      // OAuth server only allows plain-http loopback redirects for native
      // clients (RFC 8252 §7.3); "web" (the DCR default) requires https.
      application_type: 'native',
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

/** Merges (or removes) the `monoes` entry in the project's existing
 * .mcp.json. Only touches that one key — never creates or rewrites the
 * rest of the file, since .mcp.json is otherwise owned by `init`/the user.
 * No-ops if .mcp.json doesn't exist yet (nothing to merge into).
 * `hasConnection` is a boolean, not a token — the entry is a local stdio
 * proxy (mcp/monoes-proxy.ts) that resolves the Authorization header itself
 * at request time, so there is no token to embed here at all. */
function _syncMonoesMcpEntry(projectDir, hasConnection) {
  const mcpPath = path.join(projectDir, '.mcp.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  } catch {
    return;
  }
  config.mcpServers = config.mcpServers || {};
  if (hasConnection) {
    config.mcpServers.monoes = buildMonoesMcpEntry();
  } else {
    delete config.mcpServers.monoes;
  }
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2));
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
  const { MONOMIND_HOME, dashboardPort, projectDir } = ctx;
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
      closeTab(
        'Connection failed — the request was invalid or expired. You can close this tab and try again.',
      );
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
      _syncMonoesMcpEntry(path.resolve(projectDir || process.cwd()), !!tokenData.access_token);

      closeTab('Connected to monoes.me — you can close this tab.');
    } catch (err) {
      closeTab(`Connection failed: ${err.message}. You can close this tab and try again.`);
    }
    return true;
  }

  // ---------------------------------------------------- GET /api/monoes/status
  // Polled on every dashboard load — piggybacks the silent-refresh check so
  // .mcp.json's entry self-heals (added/removed/migrated) roughly as often
  // as the dashboard is opened, instead of only on the explicit
  // connect/disconnect actions. Since the entry no longer embeds a token
  // (it's a stdio proxy that resolves the header itself — see
  // mcp/monoes-mcp-entry.mjs), a refresh that only changes the *value* of
  // the token no longer requires a re-sync; only a change in *whether*
  // .mcp.json's actual current entry matches the actual current connection
  // state does (checked directly against the file, so this self-heals even
  // if .mcp.json drifted from the connection for some other reason — a hand
  // edit, a stale/missing file, etc). Reviewer i-066 finding 2: "matches"
  // must be shape-aware, not presence-aware — a pre-fix entry that still
  // carries a literal `headers`/`type: 'http'` bearer shape counts as
  // needing a re-sync too, or a connected user whose .mcp.json already
  // leaked the token is warned forever but never migrated.
  if (req.method === 'GET' && url === '/api/monoes/status') {
    const beforeConn = readMonoesConnection(MONOMIND_HOME);
    const validToken = /* value */ beforeConn?.accessToken
      ? await getValidMonoesToken(MONOMIND_HOME)
      : null;
    const afterConn = readMonoesConnection(MONOMIND_HOME);
    const isConnected = !!validToken;

    const resolvedProjectDir = path.resolve(projectDir || process.cwd());
    let entry;
    try {
      const currentMcp = JSON.parse(
        fs.readFileSync(path.join(resolvedProjectDir, '.mcp.json'), 'utf8'),
      );
      entry = currentMcp?.mcpServers?.monoes;
    } catch {
      entry = undefined; // No .mcp.json, or unreadable — nothing to sync into; _syncMonoesMcpEntry no-ops too.
    }
    const hasEntry = !!entry;
    // i-066 reviewer finding 8 [BLOCKER]: `'headers' in entry` throws a
    // TypeError when entry isn't an object — a realistic shape for a file
    // designed to be committed and merged (a typo, a hand edit, a bad merge
    // resolution can leave mcpServers.monoes as a string/number/boolean/
    // array). That throw would escape this handler uncaught, and
    // ui/server.mjs's http.createServer callback has no enclosing
    // try/catch, so it would kill the whole dashboard process. Guard with
    // an explicit object check first — a non-object (or array) value is
    // simply non-conforming, so it self-heals via the normal re-sync path
    // instead of crashing.
    const isObjectEntry = typeof entry === 'object' && entry !== null && !Array.isArray(entry);
    const isConformingEntry = isObjectEntry && !('headers' in entry) && entry.type !== 'http';
    if (isConnected !== hasEntry || (hasEntry && !isConformingEntry)) {
      _syncMonoesMcpEntry(resolvedProjectDir, isConnected);
    }

    // i-066 §3.5: if this project already leaked the token (a legacy literal
    // bearer entry still in .mcp.json, or monoes-connection.json tracked by
    // git), warn loudly on every status poll rather than migrating silently.
    // Reviewer i-066 finding 4: detectMonoesTokenLeak() shells out to git —
    // throttle to at most once per _leakCheckIntervalMs per process rather
    // than spawning a subprocess on every single-threaded-server poll; the
    // condition it detects changes on the order of "never", not per poll.
    const now = Date.now();
    if (now - _lastLeakCheckAt > _leakCheckIntervalMs) {
      _lastLeakCheckAt = now;
      const leakWarning = formatMonoesLeakWarning(await detectMonoesTokenLeak(resolvedProjectDir));
      if (leakWarning) console.error(leakWarning);
    }

    _json(res, corsOrigin, 200, {
      connected: isConnected,
      username: isConnected ? afterConn?.connectedUsername || null : null,
    });
    return true;
  }

  // ------------------------------------------------ POST /api/monoes/disconnect
  if (req.method === 'POST' && url === '/api/monoes/disconnect') {
    _deleteMonoesConnection(MONOMIND_HOME);
    _syncMonoesMcpEntry(path.resolve(projectDir || process.cwd()), false);
    _json(res, corsOrigin, 200, { connected: false });
    return true;
  }

  // ----------------------------------------------- POST /api/monoes/upload-org
  // Reads the org's existing on-disk definition (the same
  // .monomind/orgs/<name>.json file GET /api/orgs/:name already serves —
  // no new read path) and forwards it to monoes.me's real upload endpoint.
  if (req.method === 'POST' && url === '/api/monoes/upload-org') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { orgName, dir } = JSON.parse(body || '{}');
        if (!orgName || orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
          _json(res, corsOrigin, 400, { error: 'Invalid org name' });
          return;
        }

        const token = await getValidMonoesToken(MONOMIND_HOME);
        if (!token) {
          _json(res, corsOrigin, 401, { error: 'not_connected' });
          return;
        }

        const root = path.resolve(dir || ctx.projectDir || process.cwd());
        const projDir = ctx._resolveOrgProjectDir(orgName, root) || root;
        const orgFile = path.join(projDir, '.monomind', 'orgs', `${orgName}.json`);
        if (!fs.existsSync(orgFile)) {
          _json(res, corsOrigin, 404, { error: 'Org not found' });
          return;
        }
        const orgJson = fs.readFileSync(orgFile, 'utf8');

        const uploadRes = await fetch(`${MONOES_BASE_URL}/api/community/orgs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orgJson }),
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          _json(res, corsOrigin, uploadRes.status, uploadBody);
          return;
        }
        _json(res, corsOrigin, 201, {
          ...uploadBody,
          url: `${MONOES_BASE_URL}/community/orgs/${uploadBody.id}`,
        });
      } catch (err) {
        _json(res, corsOrigin, 500, { error: err.message });
      }
    });
    return true;
  }

  return false;
}
