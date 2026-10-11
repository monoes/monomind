import fs from 'node:fs';
import path from 'node:path';
import * as orgRuntime from './org-runtime.mjs';
import { approvalsOrEmpty, hilRespond, hilRoot, readHilBody } from './routes-org-helpers.mjs';
import { _readTailLines } from './server-fileutils.mjs';

// Org dashboard routes: search, health, plugins, runtime, live config and agent stats.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgStatusRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/search?q=<query> — fuzzy search across org data
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/search(\?.*)?$/i.test(url)) {
    try {
      const urlObj = new URL(`http://x${req.url}`);
      const orgName = decodeURIComponent(urlObj.pathname.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const q = (urlObj.searchParams.get('q') || '').toLowerCase().trim();
      if (!q || q.length < 2) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end('{"hits":[]}');
        return true;
      }

      const d = path.resolve(urlObj.searchParams.get('dir') || ctx.projectDir || process.cwd());
      const orgsDir = path.join(d, '.monomind', 'orgs');
      const readJ = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };

      const hits = [];
      const match = (str) => str?.toLowerCase().includes(q);

      // Agents
      const config = readJ(path.join(orgsDir, `${orgName}.json`));
      for (const role of config?.roles || []) {
        if (
          match(role.id) ||
          match(role.title) ||
          (role.responsibilities || []).some((r) => match(r))
        ) {
          hits.push({ type: 'agent', id: role.id, title: role.title, meta: role.agent_type });
        }
      }

      // Goals
      const goals = readJ(path.join(orgsDir, `${orgName}-goals.json`));
      for (const g of goals?.goals || []) {
        if (match(g.title) || match(g.text) || match(g.goal) || match(g.description)) {
          hits.push({
            type: 'goal',
            id: g.id,
            title: g.title || g.text || g.goal,
            meta: g.status || 'open',
          });
        }
      }

      // Routines
      const routines = readJ(path.join(orgsDir, `${orgName}-routines.json`));
      for (const r of routines?.routines || []) {
        if (match(r.name) || match(r.description)) {
          hits.push({ type: 'routine', id: r.name, title: r.name, meta: r.schedule || '' });
        }
      }

      // Approvals
      for (const a of approvalsOrEmpty(orgsDir, orgName)) {
        if (match(a.action) || match(a.roleId)) {
          hits.push({
            type: 'approval',
            id: a.id,
            title: `${a.roleId}: ${a.action}`,
            meta: a.status,
          });
        }
      }

      // Projects
      const projects = readJ(path.join(orgsDir, `${orgName}-projects.json`));
      for (const p of projects?.projects || []) {
        if (match(p.name) || match(p.description)) {
          hits.push({
            type: 'project',
            id: p.id || p.name,
            title: p.name,
            meta: p.status || 'active',
          });
        }
      }

      // Issues
      const issuesData = readJ(path.join(orgsDir, `${orgName}-issues.json`));
      for (const i of issuesData?.issues || []) {
        if (match(i.title) || match(i.description) || match(i.slug)) {
          hits.push({
            type: 'issue',
            id: i.id || i.slug,
            title: i.title || i.slug,
            meta: i.status || 'open',
          });
        }
      }

      // Recent activity events
      const eventsFile = path.join(d, 'data', 'mastermind-events.jsonl');
      if (fs.existsSync(eventsFile)) {
        const lines = _readTailLines(eventsFile).slice(-500);
        for (const l of lines) {
          try {
            const e = JSON.parse(l);
            if (e.org === orgName && match(JSON.stringify(e))) {
              hits.push({
                type: 'event',
                id: String(e.ts),
                title: e.type,
                meta: e.role || e.task || '',
              });
              if (hits.length >= 50) break;
            }
          } catch (_) {}
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ q, hits: hits.slice(0, 50) }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/health — aggregate org health, from the same runtime
  // sources as /runtime: live role sessions, the task DAG, this run's usage on
  // the budget's enforcement basis, and how the last 7 days of runs ended.
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/health$/i)) {
    const orgName = decodeURIComponent(url.split('/')[3]);
    return hilRespond(res, corsOrigin, async () => {
      const v = await orgRuntime.runtimeView(hilRoot(req, ctx), orgName);
      if (!v) throw Object.assign(new Error(`org "${orgName}" has no definition`), { status: 404 });
      const running = v.roles.filter((r) => r.status === 'running').length;
      const openTasks = v.tasks.filter((t) =>
        ['pending', 'ready', 'blocked'].includes(t.status),
      ).length;
      const activeTasks = v.tasks.filter((t) => t.status === 'running').length;
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      // A resumed run keeps its run id and appends a history line per stop:
      // count each run once, by its latest line (history is newest first).
      const seenRuns = new Set();
      const week = v.history.filter(
        (h) => (h.endedAt || 0) >= weekAgo && !seenRuns.has(h.run) && seenRuns.add(h.run),
      );
      // Only a boss's gate-checked org_complete with 'achieved' counts as success.
      const achieved = week.filter(
        (h) => h.closedBy === 'org-complete' && h.outcome?.status === 'achieved',
      ).length;
      const { used, tokens } = v.budget;
      return {
        agents_running: running,
        agents_idle: v.roles.length - running,
        agents_active: running,
        open_issues: openTasks,
        in_progress_issues: activeTasks,
        tasks_pending: openTasks + activeTasks,
        budget_used_tokens: used,
        budget_max_tokens: tokens,
        budget_basis: v.budget.basis,
        budget_used_pct: tokens && used !== null ? Math.round((used / tokens) * 100) : null,
        run_success_rate_7d: week.length ? Math.round((achieved / week.length) * 100) : null,
        total_runs_7d: week.length,
        errors: [...v.problems, ...(v.liveError ? [`daemon: ${v.liveError}`] : [])],
      };
    });
  }

  // GET /api/org/:name/plugins — plugins from registry filtered/merged with org overrides
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/plugins$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _pluginsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_pluginsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
      );
      let plugins = [];
      try {
        const reg = JSON.parse(
          fs.readFileSync(path.join(base, 'plugins', 'registry.json'), 'utf8'),
        );
        plugins = reg.plugins || [];
        // Strip sensitive config fields from output
        plugins = plugins.map((p) => {
          const safe = { ...p };
          if (safe.config) {
            safe.config = Object.fromEntries(
              Object.entries(safe.config).map(([k, v]) =>
                /key|token|secret|password|api/i.test(k) ? [k, '***'] : [k, v],
              ),
            );
          }
          return safe;
        });
      } catch (_) {
        /* no global registry */
      }
      // Merge org-level overrides
      try {
        const orgPlugins = JSON.parse(
          fs.readFileSync(path.join(base, 'orgs', `${orgName}-plugins.json`), 'utf8'),
        );
        const overrideMap = {};
        (orgPlugins.plugins || []).forEach((p) => {
          overrideMap[p.id] = p;
        });
        if (Object.keys(overrideMap).length) {
          plugins = plugins.map((p) =>
            overrideMap[p.id] ? { ...p, ...overrideMap[p.id], _orgOverride: true } : p,
          );
        }
      } catch (_) {
        /* no org-level overrides */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plugins }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/runtime — what the org is doing now, from the runtime's
  // own sources (live daemon status, run bus, idle watchdog, history).
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runtime$/i)) {
    const orgName = decodeURIComponent(url.split('/')[3]);
    return hilRespond(res, corsOrigin, async () => {
      const view = await orgRuntime.runtimeView(hilRoot(req, ctx), orgName);
      if (!view)
        throw Object.assign(new Error(`org "${orgName}" has no definition`), { status: 404 });
      return view;
    });
  }

  // POST /api/org/:name/config — edit the org definition's goal, schedule,
  // run_config and default cost tier; refused unless the result passes the
  // same OrgDefSchema parse `org run` does.
  if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/config$/i)) {
    const orgName = decodeURIComponent(url.split('/')[3]);
    const root = hilRoot(req, ctx);
    return hilRespond(res, corsOrigin, async () => {
      const body = await readHilBody(req);
      if (!body || typeof body !== 'object')
        throw Object.assign(new Error('JSON body required'), { status: 400 });
      try {
        const def = orgRuntime.patchOrgConfig(root, orgName, body);
        return {
          ok: true,
          def,
          warnings: orgRuntime.orgChecklist(def).warnings,
          signature: orgRuntime.orgSignatureState(root, orgName),
        };
      } catch (err) {
        if (err instanceof orgRuntime.ConfigRejected)
          throw Object.assign(new Error(err.message), { status: 400 });
        throw err;
      }
    });
  }

  // GET /api/org/:name/agents — agents from roles + merged heartbeat state
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agents$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _agentsQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_agentsQs.get('dir') || ctx.projectDir || process.cwd());
      const base = path.join(d, '.monomind', 'orgs');
      const readJsonSafe = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      const config = readJsonSafe(path.join(base, `${orgName}.json`)) || {};
      const stateData = readJsonSafe(path.join(base, `${orgName}-state.json`)) || {};
      const agentState =
        stateData.agents || stateData.roles
          ? stateData.agents || Object.fromEntries((stateData.roles || []).map((r) => [r.id, r]))
          : {};
      const roles = config.roles || [];
      const agents = roles.map((r) => {
        const s = agentState[r.id] || {};
        // Runtime and model the role actually runs with (cost tiers included).
        const m = orgRuntime.describeRoleModel(r, config);
        return {
          id: r.id,
          title: r.title || r.id,
          adapterType: m.runtime,
          adapterModel: m.model,
          effort: m.effort,
          tier: m.tier,
          governance: r.governance || null,
          reportsTo: r.reports_to || null,
          status: s.status || 'idle',
          lastHeartbeat: s.last_heartbeat || s.lastHeartbeat || null,
          tokensIn: s.tokens_in || 0,
          tokensOut: s.tokens_out || 0,
          cacheRead: s.cache_read_tokens || 0,
          cacheCreation: s.cache_creation_tokens || 0,
          tokensUsed: s.tokens_used || 0,
          costUsd: s.total_cost_usd ?? null, // null = unknown (no reported cost)
        };
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ agents }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"agents":[]}');
    }
    return true;
  }
  return false;
}
