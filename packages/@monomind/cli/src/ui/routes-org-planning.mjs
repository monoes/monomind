import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './org-hil.mjs';
import { readBodyOrReply } from './routes-org-helpers.mjs';

// Org dashboard routes: budgets, routines and goals.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgPlanningRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/budgets — org and per-agent budget data
  // Returns: { org_budget: {limit_tokens}, agent_budgets: {agentId: {limit_usd, limit_tokens}}, agents: [{id, title, tokens_in, tokens_out, total_cost_usd}] }
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/budgets$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _budgetsQs = new URL(req.url, 'http://localhost').searchParams;
      const _budgetsRoot = path.resolve(_budgetsQs.get('dir') || ctx.projectDir || process.cwd());
      const base = path.join(_budgetsRoot, '.monomind', 'orgs');
      // #400: limits are the caps the org runtime enforces, read from the org
      // definition (roles[].budget_usd / budget_tokens, run_config.budget_tokens)
      // — not a side-car <org>-budgets.json that nothing enforces. There is no
      // org-wide USD cap, so org_budget.limit_usd is never set.
      const budgetData = { org_budget: {}, agent_budgets: {}, period: 'run', currency: 'USD' };
      try {
        const def = JSON.parse(fs.readFileSync(path.join(base, `${orgName}.json`), 'utf8'));
        budgetData.org_budget.limit_tokens = def.run_config?.budget_tokens ?? 1_000_000;
        for (const r of def.roles || []) {
          const limitUsd = r.policy?.maxUsd ?? r.budget_usd;
          const limitTokens = r.policy?.maxTokens ?? r.budget_tokens;
          if (limitUsd == null && limitTokens == null) continue;
          budgetData.agent_budgets[r.id] = {
            ...(limitUsd != null ? { limit_usd: limitUsd } : {}),
            ...(limitTokens != null ? { limit_tokens: limitTokens } : {}),
          };
        }
      } catch (_) {}
      // Enrich with per-agent spend from state file.
      // State file format: { agents: { "<role_id>": { tokens_in, tokens_out, ... } } }
      let agents = [];
      try {
        const state = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-state.json`), 'utf8'));
        const agentMap = state.agents || {};
        // Also load role titles from org config for enrichment
        const roleMap = {};
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(base, `${orgName}.json`), 'utf8'));
          (cfg.roles || []).forEach((r) => {
            roleMap[r.id] = r.title || r.id;
          });
        } catch (_) {}
        agents = Object.entries(agentMap).map(([id, s]) => ({
          id,
          title: roleMap[id] || s.title || id,
          tokens_in: s.tokens_in || 0,
          tokens_out: s.tokens_out || 0,
          tokens_used: s.tokens_used || (s.tokens_in || 0) + (s.tokens_out || 0),
          total_cost_usd: s.total_cost_usd ?? null,
        }));
      } catch (_) {}
      // Scan org run jsonl files for usage events (fallback when state.json has no token data).
      // Two event-type variants show up here in practice and must BOTH be matched, each with its
      // own field mapping — matching only one silently drops real v2 cost data from the UI:
      //  - 'agent:usage': flattened { role, tokens_in, tokens_out, cost_usd } (legacy/direct writers).
      //  - 'org:usage': orgrt's actual forwarded shape (attachForwarder's translate() default case
      //    for a raw OrgBus 'usage' event) — { from, data: { tokens, cost_usd } }. orgrt never emits
      //    'agent:usage' itself, so scanning for that alone means this fallback never fires for real runs.
      const _hasTokenData = agents.some(
        (a) => a.tokens_in > 0 || a.tokens_out > 0 || a.total_cost_usd > 0,
      );
      if (!_hasTokenData) {
        try {
          // The server writes run files under the git monomind dir in a git
          // project (server-mastermind-event.mjs), else under .monomind: read both.
          const _runsDirs = [path.join(base, orgName, 'runs')];
          const _gitMonoDir = ctx._getGitMonomindDir?.(_budgetsRoot);
          if (_gitMonoDir && _gitMonoDir !== path.join(_budgetsRoot, '.monomind'))
            _runsDirs.unshift(path.join(_gitMonoDir, 'orgs', orgName, 'runs'));
          const _seenRunFiles = new Set();
          if (_runsDirs.some((d) => fs.existsSync(d))) {
            const _usageByRole = {};
            const _bump = (role, tokensIn, tokensOut, tokensTotal, costUsd) => {
              if (!role) return;
              role = String(role).trim();
              if (!role) return;
              if (!_usageByRole[role])
                _usageByRole[role] = {
                  tokens_in: 0,
                  tokens_out: 0,
                  tokens_used: 0,
                  total_cost_usd: null, // null = no cost reported (unknown, rev 28)
                  cost_complete: true, // false = some usage event had no cost: a lower bound
                };
              _usageByRole[role].tokens_in += tokensIn;
              _usageByRole[role].tokens_out += tokensOut;
              _usageByRole[role].tokens_used += tokensIn + tokensOut + tokensTotal;
              if (costUsd !== null && costUsd !== undefined && Number.isFinite(Number(costUsd)))
                _usageByRole[role].total_cost_usd =
                  (_usageByRole[role].total_cost_usd ?? 0) + Number(costUsd);
              else _usageByRole[role].cost_complete = false;
            };
            for (const _runsDir of _runsDirs) {
              if (!fs.existsSync(_runsDir)) continue;
              for (const f of fs.readdirSync(_runsDir)) {
                if (!f.endsWith('.jsonl') || f.startsWith('._') || _seenRunFiles.has(f)) continue;
                _seenRunFiles.add(f);
                const lines = fs
                  .readFileSync(path.join(_runsDir, f), 'utf8')
                  .split('\n')
                  .filter(Boolean);
                for (const l of lines) {
                  try {
                    const ev = JSON.parse(l);
                    if (ev.type === 'agent:usage' && ev.role) {
                      _bump(
                        ev.role,
                        Number(ev.tokens_in) || 0,
                        Number(ev.tokens_out) || 0,
                        0,
                        ev.cost_usd ?? null,
                      );
                    } else if (ev.type === 'org:usage' && ev.from) {
                      _bump(ev.from, 0, 0, Number(ev.data?.tokens) || 0, ev.data?.cost_usd ?? null);
                    }
                  } catch (_) {}
                }
              }
            }
            if (Object.keys(_usageByRole).length > 0) {
              // Merge usage into agents list; preserve role titles
              agents = agents.map((a) => {
                const u = _usageByRole[a.id] || {};
                return {
                  ...a,
                  tokens_in: u.tokens_in || 0,
                  tokens_out: u.tokens_out || 0,
                  tokens_used: u.tokens_used || (u.tokens_in || 0) + (u.tokens_out || 0),
                  total_cost_usd: u.total_cost_usd ?? null,
                  cost_complete: u.cost_complete ?? true,
                };
              });
              // Add any roles that appeared in events but aren't in config
              for (const [role, u] of Object.entries(_usageByRole)) {
                if (!agents.find((a) => a.id === role))
                  agents.push({ id: role, title: role, ...u });
              }
            }
          }
        } catch (_) {}
      }
      // Do NOT fall back to zero-value role stubs — empty agents array is the honest signal
      // that no usage has been tracked yet; the UI shows "No cost data" rather than $0.0000 rows.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ...budgetData,
          agents,
          // true = at least one agent's cost_usd leaves out usage that reported none.
          cost_lower_bound: agents.some((a) => a.cost_complete === false),
        }),
      );
    } catch (_) {
      res.writeHead(500);
      res.end('{"org_budget":{},"agent_budgets":{},"agents":[]}');
    }
    return true;
  }

  // GET /api/org/:name/routines — read org routines (falls back to synthesizing from org config's loop object)
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/routines$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _routinesQs = new URL(req.url, 'http://localhost').searchParams;
      const _routinesBase = path.resolve(_routinesQs.get('dir') || ctx.projectDir || process.cwd());
      const _routinesProjDir = ctx._resolveOrgProjectDir(orgName, _routinesBase) || _routinesBase;
      const routinesFile = path.join(
        _routinesProjDir,
        '.monomind',
        'orgs',
        `${orgName}-routines.json`,
      );
      let data = { routines: [] };
      try {
        data = JSON.parse(fs.readFileSync(routinesFile, 'utf8'));
      } catch (_) {}
      // Synthesize routines from org config's loop/schedule settings when no explicit routines are defined
      if (!data.routines?.length) {
        try {
          const orgCfg = JSON.parse(
            fs.readFileSync(
              path.join(_routinesProjDir, '.monomind', 'orgs', `${orgName}.json`),
              'utf8',
            ),
          );
          const loop = orgCfg.loop;
          if (loop && (loop.poll_interval_minutes || loop.interval_minutes)) {
            const intervalMin = loop.poll_interval_minutes || loop.interval_minutes;
            data.routines = [
              {
                name: `${orgName}-cycle`,
                description: orgCfg.goal ? orgCfg.goal.slice(0, 120) : 'Org iteration cycle',
                schedule: `every ${intervalMin}m`,
                cron: null,
                enabled: orgCfg.status === 'active',
                status: orgCfg.status || 'stopped',
                prompt_file: loop.run_prompt_file || null,
                source: 'loop-config',
                lastRun: null,
              },
            ];
          } else if (orgCfg.schedule) {
            data.routines = [
              {
                name: `${orgName}-schedule`,
                description: orgCfg.goal ? orgCfg.goal.slice(0, 120) : 'Org scheduled run',
                schedule: String(orgCfg.schedule),
                cron: null,
                enabled: orgCfg.status === 'active',
                status: orgCfg.status || 'stopped',
                source: 'schedule-config',
                lastRun: null,
              },
            ];
          }
        } catch (_) {}
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ routines: data.routines || [] }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"routines":[]}');
    }
    return true;
  }

  // POST /api/org/:name/goals — upsert the org goals file
  // Body: { goals: [{id, title, description, status, priority, assignee_id, created_at}] }
  if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/goals$/i)) {
    const body = await readBodyOrReply(req, res, 2097152, corsOrigin);
    if (body === null) return true;
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const parsed = JSON.parse(body);
      if (!parsed || !Array.isArray(parsed.goals)) {
        res.writeHead(400);
        res.end('{"error":"goals array required"}');
        return true;
      }
      const _postGoalsQs = new URL(req.url, 'http://localhost').searchParams;
      const goalsFile = path.join(
        path.resolve(_postGoalsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
        `${orgName}-goals.json`,
      );
      const payload = { org: orgName, updated_at: new Date().toISOString(), goals: parsed.goals };
      writeFileAtomic(goalsFile, JSON.stringify(payload, null, 2));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, count: parsed.goals.length }));
    } catch (_) {
      res.writeHead(500);
      res.end(`{"error":"${String(_).replace(/"/g, '\\"')}"}`);
    }
    return true;
  }

  // POST /api/org/:name/routines — upsert the org routines file
  // Body: { routines: [{name, description, schedule, enabled, last_run, next_run}] }
  if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/routines$/i)) {
    const body = await readBodyOrReply(req, res, 2097152, corsOrigin);
    if (body === null) return true;
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const parsed = JSON.parse(body);
      if (!parsed || !Array.isArray(parsed.routines)) {
        res.writeHead(400);
        res.end('{"error":"routines array required"}');
        return true;
      }
      const _postRoutinesQs = new URL(req.url, 'http://localhost').searchParams;
      const routinesFile = path.join(
        path.resolve(_postRoutinesQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
        `${orgName}-routines.json`,
      );
      const payload = {
        org: orgName,
        updated_at: new Date().toISOString(),
        routines: parsed.routines,
      };
      writeFileAtomic(routinesFile, JSON.stringify(payload, null, 2));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, count: parsed.routines.length }));
    } catch (_) {
      res.writeHead(500);
      res.end(`{"error":"${String(_).replace(/"/g, '\\"')}"}`);
    }
    return true;
  }
  return false;
}
