import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToSlug } from './server-slug.mjs';

// Memory-file / routing-feedback / memory-stats routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesMemory1(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // ------------------------------------------------------- GET /api/memory-files
  if (req.method === 'GET' && url === '/api/memory-files') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const homeDir = os.homedir();
      const slug = pathToSlug(d);
      const memDir = path.join(homeDir, '.claude', 'projects', slug, 'memory');

      let files = [];
      try {
        files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
      } catch {}

      const memories = files
        .map((fname) => {
          const fp = path.join(memDir, fname);
          let stat = null;
          try {
            stat = fs.statSync(fp);
          } catch {}
          let raw = '';
          try {
            raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
          } catch {}
          // Parse frontmatter — escHtml ordering: bold replace runs on already-escaped content (safe)
          let name = fname.replace('.md', ''),
            description = '',
            type = 'project',
            body = raw;
          const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
          if (fm) {
            body = fm[2].trim();
            for (const line of fm[1].split('\n')) {
              const m = line.match(/^(\w+):\s*(.+)$/);
              if (m) {
                if (m[1] === 'name') name = m[2].trim();
                if (m[1] === 'description') description = m[2].trim();
                if (m[1] === 'type') type = m[2].trim();
              }
            }
          }
          return {
            filename: fname,
            name,
            description,
            type,
            body,
            source: 'file',
            readonly: false,
            mtime: stat ? stat.mtimeMs : null,
          };
        })
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

      // Merge the auto-memory store (.monomind/data/auto-memory-store.json). Its
      // entries are not .md files, so the file-only listing above
      // misses them. Surface them read-only with a source badge so the dashboard
      // reflects ALL memory, not just whatever has been flushed to disk.
      let backend = [];
      try {
        const storePath = path.join(d, '.monomind', 'data', 'auto-memory-store.json');
        if (fs.existsSync(storePath)) {
          const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
          const rows = Array.isArray(raw) ? raw : raw.entries || [];
          backend = rows
            .filter((e) => e && e.content != null && e.status !== 'deleted')
            .map((e) => ({
              filename: `backend:${e.key || e.id}`,
              name: e.key || e.id || 'entry',
              description: e.namespace ? `namespace: ${e.namespace}` : '',
              type: e.type || 'semantic',
              body: String(e.content),
              source: 'backend',
              readonly: true,
              mtime: e.updatedAt || e.createdAt || null,
            }))
            .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        }
      } catch {}

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ memories: memories.concat(backend), memDir }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ------------------------------------------------------- PUT /api/memory-file
  if (req.method === 'PUT' && url === '/api/memory-file') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', () => {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const slug = pathToSlug(d);
        const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
        const { filename, content } = JSON.parse(body);
        if (
          !filename ||
          filename.includes('..') ||
          !filename.endsWith('.md') ||
          filename.includes('/')
        ) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid filename' }));
          return true;
        }
        const fp = path.join(memDir, filename);
        if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied' }));
          return true;
        }
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(fp, content || '', 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ------------------------------------------------------- DELETE /api/memory-file
  if (req.method === 'DELETE' && url === '/api/memory-file') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', () => {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const slug = pathToSlug(d);
        const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
        const { filename } = JSON.parse(body);
        if (
          !filename ||
          filename.includes('..') ||
          !filename.endsWith('.md') ||
          filename.includes('/')
        ) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid filename' }));
          return true;
        }
        const fp = path.join(memDir, filename);
        if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied' }));
          return true;
        }
        fs.unlinkSync(fp);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ------------------------------------------------- GET /api/routing-feedback
  if (req.method === 'GET' && url === '/api/routing-feedback') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      const feedbackPath = path.join(d, '.monomind', 'routing-feedback.jsonl');
      let rows = [];
      if (fs.existsSync(feedbackPath)) {
        const raw = fs.readFileSync(feedbackPath, 'utf-8');
        rows = raw
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
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ---------------------------------------------------- GET /api/memory/stats
  if (req.method === 'GET' && url === '/api/memory/stats') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      const slug = pathToSlug(d);
      const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');

      let total = 0,
        namespaces = 0,
        size = 0,
        lastWrite = null;
      const byType = {};
      if (fs.existsSync(memDir)) {
        const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'));
        total = files.length;
        namespaces = files.length; // each .md file is a memory namespace
        files.forEach((f) => {
          const fp = path.join(memDir, f);
          try {
            const st = fs.statSync(fp);
            size += st.size;
            if (!lastWrite || st.mtimeMs > lastWrite) lastWrite = st.mtimeMs;
          } catch {}
          const type = f.replace('.md', '');
          byType[type] = (byType[type] || 0) + 1;
        });
      }

      // Real v2 memory sources: auto-memory pattern store + episodic log
      let patterns = 0,
        patternsUpdated = null;
      try {
        const store = JSON.parse(
          fs.readFileSync(path.join(d, '.monomind', 'data', 'auto-memory-store.json'), 'utf8'),
        );
        if (Array.isArray(store)) {
          patterns = store.length;
          for (const e of store) {
            if (e && typeof e.ts === 'number' && (!patternsUpdated || e.ts > patternsUpdated))
              patternsUpdated = e.ts;
          }
        }
      } catch {}

      let episodes = 0,
        lastEpisode = null;
      try {
        const lines = fs
          .readFileSync(path.join(d, '.monomind', 'episodic', 'episodes.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean);
        episodes = lines.length;
        if (lines.length) {
          try {
            const last = JSON.parse(lines[lines.length - 1]);
            lastEpisode = last.ts || last.timestamp || null;
          } catch {}
        }
      } catch {}

      const stats = {
        total,
        count: total,
        namespaces,
        ns: Object.keys(byType).length,
        size,
        byType,
        patterns,
        patternsUpdated,
        episodes,
        lastEpisode,
        memoryFiles: total,
        // Legacy keys (v1 backends removed in v2) — kept false for frontend backward-safety
        hnsw: false,
        agentdb: false,
        rvf: false,
        lastWrite,
        memDir,
      };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
