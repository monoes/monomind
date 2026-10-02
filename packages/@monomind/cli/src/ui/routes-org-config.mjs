import fs from 'node:fs';
import path from 'node:path';
import { checklistErrorsForRaw } from '../orgrt/validate-checklist.js';
import { approvalsOrEmpty } from './routes-org-helpers.mjs';

// Org dashboard routes: org list, import, create, config and activity.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgConfigRoutes(req, res, url, corsOrigin, ctx) {
  // ------------------------------------------------- Org management
  // GET /api/orgs — list all saved org configs
  if (req.method === 'GET' && url === '/api/orgs') {
    try {
      const _orgsQs = new URL(req.url, 'http://localhost').searchParams;
      const _orgsExplicitDir = _orgsQs.get('dir');
      const _orgsServerRoot = path.resolve(_orgsExplicitDir || ctx.projectDir || process.cwd());
      // Collect project dirs to search: explicit dir + known-projects (like sessions API)
      const _orgsProjDirs = new Set([_orgsServerRoot]);
      if (!_orgsExplicitDir) {
        try {
          const _knownOrgsFile = path.join(_orgsServerRoot, 'data', 'known-projects.json');
          if (fs.existsSync(_knownOrgsFile)) {
            JSON.parse(fs.readFileSync(_knownOrgsFile, 'utf8')).forEach((p) =>
              _orgsProjDirs.add(p),
            );
          }
        } catch (_) {}
      }
      const _sidecarSuffixRe =
        /-(approvals|state|activity|goals|routines|projects|members|issues|workspaces|worktrees|environments|plugins|adapters|bootstrap|threads|budgets|project-workspaces|approval-comments|secrets|join-requests|skills)\.json$/;
      const _orgsSeen = new Set();
      const orgs = [];
      for (const _opd of _orgsProjDirs) {
        const orgsDir = path.join(_opd, '.monomind', 'orgs');
        if (!fs.existsSync(orgsDir)) continue;
        const files = fs
          .readdirSync(orgsDir)
          .filter((f) => f.endsWith('.json') && !_sidecarSuffixRe.test(f));
        for (const f of files) {
          try {
            const cfg = JSON.parse(fs.readFileSync(path.join(orgsDir, f), 'utf8'));
            const _lOrgName = cfg.name || '';
            if (!_lOrgName || _orgsSeen.has(_lOrgName)) continue;
            _orgsSeen.add(_lOrgName);
            const _rs = ctx._readRunState(_lOrgName, _opd);
            const _ttl = Math.max((_rs?.checkpointInterval || 600000) * 2, 7200000);
            const running =
              (_rs?.status === 'running' && Date.now() - (_rs?.lastEventAt || 0) < _ttl) ||
              ctx.activeOrgRuns.has(_lOrgName);
            orgs.push({
              name: cfg.name,
              goal: cfg.goal,
              roles: Array.isArray(cfg.roles) ? cfg.roles : [],
              topology: cfg.topology,
              created_at: cfg.created_at,
              running,
              status: cfg.status,
              projectDir: _opd,
              lastEventAt: _rs?.lastEventAt || null,
              loop: cfg.loop
                ? {
                    poll_interval_minutes: cfg.loop.poll_interval_minutes,
                    last_run: cfg.loop.last_run,
                    next_run: cfg.loop.next_run,
                  }
                : undefined,
            });
          } catch (_) {}
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(orgs));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }

  // POST /api/orgs/:name/import — import an org config by name (orgs.html upload flow)
  if (req.method === 'POST' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/import$/i.test(url)) {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const urlParts = url.split('/');
        const orgName = decodeURIComponent(urlParts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid org name' }));
          return;
        }
        const cfg = JSON.parse(body);
        // Org sections spec 7.3: a deferred feature is refused, not saved.
        const checklistErrors = checklistErrorsForRaw({ ...cfg, name: orgName });
        if (checklistErrors.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: checklistErrors.join('; ') }));
          return;
        }
        const _importQs = new URL(req.url, 'http://localhost').searchParams;
        const dir = path.resolve(_importQs.get('dir') || ctx.projectDir || process.cwd());
        const orgsDir = path.join(dir, '.monomind', 'orgs');
        fs.mkdirSync(orgsDir, { recursive: true });
        const destFile = path.join(orgsDir, `${orgName}.json`);
        fs.writeFileSync(destFile, JSON.stringify({ ...cfg, name: orgName }, null, 2), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, name: orgName, file: destFile }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/orgs — import / create org from JSON body
  if (req.method === 'POST' && url === '/api/orgs') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || cfg.dir || ctx.projectDir || process.cwd();
        const name = (cfg.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64);
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid org name' }));
          return;
        }
        const orgsDir = path.join(path.resolve(dir), '.monomind', 'orgs');
        fs.mkdirSync(orgsDir, { recursive: true });
        const destFile = path.join(orgsDir, `${name}.json`);
        const cleanCfg = Object.fromEntries(
          Object.entries({ ...cfg, name }).filter(([k]) => !k.startsWith('_')),
        );
        const checklistErrors = checklistErrorsForRaw(cleanCfg);
        if (checklistErrors.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: checklistErrors.join('; ') }));
          return;
        }
        fs.writeFileSync(destFile, JSON.stringify(cleanCfg, null, 2), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, name, file: destFile }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // GET /api/orgs/:name — get specific org config (exact path: /api/orgs/<slug>)
  if (req.method === 'GET' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
    try {
      const orgName = decodeURIComponent(url.slice('/api/orgs/'.length));
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _orgsOneQs = new URL(req.url, 'http://localhost').searchParams;
      const _orgsOneRoot = path.resolve(_orgsOneQs.get('dir') || ctx.projectDir || process.cwd());
      const _orgsOneProjDir = ctx._resolveOrgProjectDir(orgName, _orgsOneRoot) || _orgsOneRoot;
      const f = path.join(_orgsOneProjDir, '.monomind', 'orgs', `${orgName}.json`);
      if (!fs.existsSync(f)) {
        res.writeHead(404);
        res.end('{"error":"not found"}');
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(fs.readFileSync(f, 'utf8'));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name — ORG ROOM: rich org data (config + state + tasks + routines + goals)
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
    try {
      const orgName = decodeURIComponent(url.slice('/api/org/'.length));
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _orgQs = new URL(req.url, 'http://localhost').searchParams;
      const _orgServerRoot = path.resolve(_orgQs.get('dir') || ctx.projectDir || process.cwd());
      // Resolve which project dir actually has this org's config
      const d = ctx._resolveOrgProjectDir(orgName, _orgServerRoot) || _orgServerRoot;
      const orgsDir = path.join(d, '.monomind', 'orgs');

      const readJsonSafe = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };

      const configFile = path.join(orgsDir, `${orgName}.json`);
      if (!fs.existsSync(configFile)) {
        res.writeHead(404);
        res.end('{"error":"org not found"}');
        return true;
      }
      const config = readJsonSafe(configFile);

      const state = readJsonSafe(path.join(orgsDir, `${orgName}-state.json`)) || { agents: {} };
      const goalsData = readJsonSafe(path.join(orgsDir, `${orgName}-goals.json`)) || { goals: [] };
      const routinesData = readJsonSafe(path.join(orgsDir, `${orgName}-routines.json`)) || {
        routines: [],
      };
      const approvalsData = { approvals: approvalsOrEmpty(orgsDir, orgName) };

      // Check running status: stop file absence AND (in-memory ctx.activeOrgRuns OR state-file agents OR active loop file)
      // Path must match what `org run`'s poll loop and `org serve`'s pollStopfiles()
      // actually watch (.monomind/orgs/<name>/stop) — see the POST .../stop handler below.
      const stopFile = path.join(orgsDir, orgName, 'stop');
      const _loopsDir = path.join(d, '.monomind', 'loops');
      const _loopRunning = (() => {
        try {
          if (!fs.existsSync(_loopsDir)) return false;
          // Get the org's state file mtime to correlate with loop activity
          const orgStateMtime = (() => {
            try {
              return fs.statSync(path.join(orgsDir, `${orgName}-state.json`)).mtimeMs;
            } catch {
              return 0;
            }
          })();
          // Also check org's most recent run file mtime
          const orgRunsDir = path.join(
            ctx._getGitMonomindDir(d) || path.join(d, '.monomind'),
            'orgs',
            orgName,
            'runs',
          );
          const orgLastRunMtime = (() => {
            try {
              if (!fs.existsSync(orgRunsDir)) return 0;
              const runFiles = fs
                .readdirSync(orgRunsDir)
                .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
              if (!runFiles.length) return 0;
              return Math.max(
                ...runFiles.map((f) => {
                  try {
                    return fs.statSync(path.join(orgRunsDir, f)).mtimeMs;
                  } catch {
                    return 0;
                  }
                }),
              );
            } catch {
              return 0;
            }
          })();
          const orgLastActivity = Math.max(orgStateMtime, orgLastRunMtime);
          return fs.readdirSync(_loopsDir).some((f) => {
            if (!f.endsWith('.json') || f.endsWith('.stop')) return false;
            try {
              const lp = JSON.parse(fs.readFileSync(path.join(_loopsDir, f), 'utf8'));
              if (!lp.command?.includes('runorg')) return false;
              if (!['running', 'paused'].includes(lp.status)) return false;
              // Primary match: explicit orgName field (written by runorg command since v1.14.2)
              if (lp.orgName === orgName) return true;
              // Fallback: org name in prompt (early loop files that preserved --org flag)
              if ((lp.prompt || '').includes(orgName)) return true;
              // Heuristic: if loop's lastRunAt is within 3x wait interval of org's last activity
              const waitMs = (lp.wait || 60) * 3 * 1000;
              return (
                orgLastActivity > 0 && Math.abs(orgLastActivity - (lp.lastRunAt || 0)) < waitMs
              );
            } catch {
              return false;
            }
          });
        } catch {
          return false;
        }
      })();
      const _runstateData = ctx._readRunState(orgName, d);
      const _runstateTtl = Math.max((_runstateData?.checkpointInterval || 600000) * 2, 7200000);
      const _runstateAlive =
        _runstateData?.status === 'running' &&
        Date.now() - (_runstateData?.lastEventAt || 0) < _runstateTtl;
      const running =
        !fs.existsSync(stopFile) &&
        (_runstateAlive || ctx.activeOrgRuns.has(orgName) || _loopRunning);

      // Read real tasks from the task store and group by status column
      const taskStoreData = readJsonSafe(path.join(d, '.monomind', 'tasks', 'store.json'));
      const allTasks = taskStoreData ? Object.values(taskStoreData.tasks || {}) : [];
      const tasks = {
        todo: allTasks
          .filter((t) => t.status === 'pending')
          .map((t) => ({
            id: t.taskId,
            description: t.description,
            status: 'todo',
            ts: t.createdAt,
          })),
        doing: allTasks
          .filter((t) => t.status === 'in_progress')
          .map((t) => ({
            id: t.taskId,
            description: t.description,
            status: 'doing',
            ts: t.startedAt || t.createdAt,
          })),
        done: allTasks
          .filter(
            (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
          )
          .map((t) => ({
            id: t.taskId,
            description: t.description,
            status: t.status,
            ts: t.completedAt || t.createdAt,
          })),
      };

      const result = {
        config,
        state,
        goals: goalsData.goals,
        routines: routinesData.routines,
        approvals: approvalsData.approvals,
        running,
        tasks,
        runId: _runstateData?.runId || null,
        lastEventAt: _runstateData?.lastEventAt || null,
        agentStates: _runstateData?.agentStates || {},
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(result));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/activity — recent org events from mastermind-events.jsonl
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/activity$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('[]');
        return true;
      }
      const _actQs = new URL(req.url, 'http://localhost').searchParams;
      const _actServerRoot = path.resolve(_actQs.get('dir') || ctx.projectDir || process.cwd());
      const d = ctx._resolveOrgProjectDir(orgName, _actServerRoot) || _actServerRoot;
      const orgsDir = path.join(d, '.monomind', 'orgs');
      const readJ = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      const events = [];

      // 1) Global mastermind events that EXPLICITLY belong to this org (strict — no untagged leak)
      const eventsFile = path.join(d, 'data', 'mastermind-events.jsonl');
      if (fs.existsSync(eventsFile)) {
        const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
        for (const l of lines.slice(-1000)) {
          try {
            const e = JSON.parse(l);
            if (e && e.org === orgName) events.push(e);
          } catch (_) {}
        }
      }

      // 2) Synthesize an org-scoped timeline from this org's own records (real data, distinct per org)
      const cfg = readJ(path.join(orgsDir, `${orgName}.json`));
      if (cfg) {
        const createdMs = cfg.created_at ? Date.parse(cfg.created_at) : null;
        if (createdMs)
          events.push({
            type: 'org:create',
            ts: createdMs,
            msg: String(cfg.goal || 'Org created').slice(0, 80),
          });
        // Roles are defined atomically at org creation — there is no per-role
        // timestamp in the config, so every role:defined event uses the org's
        // real created_at instead of a fabricated per-index offset.
        (cfg.roles || []).forEach((r) => {
          events.push({
            type: 'role:defined',
            ts: createdMs,
            role: r.title || r.id,
            msg: r.agent_type || '',
          });
        });
      }
      const goals = readJ(path.join(orgsDir, `${orgName}-goals.json`));
      (goals?.goals || []).forEach((g) =>
        events.push({
          type: 'goal',
          ts: Date.parse(g.created_at || g.updated_at || '') || null,
          role: g.status || '',
          msg: String(g.text || g.title || g.goal || '').slice(0, 80),
        }),
      );
      approvalsOrEmpty(orgsDir, orgName).forEach((a) => {
        events.push({
          type: 'approval',
          ts: a.ts,
          role: a.roleId || '',
          msg: `${a.action} — ${a.status}`.slice(0, 80),
        });
      });
      const state = readJ(path.join(orgsDir, `${orgName}-state.json`));
      if (state?.agents) {
        for (const [aid, a] of Object.entries(state.agents)) {
          const raw = a.lastHeartbeat || a.last_seen || a.updated_at || null;
          const ts = typeof raw === 'number' ? raw : raw ? Date.parse(raw) : null;
          events.push({ type: 'org:heartbeat', ts, agent: aid, msg: a.status || '' });
        }
      }

      const out = events
        .filter((e) => e?.ts)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 100);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(out));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }
  return false;
}
