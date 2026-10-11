import fs from 'node:fs';
import path from 'node:path';
// forwarder.js is compiled from orgrt/forwarder.ts (dist/src/orgrt/forwarder.js
// sits alongside this file's own compiled copy in dist/src/ui/ after
// build; under vitest the .js specifier resolves straight to the .ts source,
// same as every other cross-reference in this codebase). translate()/
// companionEvents() are pure — no filesystem or process side effects — so
// importing them here doesn't pull in attachForwarder's spawn/heal logic.
import { companionEvents, translate } from '../orgrt/forwarder.js';
import { _readTailLines } from './server-fileutils.mjs';
import { getMmClientCount } from './sse-manager.mjs';

// Org dashboard routes: loops, status, current run, history and memory.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgLiveRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/mastermind/loops — list all active loop state files
  if (req.method === 'GET' && url === '/api/mastermind/loops') {
    try {
      const loopsDir = path.join(ctx.projectDir || process.cwd(), '.monomind', 'loops');
      const loops = [];
      if (fs.existsSync(loopsDir)) {
        const files = fs
          .readdirSync(loopsDir)
          .filter((f) => f.endsWith('.json') && !f.includes('-hil'));
        for (const f of files) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(loopsDir, f), 'utf8'));
            loops.push(d);
          } catch (_) {}
        }
      }
      loops.sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ loops }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"loops":[]}');
    }
    return true;
  }

  // GET /api/status — live system snapshot for dashboard polling
  if (req.method === 'GET' && url === '/api/status') {
    try {
      const root = ctx.projectDir || process.cwd();
      // Active org runs: { orgName -> runId }
      const orgRuns = {};
      ctx.activeOrgRuns.forEach((runId, org) => {
        orgRuns[org] = runId;
      });
      // Recent events (last 10)
      let recentEvents = [];
      try {
        const evPath = path.join(root, 'data', 'mastermind-events.jsonl');
        const lines = _readTailLines(evPath).slice(-10);
        recentEvents = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean);
      } catch (_) {}
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(
        JSON.stringify({
          ts: Date.now(),
          pid: process.pid,
          uptime: process.uptime(),
          dir: root,
          sseClients: getMmClientCount(),
          activeOrgs: Object.keys(orgRuns).length,
          orgRuns,
          recentEvents,
        }),
      );
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/orgs/:name/runs/current — events from the active run file for an org
  if (req.method === 'GET' && /^\/api\/orgs\/[^/]+\/runs\/current$/.test(url)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      const _curQs = new URL(req.url, 'http://localhost').searchParams;
      const root = path.resolve(_curQs.get('dir') || ctx.projectDir || process.cwd());
      // Validate orgName
      if (!orgName || orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"error":"invalid org name"}');
        return true;
      }
      const runId = ctx.activeOrgRuns.get(orgName);
      const monoDir = ctx._getGitMonomindDir(root) || path.join(root, '.monomind');
      // Try active run first, then fall back to most recent run file.
      // Org Runtime v2 (#238): the active run's own events live under
      // orgs/<org>/<runId>/bus.jsonl, never the v1 flat orgs/<org>/runs/
      // layout — check that shape (and translate it) before the v1 lookup.
      let runFile = null;
      let isV2 = false;
      if (runId) {
        const v2Candidate = path.join(monoDir, 'orgs', orgName, runId, 'bus.jsonl');
        if (fs.existsSync(v2Candidate)) {
          runFile = v2Candidate;
          isV2 = true;
        } else {
          const candidate = path.join(monoDir, 'orgs', orgName, 'runs', `${runId}.jsonl`);
          if (fs.existsSync(candidate)) runFile = candidate;
        }
      }
      if (!runFile) {
        const orgDir = path.join(monoDir, 'orgs', orgName);
        const runDirs = fs.existsSync(orgDir)
          ? fs
              .readdirSync(orgDir)
              .filter(
                (d) => d.startsWith('run-') && fs.existsSync(path.join(orgDir, d, 'bus.jsonl')),
              )
              .sort()
              .reverse()
          : [];
        if (runDirs.length) {
          runFile = path.join(orgDir, runDirs[0], 'bus.jsonl');
          isV2 = true;
        }
      }
      if (!runFile) {
        const runsDir = path.join(monoDir, 'orgs', orgName, 'runs');
        if (fs.existsSync(runsDir)) {
          const files = fs
            .readdirSync(runsDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
          if (files.length) {
            files.sort();
            runFile = path.join(runsDir, files[files.length - 1]);
          }
        }
      }
      if (!runFile) {
        res.writeHead(404);
        res.end('{"events":[],"runId":null}');
        return true;
      }
      const detectedRunId = isV2
        ? path.basename(path.dirname(runFile))
        : path.basename(runFile, '.jsonl');
      const lines = _readTailLines(runFile).slice(-100);
      const rawEvents = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
      // v1's stored events are already dashboard-native; v2's raw BusEvents
      // need the same translate()/companionEvents() pass the live view gets.
      const events = isV2
        ? rawEvents.flatMap((e) => [...companionEvents(e), translate(e)])
        : rawEvents;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(
        JSON.stringify({ runId: detectedRunId, events, active: ctx.activeOrgRuns.has(orgName) }),
      );
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/orgs/:name/history — per-run outcome summaries (history.jsonl, newest first)
  if (req.method === 'GET' && /^\/api\/orgs\/[^/]+\/history$/.test(url)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      const _histQs = new URL(req.url, 'http://localhost').searchParams;
      const root = path.resolve(_histQs.get('dir') || ctx.projectDir || process.cwd());
      if (!orgName || orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"error":"invalid org name"}');
        return true;
      }
      const monoDir = ctx._getGitMonomindDir(root) || path.join(root, '.monomind');
      const histFile = path.join(monoDir, 'orgs', orgName, 'history.jsonl');
      let runs = [];
      if (fs.existsSync(histFile)) {
        runs = _readTailLines(histFile)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean)
          .reverse()
          .slice(0, 50);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ runs }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/orgs/:name/memory — org knowledge-graph stats + glossary + rules
  if (req.method === 'GET' && /^\/api\/orgs\/[^/]+\/memory$/.test(url)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      const _memQs = new URL(req.url, 'http://localhost').searchParams;
      const root = path.resolve(_memQs.get('dir') || ctx.projectDir || process.cwd());
      if (!orgName || orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"error":"invalid org name"}');
        return true;
      }
      const monoDir = ctx._getGitMonomindDir(root) || path.join(root, '.monomind');
      const dbPath = path.join(monoDir, 'org-memory');
      if (!fs.existsSync(dbPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ nodes: 0, edges: 0, rules: 0, glossary: [], ruleTexts: [] }));
        return true;
      }
      const kg = await import('../memory/memory-kg.js');
      const [stats, glossary, ruleList] = await Promise.all([
        kg.kgStats({ dbPath }),
        kg.kgGlossary({ dbPath, limit: 12 }),
        kg.kgListRules({ dbPath, limit: 10 }),
      ]);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(
        JSON.stringify({
          ...stats,
          glossary,
          ruleTexts: ruleList.map((r) => r.rule.slice(0, 200)),
        }),
      );
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
