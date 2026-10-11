import fs from 'node:fs';
import path from 'node:path';
import { collectAllProjects } from './collector-allprojects.mjs';
import { listDir, readJSON } from './collector-helpers.mjs';
import {
  collectAgents,
  collectProject,
  collectSessions,
  collectSwarm,
  getClaudeProjectSessionsDir,
} from './collector-project.mjs';
import {
  collectHooks,
  collectKnowledge,
  collectMemory,
  collectMemoryFiles,
  collectMetrics,
  collectSystem,
  collectTriggers,
} from './collector-status.mjs';

// Single source-of-truth for all model pricing (canonical list from src/pricing/model-pricing.ts).
// server.mjs imports _tokPrice and _tokCost from here instead of duplicating this table.
const _TOK_PRICES = {
  // Opus
  'claude-fable-5-1': { in: 10e-6, out: 50e-6, cw: 12.5e-6, cr: 0.25e-6 },
  'claude-opus-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-7': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-6': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-1': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  // Sonnet
  'claude-sonnet-5': { in: 2e-6, out: 10e-6, cw: 2.5e-6, cr: 0.2e-6 },
  'claude-sonnet-4-6': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-sonnet-4-5': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-sonnet-4': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-3-7-sonnet': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-3-5-sonnet': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  // Haiku
  'claude-haiku-4-5': { in: 1e-6, out: 5e-6, cw: 1.25e-6, cr: 0.1e-6 },
  'claude-haiku-4': { in: 0.8e-6, out: 4e-6, cw: 1e-6, cr: 0.08e-6 },
  'claude-3-5-haiku': { in: 0.8e-6, out: 4e-6, cw: 1e-6, cr: 0.08e-6 },
  // OpenAI
  'gpt-5': { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6 },
  'gpt-4o': { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6 },
  'gpt-4o-mini': { in: 0.15e-6, out: 0.6e-6, cw: 0.15e-6, cr: 0.075e-6 },
  // Google
  'gemini-2.5-pro': { in: 1.25e-6, out: 10e-6, cw: 1.25e-6, cr: 0.315e-6 },
};
function _tokPrice(model) {
  const _ALIAS = {
    haiku: 'claude-haiku-4-5-20251001',
    opus: 'claude-opus-5',
    // claude-sonnet-5 = DEFAULT_CLAUDE_MODEL (src/orgrt/vercel-providers.ts); .mjs can't import TS.
    sonnet: 'claude-sonnet-5',
    fable: 'claude-fable-5-1',
  };
  let k = (model || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  k = _ALIAS[k] || k;
  if (_TOK_PRICES[k]) return _TOK_PRICES[k];
  for (const p of Object.keys(_TOK_PRICES)) {
    if (k.startsWith(p) || k.includes(p)) return _TOK_PRICES[p];
  }
  // #124: previously silently returned a hardcoded Sonnet rate here, so an
  // unrecognized model (e.g. a newly-released one not yet in this table)
  // was costed AS Sonnet with no indication anything was estimated —
  // wrong in either direction depending on the actual model's real price.
  // null (matching server.mjs's _sjGetPricing) is the honest answer: "we
  // don't know" is not the same claim as "$0" or "same as Sonnet".
  return null;
}
/** True when this model has a pricing row (directly, by alias, or by prefix match). Mirrors server.mjs's _sjHasPricing. */
function _tokHasPricing(model) {
  return _tokPrice(model) !== null;
}
function _tokCost(model, usage) {
  const p = _tokPrice(model);
  if (!p) return 0; // unpriced model — see _tokPrice's comment; 0 here, not a guessed price
  const webSearch = (usage.server_tool_use?.web_search_requests || 0) * 0.01;
  return (
    (usage.input_tokens || 0) * p.in +
    (usage.output_tokens || 0) * p.out +
    (usage.cache_creation_input_tokens || 0) * p.cw +
    (usage.cache_read_input_tokens || 0) * p.cr +
    webSearch
  );
}

function collectTokens(projectDir, days = 14) {
  const base = path.join(projectDir, '.monomind', 'metrics');
  const summary = readJSON(path.join(base, 'token-summary.json')) || {};

  // Scan session JSONLs to build daily chart data and per-session rows
  const sessionsDir = getClaudeProjectSessionsDir(projectDir);
  const jsonlFiles = listDir(sessionsDir).filter((f) => f.endsWith('.jsonl'));

  const dailyMap = {}; // date-string → { cost, calls, tokensIn, tokensOut }
  const rows = []; // per-session summary
  const unknownModels = new Set(); // models with no pricing row (their cost counts as 0)
  let totalTokensIn = 0,
    totalTokensOut = 0;

  // Cutoff: look back `days` days
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  // Month cutoff: first day of the current UTC month — needed to compute monthCost accurately
  // even when the month started more than `days` days ago.
  const now = new Date();
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Effective scan floor is the earlier of the two cutoffs (broader window covers both needs).
  const scanCutoff = Math.min(cutoff, monthStartMs);
  const scanCutoffDate = new Date(scanCutoff).toISOString().slice(0, 10);
  const monthPrefix = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  for (const fname of jsonlFiles) {
    const fpath = path.join(sessionsDir, fname);
    let stat;
    try {
      stat = fs.statSync(fpath);
    } catch {
      continue;
    }
    // Skip very old sessions for performance (mtime heuristic).
    // Use scanCutoff (which may reach back to month start) minus a 7-day buffer.
    if (stat.mtimeMs < scanCutoff - 7 * 24 * 60 * 60 * 1000) continue;

    let content;
    try {
      content = fs.readFileSync(fpath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    let sessTokensIn = 0,
      sessTokensOut = 0,
      sessCost = 0,
      sessCalls = 0,
      sessIncomplete = false;
    let sessLastPrompt = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Capture last user prompt for session label
      if (entry.type === 'user') {
        const txt = Array.isArray(entry.message?.content)
          ? (entry.message.content.find((b) => b.type === 'text')?.text || '').slice(0, 60)
          : String(entry.message?.content || '').slice(0, 60);
        if (txt.trim()) sessLastPrompt = txt.trim();
      }

      if (entry.type === 'assistant' && entry.message?.usage) {
        const usage = entry.message.usage;
        const model = entry.message.model || '';
        const cost = _tokCost(model, usage);
        const unpriced = !_tokHasPricing(model);
        if (unpriced) unknownModels.add(model || '(unknown)');
        const tokIn =
          (usage.input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0);
        const tokOut = usage.output_tokens || 0;
        const ts = entry.timestamp || '';
        const day = ts.slice(0, 10); // "YYYY-MM-DD"

        if (day && day >= scanCutoffDate) {
          if (!dailyMap[day])
            dailyMap[day] = { cost: 0, calls: 0, tokensIn: 0, tokensOut: 0, costIncomplete: false };
          dailyMap[day].cost += cost;
          if (unpriced) dailyMap[day].costIncomplete = true;
          dailyMap[day].calls++;
          dailyMap[day].tokensIn += tokIn;
          dailyMap[day].tokensOut += tokOut;
        }

        sessTokensIn += tokIn;
        sessTokensOut += tokOut;
        sessCost += cost;
        if (unpriced) sessIncomplete = true;
        sessCalls++;
        totalTokensIn += tokIn;
        totalTokensOut += tokOut;
      }
    }

    if (sessCalls > 0) {
      rows.push({
        id: fname.replace('.jsonl', ''),
        session: sessLastPrompt || fname.replace('.jsonl', '').slice(0, 20),
        calls: sessCalls,
        tokens: sessTokensIn + sessTokensOut,
        cost: sessCost,
        costIncomplete: sessIncomplete,
      });
    }
  }

  // Build sorted daily array
  const daily = Object.keys(dailyMap)
    .sort()
    .slice(-days)
    .map((d) => ({
      date: d,
      label: d.slice(5), // "MM-DD"
      cost: dailyMap[d].cost,
      calls: dailyMap[d].calls,
      tokensIn: dailyMap[d].tokensIn,
      tokensOut: dailyMap[d].tokensOut,
      costIncomplete: dailyMap[d].costIncomplete,
    }));

  // Sort rows by cost descending
  rows.sort((a, b) => b.cost - a.cost);

  const totalTokens = totalTokensIn + totalTokensOut;
  if (totalTokens > 0) summary.totalTokens = totalTokens;

  // Overwrite stale cached todayCost/todayCalls with fresh JSONL-derived values.
  // daily uses UTC date keys (entry.timestamp.slice(0,10)), so match that here.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayEntry = dailyMap[todayKey];
  summary.todayCost = todayEntry ? todayEntry.cost : 0;
  summary.todayCalls = todayEntry ? todayEntry.calls : 0;
  summary.todayCostIncomplete = !!todayEntry?.costIncomplete;

  // Overwrite stale monthCost/monthCalls from fresh JSONL dailyMap entries.
  // dailyMap now covers back to the start of the current month (scanCutoff), so
  // summing entries whose key starts with the current "YYYY-MM" prefix gives the
  // true month-to-date spend — no stale token-summary.json cache involved.
  let monthCostAcc = 0,
    monthCallsAcc = 0;
  for (const [d, v] of Object.entries(dailyMap)) {
    if (d.startsWith(monthPrefix)) {
      monthCostAcc += v.cost;
      monthCallsAcc += v.calls;
    }
  }
  summary.monthCost = monthCostAcc;
  summary.monthCalls = monthCallsAcc;
  summary.monthCostIncomplete = Object.entries(dailyMap).some(
    ([d, v]) => d.startsWith(monthPrefix) && v.costIncomplete,
  );
  // True when any scanned call used a model without a pricing row: the cost
  // figures above then undercount (unpriced calls add $0), so UIs must not
  // present them as exact.
  summary.costIncomplete = unknownModels.size > 0;
  summary.unknownPricingModels = [...unknownModels].sort();

  return { summary, daily, rows };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function collectAll(projectDir) {
  const resolvedDir = path.resolve(projectDir);

  return {
    timestamp: Date.now(),
    project: collectProject(resolvedDir),
    sessions: collectSessions(resolvedDir),
    swarm: collectSwarm(resolvedDir),
    agents: collectAgents(resolvedDir),
    tokens: collectTokens(resolvedDir),
    hooks: collectHooks(resolvedDir),
    knowledge: collectKnowledge(resolvedDir),
    metrics: collectMetrics(resolvedDir),
    triggers: collectTriggers(resolvedDir),
    memory: collectMemory(resolvedDir),
    system: collectSystem(),
    allProjects: collectAllProjects(),
  };
}

export {
  _tokCost,
  _tokHasPricing,
  _tokPrice,
  collectAgents,
  collectAllProjects,
  collectHooks,
  collectKnowledge,
  collectMemory,
  collectMemoryFiles,
  collectMetrics,
  collectProject,
  collectSessions,
  collectSwarm,
  collectSystem,
  collectTokens,
};

export function getWatchPaths(projectDir) {
  const resolvedDir = path.resolve(projectDir);
  const m = path.join(resolvedDir, '.monomind');
  const c = path.join(resolvedDir, '.claude');

  return [
    // Swarm
    path.join(m, 'swarm', 'history.jsonl'),
    path.join(m, 'swarm-config.json'),
    // Metrics
    path.join(m, 'metrics', 'monoswarm-activity.json'),
    path.join(m, 'metrics', 'token-summary.json'),
    path.join(m, 'metrics', 'token-sessions.json'),
    path.join(m, 'metrics', 'ddd-progress.json'),
    path.join(m, 'metrics', 'codebase-map.json'),
    path.join(m, 'metrics', 'security-audit.json'),
    path.join(m, 'metrics', 'performance.json'),
    path.join(m, 'metrics', 'consolidation.json'),
    // Agents
    path.join(m, 'registry.json'),
    path.join(m, 'agents', 'registrations'),
    // Hooks / routing
    path.join(m, 'last-route.json'),
    path.join(m, 'routing-feedback.jsonl'),
    path.join(m, 'worker-dispatch'),
    // Knowledge
    path.join(m, 'knowledge', 'chunks.jsonl'),
    path.join(m, 'skills.jsonl'),
    // Triggers & memory — live v2 sources
    path.join(m, 'trigger-index.json'),
    path.join(m, 'data', 'auto-memory-store.json'),
    path.join(m, 'episodic', 'episodes.jsonl'),
    // Sessions
    path.join(c, 'sessions'),
  ];
}
