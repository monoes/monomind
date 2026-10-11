import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedProjectDir } from './server-fileutils.mjs';
import { _getKnowledgeBridge } from './server-knowledge-bridge.mjs';

// Second-Brain knowledge-entry and knowledge-chunk routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesMemory2(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // ------------------------------------------ GET /api/memory/entries (SQLite)
  if (req.method === 'GET' && url === '/api/memory/entries') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const ns = qs.get('namespace') || undefined;
      const limit = Math.min(parseInt(qs.get('limit') || '50', 10) || 50, 200);
      const offset = parseInt(qs.get('offset') || '0', 10) || 0;
      const bridge = await _getKnowledgeBridge();
      if (!bridge) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
        return true;
      }
      const result = await bridge.bridgeListEntries({ namespace: ns, limit, offset });
      if (!result?.success) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result?.error || 'Failed to list entries' }));
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ entries: result.entries, total: result.total }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // --------------------------------------- GET /api/memory/search (SQLite)
  if (req.method === 'GET' && url === '/api/memory/search') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const query = qs.get('q') || '';
      const ns = qs.get('namespace') || undefined;
      const limit = Math.min(parseInt(qs.get('limit') || '20', 10) || 20, 100);
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing query parameter q' }));
        return true;
      }
      const bridge = await _getKnowledgeBridge();
      if (!bridge) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
        return true;
      }
      const result = await bridge.bridgeSearchEntries({ query, namespace: ns, limit });
      if (!result?.success) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result?.error || 'Search failed' }));
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(
        JSON.stringify({
          results: result.results,
          searchTime: result.searchTime,
          searchMethod: result.searchMethod,
        }),
      );
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------- POST /api/memory/entry (SQLite)
  if (req.method === 'POST' && url === '/api/memory/entry') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', async () => {
      try {
        const { key, value, namespace, tags } = JSON.parse(body);
        if (!key || !value) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing key or value' }));
          return true;
        }
        const bridge = await _getKnowledgeBridge();
        if (!bridge) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
          return true;
        }
        const result = await bridge.bridgeStoreEntry({
          key: String(key),
          value: String(value),
          namespace: namespace || 'default',
          tags: Array.isArray(tags) ? tags : [],
          upsert: true,
        });
        if (!result?.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result?.error || 'Store failed' }));
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, id: result.id, duplicate: result.duplicate }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ------------------------------------ DELETE /api/memory/entry (SQLite)
  if (req.method === 'DELETE' && url === '/api/memory/entry') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', async () => {
      try {
        const { key, id, namespace } = JSON.parse(body);
        if (!key && !id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing key or id' }));
          return true;
        }
        const bridge = await _getKnowledgeBridge();
        if (!bridge) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
          return true;
        }
        const result = await bridge.bridgeDeleteEntry({
          key,
          id,
          namespace: namespace || 'default',
        });
        if (!result?.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result?.error || 'Delete failed' }));
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, deleted: result.deleted }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ------------------------------------------------------- DELETE /api/knowledge-chunk
  if (req.method === 'DELETE' && url === '/api/knowledge-chunk') {
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
        const d = resolveAllowedProjectDir(qs.get('dir'), projectDir);
        if (!d) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
          return true;
        }
        const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
        const { chunkId } = JSON.parse(body);
        if (!chunkId || typeof chunkId !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid chunkId' }));
          return true;
        }
        if (!fs.existsSync(chunksFile)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
          return true;
        }
        const entries = fs
          .readFileSync(chunksFile, 'utf8')
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
        const before = entries.length;
        const filtered = entries.filter((e) => e.chunkId !== chunkId);
        if (filtered.length === before) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Chunk not found' }));
          return true;
        }
        fs.writeFileSync(
          chunksFile,
          filtered.map((e) => JSON.stringify(e)).join('\n') + (filtered.length ? '\n' : ''),
          'utf8',
        );
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, removed: before - filtered.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ------------------------------------------------------- PUT /api/knowledge-chunk
  if (req.method === 'PUT' && url === '/api/knowledge-chunk') {
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
        const d = resolveAllowedProjectDir(qs.get('dir'), projectDir);
        if (!d) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
          return true;
        }
        const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
        const { chunkId, text } = JSON.parse(body);
        if (!chunkId || typeof chunkId !== 'string' || typeof text !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid chunkId or text' }));
          return true;
        }
        if (!fs.existsSync(chunksFile)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
          return true;
        }
        const entries = fs
          .readFileSync(chunksFile, 'utf8')
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
        const idx = entries.findIndex((e) => e.chunkId === chunkId);
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Chunk not found' }));
          return true;
        }
        entries[idx] = { ...entries[idx], text };
        fs.writeFileSync(
          chunksFile,
          `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
          'utf8',
        );
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

  return false;
}
