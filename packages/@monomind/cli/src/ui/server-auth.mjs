import crypto from 'node:crypto';

// Page-bootstrap and static-asset routes that stay open — everything else
// (all of /api/*, GET or not) requires _checkAuth. These serve the HTML/JS
// that embeds the token in a <meta name="mm-token"> tag on page load, so
// they must be reachable before any fetch() call could attach the token.
const _OPEN_ROUTES = new Set([
  '/',
  '/v2',
  '/mastermind',
  '/orgs',
  '/orgs-files.js',
  '/markdown.js',
  '/favicon.ico',
  '/api/identity',
]);
// Pages that embed the token: served only to a browser with the human session.
const _HUMAN_PAGES = new Set(['/', '/v2', '/orgs', '/mastermind']);
// Mutations that act as the human supervising an org (org-hil.mjs,
// org-runtime.mjs's config patch) or that write or destroy an org definition
// or end a run: the token alone, which any local process can read, is not
// enough. The dashboard pages send the human cookie with these.
const _HUMAN_ROUTES = [
  /^\/api\/questions\/answer$/,
  /^\/api\/questions\/dismiss$/,
  /^\/api\/org\/[^/]+\/approvals\/[^/]+$/,
  /^\/api\/org\/[^/]+\/gates\/[^/]+$/,
  /^\/api\/org\/[^/]+\/config$/,
  /^\/api\/orgs\/[^/]+\/chat$/,
  /^\/api\/orgs$/,
  /^\/api\/orgs\/[^/]+$/,
  /^\/api\/orgs\/[^/]+\/(import|copy)$/,
  /^\/api\/org\/[^/]+\/agent\/[^/]+\/(avatar|config)$/,
];
const _isHumanRoute = (url) => _HUMAN_ROUTES.some((re) => re.test(url));
const _isOpenRoute = (url, method) =>
  (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') &&
  (_OPEN_ROUTES.has(url) ||
    /^\/data\/avatars\/[A-Za-z0-9._-]+\.svg$/.test(url) ||
    // The browser hits this directly via monoes.me's OAuth redirect — it
    // never has this dashboard's own auth token to attach. Protected
    // instead by the OAuth `state` parameter (routes-monoes.mjs rejects
    // any code/state pair it didn't itself generate).
    url.startsWith('/api/monoes/callback'));

// Factory: _checkAuth/_sendUnauthorized close over dashboardAuthValue
// (per-server-start state), threaded in explicitly now that this lives
// outside startServer's closure.
function createAuthGate({ dashboardAuthValue }) {
  const _checkAuth = (req) => {
    let _suppliedAuth = req.headers['x-monomind-token'] || '';
    // i-073: the query-token fallback is for EventSource (which cannot send
    // headers) and other subresource GETs ONLY. It used to apply
    // unconditionally, which meant a mutation needed only the header OR the
    // query param — and the header is what forces a CORS preflight (a
    // mutation becomes a "simple request" without it). A plain
    // `<form method=POST action="...?token=LEAKED">` has no header to omit,
    // so accepting the query param on POST turned every mutation into a
    // CSRF target reachable with no preflight and no JS. Restoring the
    // unconditional fallback here reopens that hole — see i-073.
    if (!_suppliedAuth && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        _suppliedAuth = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
      } catch (_) {}
    }
    const _suppliedAuthBuf = Buffer.from(String(_suppliedAuth));
    const _expectedAuthBuf = Buffer.from(dashboardAuthValue);
    return (
      _suppliedAuthBuf.length === _expectedAuthBuf.length &&
      crypto.timingSafeEqual(_suppliedAuthBuf, _expectedAuthBuf)
    );
  };
  const _sendUnauthorized = (res, corsOrigin) => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid auth token' }));
  };
  return { checkAuth: _checkAuth, sendUnauthorized: _sendUnauthorized };
}

export { _HUMAN_PAGES, _isHumanRoute, _isOpenRoute, createAuthGate };
