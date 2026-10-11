import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedProjectDir } from './server-fileutils.mjs';

// Monograph dashboard routes (extracted from routes-monograph.mjs).
// Registered, in order, by handleMonographRoutes in routes-monograph.mjs.
export async function handleMonographWatchRoutes(req, res, url, corsOrigin, ctx) {
  // -------------------------------------------------- GET /api/monograph-watch-status
  if (req.method === 'GET' && url === '/api/monograph-watch-status') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      let running = false,
        pid = null;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          running = true;
          break;
        } catch {}
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ running, pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-watch-toggle
  if (req.method === 'POST' && url === '/api/monograph-watch-toggle') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = resolveAllowedProjectDir(qs.get('dir'), ctx.projectDir);
      if (!d) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
        return true;
      }
      const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
      let wasRunning = false;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          const pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          wasRunning = true;
          process.kill(pid, 'SIGTERM');
          try {
            fs.unlinkSync(pp);
          } catch {}
        } catch {}
      }

      if (wasRunning) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ running: false, action: 'stopped' }));
      } else {
        const { spawn: sp } = await import('node:child_process');
        const child = sp(process.execPath, [process.argv[1], 'monograph', 'watch'], {
          stdio: 'ignore',
          detached: true,
          cwd: d,
          env: process.env,
        });
        child.unref();
        try {
          fs.mkdirSync(path.join(d, '.monomind'), { recursive: true });
        } catch {}
        try {
          fs.writeFileSync(pidPath, String(child.pid));
        } catch {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ running: true, pid: child.pid, action: 'started' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-benchmark
  if (req.method === 'GET' && url === '/api/monograph-benchmark') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
      const legacyPath = path.join(d, 'graphify-out', 'graph.json');
      const gp = fs.existsSync(graphPath)
        ? graphPath
        : fs.existsSync(legacyPath)
          ? legacyPath
          : null;

      if (!gp) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ available: false }));
        return true;
      }

      const { execSync: ex } = await import('node:child_process');
      const out = ex(`graphify benchmark ${gp}`, {
        encoding: 'utf8',
        cwd: d,
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ available: true, result: out }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Reads .monomind/monograph.db via sqlite3 CLI to avoid bundling better-sqlite3.
  if (req.method === 'GET' && url === '/api/monograph') {
    try {
      const dbPath = path.join(ctx.projectDir || process.cwd(), '.monomind', 'monograph.db');
      if (!fs.existsSync(dbPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
        return true;
      }
      const { execFileSync } = await import('node:child_process');
      // Pipe SQL via stdin to avoid shell quoting issues with single-quoted SQL strings.
      const runSql = (sql, timeout = 5000) => {
        try {
          return execFileSync('sqlite3', ['-json', dbPath], {
            encoding: 'utf-8',
            timeout: timeout,
            input: `${sql};`,
          });
        } catch (_e) {
          return '[]';
        }
      };
      const counts = JSON.parse(
        runSql(
          'SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges;',
        ) || '[{}]',
      )[0] || { nodes: 0, edges: 0 };
      // Compute degree in one pass via GROUP BY (much faster than per-row subquery).
      const gods = JSON.parse(
        runSql(
          'WITH deg(node_id, d) AS (' +
            '  SELECT source_id, COUNT(*) FROM edges GROUP BY source_id ' +
            '  UNION ALL ' +
            '  SELECT target_id, COUNT(*) FROM edges GROUP BY target_id' +
            '), totals AS (' +
            '  SELECT node_id, SUM(d) AS deg FROM deg GROUP BY node_id' +
            ') ' +
            'SELECT n.name, n.label, n.file_path, t.deg ' +
            'FROM nodes n JOIN totals t ON t.node_id = n.id ' +
            "WHERE n.label NOT IN ('Concept') " +
            "AND n.file_path IS NOT NULL AND n.file_path != '' " +
            "AND n.name NOT LIKE '(%' AND length(n.name) >= 3 " +
            'ORDER BY t.deg DESC LIMIT 20',
          10000,
        ) || '[]',
      );
      const types = JSON.parse(
        runSql(
          'SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC LIMIT 12',
        ) || '[]',
      );
      const relations = JSON.parse(
        runSql(
          'SELECT relation, COUNT(*) AS count FROM edges GROUP BY relation ORDER BY count DESC',
        ) || '[]',
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          exists: true,
          nodes: counts.nodes,
          edges: counts.edges,
          godNodes: gods,
          typeDistribution: types,
          relationDistribution: relations,
          updatedAt: (() => {
            try {
              return fs.statSync(dbPath).mtime;
            } catch {
              return null;
            }
          })(),
        }),
      );
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          exists: true,
          nodes: 0,
          edges: 0,
          godNodes: [],
          typeDistribution: [],
          relationDistribution: [],
          error: String(err),
        }),
      );
    }
    return true;
  }
  return false;
}
