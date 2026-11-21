import fs from 'node:fs';
import path from 'node:path';

// Org dashboard routes: org file listing and file content.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgFileRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/files — all files related to an org
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/files$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"error":"Invalid org name"}');
        return true;
      }
      const _filesQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_filesQs.get('dir') || ctx.projectDir || process.cwd());
      const orgsDir = path.join(d, '.monomind', 'orgs');
      const files = [];
      const seen = new Set();
      const addFile = (fp, type) => {
        if (seen.has(fp)) return;
        seen.add(fp);
        try {
          const st = fs.statSync(fp);
          files.push({
            name: path.basename(fp),
            path: fp,
            type,
            size: st.size,
            mtime: st.mtime.toISOString(),
          });
        } catch (_) {}
      };
      addFile(path.join(orgsDir, `${orgName}.json`), 'config');
      // Threads are appended line by line (server-mastermind-event.mjs): .jsonl.
      for (const s of [
        '-state.json',
        '-approvals.json',
        '-goals.json',
        '-routines.json',
        '-projects.json',
        '-members.json',
        '-issues.json',
        '-threads.jsonl',
        '-budgets.json',
      ]) {
        const fp = path.join(orgsDir, orgName + s);
        if (fs.existsSync(fp)) addFile(fp, s.slice(1, s.indexOf('.')));
      }
      const walkDir = (dir, depth) => {
        if (depth > 3) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) walkDir(fp, depth + 1);
          else addFile(fp, 'generated');
        }
      };
      const orgWorkDir = path.join(orgsDir, orgName);
      if (fs.existsSync(orgWorkDir)) walkDir(orgWorkDir, 0);
      let orgCfg = null;
      try {
        orgCfg = JSON.parse(fs.readFileSync(path.join(orgsDir, `${orgName}.json`), 'utf8'));
      } catch (_) {}
      if (orgCfg && Array.isArray(orgCfg.roles)) {
        const agentsDir = path.join(d, '.claude', 'agents');
        const walkAgents = (dir) => {
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch (_) {
            return;
          }
          for (const e of entries) {
            if (e.isDirectory()) {
              walkAgents(path.join(dir, e.name));
              continue;
            }
            if (!e.name.endsWith('.md')) continue;
            const fp = path.join(dir, e.name);
            const base = e.name.replace('.md', '').toLowerCase();
            if (
              orgCfg.roles.some(
                (r) =>
                  base === (r.id || '').toLowerCase() ||
                  base === (r.agent_type || '').toLowerCase() ||
                  (r.instructions_file || '').endsWith(e.name),
              )
            )
              addFile(fp, 'agent-definition');
          }
        };
        if (fs.existsSync(agentsDir)) walkAgents(agentsDir);
      }
      files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/file-content — return raw text content of a .monomind file
  if (req.method === 'GET' && url === '/api/file-content') {
    try {
      const _fcQs = new URL(req.url, 'http://localhost').searchParams;
      const rawPath = _fcQs.get('path');
      const baseDir = path.resolve(_fcQs.get('dir') || ctx.projectDir || process.cwd());
      if (!rawPath) {
        res.writeHead(400);
        res.end('Missing path');
        return true;
      }
      const resolved = path.resolve(rawPath);
      // Security: must be inside .monomind of the project dir
      const monomindDir = path.join(baseDir, '.monomind');
      if (!resolved.startsWith(monomindDir + path.sep) && resolved !== monomindDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return true;
      }
      if (!fs.existsSync(resolved)) {
        res.writeHead(404);
        res.end('Not found');
        return true;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        res.writeHead(400);
        res.end('Not a file');
        return true;
      }
      if (stat.size > 524288) {
        res.writeHead(413);
        res.end('File too large');
        return true;
      }
      const _fcMime = ctx._detectMimeType(resolved);
      if (_fcMime.startsWith('image/')) {
        res.writeHead(200, {
          'Content-Type': _fcMime,
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(fs.readFileSync(resolved));
        return true;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(content);
    } catch (_) {
      res.writeHead(500);
      res.end('Internal error');
    }
    return true;
  }
  return false;
}
