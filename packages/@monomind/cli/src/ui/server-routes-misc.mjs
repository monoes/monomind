import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeOurProcess } from './server-rundb.mjs';

// The token tracker that ships with the CLI package (package.json "files"
// includes .claude). It reads ~/.claude globally, so ?dir= only picks the
// fallback metrics file — never which code runs: a project's own
// .claude/helpers/token-tracker.cjs is writable by any agent in it.
// src/ui and dist/src/ui sit two and three levels below the package root.
export function bundledTokenTrackerPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const up of [
    ['..', '..'],
    ['..', '..', '..'],
  ]) {
    const p = path.join(here, ...up, '.claude', 'helpers', 'token-tracker.cjs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Shutdown + token-usage routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesMisc(req, res, url, corsOrigin, ctx) {
  const { projectDir, shutdown } = ctx;
  // -------------------------------------------------- POST /api/shutdown
  if (req.method === 'POST' && url === '/api/shutdown') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify({ ok: true }));
    // Kill monograph watcher if running
    const d = projectDir || process.cwd();
    for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
      try {
        const wp = path.join(d, '.monomind', pidName);
        if (fs.statSync(wp).size > 32) continue;
        const wpid = parseInt(fs.readFileSync(wp, 'utf-8').trim(), 10);
        if (!Number.isInteger(wpid) || wpid <= 0) {
          try {
            fs.unlinkSync(wp);
          } catch {}
          continue;
        }
        if (looksLikeOurProcess(wpid, d)) process.kill(wpid, 'SIGTERM');
        try {
          fs.unlinkSync(wp);
        } catch {}
      } catch {}
    }
    // Remove control.json so startup knows we're gone
    try {
      fs.unlinkSync(path.join(d, '.monomind', 'control.json'));
    } catch {}
    setTimeout(shutdown, 100);
    return true;
  }

  // -------------------------------------------------- GET /api/token-usage
  if (req.method === 'GET' && url.startsWith('/api/token-usage')) {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      // Frontend sends ?range=..., older callers use ?period=... — accept both
      const _periodRaw = qs.get('period') || qs.get('range');
      const period = ['today', 'week', '30days', 'month'].includes(_periodRaw)
        ? _periodRaw
        : 'today';
      const dir = path.resolve(qs.get('dir') || projectDir || process.cwd());
      const trackerPath = bundledTokenTrackerPath();
      const fallback = () => {
        const summary = (() => {
          try {
            return JSON.parse(
              fs.readFileSync(path.join(dir, '.monomind', 'metrics', 'token-summary.json'), 'utf8'),
            );
          } catch {
            return {};
          }
        })();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        const fbSum = {
          todayCost: summary.todayCost || 0,
          cost: summary.todayCost || 0,
          todayCalls: summary.todayCalls || 0,
          calls: summary.todayCalls || 0,
          totalTokens: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          cacheTokens: 0,
          modelCount: 0,
        };
        res.end(
          JSON.stringify({
            summary: fbSum,
            totalCost: summary.todayCost || 0,
            totalCalls: summary.todayCalls || 0,
            totalIn: 0,
            totalOut: 0,
            totalCR: 0,
            totalCW: 0,
            rows: [],
            models: [],
            categories: [],
            tools: [],
            mcpServers: [],
            projects: [],
            modelBreakdown: {},
            categoryBreakdown: {},
            toolBreakdown: {},
            mcpBreakdown: {},
            periodLabel: period,
          }),
        );
      };
      if (!trackerPath) {
        fallback();
        return true;
      }
      try {
        const _req = createRequire(import.meta.url);
        const tracker = _req(trackerPath);
        const range = tracker.getDateRange(period);
        const projects = tracker.parseAllSessions(range.start, range.end);
        let totalCost = 0,
          totalIn = 0,
          totalOut = 0,
          totalCR = 0,
          totalCW = 0,
          totalCalls = 0;
        const modelBreakdown = {},
          categoryBreakdown = {},
          toolBreakdown = {},
          mcpBreakdown = {};
        for (const p of projects) {
          totalCost += p.totalCost || 0;
          for (const s of p.sessions || []) {
            totalIn += s.totalInputTokens || 0;
            totalOut += s.totalOutputTokens || 0;
            totalCR += s.totalCacheRead || 0;
            totalCW += s.totalCacheWrite || 0;
            totalCalls += s.apiCalls || 0;
            for (const [mn, m] of Object.entries(s.modelBreakdown || {})) {
              if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
              modelBreakdown[mn].calls += m.calls || 0;
              modelBreakdown[mn].cost += m.cost || 0;
              modelBreakdown[mn].tokens += m.tokens || 0;
            }
            for (const [cat, c] of Object.entries(s.categoryBreakdown || {})) {
              if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { turns: 0, cost: 0 };
              categoryBreakdown[cat].turns += c.turns || 0;
              categoryBreakdown[cat].cost += c.cost || 0;
            }
            for (const [tool, t] of Object.entries(s.toolBreakdown || {})) {
              if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
              toolBreakdown[tool].calls += t.calls || 0;
            }
            for (const [srv, m] of Object.entries(s.mcpBreakdown || {})) {
              if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
              mcpBreakdown[srv].calls += m.calls || 0;
            }
          }
        }
        // Build client-friendly arrays from breakdown dicts
        const models = Object.entries(modelBreakdown)
          .map(([model, m]) => ({ model, cost: m.cost, calls: m.calls, tokens: m.tokens }))
          .sort((a, b) => b.cost - a.cost);
        const categories = Object.entries(categoryBreakdown)
          .map(([category, c]) => ({ category, turns: c.turns, cost: c.cost }))
          .sort((a, b) => b.turns - a.turns);
        const tools = Object.entries(toolBreakdown)
          .map(([tool, t]) => ({ tool, count: t.calls }))
          .sort((a, b) => b.count - a.count);
        const mcpServers = Object.entries(mcpBreakdown)
          .map(([server, m]) => ({ server, count: m.calls }))
          .sort((a, b) => b.count - a.count);
        const projectRows = projects
          .map((p) => ({ project: p.name || p.slug || p.dir || '?', cost: p.totalCost || 0 }))
          .sort((a, b) => b.cost - a.cost);
        // Build rows array from sessions for per-session table
        const rows = [];
        for (const p of projects) {
          for (const s of p.sessions || []) {
            rows.push({
              id: s.id || '',
              session: s.lastPrompt || s.id || '',
              calls: s.apiCalls || 0,
              cost: s.totalCost || 0,
              tokens: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
            });
          }
        }
        rows.sort((a, b) => b.cost - a.cost);
        // Summary object matching client expectations
        const summary = {
          todayCost: totalCost,
          cost: totalCost,
          todayCalls: totalCalls,
          calls: totalCalls,
          totalTokens: totalIn + totalOut,
          totalTokensIn: totalIn,
          totalTokensOut: totalOut,
          cacheTokens: totalCR,
          modelCount: models.length,
        };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(
          JSON.stringify({
            summary,
            totalCost,
            totalCalls,
            totalIn,
            totalOut,
            totalCR,
            totalCW,
            rows,
            models,
            categories,
            tools,
            mcpServers,
            projects: projectRows,
            modelBreakdown,
            categoryBreakdown,
            toolBreakdown,
            mcpBreakdown,
            periodLabel: period,
          }),
        );
      } catch (_e) {
        fallback();
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
