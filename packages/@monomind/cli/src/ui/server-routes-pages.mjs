import fs from 'node:fs';
import path from 'node:path';
import {
  consumeLoginNonce,
  humanSessionCookie,
  isHumanRequest,
  loginRequiredPage,
} from './human-auth.mjs';
import { _HUMAN_PAGES, _isHumanRoute } from './server-auth.mjs';

// Page-bootstrap, static-asset and human-session-gate routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
/** Port of the browse (monobrowse) dashboard the playbook builder talks to.
 *  Nothing persists the port a running browse server chose (it takes `--port`,
 *  default 4243), so MONOMIND_BROWSE_DASHBOARD_PORT is the override. */
export function resolveBrowsePort(env = process.env) {
  const n = Number(env.MONOMIND_BROWSE_DASHBOARD_PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 4243;
}

export async function handleRoutesPages(req, res, url, corsOrigin, ctx) {
  const { __dirname, dashboardAuthValue, tokenState, projectDir } = ctx;
  // ------------------------------------------------ GET /api/identity
  // Which process serves this port and where its token file is — never the
  // token itself. control-start.cjs pairs another project with a server it
  // finds already listening, by reading that file as the same user.
  if (req.method === 'GET' && url === '/api/identity') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        pid: process.pid,
        dir: projectDir || process.cwd(),
        tokenFile: tokenState.path,
      }),
    );
    return true;
  }

  // ── Human session (human-auth.mjs) ─────────────────────────────────────
  // The pages embed the dashboard token, and the decision routes act as the
  // human who supervises an org — both need the browser session cookie, not
  // just the token any local process can obtain. A one-time `?login=` link
  // sets that cookie.
  if (req.method === 'GET' && _HUMAN_PAGES.has(url)) {
    const _login = new URL(req.url, 'http://localhost').searchParams.get('login');
    if (_login && consumeLoginNonce(_login)) {
      res.writeHead(302, {
        Location: url,
        'Set-Cookie': humanSessionCookie(),
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    if (!isHumanRequest(req)) {
      res.writeHead(401, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(loginRequiredPage());
      return true;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && _isHumanRoute(url) && !isHumanRequest(req)) {
    res.writeHead(403, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(
      JSON.stringify({
        ok: false,
        error:
          'this acts as the human supervising the org — open the dashboard with `monomind dashboard open` and do it from that browser',
      }),
    );
    return true;
  }

  // ------------------------------------------------------------------ GET /
  if (req.method === 'GET' && url === '/') {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    try {
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Inject this process's auth credential so the page's own fetch() calls can
      // attach it (see the fetch-wrapper near the top of dashboard.html's <script>
      // block) — every non-GET route above requires it, but the served HTML was
      // previously never given a way to know it, so every write action 401'd from
      // the actual browser UI.
      html = html.replace(
        '<head>',
        `<head>\n<meta name="mm-token" content="${dashboardAuthValue}">\n<meta name="mm-browse-port" content="${resolveBrowsePort()}">`,
      );
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed to load dashboard.html: ${err.message}`);
    }
    return true;
  }

  // ------------------------------------------------ GET /markdown.js
  // Markdown renderer, split out of dashboard.html (#124) — same pattern
  // as GET /orgs-files.js in routes-org-mastermind.mjs (a sibling asset served via
  // its own hardcoded route, not a generic static-file handler). Must be
  // in _OPEN_ROUTES above: dashboard.html's own <script src="markdown.js">
  // request happens before the page has the auth token to attach.
  if (req.method === 'GET' && url === '/markdown.js') {
    try {
      const jsPath = path.join(__dirname, 'markdown.js');
      const js = fs.readFileSync(jsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
    } catch (err) {
      res.writeHead(404);
      res.end(`markdown.js not found: ${err.message}`);
    }
    return true;
  }

  // ------------------------------------------------- GET /data/avatars/*.svg (agent avatars)
  if (req.method === 'GET' && /^\/data\/avatars\/[A-Za-z0-9._-]+\.svg$/.test(url)) {
    try {
      const name = path.basename(decodeURIComponent(url));
      if (!/^[A-Za-z0-9._-]+\.svg$/.test(name) || name.includes('..')) {
        res.writeHead(400);
        res.end();
        return true;
      }
      const avatarsDir = path.join(__dirname, 'data', 'avatars');
      const filePath = path.join(avatarsDir, name);
      if (!filePath.startsWith(avatarsDir + path.sep) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return true;
      }
      const svg = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(svg);
    } catch (_) {
      res.writeHead(404);
      res.end();
    }
    return true;
  }

  // ----------------------------------------------------------------- GET /v2 (alias → /)
  if (req.method === 'GET' && url === '/v2') {
    res.writeHead(301, { Location: '/' });
    res.end();
    return true;
  }

  // --------------------------------------------------------- GET /api/git-user
  if (req.method === 'GET' && url === '/api/git-user') {
    try {
      const { execSync: gitExec } = await import('node:child_process');
      const cwd = projectDir || process.cwd();
      const name = gitExec('git config user.name', { cwd, encoding: 'utf8' }).trim();
      const email = gitExec('git config user.email', { cwd, encoding: 'utf8' }).trim();
      let remoteUrl = '';
      try {
        remoteUrl = gitExec('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
      } catch {}
      // Normalise SSH remote to HTTPS URL for browser linking
      if (remoteUrl.startsWith('git@')) {
        remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
      } else if (remoteUrl.endsWith('.git')) {
        remoteUrl = remoteUrl.slice(0, -4);
      }
      let branch = '';
      try {
        branch = gitExec('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
      } catch {}
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ name, email, cwd, remoteUrl, branch }));
    } catch (_) {
      const cwd2 = projectDir || process.cwd();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ name: '', email: '', cwd: cwd2, remoteUrl: '', branch: '' }));
    }
    return true;
  }

  // ---------------------------------------------------- GET /favicon.ico
  if (req.method === 'GET' && url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
