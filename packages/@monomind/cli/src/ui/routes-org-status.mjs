import fs from 'node:fs';
import path from 'node:path';
import * as orgRuntime from './org-runtime.mjs';
import { hilRespond, hilRoot, readHilBody } from './routes-org-helpers.mjs';

// Org dashboard routes: health, runtime, live config and agent stats.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgStatusRoutes(req, res, url, corsOrigin, ctx) {
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
