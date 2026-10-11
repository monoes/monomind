import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { _readTailLines } from './server-fileutils.mjs';

// Org dashboard routes: metrics, playbooks, workflow defs, coverage and workflow runs.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgWorkflowRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/mastermind/metrics — aggregate system metrics from token-summary
  if (req.method === 'GET' && url === '/api/mastermind/metrics') {
    try {
      const base = path.join(ctx.projectDir || process.cwd(), '.monomind', 'metrics');
      let tokens = {},
        events = [];
      try {
        tokens = JSON.parse(fs.readFileSync(path.join(base, 'token-summary.json'), 'utf8'));
      } catch (_) {}
      try {
        const evPath = path.join(
          ctx.projectDir || process.cwd(),
          'data',
          'mastermind-events.jsonl',
        );
        const lines = _readTailLines(evPath).slice(-20);
        events = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean);
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tokens, recentEvents: events }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"tokens":{},"recentEvents":[]}');
    }
    return true;
  }

  // ------------------------------------------------- GET /api/playbooks
  // List playbook definitions from <dir>/.monomind/playbooks/*.json.
  // (Previously only POST was registered, so GET /api/playbooks?dir=... fell
  // through to the 404 handler.)
  if (req.method === 'GET' && url === '/api/playbooks') {
    try {
      const qp = new URL(req.url, 'http://localhost').searchParams;
      const dir = qp.get('dir') || ctx.projectDir || process.cwd();
      const playbookDir = path.join(path.resolve(dir), '.monomind', 'playbooks');
      const result = [];
      if (fs.existsSync(playbookDir)) {
        const files = fs
          .readdirSync(playbookDir)
          .filter((f) => f.endsWith('.json') && !f.startsWith('._'));
        for (const file of files) {
          try {
            const fpath = path.join(playbookDir, file);
            const def = JSON.parse(fs.readFileSync(fpath, 'utf8'));
            const stat = fs.statSync(fpath);
            result.push({
              ...def,
              id: def.id || file.replace('.json', ''),
              file,
              modifiedAt: stat.mtimeMs,
            });
          } catch (_) {}
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ------------------------------------------------- POST /api/playbooks
  // Save a playbook definition to .monomind/playbooks/<id>.json
  if (req.method === 'POST' && url === '/api/playbooks') {
    try {
      let body = '';
      await new Promise((resolve, reject) => {
        req.on('data', (d) => {
          body += d;
        });
        req.on('end', resolve);
        req.on('error', reject);
      });
      const pb = JSON.parse(body);
      if (!pb.id || !pb.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id and name are required' }));
        return true;
      }
      const dir = ctx.projectDir || process.cwd();
      const playbookDir = path.join(dir, '.monomind', 'playbooks');
      fs.mkdirSync(playbookDir, { recursive: true });
      const filePath = path.join(playbookDir, `${pb.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(pb, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: pb.id, file: `${pb.id}.json` }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ------------------------------------------------- GET /api/workflow-defs
  if (req.method === 'GET' && url === '/api/workflow-defs') {
    try {
      const qp = new URL(req.url, 'http://x').searchParams;
      const dir = qp.get('dir') || ctx.projectDir || process.cwd();
      const playbookDir = path.join(dir, '.monomind', 'playbooks');
      const result = [];
      if (fs.existsSync(playbookDir)) {
        const files = fs.readdirSync(playbookDir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          try {
            const fpath = path.join(playbookDir, file);
            const stat = fs.statSync(fpath);
            const def = JSON.parse(fs.readFileSync(fpath, 'utf8'));
            const params = (def.params || []).map((p) =>
              typeof p === 'string' ? p : p.name || p.key || '',
            );
            result.push({
              id: def.id || file.replace('.json', ''),
              name: def.name || file.replace('.json', ''),
              description: def.description || null,
              file,
              nodeCount: Array.isArray(def.nodes) ? def.nodes.length : 0,
              params,
              modifiedAt: stat.mtimeMs,
            });
          } catch (_) {}
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ------------------------------------------------- GET /api/org-coverage
  // Audit coverage report written by the audit loop to .monomind/audit/coverage.json
  if (req.method === 'GET' && url === '/api/org-coverage') {
    try {
      const qp = new URL(req.url, 'http://localhost').searchParams;
      const dir = path.resolve(qp.get('dir') || ctx.projectDir || process.cwd());
      const covPath = path.join(dir, '.monomind', 'audit', 'coverage.json');
      if (!fs.existsSync(covPath)) {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end('{}');
        return true;
      }
      const coverage = JSON.parse(fs.readFileSync(covPath, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(coverage));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ------------------------------------------------- GET /api/workflow-runs
  if (req.method === 'GET' && url === '/api/workflow-runs') {
    // Reads from ~/.monomind/browse-runs.json written by the monobrowse dashboard server.
    try {
      const runsFile = path.join(os.homedir(), '.monomind', 'browse-runs.json');
      if (fs.existsSync(runsFile)) {
        const raw = fs.readFileSync(runsFile, 'utf-8');
        const runs = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(runs) ? runs : []));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return true;
  }
  return false;
}
