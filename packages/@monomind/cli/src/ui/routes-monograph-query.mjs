import fs from 'node:fs';
import path from 'node:path';

// Monograph dashboard routes (extracted from routes-monograph.mjs).
// Registered, in order, by handleMonographRoutes in routes-monograph.mjs.
export async function handleMonographQueryRoutes(req, res, url, corsOrigin, ctx) {
  // -------------------------------------------------- GET /api/monograph-explain
  if (req.method === 'GET' && url === '/api/monograph-explain') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const nodeQ = (qs.get('node') || '').trim().slice(0, 4096);
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!nodeQ) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing ?node= parameter' }));
        return true;
      }
      if (!fs.existsSync(dbPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(
          JSON.stringify({
            success: false,
            explanation: 'Graph not built yet. Run: monomind monograph build',
          }),
        );
        return true;
      }
      const { openDb, closeDb } = await import(
        new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
      );
      const { ftsSearch } = await import(
        new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href
      );
      const db = openDb(dbPath);
      let explanation = '';
      try {
        let nd =
          db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeQ) ||
          db.prepare('SELECT * FROM nodes WHERE name=?').get(nodeQ);
        if (!nd) {
          const hits = ftsSearch(db, nodeQ, 1);
          if (hits[0]) nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(hits[0].id);
        }
        if (!nd) {
          explanation = `No node found matching: "${nodeQ}"`;
        } else {
          const outEdges = db
            .prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 20')
            .all(nd.id);
          const inEdges = db
            .prepare('SELECT source_id, relation FROM edges WHERE target_id=? LIMIT 20')
            .all(nd.id);
          explanation = [
            `## ${nd.name} [${nd.label}]`,
            nd.file_path ? `File: ${nd.file_path}${nd.start_line ? `:${nd.start_line}` : ''}` : '',
            nd.language ? `Language: ${nd.language}` : '',
            nd.is_exported ? 'Exported: yes' : 'Exported: no',
            '',
            outEdges.length
              ? `References (${outEdges.length}):\n` +
                outEdges
                  .map((e) => `  ${e.relation} → ${e.target_id.split('/').pop() || e.target_id}`)
                  .join('\n')
              : 'No outgoing references.',
            inEdges.length
              ? `\nReferenced by (${inEdges.length}):\n` +
                inEdges
                  .map((e) => `  ${e.source_id.split('/').pop() || e.source_id} [${e.relation}]`)
                  .join('\n')
              : '',
          ]
            .filter(Boolean)
            .join('\n');
        }
      } finally {
        closeDb(db);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ success: true, node: nodeQ, explanation }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
