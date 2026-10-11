import fs from 'node:fs';
import path from 'node:path';

// Org dashboard routes: artifacts, mastermind events, stream, sessions and pages.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgMastermindRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/artifact — serve file content for chat "View" button
  if (req.method === 'GET' && /^\/api\/org\/[^/]+\/artifact/.test(url)) {
    try {
      const _artOrgName = decodeURIComponent(url.split('/')[3] || '');
      if (_artOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_artOrgName)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid org name' }));
        return true;
      }
      const _artQp = new URL(`http://x${req.url}`).searchParams;
      const _rawPath = _artQp.get('path');
      if (!_rawPath) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'path required' }));
        return true;
      }
      const _filePath = path.resolve(_rawPath);
      // Security: this endpoint used to allow reads anywhere under the project
      // root or any data/known-projects.json entry — letting any dashboard
      // client read .env, .git/config, or other arbitrary project files.
      // Restrict it, like /api/file-content above, to this org's own
      // .monomind/orgs/<name>/ directory — never outside .monomind.
      const _artBaseDir = path.resolve(_artQp.get('dir') || ctx.projectDir || process.cwd());
      const _artProjDir = ctx._resolveOrgProjectDir(_artOrgName, _artBaseDir) || _artBaseDir;
      const _artMonoDir =
        ctx._getGitMonomindDir(_artProjDir) || path.join(_artProjDir, '.monomind');
      const _artOrgDir = path.join(_artMonoDir, 'orgs', _artOrgName);
      const _within = (p, base) => p === base || p.startsWith(base + path.sep);
      if (!_within(_filePath, _artOrgDir)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'path not allowed' }));
        return true;
      }
      if (!fs.existsSync(_filePath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'file not found' }));
        return true;
      }
      // Re-check containment after resolving symlinks so a link inside the
      // org dir cannot point the read outside it.
      let _realFile;
      let _realOrgDir;
      try {
        _realFile = fs.realpathSync(_filePath);
        _realOrgDir = fs.realpathSync(_artOrgDir);
      } catch (_) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'file not found' }));
        return true;
      }
      if (!_within(_realFile, _realOrgDir)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'path not allowed' }));
        return true;
      }
      const _mime = ctx._detectMimeType(_filePath);
      const _size = fs.statSync(_filePath).size;
      // Reject files >2MB to avoid blocking the event loop
      if (_size > 2 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'file too large', size: _size }));
        return true;
      }
      if (!_mime.startsWith('text/') && _mime !== 'application/json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ binary: true, mimeType: _mime, size: _size }));
        return true;
      }
      const _content = fs.readFileSync(_filePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ content: _content, mimeType: _mime, size: _size }));
    } catch (_e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'read failed' }));
    }
    return true;
  }

  // ------------------------------------------------- Mastermind event system
  // POST /api/mastermind/event — ingest event from mastermind skill
  if (req.method === 'POST' && url === '/api/mastermind/event') {
    await ctx.handleMastermindEvent(req, res, corsOrigin);
    return true;
  }

  // GET /api/mastermind-stream — SSE for real-time events
  if (req.method === 'GET' && url === '/api/mastermind-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.write(': connected\n\n');
    ctx.addMmClient(res);
    // Replay last 50 events from disk (use ?project= param if provided)
    try {
      const _sseQp = new URL(`http://x${req.url}`).searchParams;
      const _sseProj = _sseQp.get('project');
      const root2 = _sseProj || ctx.projectDir || process.cwd();
      const evFile = path.join(root2, 'data', 'mastermind-events.jsonl');
      const lines = fs.readFileSync(evFile, 'utf8').trim().split('\n').filter(Boolean).slice(-50);
      for (const l of lines) res.write(`data: ${l}\n\n`);
    } catch (_) {}
    const ka = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(ka);
        ctx.removeMmClient(res);
      }
    }, 20000);
    req.on('close', () => {
      ctx.removeMmClient(res);
      clearInterval(ka);
    });
    return true;
  }

  // GET /api/mastermind/sessions
  if (req.method === 'GET' && url.startsWith('/api/mastermind/sessions')) {
    try {
      const qp = new URL(`http://x${req.url}`).searchParams;
      const filterProject = qp.get('project');
      const limitParam = Math.min(parseInt(qp.get('limit') || '200', 10) || 200, 500);
      const serverRoot = ctx.projectDir || process.cwd();
      // Collect all project dirs to aggregate
      const projectDirs = new Set([serverRoot]);
      try {
        const known = JSON.parse(
          fs.readFileSync(path.join(serverRoot, 'data', 'known-projects.json'), 'utf8'),
        );
        known.forEach((p) => projectDirs.add(p));
      } catch (_) {}
      let allSessions = [];
      for (const pd of projectDirs) {
        if (filterProject && pd !== filterProject) continue;
        const sessDir = path.join(pd, 'data', 'sessions');
        const indexFile = path.join(sessDir, '_index.json');
        // ── New format: per-session JSONL + _index.json ──
        if (fs.existsSync(indexFile)) {
          try {
            const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
            const top = idx.slice(0, limitParam);
            for (const entry of top) {
              const _sid = String(entry.id || '').trim();
              if (!_sid || !ctx.SESSION_ID_RE.test(_sid)) continue;
              let events = [];
              try {
                const jl = fs.readFileSync(path.join(sessDir, `${_sid}.jsonl`), 'utf8');
                events = jl
                  .trim()
                  .split('\n')
                  .filter(Boolean)
                  .map((l) => {
                    try {
                      return JSON.parse(l);
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean);
              } catch (_) {}
              allSessions.push({ ...entry, events, project: pd });
            }
          } catch (_) {}
        } else {
          // ── Legacy fallback: mastermind-sessions.json ──
          const f = path.join(pd, 'data', 'mastermind-sessions.json');
          if (fs.existsSync(f)) {
            try {
              const s = JSON.parse(fs.readFileSync(f, 'utf8'));
              s.forEach((sess) => {
                if (!sess.project) sess.project = pd;
              });
              allSessions = allSessions.concat(s);
            } catch (_) {}
          }
        }
      }
      allSessions.sort((a, b) => (b.ts || b.startedAt || 0) - (a.ts || a.startedAt || 0));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(allSessions.slice(0, limitParam)));
    } catch (_) {
      res.writeHead(200);
      res.end('[]');
    }
    return true;
  }

  // GET /api/mastermind/session/:id/trace — human-readable markdown trace
  if (req.method === 'GET' && url.match(/^\/api\/mastermind\/session\/[^/]+\/trace$/)) {
    try {
      const sid = url.split('/')[4];
      const sessFile = path.join(
        ctx.projectDir || process.cwd(),
        'data',
        'sessions',
        `${sid}.json`,
      );
      let s = null;
      if (fs.existsSync(sessFile)) {
        s = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      } else {
        const f = path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
        const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
        s = sessions.find((x) => x.id === sid);
      }
      if (!s) {
        res.writeHead(404);
        res.end('Session not found');
        return true;
      }
      const fmt = (ts) => `${new Date(ts).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
      const lines = [
        `# Mastermind Session Trace: ${s.id}`,
        ``,
        `**Prompt:** ${s.prompt || '(none)'}`,
        `**Status:** ${s.status}`,
        `**Started:** ${fmt(s.ts)}`,
        s.endTs ? `**Ended:** ${fmt(s.endTs)}` : '',
        `**Domains:** ${(s.domains || []).join(', ') || '(none yet)'}`,
        ``,
      ];
      for (const ev of s.events || []) {
        const t = fmt(ev.ts);
        if (ev.type === 'session:start')
          lines.push(`\`${t}\` **SESSION START** — prompt: "${ev.prompt || ''}"`);
        else if (ev.type === 'domain:dispatch')
          lines.push(`\`${t}\` **DOMAIN DISPATCH** → \`${ev.domain}\` — ${ev.cmd || ''}`);
        else if (ev.type === 'agent:spawn')
          lines.push(
            `\`${t}\` **AGENT SPAWN** [\`${ev.domain}\`] → agent: \`${ev.agent}\` — ${ev.task || ''}`,
          );
        else if (ev.type === 'intercom')
          lines.push(`\`${t}\` **INTERCOM** \`${ev.from}\` → \`${ev.to}\`: ${ev.msg || ''}`);
        else if (ev.type === 'domain:complete')
          lines.push(
            `\`${t}\` **DOMAIN COMPLETE** [\`${ev.domain}\`] status: ${ev.status}${ev.artifacts?.length ? ` — artifacts: ${ev.artifacts.join(', ')}` : ''}`,
          );
        else if (ev.type === 'session:complete')
          lines.push(
            `\`${t}\` **SESSION COMPLETE** — status: ${ev.status}, domains: ${(ev.domains || []).join(', ')}`,
          );
        else lines.push(`\`${t}\` ${ev.type} ${JSON.stringify(ev)}`);
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(lines.join('\n'));
    } catch (_) {
      res.writeHead(500);
      res.end('Error');
    }
    return true;
  }

  // GET /api/mastermind/session/:id
  if (req.method === 'GET' && url.startsWith('/api/mastermind/session/')) {
    try {
      const sid = url.slice('/api/mastermind/session/'.length);
      // Check individual session file first
      const sessFile = path.join(
        ctx.projectDir || process.cwd(),
        'data',
        'sessions',
        `${sid}.json`,
      );
      if (fs.existsSync(sessFile)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(fs.readFileSync(sessFile, 'utf8'));
        return true;
      }
      const f = path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
      const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
      const s = sessions.find((x) => x.id === sid);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(s || null));
    } catch (_) {
      res.writeHead(200);
      res.end('null');
    }
    return true;
  }

  // -------------------------------------------------------- GET /mastermind
  if (req.method === 'GET' && url === '/mastermind') {
    // Serve local file if present (dev), otherwise fall back to bundled HTML
    const root = ctx.projectDir || process.cwd();
    const htmlPath = path.join(root, 'docs', 'mastermind-diagram.html');
    let html = ctx.MASTERMIND_DIAGRAM_HTML;
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch (_) {}
    // Same auth-token injection as GET / and GET /orgs.
    html = String(html).replace(
      '<head>',
      `<head>\n<meta name="mm-token" content="${ctx.dashboardAuthValue}">`,
    );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }

  // ----------------------------------------------------------- GET /orgs
  if (req.method === 'GET' && url === '/orgs') {
    try {
      const htmlPath = path.join(ctx.__dirname, 'orgs.html');
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Inject this process's auth credential the same way GET / does for
      // dashboard.html — orgs.html's fetch() calls hit the same now
      // default-closed /api/* routes and need a way to know the token.
      html = html.replace(
        '<head>',
        `<head>\n<meta name="mm-token" content="${ctx.dashboardAuthValue}">`,
      );
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(html);
    } catch (err) {
      res.writeHead(404);
      res.end(`orgs.html not found: ${err.message}`);
    }
    return true;
  }

  // ------------------------------------------------ GET /orgs-files.js
  // Files-tab + diff-view script, split out of orgs.html (see orgs.html's
  // script-src comment). Not a generic static handler — this UI serves each
  // sibling asset via its own hardcoded route, same as GET /orgs above.
  if (req.method === 'GET' && url === '/orgs-files.js') {
    try {
      const jsPath = path.join(ctx.__dirname, 'orgs-files.js');
      const js = fs.readFileSync(jsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
    } catch (err) {
      res.writeHead(404);
      res.end(`orgs-files.js not found: ${err.message}`);
    }
    return true;
  }
  return false;
}
