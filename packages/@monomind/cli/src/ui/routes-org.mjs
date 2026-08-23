import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMmClientCount } from './sse-manager.mjs';

export async function handleOrgRoutes(req, res, url, corsOrigin, ctx) {
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
      const approvalsData = readJsonSafe(path.join(orgsDir, `${orgName}-approvals.json`)) || {
        approvals: [],
      };

      // Check running status: stop file absence AND (in-memory ctx.activeOrgRuns OR state-file agents OR active loop file)
      const stopFile = path.join(orgsDir, '.stops', `${orgName}.stop`);
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
      const appr = readJ(path.join(orgsDir, `${orgName}-approvals.json`));
      (appr?.approvals || []).forEach((a) => {
        const ts = typeof a.ts === 'number' ? a.ts : Date.parse(a.created_at || a.ts || '') || null;
        events.push({
          type: 'approval',
          ts,
          role: a.agent_id || a.requester || '',
          msg: String(a.title || a.action || '').slice(0, 80),
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

  // GET /api/org/:name/projects — org projects from projects json file
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/projects$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('[]');
        return true;
      }
      const _projsQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_projsQs.get('dir') || ctx.projectDir || process.cwd());
      const projFile = path.join(d, '.monomind', 'orgs', `${orgName}-projects.json`);
      if (!fs.existsSync(projFile)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end('[]');
        return true;
      }
      const data = JSON.parse(fs.readFileSync(projFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(data.projects || []));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }

  // GET /api/org/:name/members — org member list and join requests
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/members$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _membersQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_membersQs.get('dir') || ctx.projectDir || process.cwd());
      const membersFile = path.join(d, '.monomind', 'orgs', `${orgName}-members.json`);
      if (!fs.existsSync(membersFile)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end('{"members":[],"join_requests":[]}');
        return true;
      }
      const data = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(data));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/adapters — org adapter registry
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/adapters$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _adaptersQs = new URL(req.url, 'http://localhost').searchParams;
      const _adaptersRoot = path.resolve(_adaptersQs.get('dir') || ctx.projectDir || process.cwd());
      const d = ctx._resolveOrgProjectDir(orgName, _adaptersRoot) || _adaptersRoot;
      const adaptersFile = path.join(d, '.monomind', 'orgs', `${orgName}-adapters.json`);
      if (!fs.existsSync(adaptersFile)) {
        // Return defaults derived from org config if available
        const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
        let defaultAdapter = 'claude-sonnet-4-6';
        try {
          defaultAdapter =
            JSON.parse(fs.readFileSync(orgFile, 'utf8'))?.run_config?.ceo_adapter || defaultAdapter;
        } catch (_) {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        // This list mirrors the runtimes orgrt/daemon.ts actually registers
        // (resolveRunner()'s if-chain + the ClaudeAgentRunner default it falls
        // through to) rather than an independent, hand-maintained catalog — a
        // standalone 'gemini-local' entry used to be advertised here even
        // though no runner is ever registered for it (autoRuntimeFromProvider
        // has no 'gemini' case, so a role requesting it silently falls back to
        // Claude — see daemon.ts#startOrg's fail-fast warning). Gemini is only
        // actually reachable via the 'vercel' runtime (vendor: 'google') or via
        // 'antigravity' (Google-account CLI), both listed below. 'http' maps to
        // provider.kind === 'base-url' (ANTHROPIC_BASE_URL + optional auth
        // token) — a real, usable path, not disabled.
        res.end(
          JSON.stringify({
            default_adapter: defaultAdapter,
            adapters: [
              {
                type: 'claude-local',
                label: 'Claude (local CLI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 3,
              },
              {
                type: 'codex-local',
                label: 'Codex CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'antigravity',
                label: 'Antigravity (Google CLI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'grok',
                label: 'Grok CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'qwen',
                label: 'Qwen CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'crush',
                label: 'Crush CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'copilot',
                label: 'GitHub Copilot CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              { type: 'pi', label: 'Pi CLI', source: 'built-in', disabled: false, modelsCount: 1 },
              {
                type: 'opencode',
                label: 'OpenCode CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'kimicode',
                label: 'KimiCode CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'vercel',
                label: 'Vercel AI SDK (multi-vendor, incl. Gemini/OpenAI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 14,
              },
              {
                type: 'http',
                label: 'Custom HTTP (base-url provider)',
                source: 'built-in',
                disabled: false,
                modelsCount: 0,
              },
            ],
          }),
        );
        return true;
      }
      const data = JSON.parse(fs.readFileSync(adaptersFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(data));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/skills — list skills from .claude/skills/ mapped to org roles
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/skills$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _skillsQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_skillsQs.get('dir') || ctx.projectDir || process.cwd());
      const skillsDir = path.join(d, '.claude', 'skills');
      const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);

      // Scan skills directory
      const skills = [];
      if (fs.existsSync(skillsDir)) {
        const scanDir = (dir, prefix) => {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                scanDir(path.join(dir, entry.name), `${entry.name}:`);
              } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
                const slug = entry.name.replace(/\.md$/, '');
                const content = fs.readFileSync(path.join(dir, entry.name), 'utf8').slice(0, 500);
                const typeMatch = content.match(/^type:\s*(.+)$/m);
                const modeMatch = content.match(/^default_mode:\s*(.+)$/m);
                const descMatch = content.match(/^description:\s*(.+)$/m);
                skills.push({
                  name: `${prefix}${slug}`,
                  slug,
                  type: typeMatch ? typeMatch[1].trim() : 'skill',
                  default_mode: modeMatch ? modeMatch[1].trim() : 'auto',
                  description: descMatch ? descMatch[1].trim() : '',
                });
              }
            }
          } catch (_) {}
        };
        scanDir(skillsDir, '');
      }

      // Map skills enabled per role from org config
      const roleSkillMap = {};
      if (fs.existsSync(orgFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
          for (const role of config.roles || []) {
            roleSkillMap[role.id] = role.skills || [];
          }
        } catch (_) {}
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ skills, role_skill_map: roleSkillMap }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/agent/:roleId — full agent detail: org role + .claude/agents definition
  //   (characteristics, skills/expertise, responsibilities, instructions document)
  if (
    req.method === 'GET' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)
  ) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const roleId = decodeURIComponent(parts[5]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      if (roleId.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(roleId)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _agentQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_agentQs.get('dir') || ctx.projectDir || process.cwd());
      const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
      if (!fs.existsSync(orgFile)) {
        res.writeHead(404);
        res.end('{}');
        return true;
      }
      const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
      const role = (config.roles || []).find((r) => r.id === roleId);
      if (!role) {
        res.writeHead(404);
        res.end('{}');
        return true;
      }

      const agentType = String(role.agent_type || role.type || '').toLowerCase();
      const wanted = [agentType, String(role.id).toLowerCase()].filter(Boolean);

      // Find a matching agent definition under .claude/agents (recursive); match frontmatter name then filename.
      const agentsDir = path.join(d, '.claude', 'agents');
      let definition = { found: false };
      if (wanted.length && fs.existsSync(agentsDir)) {
        const stack = [agentsDir];
        let nameMatch = null,
          slugMatch = null;
        while (stack.length && !nameMatch) {
          const dir = stack.pop();
          let entries = [];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch (_) {
            continue;
          }
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              stack.push(full);
              continue;
            }
            if (!e.name.endsWith('.md') || e.name.startsWith('_')) continue;
            const slug = e.name.replace(/\.md$/, '').toLowerCase();
            let raw = '';
            try {
              raw = fs.readFileSync(full, 'utf8');
            } catch (_) {
              continue;
            }
            const fmName = ((raw.match(/^name:\s*(.+)$/m) || [])[1] || '').trim().toLowerCase();
            if (fmName && wanted.includes(fmName)) {
              nameMatch = { full, raw };
              break;
            }
            if (!slugMatch && wanted.includes(slug)) slugMatch = { full, raw };
          }
        }
        const match = nameMatch || slugMatch;
        if (match) {
          definition = ctx.parseAgentDef(match.raw);
          definition.found = true;
          definition.file = path.relative(d, match.full);
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ role, definition }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/org/:name/agent/:roleId/avatar — set (or clear) a custom avatar for one
  // role, stored inline as a data URL on the role itself so it travels with the org
  // config export/import. Body: { avatarDataUrl } — null/omitted avatarDataUrl clears
  // the custom avatar and reverts to the built-in library picture. `dir` (like every
  // other dir-accepting route in this file, POST included — see /goals above) comes
  // from the query string, not the body.
  if (
    req.method === 'POST' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}\/avatar$/i.test(url)
  ) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8388608) {
        req.destroy();
        break;
      }
    }
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const roleId = decodeURIComponent(parts[5]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid org name"}');
        return true;
      }
      if (roleId.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(roleId)) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid role id"}');
        return true;
      }
      const parsed = JSON.parse(body);
      const avatarDataUrl = parsed.avatarDataUrl;
      if (
        avatarDataUrl != null &&
        (typeof avatarDataUrl !== 'string' ||
          avatarDataUrl.length > 2_000_000 ||
          !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatarDataUrl))
      ) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid or oversized avatarDataUrl"}');
        return true;
      }
      const _avatarQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_avatarQs.get('dir') || ctx.projectDir || process.cwd());
      const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
      if (!fs.existsSync(orgFile)) {
        res.writeHead(404);
        res.end('{"ok":false,"error":"org not found"}');
        return true;
      }
      const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
      const role = (config.roles || []).find((r) => r.id === roleId);
      if (!role) {
        res.writeHead(404);
        res.end('{"ok":false,"error":"role not found"}');
        return true;
      }
      if (avatarDataUrl) role.avatar = avatarDataUrl;
      else delete role.avatar;
      const tmp = `${orgFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
      fs.renameSync(tmp, orgFile);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return true;
  }

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
      const approvals = readJ(path.join(orgsDir, `${orgName}-approvals.json`));
      for (const a of approvals?.approvals || []) {
        if (match(a.title) || match(a.action) || match(a.agent_id)) {
          hits.push({ type: 'approval', id: a.id, title: a.title, meta: a.status });
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
        const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).slice(-500);
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

  // GET /api/org/:name/issues — org task/issue list from issues file
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/issues$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _issuesQs = new URL(req.url, 'http://localhost').searchParams;
      const _issuesDir = path.resolve(_issuesQs.get('dir') || ctx.projectDir || process.cwd());
      const issuesPath = path.join(_issuesDir, '.monomind', 'orgs', `${orgName}-issues.json`);
      const payload = { issues: [] };
      try {
        const raw = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
        payload.issues = (raw.issues || []).map((i) => ({
          id: i.id,
          slug: i.slug,
          title: i.title,
          description: i.description || null,
          status: i.status || 'open',
          priority: i.priority || 'medium',
          assignee_id: i.assignee_id || null,
          assignee: i.assignee || i.assignee_id || null,
          project_id: i.project_id || null,
          parent_id: i.parent_id || null,
          created_at: i.created_at,
          updated_at: i.updated_at,
        }));
      } catch (_) {
        /* file missing is fine */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/health — aggregate org health metrics
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/health$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _healthQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_healthQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );

      let agentsRunning = 0,
        agentsIdle = 0,
        openIssues = 0,
        inProgressIssues = 0;
      let budgetUsedTokens = 0,
        budgetMaxTokens = 0;
      let successRuns = 0,
        totalRuns = 0;

      // State: agent statuses
      try {
        const state = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-state.json`), 'utf8'));
        const agents = state.agents || {};
        Object.values(agents).forEach((a) => {
          if (a.status === 'running') agentsRunning++;
          else agentsIdle++;
          budgetUsedTokens += a.tokens_used || (a.tokens_in || 0) + (a.tokens_out || 0);
        });
      } catch (_) {}

      // Budget cap from org config
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(base, `${orgName}.json`), 'utf8'));
        budgetMaxTokens = cfg.run_config?.budget_tokens || cfg.budget_tokens || 0;
      } catch (_) {}

      // Issues: open count
      try {
        const iss = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-issues.json`), 'utf8'));
        openIssues = (iss.issues || []).filter((i) => i.status === 'open').length;
        inProgressIssues = (iss.issues || []).filter((i) => i.status === 'in_progress').length;
      } catch (_) {}

      // Activity: 7-day success rate
      try {
        const actPath = path.join(base, `${orgName}-activity.jsonl`);
        const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
        const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        lines.forEach((line) => {
          try {
            const ev = JSON.parse(line);
            const evMs = typeof ev.ts === 'number' ? ev.ts : ev.ts ? Date.parse(ev.ts) : 0;
            if (!evMs || evMs < cutoffMs) return;
            totalRuns++;
            if (ev.type?.includes('complete')) successRuns++;
          } catch (_) {}
        });
      } catch (_) {}

      const budgetUsedPct =
        budgetMaxTokens > 0 ? Math.round((budgetUsedTokens / budgetMaxTokens) * 100) : null;
      const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          agents_running: agentsRunning,
          agents_idle: agentsIdle,
          agents_active: agentsRunning,
          open_issues: openIssues,
          in_progress_issues: inProgressIssues,
          tasks_pending: openIssues + inProgressIssues,
          budget_used_tokens: budgetUsedTokens,
          budget_max_tokens: budgetMaxTokens,
          budget_used_pct: budgetUsedPct,
          run_success_rate_7d: successRate,
          total_runs_7d: totalRuns,
          errors: [],
        }),
      );
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/environments — org execution environments (strips key material)
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/environments$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _envsQs = new URL(req.url, 'http://localhost').searchParams;
      const envsPath = path.join(
        path.resolve(_envsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
        `${orgName}-environments.json`,
      );
      const payload = { environments: [], default_env: null };
      try {
        const raw = JSON.parse(fs.readFileSync(envsPath, 'utf8'));
        // Strip any accidental key_material or private_key fields — never send to browser
        payload.default_env = raw.default_env || null;
        payload.environments = (raw.environments || []).map((e) => {
          const safe = { ...e };
          delete safe.key_material;
          delete safe.private_key;
          delete safe.ssh_key;
          delete safe.password;
          return safe;
        });
      } catch (_) {
        /* file missing is fine — return empty */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/workspaces — org workspaces cross-referenced with worktree registry
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/workspaces$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _wsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_wsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const payload = { workspaces: [] };
      try {
        const wsRaw = JSON.parse(
          fs.readFileSync(path.join(base, `${orgName}-workspaces.json`), 'utf8'),
        );
        const workspaces = wsRaw.workspaces || [];
        // Optionally cross-reference worktree registry for branch/status enrichment
        const worktreeMap = {};
        try {
          const wtRaw = JSON.parse(
            fs.readFileSync(path.join(base, `${orgName}-worktrees.json`), 'utf8'),
          );
          (wtRaw.worktrees || []).forEach((wt) => {
            worktreeMap[wt.path] = wt;
          });
        } catch (_) {
          /* no worktree registry, that's fine */
        }
        payload.workspaces = workspaces.map((w) => {
          const wt = w.worktree_path ? worktreeMap[w.worktree_path] : null;
          return wt ? { ...w, branch: w.branch || wt.branch || w.branch } : w;
        });
      } catch (_) {
        /* file missing is fine */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/invites — active invites + pending join requests
  if (
    req.method === 'GET' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/invites(\?.*)?$/i)
  ) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _invitesQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_invitesQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const payload = { invites: [], join_requests: [] };
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-members.json`), 'utf8'));
        const all = raw.join_requests || [];
        payload.invites = all
          .filter((r) => r.type === 'invite' && r.status === 'pending')
          .map((r) => ({
            id: r.id,
            token: r.token ? `${r.token.slice(0, 8)}…` : r.id,
            role: r.role || 'operator',
            createdAt: r.createdAt || null,
            expiresAt: r.expiresAt || null,
            status: r.status,
          }));
        payload.join_requests = all
          .filter((r) => r.type !== 'invite' && r.status === 'pending_approval')
          .map((r) => ({
            id: r.id,
            requestType: r.requestType || 'human',
            role: r.role || 'viewer',
            createdAt: r.createdAt || null,
            message: r.message || '',
          }));
      } catch (_) {
        /* members file missing */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
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

  // GET /api/org/:name/my-issues — open + in_progress issues (self-assignable queue)
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/my-issues$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _myIssuesQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_myIssuesQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const payload = { issues: [] };
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-issues.json`), 'utf8'));
        // Return open + in_progress issues — the "my issues" queue for the operator
        payload.issues = (raw.issues || [])
          .filter((i) => i.status === 'open' || i.status === 'in_progress')
          .map((i) => ({
            id: i.id,
            title: i.title || null,
            description: i.description || null,
            status: i.status || 'open',
            priority: i.priority || 'medium',
            assigneeId: i.assigneeId || i.assigned_to || null,
            projectId: i.projectId || i.project_id || null,
            createdAt: i.createdAt || null,
            lastActivityAt: i.lastActivityAt || null,
            updated_at: i.updated_at || i.lastActivityAt || i.updatedAt || i.ts || null,
            ts: i.ts || i.updated_at || i.lastActivityAt || null,
          }));
      } catch (_) {
        /* issues file missing */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
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
        return {
          id: r.id,
          title: r.title || r.id,
          adapterType: r.agent_type || r.type || null,
          adapterModel: r.adapter_config?.model || r.adapter?.model || null,
          governance: r.governance || null,
          reportsTo: r.reports_to || null,
          status: s.status || 'idle',
          lastHeartbeat: s.last_heartbeat || s.lastHeartbeat || null,
          tokensIn: s.tokens_in || 0,
          tokensOut: s.tokens_out || 0,
          skills: r.skills || [],
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

  // GET /api/org/:name/approvals — full approvals list with status filter support
  if (
    req.method === 'GET' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals(\?.*)?$/i)
  ) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _approvalsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_approvalsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const readJsonSafe = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      const data = readJsonSafe(path.join(base, `${orgName}-approvals.json`)) || { approvals: [] };
      const approvals = (data.approvals || [])
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.created_at || b.requested_at || 0) -
            new Date(a.createdAt || a.created_at || a.requested_at || 0),
        )
        .map((a) => ({
          id: a.id,
          title: a.title || a.action || null,
          action: a.action || a.title || null,
          description: a.description || a.action || a.title || null,
          status: a.status || 'pending',
          agentId: a.agentId || a.agent_id || null,
          agentTitle: a.agentTitle || null,
          requester: a.requester || a.agentTitle || a.agent_id || a.agentId || null,
          agent: a.agent || a.agent_id || a.agentId || null,
          payload: a.payload || null,
          risk_level: a.risk_level || 'medium',
          created_at: a.created_at || a.createdAt || a.requested_at || null,
          createdAt: a.createdAt || a.created_at || a.requested_at || null,
          updatedAt: a.updatedAt || null,
          resolvedAt: a.resolvedAt || null,
          resolvedBy: a.resolvedBy || null,
          ts: a.ts || null,
        }));
      const pending = approvals.filter(
        (a) => a.status === 'pending' || a.status === 'revision_requested',
      ).length;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ approvals, pending }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"approvals":[],"pending":0}');
    }
    return true;
  }

  // GET /api/org/:name/gates — decision gate log (read-only explorer; resolving stays
  // CLI-only via `org gate-approve`/`gate-reject`, which needs the daemon's
  // x-monomind-cred auth header for live delivery — out of scope for a read-only view)
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/gates(\?.*)?$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _gatesQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_gatesQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const readJsonSafe = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      const data = readJsonSafe(path.join(base, orgName, 'gates.json')) || { gates: [] };
      const gates = (data.gates || [])
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          roleId: g.roleId,
          status: g.status || 'pending',
          createdAt: g.createdAt || null,
          resolvedBy: g.resolvedBy || null,
          resolvedAt: g.resolvedAt || null,
          resolution: g.resolution || null,
        }));
      const pending = gates.filter((g) => g.status === 'pending').length;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ gates, pending }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"gates":[],"pending":0}');
    }
    return true;
  }

  // GET /api/questions?dir=<ctx.projectDir> — list ask_human questions (pending and
  // answered) for every org in one project. Mirrors the existing -approvals.json
  // sidecar convention, but reads this feature's .monomind/orgs/<org>/questions.json
  // files (one per org dir). Each entry's `answer`/`answeredAt` fields (present once
  // answered, absent while pending) let the dashboard split them into tabs.
  if (req.method === 'GET' && url === '/api/questions') {
    try {
      const _qDir =
        new URL(req.url, 'http://localhost').searchParams.get('dir') ||
        ctx.projectDir ||
        process.cwd();
      const base = path.join(path.resolve(_qDir), '.monomind', 'orgs');
      const out = [];
      if (fs.existsSync(base)) {
        for (const orgName of fs.readdirSync(base)) {
          const qFile = path.join(base, orgName, 'questions.json');
          if (!fs.existsSync(qFile)) continue;
          let data = { questions: [] };
          try {
            data = JSON.parse(fs.readFileSync(qFile, 'utf8'));
          } catch (_) {}
          for (const q of data.questions || []) {
            out.push({ org: orgName, ...q });
          }
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ questions: out }));
    } catch (_e) {
      res.writeHead(500);
      res.end('{"questions":[]}');
    }
    return true;
  }

  // POST /api/questions/answer — forward a human's answer to the org's live process
  // (looked up via the same file-based broker registry orgrt's cross-process delivery
  // already uses), or fail with a clear error if no process anywhere hosts it.
  if (req.method === 'POST' && url === '/api/questions/answer') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
    try {
      const parsed = JSON.parse(body);
      const { dir, org, role, questionId, answer } = parsed;
      if (!org || !role || !questionId || answer === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'org, role, questionId, answer are required' }));
        return true;
      }
      if (String(org).length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(String(org))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid org name' }));
        return true;
      }
      const brokerDir = path.join(os.homedir(), '.monomind', 'orgrt-broker');
      const entryPath = path.join(brokerDir, `${org}.json`);
      let hostUrl = null;
      try {
        const entry = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
        if (Date.now() - entry.updatedAt < 90000) hostUrl = entry.url;
      } catch (_) {}
      if (!hostUrl) {
        // No live process to forward to — the control server has no daemon instance of
        // its own to call autoWake() on. If the org's definition still exists on disk,
        // queue the answer the same way inbox.ts's queueMessage()/drainInbox() already
        // do for offline cross-org messages, so it's delivered whenever the org next
        // starts (manually or via its own schedule) — matching the offline-delivery goal
        // for the dashboard path, not just the direct-daemon path Task 4 already covers.
        const projDir = path.resolve(dir || ctx.projectDir || process.cwd());
        const orgDefFile = path.join(projDir, '.monomind', 'orgs', `${org}.json`);
        if (!fs.existsSync(orgDefFile)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: false,
              error: `org "${org}" not found — no running process and no saved definition`,
            }),
          );
          return true;
        }
        const qFile = path.join(projDir, '.monomind', 'orgs', org, 'questions.json');
        let qData = { questions: [] };
        try {
          qData = JSON.parse(fs.readFileSync(qFile, 'utf8'));
        } catch (_) {}
        const qIdx = (qData.questions || []).findIndex((q) => q.questionId === questionId);
        if (qIdx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: false,
              error: `question "${questionId}" not found for org "${org}"`,
            }),
          );
          return true;
        }
        if (qData.questions[qIdx].answer !== null && qData.questions[qIdx].answer !== undefined) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, alreadyAnswered: true }));
          return true;
        }
        const answeredQuestion = qData.questions[qIdx];
        qData.questions[qIdx] = { ...answeredQuestion, answer, answeredAt: Date.now() };
        const qTmp = `${qFile}.tmp`;
        fs.writeFileSync(qTmp, JSON.stringify(qData, null, 2));
        fs.renameSync(qTmp, qFile);
        const inboxDir = path.join(projDir, '.monomind', 'orgs', org);
        fs.mkdirSync(inboxDir, { recursive: true });
        fs.appendFileSync(
          path.join(inboxDir, 'inbox.jsonl'),
          `${JSON.stringify({
            fromQualified: 'human',
            toRole: role,
            subject: `answer:${questionId}`,
            body: `question: ${answeredQuestion.question}\n\nanswer: ${answer}`,
            ts: Date.now(),
          })}\n`,
        );
        const queuedEvent = {
          type: 'org:question-answered',
          org,
          role,
          questionId,
          ts: Date.now(),
          queued: true,
        };
        ctx
          .appendToFile(
            path.join(projDir, 'data', 'mastermind-events.jsonl'),
            `${JSON.stringify(queuedEvent)}\n`,
          )
          .catch(() => {});
        ctx.broadcastMm(queuedEvent);
        // Auto-wake: a queued answer is worthless if nothing ever restarts the org to
        // drain it (unlike the direct-daemon path, this control server holds no OrgDaemon
        // instance to call autoWake() on). `org run` itself no-ops if the org's runtime.json
        // already shows a live pid, so this is safe to fire even if another process is
        // racing to start it.
        try {
          const child = spawn('npx', ['-y', 'monomind@latest', 'org', 'run', org], {
            cwd: projDir,
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
        } catch (_) {
          /* best-effort — the answer is still queued on disk either way */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, queued: true, waking: true }));
        return true;
      }
      const fwd = await fetch(`${hostUrl}/api/answer-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org, role, questionId, answer }),
        signal: AbortSignal.timeout(5000),
      });
      const fwdData = await fwd.json().catch(() => ({}));
      if (fwd.ok && fwdData.ok) {
        const event = { type: 'org:question-answered', org, role, questionId, ts: Date.now() };
        ctx
          .appendToFile(
            path.join(
              path.resolve(dir || ctx.projectDir || process.cwd()),
              'data',
              'mastermind-events.jsonl',
            ),
            `${JSON.stringify(event)}\n`,
          )
          .catch(() => {});
        ctx.broadcastMm(event);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(fwd.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: fwdData.error || 'answer delivery failed' }));
      }
    } catch (_e) {
      res.writeHead(500);
      res.end('{"ok":false}');
    }
    return true;
  }

  // POST /api/org/:name/approvals/:id — approve or reject a pending approval request
  // Body: { action: "approve" | "reject" | "revision_requested" }
  if (
    req.method === 'POST' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals\/[^/]+$/i)
  ) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const approvalId = decodeURIComponent(parts[5]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      if (!approvalId) {
        res.writeHead(400);
        res.end('{"error":"approval id required"}');
        return true;
      }
      const parsed = JSON.parse(body);
      const action = parsed.action;
      if (!['approve', 'reject', 'revision_requested'].includes(action)) {
        res.writeHead(400);
        res.end('{"error":"action must be approve, reject, or revision_requested"}');
        return true;
      }
      const _postApprovalsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_postApprovalsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const approvalsFile = path.join(base, `${orgName}-approvals.json`);
      let data = { approvals: [] };
      try {
        data = JSON.parse(fs.readFileSync(approvalsFile, 'utf8'));
      } catch (_) {}
      const idx = (data.approvals || []).findIndex((a) => a.id === approvalId);
      if (idx === -1) {
        res.writeHead(404);
        res.end('{"error":"approval not found"}');
        return true;
      }
      const status =
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revision_requested';
      data.approvals[idx] = {
        ...data.approvals[idx],
        status,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'operator',
      };
      const tmp = `${approvalsFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, approvalsFile);
      // Emit org:approval:resolved event so boss agent unblocks
      const event = {
        type: 'org:approval:resolved',
        org: orgName,
        approval_id: approvalId,
        status,
        ts: Date.now(),
      };
      ctx
        .appendToFile(
          path.join(
            path.resolve(_postApprovalsQs.get('dir') || ctx.projectDir || process.cwd()),
            'data',
            'mastermind-events.jsonl',
          ),
          `${JSON.stringify(event)}\n`,
        )
        .catch(() => {});
      ctx.broadcastMm(event);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, status }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/secrets — masked secrets list (NEVER exposes values)
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/secrets$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _secretsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_secretsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const secretsDir = path.join(base, '.secrets');
      const readJsonSafe = (f) => {
        try {
          return JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (_) {
          return null;
        }
      };
      // Read secrets index — NEVER expose actual values
      const indexFile = path.join(secretsDir, `${orgName}-index.json`);
      const data = readJsonSafe(indexFile) || { secrets: [] };
      const secrets = (data.secrets || []).map((s) => ({
        name: s.name,
        purpose: s.purpose || null,
        maskedRef: s.maskedRef || `${(s.name || '').substring(0, 4)}***`,
        status: s.status || 'active',
        createdAt: s.createdAt || null,
        rotatedAt: s.rotatedAt || null,
        lastUsedAt: s.lastUsedAt || null,
        usageCount: s.usageCount || 0,
      }));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ secrets }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"secrets":[]}');
    }
    return true;
  }

  // GET /api/org/:name/budgets — org and per-agent budget data
  // Returns: { org_budget: {limit_tokens, limit_usd}, agent_budgets: {agentId: {limit_usd}}, agents: [{id, title, tokens_in, tokens_out, total_cost_usd}] }
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/budgets$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _budgetsQs = new URL(req.url, 'http://localhost').searchParams;
      const base = path.join(
        path.resolve(_budgetsQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      let budgetData = { org_budget: {}, agent_budgets: {}, period: 'monthly', currency: 'USD' };
      try {
        budgetData = JSON.parse(
          fs.readFileSync(path.join(base, `${orgName}-budgets.json`), 'utf8'),
        );
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
          total_cost_usd: s.total_cost_usd || 0,
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
          const _runsDir = path.join(base, orgName, 'runs');
          if (fs.existsSync(_runsDir)) {
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
                  total_cost_usd: 0,
                };
              _usageByRole[role].tokens_in += tokensIn;
              _usageByRole[role].tokens_out += tokensOut;
              _usageByRole[role].tokens_used += tokensIn + tokensOut + tokensTotal;
              _usageByRole[role].total_cost_usd += costUsd;
            };
            for (const f of fs.readdirSync(_runsDir)) {
              if (!f.endsWith('.jsonl') || f.startsWith('._')) continue;
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
                      Number(ev.cost_usd) || 0,
                    );
                  } else if (ev.type === 'org:usage' && ev.from) {
                    _bump(
                      ev.from,
                      0,
                      0,
                      Number(ev.data?.tokens) || 0,
                      Number(ev.data?.cost_usd) || 0,
                    );
                  }
                } catch (_) {}
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
                  total_cost_usd: u.total_cost_usd || 0,
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
      res.end(JSON.stringify({ ...budgetData, agents }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"org_budget":{},"agent_budgets":{},"agents":[]}');
    }
    return true;
  }

  // GET /api/org/:name/threads — conversation threads from threads.jsonl
  // Returns: { threads: [{id, subject, authorId, authorName, issueId, createdAt, messages:[]}] }
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/threads$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _threadsQs = new URL(req.url, 'http://localhost').searchParams;
      const _threadsRoot = path.resolve(_threadsQs.get('dir') || ctx.projectDir || process.cwd());
      const _threadsProjDir = ctx._resolveOrgProjectDir(orgName, _threadsRoot) || _threadsRoot;
      const threadsFile = path.join(
        _threadsProjDir,
        '.monomind',
        'orgs',
        `${orgName}-threads.jsonl`,
      );
      let threads = [];
      try {
        const lines = fs
          .readFileSync(threadsFile, 'utf8')
          .split('\n')
          .filter((l) => l.trim());
        threads = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean);
        // Group 'message' entries (from org:comms) by run_id into synthetic thread objects
        const msgsByRun = {};
        threads
          .filter((t) => t.type === 'message')
          .forEach((m) => {
            const rid = m.run_id || 'unknown';
            if (!msgsByRun[rid])
              msgsByRun[rid] = {
                id: `thread-${rid}`,
                type: 'thread',
                subject: `Run ${rid}`,
                run_id: rid,
                createdAt: m.ts,
                messages: [],
              };
            msgsByRun[rid].messages.push({ from: m.from, to: m.to, msg: m.msg, ts: m.ts });
          });
        const syntheticThreads = Object.values(msgsByRun).map((t) => ({
          ...t,
          messageCount: t.messages.length,
          author: t.messages[0]?.from || null,
        }));
        threads = threads
          .filter((t) => t.type === 'thread' || !t.type)
          .map((t) => ({
            ...t,
            author: t.author || t.authorName || t.createdBy || t.authorId || null,
            messageCount:
              t.messageCount != null
                ? t.messageCount
                : Array.isArray(t.messages)
                  ? t.messages.length
                  : typeof t.messages === 'number'
                    ? t.messages
                    : null,
          }));
        threads = [...threads, ...syntheticThreads];
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ threads }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"threads":[]}');
    }
    return true;
  }

  // GET /api/org/:name/join-requests — pending join requests for this org
  // Returns: { requests: [{id, requesterId, requesterName, type, status, createdAt, resolvedAt}], pending: N }
  if (
    req.method === 'GET' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/join-requests(\?.*)?$/i)
  ) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _joinQs = new URL(req.url, 'http://localhost').searchParams;
      const joinFile = path.join(
        path.resolve(_joinQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
        `${orgName}-join-requests.json`,
      );
      let requests = [];
      try {
        const raw = fs.readFileSync(joinFile, 'utf8');
        const data = JSON.parse(raw);
        requests = (data.requests || []).map((r) => ({
          id: r.id,
          requesterId: r.requesterId,
          requesterName: r.requesterName || r.requesterId,
          type: r.type || 'human',
          status: r.status || 'pending_approval',
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt || null,
        }));
      } catch (_) {}
      const pending = requests.filter((r) => r.status === 'pending_approval').length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requests, pending }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"requests":[],"pending":0}');
    }
    return true;
  }

  // GET /api/org/:name/goals — read org goals
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/goals$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _goalsQs = new URL(req.url, 'http://localhost').searchParams;
      const _goalsRoot = path.resolve(_goalsQs.get('dir') || ctx.projectDir || process.cwd());
      const _goalsProjDir = ctx._resolveOrgProjectDir(orgName, _goalsRoot) || _goalsRoot;
      const goalsFile = path.join(_goalsProjDir, '.monomind', 'orgs', `${orgName}-goals.json`);
      let data = { goals: [] };
      try {
        data = JSON.parse(fs.readFileSync(goalsFile, 'utf8'));
      } catch (_) {}
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ goals: data.goals || [] }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"goals":[]}');
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
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
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
      const tmp = `${goalsFile}.tmp`;
      const payload = { org: orgName, updated_at: new Date().toISOString(), goals: parsed.goals };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmp, goalsFile);
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
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
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
      const tmp = `${routinesFile}.tmp`;
      const payload = {
        org: orgName,
        updated_at: new Date().toISOString(),
        routines: parsed.routines,
      };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmp, routinesFile);
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

  // GET /api/org/:name/files — all files related to an org
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/files$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"error":"Invalid org name"}');
        return true;
      }
      const _filesQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_filesQs.get('dir') || ctx.projectDir || process.cwd());
      const orgsDir = path.join(d, '.monomind', 'orgs');
      const files = [];
      const seen = new Set();
      const addFile = (fp, type) => {
        if (seen.has(fp)) return;
        seen.add(fp);
        try {
          const st = fs.statSync(fp);
          files.push({
            name: path.basename(fp),
            path: fp,
            type,
            size: st.size,
            mtime: st.mtime.toISOString(),
          });
        } catch (_) {}
      };
      addFile(path.join(orgsDir, `${orgName}.json`), 'config');
      for (const s of [
        '-state',
        '-approvals',
        '-goals',
        '-routines',
        '-projects',
        '-members',
        '-issues',
        '-threads',
        '-budgets',
      ]) {
        const fp = path.join(orgsDir, `${orgName + s}.json`);
        if (fs.existsSync(fp)) addFile(fp, s.slice(1));
      }
      const walkDir = (dir, depth) => {
        if (depth > 3) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) walkDir(fp, depth + 1);
          else addFile(fp, 'generated');
        }
      };
      const orgWorkDir = path.join(orgsDir, orgName);
      if (fs.existsSync(orgWorkDir)) walkDir(orgWorkDir, 0);
      let orgCfg = null;
      try {
        orgCfg = JSON.parse(fs.readFileSync(path.join(orgsDir, `${orgName}.json`), 'utf8'));
      } catch (_) {}
      if (orgCfg && Array.isArray(orgCfg.roles)) {
        const agentsDir = path.join(d, '.claude', 'agents');
        const walkAgents = (dir) => {
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch (_) {
            return;
          }
          for (const e of entries) {
            if (e.isDirectory()) {
              walkAgents(path.join(dir, e.name));
              continue;
            }
            if (!e.name.endsWith('.md')) continue;
            const fp = path.join(dir, e.name);
            const base = e.name.replace('.md', '').toLowerCase();
            if (
              orgCfg.roles.some(
                (r) =>
                  base === (r.id || '').toLowerCase() ||
                  base === (r.agent_type || '').toLowerCase() ||
                  (r.instructions_file || '').endsWith(e.name),
              )
            )
              addFile(fp, 'agent-definition');
          }
        };
        if (fs.existsSync(agentsDir)) walkAgents(agentsDir);
      }
      files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/file-content — return raw text content of a .monomind file
  if (req.method === 'GET' && url === '/api/file-content') {
    try {
      const _fcQs = new URL(req.url, 'http://localhost').searchParams;
      const rawPath = _fcQs.get('path');
      const baseDir = path.resolve(_fcQs.get('dir') || ctx.projectDir || process.cwd());
      if (!rawPath) {
        res.writeHead(400);
        res.end('Missing path');
        return true;
      }
      const resolved = path.resolve(rawPath);
      // Security: must be inside .monomind of the project dir
      const monomindDir = path.join(baseDir, '.monomind');
      if (!resolved.startsWith(monomindDir + path.sep) && resolved !== monomindDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return true;
      }
      if (!fs.existsSync(resolved)) {
        res.writeHead(404);
        res.end('Not found');
        return true;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        res.writeHead(400);
        res.end('Not a file');
        return true;
      }
      if (stat.size > 524288) {
        res.writeHead(413);
        res.end('File too large');
        return true;
      }
      const _fcMime = ctx._detectMimeType(resolved);
      if (_fcMime.startsWith('image/')) {
        res.writeHead(200, {
          'Content-Type': _fcMime,
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(fs.readFileSync(resolved));
        return true;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(content);
    } catch (_) {
      res.writeHead(500);
      res.end('Internal error');
    }
    return true;
  }

  // DELETE /api/orgs/:name — delete an org config and all associated data files
  if (req.method === 'DELETE' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}(\?.*)?$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _delOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const orgsDir = path.join(
        path.resolve(_delOrgQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const configFile = path.join(orgsDir, `${orgName}.json`);
      const v1ConfigFile = path.join(orgsDir, `${orgName}.v1.json`);
      if (!fs.existsSync(configFile) && !fs.existsSync(v1ConfigFile)) {
        res.writeHead(404);
        res.end('{"error":"org not found"}');
        return true;
      }
      // Remove all org-associated files (config + state + data)
      try {
        if (fs.existsSync(v1ConfigFile)) fs.unlinkSync(v1ConfigFile);
      } catch (_) {}
      const suffixes = [
        '',
        '-state',
        '-goals',
        '-routines',
        '-approvals',
        '-activity',
        '-issues',
        '-members',
        '-projects',
        '-workspaces',
        '-worktrees',
        '-environments',
        '-plugins',
        '-adapters',
        '-budgets',
        '-threads',
        '-secrets',
        '-join-requests',
        '-bootstrap',
        '-project-workspaces',
        '-approval-comments',
        '-skills',
      ];
      for (const suf of suffixes) {
        const f = path.join(orgsDir, `${orgName}${suf}.json`);
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch (_) {}
        const fjsonl = path.join(orgsDir, `${orgName}${suf}.jsonl`);
        try {
          if (fs.existsSync(fjsonl)) fs.unlinkSync(fjsonl);
        } catch (_) {}
      }
      // Remove stop file if present
      try {
        fs.unlinkSync(path.join(orgsDir, '.stops', `${orgName}.stop`));
      } catch (_) {}
      // Remove org subdirectory under .monomind/orgs/ (legacy flat-file location)
      try {
        const orgWorkDir = path.join(orgsDir, orgName);
        if (fs.existsSync(orgWorkDir)) fs.rmSync(orgWorkDir, { recursive: true, force: true });
      } catch (_) {}
      // Remove org subdirectory under git-safe location (.git/monomind/orgs/<name>/) so run
      // files written by the worktree-aware path (feat 880f034e) are also cleaned up on delete
      try {
        const _delWorkDir = path.resolve(_delOrgQs.get('dir') || ctx.projectDir || process.cwd());
        const _delGitMonoDir = ctx._getGitMonomindDir(_delWorkDir);
        if (_delGitMonoDir) {
          const gitOrgDir = path.join(_delGitMonoDir, 'orgs', orgName);
          if (fs.existsSync(gitOrgDir)) fs.rmSync(gitOrgDir, { recursive: true, force: true });
        }
      } catch (_) {}
      // Remove loop prompt file if present (created for scheduled orgs by createorg)
      try {
        const lpf = path.join(
          path.resolve(ctx.projectDir || process.cwd()),
          '.monomind',
          'loops',
          `${orgName}.md`,
        );
        if (fs.existsSync(lpf)) fs.unlinkSync(lpf);
      } catch (_) {}
      // Emit org:delete event
      const deleteEvent = { type: 'org:delete', org: orgName, ts: Date.now() };
      ctx
        .appendToFile(
          path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-events.jsonl'),
          `${JSON.stringify(deleteEvent)}\n`,
        )
        .catch(() => {});
      ctx.broadcastMm(deleteEvent);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end('{"ok":true}');
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/orgs/:name/stop — send stop signal to a running org
  if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/stop$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _stopOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const _stopOrgBase = path.resolve(_stopOrgQs.get('dir') || ctx.projectDir || process.cwd());
      const stopEvent = { type: 'org:stop', org: orgName, ts: Date.now() };
      const dataDir = path.join(_stopOrgBase, 'data');
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (_) {}
      ctx
        .appendToFile(
          path.join(dataDir, 'mastermind-events.jsonl'),
          `${JSON.stringify(stopEvent)}\n`,
        )
        .catch(() => {});
      // Write stop marker file for boss agent to detect
      try {
        const stopDir = path.join(_stopOrgBase, '.monomind', 'orgs', '.stops');
        fs.mkdirSync(stopDir, { recursive: true });
        fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
      } catch (_) {}
      ctx.broadcastMm(stopEvent);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end('{"ok":true}');
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/orgs/:name/copy — copy org config to another project directory
  if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/copy$/i)) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid org name' }));
        return true;
      }
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch (_) {}
      const destination = payload.destination ? String(payload.destination).trim() : '';
      if (!destination) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'destination is required' }));
        return true;
      }
      if (!path.isAbsolute(destination)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'destination must be an absolute path' }));
        return true;
      }
      const _copyOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const srcOrgsDir = path.join(
        path.resolve(_copyOrgQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const srcFile = path.join(srcOrgsDir, `${orgName}.json`);
      if (!fs.existsSync(srcFile)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'org not found' }));
        return true;
      }
      const destOrgsDir = path.join(path.resolve(destination), '.monomind', 'orgs');
      try {
        fs.mkdirSync(destOrgsDir, { recursive: true });
      } catch (_) {}
      const destFile = path.join(destOrgsDir, `${orgName}.json`);
      fs.copyFileSync(srcFile, destFile);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, destFile }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return true;
  }

  // GET /api/org/:name/runs — list structured run files for an org
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs(\?.*)?$/i.test(url)) {
    try {
      const _rQs = new URL(req.url, 'http://localhost').searchParams;
      const _rOrgName = decodeURIComponent(url.split('/')[3] || '');
      if (_rOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_rOrgName)) {
        res.writeHead(400);
        res.end('{"error":"Invalid org name"}');
        return true;
      }
      const _rExplicitDir = _rQs.get('dir');
      const _rServerRoot = path.resolve(_rExplicitDir || ctx.projectDir || process.cwd());
      // Search across known projects (same logic as /api/orgs) unless explicit dir given
      const _rProjDirs = new Set([_rServerRoot]);
      if (!_rExplicitDir) {
        try {
          const _rKnown = JSON.parse(
            fs.readFileSync(path.join(_rServerRoot, 'data', 'known-projects.json'), 'utf8'),
          );
          _rKnown.forEach((p) => _rProjDirs.add(p));
        } catch (_) {}
      }
      const _rSeenFiles = new Set();
      const runs = [];
      const _parseRun = (filePath, f) => {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const allLines = raw.split('\n').filter(Boolean);
          const parse = (l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          };
          // Merge .warm.jsonl (promoted pre-complete events) for accurate event count + metadata
          const warmFile = filePath.replace(/\.jsonl$/, '.warm.jsonl');
          let warmLines = [];
          let warmEvents = [];
          try {
            if (fs.existsSync(warmFile)) {
              warmLines = fs.readFileSync(warmFile, 'utf8').split('\n').filter(Boolean);
              warmEvents = warmLines.map(parse).filter(Boolean);
            }
          } catch (_) {}
          const combinedLines = [...warmLines, ...allLines];
          const eventCount = combinedLines.length;
          const headEvents = (
            warmEvents.length ? warmEvents : allLines.map(parse).filter(Boolean)
          ).slice(0, 10);
          const _tailEvents = allLines.map(parse).filter(Boolean).slice(-5).length
            ? allLines.map(parse).filter(Boolean).slice(-5)
            : warmEvents.slice(-5);
          const first = headEvents.find((e) => e.type === 'run:start') || headEvents[0];
          const last = [...warmEvents.slice(-5), ...allLines.map(parse).filter(Boolean).slice(-3)]
            .slice()
            .reverse()
            .find((e) => e.type === 'run:complete' || e.type === 'org:complete');
          const cycles = combinedLines.filter((l) => l.includes('"org:checkpoint"')).length;
          const lastEvent =
            allLines.map(parse).filter(Boolean).slice(-1)[0] || warmEvents.slice(-1)[0];
          const ageMs = lastEvent?.ts ? Date.now() - lastEvent.ts : Infinity;
          const isStale = !last && ageMs > 30 * 60 * 1000;
          const firstBossComms = headEvents.find(
            (e) => e.type === 'org:comms' && (e.from === 'boss' || e.role === 'boss') && e.msg,
          );
          const derivedGoal = first?.goal || firstBossComms?.msg?.slice(0, 80) || '';
          return {
            runId: f.replace(/\.warm\.jsonl$|\.jsonl$/, ''),
            startedAt: first?.ts || 0,
            endedAt: last?.ts || 0,
            status: last ? 'complete' : isStale ? 'stale' : 'running',
            eventCount,
            cycleCount: cycles,
            goal: derivedGoal,
            bossRole: first?.bossRole || '',
          };
        } catch (_) {
          return null;
        }
      };
      for (const _rpd of _rProjDirs) {
        // Check both .monomind and .git/monomind locations
        const _rMonoDir = ctx._getGitMonomindDir(_rpd) || path.join(_rpd, '.monomind');
        const _rSearchDirs = [path.join(_rMonoDir, 'orgs', _rOrgName, 'runs')];
        if (_rMonoDir !== path.join(_rpd, '.monomind'))
          _rSearchDirs.push(path.join(_rpd, '.monomind', 'orgs', _rOrgName, 'runs'));
        for (const _rDir of _rSearchDirs) {
          if (!fs.existsSync(_rDir)) continue;
          // Include .warm.jsonl — completed runs are renamed hot→warm on org:complete and
          // must stay visible in the chat history dropdown.
          const files = fs
            .readdirSync(_rDir)
            .filter(
              (f) =>
                f.endsWith('.jsonl') &&
                !f.startsWith('._') &&
                !f.endsWith('.convs.jsonl') &&
                !f.endsWith('.cold.jsonl'),
            )
            .sort()
            .reverse();
          for (const f of files.slice(0, 50)) {
            const _rFileId = f.replace(/\.warm\.jsonl$|\.jsonl$/, '');
            if (_rSeenFiles.has(_rFileId)) continue;
            _rSeenFiles.add(_rFileId);
            const r = _parseRun(path.join(_rDir, f), f);
            if (r) runs.push(r);
          }
        }
      }
      runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      // Threads fallback: if no run files found, synthesize a run from the org threads file
      // so orgs whose boss never emitted runId-tagged events still show in the chat dropdown.
      if (runs.length === 0) {
        for (const _rpd of _rProjDirs) {
          const _tf = path.join(_rpd, '.monomind', 'orgs', `${_rOrgName}-threads.jsonl`);
          if (!fs.existsSync(_tf)) continue;
          const _tLines = fs.readFileSync(_tf, 'utf8').split('\n').filter(Boolean);
          if (!_tLines.length) continue;
          const _tEvs = _tLines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          if (!_tEvs.length) continue;
          const _firstTs = _tEvs[0].ts
            ? typeof _tEvs[0].ts === 'number'
              ? _tEvs[0].ts
              : new Date(_tEvs[0].ts).getTime()
            : Date.now();
          const _lastTs = _tEvs[_tEvs.length - 1].ts
            ? typeof _tEvs[_tEvs.length - 1].ts === 'number'
              ? _tEvs[_tEvs.length - 1].ts
              : new Date(_tEvs[_tEvs.length - 1].ts).getTime()
            : _firstTs;
          runs.push({
            id: `threads-${_rOrgName}`,
            orgName: _rOrgName,
            goal: `${_rOrgName} threads`,
            status: 'complete',
            startedAt: _firstTs,
            endedAt: _lastTs,
            eventCount: _tEvs.length,
            _threadsFile: _tf,
          });
          break;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(runs));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }

  // GET /api/org/:name/runs/:runId — get all events for a specific run
  if (
    req.method === 'GET' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs\/[a-z0-9][a-z0-9_-]{0,79}(\?.*)?$/i.test(url)
  ) {
    try {
      const _rvQs = new URL(req.url, 'http://localhost').searchParams;
      const _rvParts = url.replace(/\?.*$/, '').split('/');
      const _rvOrgName = decodeURIComponent(_rvParts[3] || '');
      const _rvRunId = decodeURIComponent(_rvParts[5] || '');
      if (
        _rvOrgName.length > 64 ||
        !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvOrgName) ||
        _rvRunId.length > 80 ||
        !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvRunId)
      ) {
        res.writeHead(400);
        res.end('{"error":"Invalid org or run id"}');
        return true;
      }
      const _rvExplicitDir = _rvQs.get('dir');
      const _rvServerRoot = path.resolve(_rvExplicitDir || ctx.projectDir || process.cwd());
      // Threads fallback: threads-${orgName} is a synthetic runId served from threads file
      if (_rvRunId === `threads-${_rvOrgName}`) {
        const _rvProjDirsT = new Set([_rvServerRoot]);
        if (!_rvExplicitDir) {
          try {
            JSON.parse(
              fs.readFileSync(path.join(_rvServerRoot, 'data', 'known-projects.json'), 'utf8'),
            ).forEach((p) => _rvProjDirsT.add(p));
          } catch (_) {}
        }
        for (const _rvpd of _rvProjDirsT) {
          const _tf = path.join(_rvpd, '.monomind', 'orgs', `${_rvOrgName}-threads.jsonl`);
          if (!fs.existsSync(_tf)) continue;
          const _tLines = fs.readFileSync(_tf, 'utf8').split('\n').filter(Boolean);
          const _tEvs = _tLines
            .map((l) => {
              try {
                const e = JSON.parse(l);
                return {
                  type: 'org:comms',
                  from: e.role || e.from || 'agent',
                  to: e.to || 'all',
                  msg: e.message || e.msg || '',
                  ts: e.ts
                    ? typeof e.ts === 'number'
                      ? e.ts
                      : new Date(e.ts).getTime()
                    : Date.now(),
                  org: _rvOrgName,
                  runId: _rvRunId,
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify(_tEvs));
          return true;
        }
        res.writeHead(404);
        res.end('{"error":"threads file not found"}');
        return true;
      }
      // Search across known projects
      const _rvProjDirs = new Set([_rvServerRoot]);
      if (!_rvExplicitDir) {
        try {
          JSON.parse(
            fs.readFileSync(path.join(_rvServerRoot, 'data', 'known-projects.json'), 'utf8'),
          ).forEach((p) => _rvProjDirs.add(p));
        } catch (_) {}
      }
      let _rvFile = null;
      for (const _rvpd of _rvProjDirs) {
        const _rvMonoDir = ctx._getGitMonomindDir(_rvpd) || path.join(_rvpd, '.monomind');
        const _candidates = [
          path.join(_rvMonoDir, 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`),
          path.join(_rvMonoDir, 'orgs', _rvOrgName, 'runs', `${_rvRunId}.warm.jsonl`),
        ];
        if (_rvMonoDir !== path.join(_rvpd, '.monomind')) {
          _candidates.push(
            path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`),
          );
          _candidates.push(
            path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, 'runs', `${_rvRunId}.warm.jsonl`),
          );
        }
        for (const c of _candidates) {
          if (fs.existsSync(c)) {
            _rvFile = c;
            break;
          }
        }
        if (_rvFile) break;
      }
      if (!_rvFile) {
        res.writeHead(404);
        res.end('{"error":"run not found"}');
        return true;
      }
      const _parseLines = (p) => {
        try {
          return fs
            .readFileSync(p, 'utf8')
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
        } catch {
          return [];
        }
      };
      const events = _parseLines(_rvFile);
      // Merge .warm.jsonl (pre-run:complete events, including org:comms) if it exists.
      // When run:complete fires, the hot .jsonl is renamed to .warm.jsonl so all pre-complete
      // events live there. The current .jsonl then only holds post-complete events (e.g. org:stop).
      const _rvWarmFile = _rvFile.endsWith('.warm.jsonl')
        ? _rvFile
        : _rvFile.replace(/\.jsonl$/, '.warm.jsonl');
      if (_rvWarmFile !== _rvFile && fs.existsSync(_rvWarmFile)) {
        events.push(..._parseLines(_rvWarmFile));
      }
      // For in-progress runs (no .warm.jsonl), org:comms also go to .convs.jsonl (stripped form).
      // They're already in .jsonl as full events, so .convs.jsonl would duplicate — skip it.
      events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(events));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }

  // GET /api/org/:name/artifact — serve file content for chat "View" button
  if (req.method === 'GET' && /^\/api\/org\/[^/]+\/artifact/.test(url)) {
    try {
      const _artQp = new URL(`http://x${req.url}`).searchParams;
      const _rawPath = _artQp.get('path');
      if (!_rawPath) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'path required' }));
        return true;
      }
      const _filePath = path.resolve(decodeURIComponent(_rawPath));
      // Path traversal guard: only allow reads within known project dirs
      const _allowed = ctx._getAllowedArtifactDirs(ctx.projectDir || process.cwd());
      const _safe = _allowed.some((d) => _filePath.startsWith(d + path.sep) || _filePath === d);
      if (!_safe) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'path not allowed' }));
        return true;
      }
      if (!fs.existsSync(_filePath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'file not found' }));
        return true;
      }
      const _mime = ctx._detectMimeType(_filePath);
      const _size = fs.statSync(_filePath).size;
      // Reject files >2MB to avoid blocking the event loop
      if (_size > 2 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'file too large', size: _size }));
        return true;
      }
      if (!_mime.startsWith('text/') && _mime !== 'application/json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ binary: true, mimeType: _mime, size: _size }));
        return true;
      }
      const _content = fs.readFileSync(_filePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ content: _content, mimeType: _mime, size: _size }));
    } catch (_e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'read failed' }));
    }
    return true;
  }

  // ------------------------------------------------- Mastermind event system
  // POST /api/mastermind/event — ingest event from mastermind skill
  if (req.method === 'POST' && url === '/api/mastermind/event') {
    await ctx.handleMastermindEvent(req, res, corsOrigin);
    return true;
  }

  // GET /api/mastermind-stream — SSE for real-time events
  if (req.method === 'GET' && url === '/api/mastermind-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.write(': connected\n\n');
    ctx.addMmClient(res);
    // Replay last 50 events from disk (use ?project= param if provided)
    try {
      const _sseQp = new URL(`http://x${req.url}`).searchParams;
      const _sseProj = _sseQp.get('project');
      const root2 = _sseProj || ctx.projectDir || process.cwd();
      const evFile = path.join(root2, 'data', 'mastermind-events.jsonl');
      const lines = fs.readFileSync(evFile, 'utf8').trim().split('\n').filter(Boolean).slice(-50);
      for (const l of lines) res.write(`data: ${l}\n\n`);
    } catch (_) {}
    const ka = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(ka);
        ctx.removeMmClient(res);
      }
    }, 20000);
    req.on('close', () => {
      ctx.removeMmClient(res);
      clearInterval(ka);
    });
    return true;
  }

  // GET /api/mastermind/sessions
  if (req.method === 'GET' && url.startsWith('/api/mastermind/sessions')) {
    try {
      const qp = new URL(`http://x${req.url}`).searchParams;
      const filterProject = qp.get('project');
      const limitParam = Math.min(parseInt(qp.get('limit') || '200', 10) || 200, 500);
      const serverRoot = ctx.projectDir || process.cwd();
      // Collect all project dirs to aggregate
      const projectDirs = new Set([serverRoot]);
      try {
        const known = JSON.parse(
          fs.readFileSync(path.join(serverRoot, 'data', 'known-projects.json'), 'utf8'),
        );
        known.forEach((p) => projectDirs.add(p));
      } catch (_) {}
      let allSessions = [];
      for (const pd of projectDirs) {
        if (filterProject && pd !== filterProject) continue;
        const sessDir = path.join(pd, 'data', 'sessions');
        const indexFile = path.join(sessDir, '_index.json');
        // ── New format: per-session JSONL + _index.json ──
        if (fs.existsSync(indexFile)) {
          try {
            const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
            const top = idx.slice(0, limitParam);
            for (const entry of top) {
              const _sid = String(entry.id || '').trim();
              if (!_sid || !ctx.SESSION_ID_RE.test(_sid)) continue;
              let events = [];
              try {
                const jl = fs.readFileSync(path.join(sessDir, `${_sid}.jsonl`), 'utf8');
                events = jl
                  .trim()
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
              } catch (_) {}
              allSessions.push({ ...entry, events, project: pd });
            }
          } catch (_) {}
        } else {
          // ── Legacy fallback: mastermind-sessions.json ──
          const f = path.join(pd, 'data', 'mastermind-sessions.json');
          if (fs.existsSync(f)) {
            try {
              const s = JSON.parse(fs.readFileSync(f, 'utf8'));
              s.forEach((sess) => {
                if (!sess.project) sess.project = pd;
              });
              allSessions = allSessions.concat(s);
            } catch (_) {}
          }
        }
      }
      allSessions.sort((a, b) => (b.ts || b.startedAt || 0) - (a.ts || a.startedAt || 0));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(allSessions.slice(0, limitParam)));
    } catch (_) {
      res.writeHead(200);
      res.end('[]');
    }
    return true;
  }

  // GET /api/mastermind/session/:id/trace — human-readable markdown trace
  if (req.method === 'GET' && url.match(/^\/api\/mastermind\/session\/[^/]+\/trace$/)) {
    try {
      const sid = url.split('/')[4];
      const sessFile = path.join(
        ctx.projectDir || process.cwd(),
        'data',
        'sessions',
        `${sid}.json`,
      );
      let s = null;
      if (fs.existsSync(sessFile)) {
        s = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      } else {
        const f = path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
        const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
        s = sessions.find((x) => x.id === sid);
      }
      if (!s) {
        res.writeHead(404);
        res.end('Session not found');
        return true;
      }
      const fmt = (ts) => `${new Date(ts).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
      const lines = [
        `# Mastermind Session Trace: ${s.id}`,
        ``,
        `**Prompt:** ${s.prompt || '(none)'}`,
        `**Status:** ${s.status}`,
        `**Started:** ${fmt(s.ts)}`,
        s.endTs ? `**Ended:** ${fmt(s.endTs)}` : '',
        `**Domains:** ${(s.domains || []).join(', ') || '(none yet)'}`,
        ``,
      ];
      for (const ev of s.events || []) {
        const t = fmt(ev.ts);
        if (ev.type === 'session:start')
          lines.push(`\`${t}\` **SESSION START** — prompt: "${ev.prompt || ''}"`);
        else if (ev.type === 'domain:dispatch')
          lines.push(`\`${t}\` **DOMAIN DISPATCH** → \`${ev.domain}\` — ${ev.cmd || ''}`);
        else if (ev.type === 'agent:spawn')
          lines.push(
            `\`${t}\` **AGENT SPAWN** [\`${ev.domain}\`] → agent: \`${ev.agent}\` — ${ev.task || ''}`,
          );
        else if (ev.type === 'intercom')
          lines.push(`\`${t}\` **INTERCOM** \`${ev.from}\` → \`${ev.to}\`: ${ev.msg || ''}`);
        else if (ev.type === 'domain:complete')
          lines.push(
            `\`${t}\` **DOMAIN COMPLETE** [\`${ev.domain}\`] status: ${ev.status}${ev.artifacts?.length ? ` — artifacts: ${ev.artifacts.join(', ')}` : ''}`,
          );
        else if (ev.type === 'session:complete')
          lines.push(
            `\`${t}\` **SESSION COMPLETE** — status: ${ev.status}, domains: ${(ev.domains || []).join(', ')}`,
          );
        else lines.push(`\`${t}\` ${ev.type} ${JSON.stringify(ev)}`);
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(lines.join('\n'));
    } catch (_) {
      res.writeHead(500);
      res.end('Error');
    }
    return true;
  }

  // GET /api/mastermind/session/:id
  if (req.method === 'GET' && url.startsWith('/api/mastermind/session/')) {
    try {
      const sid = url.slice('/api/mastermind/session/'.length);
      // Check individual session file first
      const sessFile = path.join(
        ctx.projectDir || process.cwd(),
        'data',
        'sessions',
        `${sid}.json`,
      );
      if (fs.existsSync(sessFile)) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(fs.readFileSync(sessFile, 'utf8'));
        return true;
      }
      const f = path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
      const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
      const s = sessions.find((x) => x.id === sid);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(s || null));
    } catch (_) {
      res.writeHead(200);
      res.end('null');
    }
    return true;
  }

  // -------------------------------------------------------- GET /mastermind
  if (req.method === 'GET' && url === '/mastermind') {
    // Serve local file if present (dev), otherwise fall back to bundled HTML
    const root = ctx.projectDir || process.cwd();
    const htmlPath = path.join(root, 'docs', 'mastermind-diagram.html');
    let html = ctx.MASTERMIND_DIAGRAM_HTML;
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }

  // ----------------------------------------------------------- GET /orgs
  if (req.method === 'GET' && url === '/orgs') {
    try {
      const htmlPath = path.join(ctx.__dirname, 'orgs.html');
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Inject this process's auth credential the same way GET / does for
      // dashboard.html — orgs.html's fetch() calls hit the same now
      // default-closed /api/* routes and need a way to know the token.
      html = html.replace(
        '<head>',
        `<head>\n<meta name="mm-token" content="${ctx.dashboardAuthValue}">`,
      );
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(html);
    } catch (err) {
      res.writeHead(404);
      res.end(`orgs.html not found: ${err.message}`);
    }
    return true;
  }

  // ------------------------------------------------ GET /orgs-files.js
  // Files-tab + diff-view script, split out of orgs.html (see orgs.html's
  // script-src comment). Not a generic static handler — this UI serves each
  // sibling asset via its own hardcoded route, same as GET /orgs above.
  if (req.method === 'GET' && url === '/orgs-files.js') {
    try {
      const jsPath = path.join(ctx.__dirname, 'orgs-files.js');
      const js = fs.readFileSync(jsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
    } catch (err) {
      res.writeHead(404);
      res.end(`orgs-files.js not found: ${err.message}`);
    }
    return true;
  }

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
        const lines = fs
          .readFileSync(evPath, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .slice(-10);
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
      // Try active run first, then fall back to most recent run file
      let runFile = null;
      if (runId) {
        const candidate = path.join(monoDir, 'orgs', orgName, 'runs', `${runId}.jsonl`);
        if (fs.existsSync(candidate)) runFile = candidate;
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
      const detectedRunId = path.basename(runFile, '.jsonl');
      const lines = fs
        .readFileSync(runFile, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .slice(-100);
      const events = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
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
        runs = fs
          .readFileSync(histFile, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
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

  // POST /api/knowledge/search — warm semantic knowledge search for hooks.
  // The dashboard server is the one long-lived process on the machine, so it
  // holds the local embedding model warm; per-prompt hook subprocesses (which
  // cannot afford a model load) POST here and fall back to keyword scoring
  // when this endpoint is cold/absent. Fully local — model + store on disk.
  if (req.method === 'POST' && url === '/api/knowledge/search') {
    let body = '';
    let overLimit = false;
    req.on('data', (c) => {
      if (overLimit) return;
      body += c;
      if (body.length > 64 * 1024) {
        // queries are prompts, not documents
        overLimit = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end('{"error":"request body too large"}');
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (overLimit) return;
      try {
        const payload = JSON.parse(body || '{}');
        const query = String(payload.query || '').slice(0, 2000);
        const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 3, 1), 10);
        const namespace =
          typeof payload.namespace === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(payload.namespace)
            ? payload.namespace
            : 'knowledge:shared';
        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"query required"}');
          return;
        }
        const bridge = await ctx._getKnowledgeBridge();
        if (!bridge) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end('{"error":"knowledge bridge unavailable"}');
          return;
        }
        // scope: project | global | all (default all) — project results get a
        // small tie boost; global hits are flagged so callers can show origin.
        const scope =
          payload.scope === 'project' || payload.scope === 'global' ? payload.scope : 'all';
        // Rule-based router (no LLM): chunks always run (this endpoint's
        // bread and butter); the auxiliary surfaces — distilled rules,
        // knowledge-graph triplets, pattern memories — only spend a query
        // when the router votes for them or routing is unconfident.
        let wantRules = true,
          wantKg = true,
          wantMemory = true;
        let rrfFuse = null;
        try {
          const routerMod = await import('../memory/query-router.js');
          const route = routerMod.routeQuery(query);
          rrfFuse = routerMod.rrfFuse;
          wantRules = !route.confident || route.surfaces.includes('rules');
          wantKg = !route.confident || route.surfaces.includes('kg');
          wantMemory = !route.confident || route.surfaces.includes('memory');
        } catch {
          /* router unavailable — keep all surfaces on */
        }
        let kgSearch = null;
        if (wantKg && scope !== 'global') {
          try {
            kgSearch = (await import('../memory/memory-kg.js')).kgSearch;
          } catch {
            /* kg unavailable */
          }
        }
        // Superseded-version filtering — the SAME rule `searchKnowledge` (and
        // therefore `monomind doc search` / `knowledge_search`) applies. This
        // endpoint queries the bridge directly for warmth, so without this it
        // would inject old document versions the Second Brain itself hides.
        let liveProj = new Set(),
          liveGlob = new Set(),
          isSuperseded = () => false,
          overfetch = (n) => n;
        // metaProj/metaGlob distinguish "no metadata log" (cannot judge, keep
        // everything) from "log exists and is empty" (every document was
        // removed, keep nothing). Without them, `doc remove` of the last
        // document left its chunks being injected into every prompt.
        let metaProj = false,
          metaGlob = false;
        try {
          const dp = await import('../knowledge/document-pipeline.js');
          // CLAUDE_PROJECT_DIR is whatever directory the user opened, which
          // can be a package subdirectory, while the CLI writes the metadata
          // log at the project root. Walk up to the nearest one that has it:
          // resolving the wrong root yields an empty live set, which silently
          // turns filtering OFF — and superseded rows are the large majority
          // of a long-lived store, so injection would be dominated by stale
          // document versions.
          const resolveKnowledgeRoot = (start) => {
            let probe = path.resolve(start);
            for (let up = 0; up < 8; up++) {
              if (dp.hasKnowledgeMetadata?.(probe)) return probe;
              const parent = path.dirname(probe);
              if (parent === probe) break;
              probe = parent;
            }
            return path.resolve(start);
          };
          const projRoot = resolveKnowledgeRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
          const globRoot =
            process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
            path.join(os.homedir(), '.monomind', 'global-brain');
          liveProj = dp.liveContentHashes(projRoot);
          liveGlob = dp.liveContentHashes(globRoot);
          metaProj = dp.hasKnowledgeMetadata?.(projRoot) ?? liveProj.size > 0;
          metaGlob = dp.hasKnowledgeMetadata?.(globRoot) ?? liveGlob.size > 0;
          isSuperseded = dp.isSupersededKey;
          overfetch = dp.supersededOverfetchLimit;
        } catch {
          /* pipeline unavailable — no filtering, same as before */
        }
        const keepLive = (rows, live, hasMeta) =>
          (rows || [])
            .filter((r) => !isSuperseded(String(r.key || ''), live, hasMeta))
            .slice(0, limit);
        const [projRaw, globRaw, rules, graph, mems] = await Promise.all([
          scope !== 'global'
            ? bridge
                .bridgeSearchEntries({ query, namespace, limit: overfetch(limit, liveProj) })
                .catch(() => null)
            : null,
          scope !== 'project'
            ? bridge
                .bridgeSearchEntries({
                  query,
                  namespace: 'knowledge:global',
                  limit: overfetch(limit, liveGlob),
                  dbPath: '@global',
                })
                .catch(() => null)
            : null,
          // Distilled rules ("when X do Y") learned from sessions/runs —
          // small namespace, high injection value, threshold keeps it quiet.
          scope !== 'global' && wantRules
            ? bridge
                .bridgeSearchEntries({ query, namespace: 'rules', limit: 2, threshold: 0.45 })
                .catch(() => null)
            : null,
          // Knowledge-graph triplets: relationship-shaped queries surface
          // facts no chunk contains. Triplet scores derive from seeded
          // cosine matches (≥0.35), so they clear callers' relevance floors.
          scope !== 'global' && kgSearch ? kgSearch({ query, limit: 4 }).catch(() => null) : null,
          // Past patterns/decisions for "last time / previously" queries.
          scope !== 'global' && wantMemory
            ? bridge
                .bridgeSearchEntries({ query, namespace: 'patterns', limit: 2, threshold: 0.4 })
                .catch(() => null)
            : null,
        ]);
        const lists = [
          keepLive(projRaw?.results, liveProj, metaProj).map((r) => ({
            id: r.id,
            key: r.key,
            content: String(r.content || '').slice(0, 2000),
            score: r.score + 0.05,
            global: false,
            tags: r.tags,
            importance: 0.6,
          })),
          keepLive(globRaw?.results, liveGlob, metaGlob).map((r) => ({
            id: r.id,
            key: r.key,
            content: String(r.content || '').slice(0, 2000),
            score: r.score,
            global: true,
            tags: r.tags,
          })),
          (rules?.results || []).map((r) => ({
            id: r.id,
            key: r.key,
            content: String(r.content || '').slice(0, 2000),
            score: r.score + 0.05,
            global: false,
            rule: true,
            tags: r.tags,
            importance: 0.7,
          })),
          (graph?.triplets || []).map((t, i) => ({
            id: `kg:${i}:${t.source}|${t.relation}|${t.target}`,
            key: `kg:${t.source}`,
            content: String(
              t.source +
                ' —' +
                t.relation +
                '→ ' +
                t.target +
                (t.fact && t.fact !== `${t.source} ${t.relation} ${t.target}`
                  ? ` (${String(t.fact).slice(0, 300)})`
                  : ''),
            ).slice(0, 2000),
            score: t.score,
            global: false,
            triplet: true,
          })),
          (mems?.results || []).map((r) => ({
            id: r.id,
            key: r.key,
            content: String(r.content || '').slice(0, 2000),
            score: r.score,
            global: false,
            memory: true,
            tags: r.tags,
          })),
        ];
        // Rank-fuse across surfaces (raw scores aren't comparable between
        // cosine chunks and blended triplets); each item keeps its native
        // score so downstream relevance floors still apply. Fallback: flat
        // score sort when the router module failed to load.
        const merged = (
          rrfFuse
            ? rrfFuse(lists, limit)
            : lists
                .flat()
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
        ).map(({ importance, rrf, ...r }) => r);
        // Served excerpts are (very likely) injected into the caller's prompt —
        // that IS usage. Reinforce frequency_weight, per-store, fire-and-forget.
        try {
          const projIds = merged.filter((m) => !m.global && !m.triplet && m.id).map((m) => m.id);
          const globIds = merged.filter((m) => m.global && m.id).map((m) => m.id);
          if (projIds.length) bridge.bridgeRecordUsage?.({ entryIds: projIds }).catch(() => {});
          if (globIds.length)
            bridge.bridgeRecordUsage?.({ entryIds: globIds, dbPath: '@global' }).catch(() => {});
        } catch {
          /* best effort */
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(
          JSON.stringify({
            method:
              projRaw?.searchMethod ||
              globRaw?.searchMethod ||
              rules?.searchMethod ||
              mems?.searchMethod ||
              (merged.length ? 'mixed' : 'none'),
            results: merged,
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // GET /api/mastermind/metrics — aggregate system metrics from token-summary and monoswarm-activity
  if (req.method === 'GET' && url === '/api/mastermind/metrics') {
    try {
      const base = path.join(ctx.projectDir || process.cwd(), '.monomind', 'metrics');
      let tokens = {},
        monoswarm = {},
        events = [];
      try {
        tokens = JSON.parse(fs.readFileSync(path.join(base, 'token-summary.json'), 'utf8'));
      } catch (_) {}
      try {
        monoswarm = JSON.parse(fs.readFileSync(path.join(base, 'monoswarm-activity.json'), 'utf8'));
      } catch (_) {}
      try {
        const evPath = path.join(
          ctx.projectDir || process.cwd(),
          'data',
          'mastermind-events.jsonl',
        );
        const lines = fs
          .readFileSync(evPath, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .slice(-20);
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
      res.end(JSON.stringify({ tokens, monoswarm, recentEvents: events }));
    } catch (_) {
      res.writeHead(500);
      res.end('{"tokens":{},"monoswarm":{},"recentEvents":[]}');
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

  // ---- POST /api/orgs/:name/mark-complete — manual STALE recovery ----
  if (
    req.method === 'POST' &&
    /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/mark-complete$/i.test(url)
  ) {
    const _mcOrgName = decodeURIComponent(url.split('/')[3]);
    if (_mcOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_mcOrgName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid org name' }));
      return true;
    }
    const _mcRoot = ctx.projectDir || process.cwd();
    const _mcMonoDir = ctx._getGitMonomindDir(_mcRoot) || path.join(_mcRoot, '.monomind');
    const _mcRunId = ctx.activeOrgRuns.get(_mcOrgName) || ctx._getActiveRunId(_mcOrgName, _mcRoot);
    if (!_mcRunId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No active run for org: ${_mcOrgName}` }));
      return true;
    }
    const _mcEvent = {
      type: 'run:complete',
      org: _mcOrgName,
      runId: _mcRunId,
      ts: Date.now(),
      reason: 'manual',
    };
    try {
      const _mcRunFile = path.join(_mcMonoDir, 'orgs', _mcOrgName, 'runs', `${_mcRunId}.jsonl`);
      if (fs.existsSync(_mcRunFile))
        await ctx.appendToFile(_mcRunFile, `${JSON.stringify(_mcEvent)}\n`);
      ctx.activeOrgRuns.delete(_mcOrgName);
      // Clean up ppid-keyed active-run files for this org
      const _mcCapDir = path.join(ctx.MONOMIND_HOME, '.monomind', 'capture');
      try {
        const _mcPpidDir = path.join(_mcCapDir, 'active-runs');
        if (fs.existsSync(_mcPpidDir)) {
          fs.readdirSync(_mcPpidDir)
            .filter((f) => f.endsWith('.json'))
            .forEach((_pf) => {
              try {
                const _pd = JSON.parse(fs.readFileSync(path.join(_mcPpidDir, _pf), 'utf8'));
                if (_pd.org === _mcOrgName) fs.unlinkSync(path.join(_mcPpidDir, _pf));
              } catch (_) {}
            });
        }
        const _mcActiveFile = path.join(_mcCapDir, 'active-run.json');
        if (fs.existsSync(_mcActiveFile)) {
          try {
            const _a = JSON.parse(fs.readFileSync(_mcActiveFile, 'utf8'));
            if (_a.org === _mcOrgName) fs.unlinkSync(_mcActiveFile);
          } catch (_) {}
        }
      } catch (_) {}
      ctx._updateRunState(_mcEvent, _mcRoot);
      ctx.broadcastMm(_mcEvent);
      const _mcFwdClients = ctx.runStreamClients.get(_mcOrgName);
      if (_mcFwdClients && _mcFwdClients.size > 0) {
        const _mcLine = `data: ${JSON.stringify(_mcEvent)}\n\n`;
        for (const _cl of _mcFwdClients) {
          try {
            _cl.write(_mcLine);
          } catch (_) {
            _mcFwdClients.delete(_cl);
          }
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, runId: _mcRunId }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ---- GET /api/orgs/:name/runs/current/stream — Phase 3 streaming tail ----
  if (
    req.method === 'GET' &&
    /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/runs\/current\/stream$/i.test(url)
  ) {
    const _stOrgName = decodeURIComponent(url.split('/')[3]);
    if (_stOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_stOrgName)) {
      res.writeHead(400);
      res.end('Invalid org name');
      return true;
    }
    const _stQs = new URL(req.url, 'http://localhost').searchParams;
    const _stSince = Math.max(0, parseInt(_stQs.get('since') || '0', 10) || 0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    // Register client for live events
    if (!ctx.runStreamClients.has(_stOrgName)) ctx.runStreamClients.set(_stOrgName, new Set());
    ctx.runStreamClients.get(_stOrgName).add(res);
    // Replay events since `since` (SQLite row id cursor; falls back to JSONL line offset)
    try {
      let _stReplayedViaSqlite = false;
      if (ctx._runDb) {
        // SQLite path: cursor is last row id seen (client sends 0 on first connect)
        const _stStmt = ctx._runDb.prepare(
          'SELECT id, raw FROM run_events WHERE org=? AND id > ? ORDER BY id LIMIT 2000',
        );
        _stStmt.bind([_stOrgName, _stSince]);
        let _stLastId = _stSince;
        while (_stStmt.step()) {
          const _stRow = _stStmt.getAsObject();
          try {
            res.write(`data: ${_stRow.raw}\n\n`);
            _stLastId = _stRow.id;
          } catch (_) {
            break;
          }
        }
        _stStmt.free();
        if (_stLastId > _stSince) {
          // SQLite had rows — send cursor and skip JSONL fallback
          res.write(
            `data: ${JSON.stringify({ type: 'stream:replay-done', count: _stLastId })}\n\n`,
          );
          _stReplayedViaSqlite = true;
        }
      }
      if (!_stReplayedViaSqlite) {
        // JSONL fallback: SQLite absent or returned 0 rows — read directly from run file.
        // `since` is a 0-based line offset in this path.
        const _stRoot = ctx.projectDir || process.cwd();
        const _stRunId =
          ctx.activeOrgRuns.get(_stOrgName) || ctx._getActiveRunId(_stOrgName, _stRoot);
        if (_stRunId) {
          const _stMono = ctx._getGitMonomindDir(_stRoot) || path.join(_stRoot, '.monomind');
          const _stRunFile = path.join(_stMono, 'orgs', _stOrgName, 'runs', `${_stRunId}.jsonl`);
          if (fs.existsSync(_stRunFile)) {
            const _stLines = fs.readFileSync(_stRunFile, 'utf8').trim().split('\n').filter(Boolean);
            for (let _i = _stSince; _i < _stLines.length; _i++) {
              try {
                res.write(`data: ${_stLines[_i]}\n\n`);
              } catch (_) {
                break;
              }
            }
            res.write(
              `data: ${JSON.stringify({ type: 'stream:replay-done', count: _stLines.length })}\n\n`,
            );
          } else {
            res.write(`data: ${JSON.stringify({ type: 'stream:replay-done', count: 0 })}\n\n`);
          }
        } else {
          res.write(`data: ${JSON.stringify({ type: 'stream:replay-done', count: 0 })}\n\n`);
        }
      }
    } catch (_) {}
    const _stKa = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(_stKa);
      }
    }, 20000);
    req.on('close', () => {
      clearInterval(_stKa);
      const _stClients = ctx.runStreamClients.get(_stOrgName);
      if (_stClients) {
        _stClients.delete(res);
        if (_stClients.size === 0) ctx.runStreamClients.delete(_stOrgName);
      }
    });
    return true;
  }

  // ---- POST /api/orgs/:name/chat — user sends a message to a running org ----
  if (req.method === 'POST' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/chat$/i.test(url)) {
    let _chBody = '';
    for await (const chunk of req) {
      _chBody += chunk;
      if (_chBody.length > 65536) {
        req.destroy();
        break;
      }
    }
    try {
      const _chOrgName = decodeURIComponent(url.split('/')[3]);
      if (_chOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_chOrgName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid org name' }));
        return true;
      }
      let _chPayload = {};
      try {
        _chPayload = JSON.parse(_chBody);
      } catch (_) {}
      const _chText = String(_chPayload.text || '')
        .trim()
        .slice(0, 4096);
      if (!_chText) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return true;
      }
      const _chQs = new URL(req.url, 'http://localhost').searchParams;
      const _chServerRoot = path.resolve(_chQs.get('dir') || ctx.projectDir || process.cwd());
      const _chRoot = ctx._resolveOrgProjectDir(_chOrgName, _chServerRoot) || _chServerRoot;
      const _chMonoDir = ctx._getGitMonomindDir(_chRoot) || path.join(_chRoot, '.monomind');
      const _chRunId =
        ctx.activeOrgRuns.get(_chOrgName) || ctx._getActiveRunId(_chOrgName, _chRoot);
      const _chEvent = {
        type: 'user:message',
        org: _chOrgName,
        runId: _chRunId || null,
        text: _chText,
        ts: Date.now(),
      };
      // Write to run JSONL if active run exists
      if (_chRunId) {
        const _chRunFile = path.join(_chMonoDir, 'orgs', _chOrgName, 'runs', `${_chRunId}.jsonl`);
        if (fs.existsSync(_chRunFile))
          await ctx.appendToFile(_chRunFile, `${JSON.stringify(_chEvent)}\n`);
      }
      // Write to mailbox file so boss agent can pick up on next cycle (durable
      // record + offline fallback — the live-delivery attempt below is best-effort)
      const _chMailbox = path.join(_chRoot, '.monomind', 'orgs', `${_chOrgName}-threads.json`);
      try {
        let _chThreads = { messages: [] };
        if (fs.existsSync(_chMailbox)) {
          try {
            _chThreads = JSON.parse(fs.readFileSync(_chMailbox, 'utf8'));
          } catch (_) {}
        }
        if (!Array.isArray(_chThreads.messages)) _chThreads.messages = [];
        _chThreads.messages.push({ text: _chText, ts: _chEvent.ts, status: 'pending' });
        fs.writeFileSync(_chMailbox, JSON.stringify(_chThreads, null, 2));
      } catch (_) {}
      // Broadcast to SSE stream clients
      ctx.broadcastMm(_chEvent);
      const _chFwdClients = ctx.runStreamClients.get(_chOrgName);
      if (_chFwdClients && _chFwdClients.size > 0) {
        const _chLine = `data: ${JSON.stringify(_chEvent)}\n\n`;
        for (const _cl of _chFwdClients) {
          try {
            _cl.write(_chLine);
          } catch (_) {
            _chFwdClients.delete(_cl);
          }
        }
      }
      // Forward to the org's live process (if any) so the message actually lands in a
      // running role's mailbox — looked up via the same file-based broker registry
      // orgrt's cross-process delivery already uses (mirrors POST /api/questions/answer).
      let _chDelivered = false;
      try {
        const _chBrokerEntryPath = path.join(
          os.homedir(),
          '.monomind',
          'orgrt-broker',
          `${_chOrgName}.json`,
        );
        const _chBrokerEntry = JSON.parse(fs.readFileSync(_chBrokerEntryPath, 'utf8'));
        if (Date.now() - _chBrokerEntry.updatedAt < 90000 && _chBrokerEntry.url) {
          let _chTargetRole = _chPayload.role;
          if (!_chTargetRole) {
            try {
              const _chCfg = JSON.parse(
                fs.readFileSync(
                  path.join(_chRoot, '.monomind', 'orgs', `${_chOrgName}.json`),
                  'utf8',
                ),
              );
              const _chRoles = Array.isArray(_chCfg.roles) ? _chCfg.roles : [];
              const _chBoss =
                _chRoles.find((r) => r.type === 'boss' || r.reports_to === null) || _chRoles[0];
              _chTargetRole = _chBoss?.id;
            } catch (_) {}
          }
          if (_chTargetRole) {
            const _chFwd = await fetch(`${_chBrokerEntry.url}/api/human-message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ org: _chOrgName, role: _chTargetRole, text: _chText }),
              signal: AbortSignal.timeout(5000),
            });
            const _chFwdData = await _chFwd.json().catch(() => ({}));
            _chDelivered = !!(_chFwd.ok && _chFwdData.ok);
          }
        }
      } catch (_) {}
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, delivered: _chDelivered }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }
  return false;
}
