import fs from 'node:fs';
import path from 'node:path';
import { isPathInside } from './server-fileutils.mjs';

// Monograph dashboard routes (extracted from routes-monograph.mjs).
// Registered, in order, by handleMonographRoutes in routes-monograph.mjs.
export async function handleMonographContentRoutes(req, res, url, corsOrigin, ctx) {
  // -------------------------------------------------- GET /api/monograph-content
  // Returns actual file content for a node (properties.content or file slice)
  if (req.method === 'GET' && url === '/api/monograph-content') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing ?id=' }));
        return true;
      }
      if (!fs.existsSync(dbPath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Graph not built' }));
        return true;
      }
      const { openDb, closeDb } = await import(
        new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
      );
      const db = openDb(dbPath);
      let content = '',
        filePath = '',
        startLine = 0,
        endLine = 0,
        language = '',
        name = '',
        type = '';
      try {
        const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
        if (!node) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Node not found' }));
          return true;
        }
        name = node.name || id;
        type = node.label || 'Unknown';
        filePath = node.file_path || '';
        startLine = node.start_line || 0;
        endLine = node.end_line || 0;
        language = node.language || '';
        // Try properties.content first (from official monograph pipeline)
        if (node.properties) {
          try {
            const props = JSON.parse(node.properties);
            if (props.content?.trim()) {
              content = props.content;
            }
          } catch {}
        }
        // Fallback: read from actual file
        if (!content && filePath) {
          const absPath = path.resolve(d, filePath);
          try {
            if (!isPathInside(d, absPath)) throw new Error('outside project dir');
            const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
            const sl = Math.max(0, (startLine || 1) - 1);
            const el = Math.min(lines.length, (endLine || startLine || lines.length) + 5);
            content = lines.slice(sl, Math.min(el, sl + 120)).join('\n');
          } catch {}
        }
      } finally {
        closeDb(db);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ content, filePath, startLine, endLine, language, name, type }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-fts
  // Full-text search with content snippets — powers the wiki search box
  if (req.method === 'GET' && url === '/api/monograph-fts') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      // Cap ?q= to prevent DoS via megabyte FTS query strings.
      const q = (qs.get('q') || '').trim().slice(0, 4096);
      const limit = Math.min(100, parseInt(qs.get('limit') || '50', 10));
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!q) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing ?q=' }));
        return true;
      }
      if (!fs.existsSync(dbPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ nodes: [] }));
        return true;
      }
      const { openDb, closeDb } = await import(
        new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
      );
      const { ftsSearch } = await import(
        new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href
      );
      const db = openDb(dbPath);
      let nodes = [];
      try {
        const hits = ftsSearch(db, q, limit);
        nodes = hits.map((h) => {
          let snippet = '';
          if (h.properties) {
            try {
              const p = JSON.parse(h.properties);
              snippet = (p.content || '').slice(0, 200);
            } catch {}
          }
          return {
            id: h.id,
            label: h.name,
            type: h.label,
            degree: 0,
            filePath: h.filePath || h.file_path,
            startLine: h.startLine || h.start_line,
            snippet,
          };
        });
      } finally {
        closeDb(db);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ nodes }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-related
  // BFS from a node — returns node IDs sorted by graph distance (for re-ranking)
  if (req.method === 'GET' && url === '/api/monograph-related') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const limit = Math.min(200, parseInt(qs.get('limit') || '60', 10));
      const maxDepth = Math.min(4, parseInt(qs.get('depth') || '3', 10));
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id || !fs.existsSync(dbPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ related: [] }));
        return true;
      }
      const { openDb, closeDb } = await import(
        new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
      );
      const db = openDb(dbPath);
      const related = [];
      try {
        const visited = new Set([id]);
        let frontier = [id];
        for (
          let depth = 1;
          depth <= maxDepth && frontier.length > 0 && related.length < limit;
          depth++
        ) {
          const next = [];
          for (const nodeId of frontier) {
            const rows = db
              .prepare(
                `SELECT DISTINCT target_id as nid FROM edges WHERE source_id=? UNION SELECT DISTINCT source_id as nid FROM edges WHERE target_id=? LIMIT 30`,
              )
              .all(nodeId, nodeId);
            for (const r of rows) {
              if (!visited.has(r.nid)) {
                visited.add(r.nid);
                next.push(r.nid);
                related.push({ id: r.nid, distance: depth });
                if (related.length >= limit) break;
              }
            }
            if (related.length >= limit) break;
          }
          frontier = next;
        }
      } finally {
        closeDb(db);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ related }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-ai-context
  // Builds a rich AI context bundle for a node: content + 1-hop neighbors
  if (req.method === 'GET' && url === '/api/monograph-ai-context') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id || !fs.existsSync(dbPath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return true;
      }
      const { openDb, closeDb } = await import(
        new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
      );
      const db = openDb(dbPath);
      const result = { node: null, content: '', neighbors: [], markdown: '' };
      try {
        const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
        if (!node) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Node not found' }));
          return true;
        }
        result.node = {
          id: node.id,
          name: node.name,
          type: node.label,
          filePath: node.file_path,
          startLine: node.start_line,
          endLine: node.end_line,
        };
        // Get content
        let content = '';
        if (node.properties) {
          try {
            const p = JSON.parse(node.properties);
            content = p.content || '';
          } catch {}
        }
        if (!content && node.file_path) {
          const absPath = path.resolve(d, node.file_path);
          try {
            if (!isPathInside(d, absPath)) throw new Error('outside project dir');
            const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
            const sl = Math.max(0, (node.start_line || 1) - 1);
            const el = Math.min(
              lines.length,
              (node.end_line || node.start_line || lines.length) + 5,
            );
            content = lines.slice(sl, Math.min(el, sl + 80)).join('\n');
          } catch {}
        }
        result.content = content;
        // Get 1-hop neighbors
        const outEdges = db
          .prepare(
            'SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.target_id WHERE e.source_id=? LIMIT 20',
          )
          .all(id);
        const inEdges = db
          .prepare(
            'SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.source_id WHERE e.target_id=? LIMIT 20',
          )
          .all(id);
        result.neighbors = [
          ...outEdges.map((e) => ({
            direction: 'out',
            relation: e.relation,
            id: e.id,
            name: e.name,
            type: e.label,
            filePath: e.file_path,
          })),
          ...inEdges.map((e) => ({
            direction: 'in',
            relation: e.relation,
            id: e.id,
            name: e.name,
            type: e.label,
            filePath: e.file_path,
          })),
        ];
        // Build markdown for clipboard/AI
        const lines2 = [];
        lines2.push(`# ${node.name} [${node.label}]`);
        if (node.file_path)
          lines2.push(
            `**File:** \`${node.file_path}\`${node.start_line ? ` (line ${node.start_line})` : ''}`,
          );
        if (content)
          lines2.push(`\n\`\`\`${node.language || ''}\n${content.slice(0, 3000)}\n\`\`\``);
        if (outEdges.length) {
          lines2.push(`\n**Depends on (${outEdges.length}):**`);
          outEdges.forEach((e) =>
            lines2.push(
              `- ${e.relation} → ${e.name} [${e.label}]${e.file_path ? ` \`${e.file_path}\`` : ''}`,
            ),
          );
        }
        if (inEdges.length) {
          lines2.push(`\n**Used by (${inEdges.length}):**`);
          inEdges.forEach((e) =>
            lines2.push(
              `- ${e.relation} ← ${e.name} [${e.label}]${e.file_path ? ` \`${e.file_path}\`` : ''}`,
            ),
          );
        }
        result.markdown = lines2.join('\n');
      } finally {
        closeDb(db);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
