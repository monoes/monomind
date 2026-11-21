/**
 * Hooks MCP Tools — metrics and list.
 * Extracted from hooks-routing.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMcpString } from '../utils/input-guards.js';
import { loadMemoryStore } from './hooks-embedding.js';
import { getProjectCwd, type MCPTool } from './types.js';

export const hooksMetrics: MCPTool = {
  name: 'hooks_metrics',
  description: 'View recorded routing/outcome metrics',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', description: 'Metrics period (1h, 24h, 7d, 30d)' },
      includeV1: { type: 'boolean', description: 'Include v1 performance metrics' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const period = validateMcpString(params.period, 'period', 32) ?? '24h';

    // Try to read real counts from memory store
    const store = loadMemoryStore();
    const entries = Object.values(store.entries);

    // Count patterns by looking at stored pattern entries
    const patternEntries = entries.filter((e) => e.key.includes('pattern'));
    const routingEntries = entries.filter(
      (e) => e.key.includes('route') || e.key.includes('routing'),
    );
    const taskEntries = entries.filter((e) => e.key.includes('task'));

    if (entries.length === 0) {
      return {
        _real: true,
        _note:
          'No metrics data collected yet. Data populates from hooks_post-task, hooks_post-edit, hooks_post-command, and hooks_route calls.',
        period,
        patterns: { total: 0, successful: 0, failed: 0, avgConfidence: null },
        agents: { routingAccuracy: null, totalRoutes: 0, topAgent: null },
        commands: { totalExecuted: 0, successRate: null, avgRiskScore: null },
        lastUpdated: new Date().toISOString(),
      };
    }

    return {
      period,
      patterns: {
        total: patternEntries.length,
        _note:
          'Success/failure breakdown not tracked yet — store outcomes via hooks_post-task to populate.',
      },
      agents: {
        totalRoutes: routingEntries.length,
        _note: 'Routing accuracy not tracked yet — requires route-outcome correlation data.',
      },
      commands: {
        totalExecuted: taskEntries.length,
        _note: 'Success rate not tracked yet — requires command-outcomes.jsonl data.',
      },
      dataSource: 'memory-store',
      entriesFound: entries.length,
      lastUpdated: new Date().toISOString(),
    };
  },
};

interface HookHandlerInvocations {
  metricsPath: string;
  recorded: boolean;
  handlers: Array<{ name: string; count: number; meanMs: number; maxMs: number }>;
}

/**
 * The only per-hook execution data monomind actually persists: invocation
 * counters written by `.claude/helpers/hook-handler.cjs` into
 * `.monomind/metrics/hook-latency.json` as `{ count, total, max, mean }`.
 *
 * It is keyed by *handler* name (`pre-bash`, `pre-write`, `agent-start`, …) —
 * the wiring `readClaudeCodeHookWiring` reports, not the subcommand registry
 * `hooks_list` returns. The two name spaces overlap on 6 of 24 entries and
 * diverge elsewhere (registry `pre-command` vs. handler `pre-bash`, registry
 * `pre-edit` vs. handler `pre-write`), so joining them would be a guess. These
 * counts are therefore reported alongside the wiring they measure.
 *
 * There is no per-hook timestamp and no per-hook priority anywhere on disk:
 * the file carries one file-global `lastUpdated`, and `HookPriority` lives
 * only in @monoes/hooks' in-memory registry, which this process never fills.
 */
function readHookHandlerInvocations(): HookHandlerInvocations {
  const metricsPath = join(getProjectCwd(), '.monomind', 'metrics', 'hook-latency.json');
  const handlers: HookHandlerInvocations['handlers'] = [];

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { metricsPath, recorded: false, handlers };
  }
  if (typeof raw !== 'object' || raw === null) return { metricsPath, recorded: false, handlers };

  for (const [name, value] of Object.entries(raw)) {
    // `lastUpdated` is a file-global epoch, not a handler.
    if (name === 'lastUpdated' || typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    // Report only what the writer actually recorded — never a defaulted zero.
    if (typeof entry.count !== 'number') continue;
    handlers.push({
      name,
      count: entry.count,
      meanMs: typeof entry.mean === 'number' ? entry.mean : 0,
      maxMs: typeof entry.max === 'number' ? entry.max : 0,
    });
  }
  handlers.sort((a, b) => b.count - a.count);

  return { metricsPath, recorded: handlers.length > 0, handlers };
}

/**
 * Claude Code event wiring, as written into `.claude/settings.json` by
 * `monomind init hooks`. This is a *different* subsystem from the hook
 * subcommand registry below — it is keyed by Claude Code event and handler
 * script, not by these subcommand names — so `hooks list` reports it
 * separately instead of folding it into the registry's own state (#270).
 */
function readClaudeCodeHookWiring(): {
  configured: boolean;
  settingsPath: string;
  wired: number;
  events: string[];
  invocations: HookHandlerInvocations;
} {
  const settingsPath = join(getProjectCwd(), '.claude', 'settings.json');
  const invocations = readHookHandlerInvocations();
  const empty = { configured: false, settingsPath, wired: 0, events: [] as string[], invocations };

  let hooks: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    hooks = (parsed?.hooks ?? {}) as Record<string, unknown>;
  } catch {
    return empty;
  }

  const events: string[] = [];
  let wired = 0;
  for (const [event, matchers] of Object.entries(hooks)) {
    let eventWired = 0;
    for (const matcher of Array.isArray(matchers) ? matchers : []) {
      for (const entry of Array.isArray(matcher?.hooks) ? matcher.hooks : []) {
        // Only ours: every command monomind generates runs a script out of
        // .claude/helpers. Third-party hooks in the same file are not ours
        // to report on.
        if (typeof entry?.command === 'string' && entry.command.includes('.claude/helpers/')) {
          eventWired++;
        }
      }
    }
    if (eventWired > 0) {
      events.push(event);
      wired += eventWired;
    }
  }

  return { configured: wired > 0, settingsPath, wired, events, invocations };
}

export const hooksList: MCPTool = {
  name: 'hooks_list',
  description: 'List all registered hooks',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    // Static registry — not live discovery from handler objects.
    // Update this list when hooks are added or removed.
    const hooks = [
      // Core hooks
      { name: 'pre-edit', type: 'PreToolUse', status: 'active' },
      { name: 'post-edit', type: 'PostToolUse', status: 'active' },
      { name: 'pre-command', type: 'PreToolUse', status: 'active' },
      { name: 'post-command', type: 'PostToolUse', status: 'active' },
      // init wires post-task to SubagentStop; it wires no event to pre-task (CLI/MCP only).
      { name: 'pre-task', type: 'cli', status: 'active' },
      { name: 'post-task', type: 'SubagentStop', status: 'active' },
      // Routing hooks
      { name: 'route', type: 'intelligence', status: 'active' },
      { name: 'explain', type: 'intelligence', status: 'active' },
      // Session hooks
      { name: 'session-start', type: 'SessionStart', status: 'active' },
      { name: 'session-end', type: 'SessionEnd', status: 'active' },
      { name: 'session-restore', type: 'SessionStart', status: 'active' },
      // Learning hooks
      { name: 'pretrain', type: 'intelligence', status: 'active' },
      { name: 'transfer', type: 'intelligence', status: 'active' },
      { name: 'metrics', type: 'analytics', status: 'active' },
      // System hooks
      { name: 'notify', type: 'coordination', status: 'active' },
      // Intelligence subcommands
      { name: 'intelligence', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-start', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-step', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-end', type: 'intelligence', status: 'active' },
      { name: 'intelligence_pattern-store', type: 'intelligence', status: 'active' },
      { name: 'intelligence_pattern-search', type: 'intelligence', status: 'active' },
      { name: 'intelligence_stats', type: 'analytics', status: 'active' },
      { name: 'intelligence_learn', type: 'intelligence', status: 'active' },
    ];
    return {
      _note:
        'Two independent things. `hooks` is a static registry of monomind CLI ' +
        'hook subcommands (update it when hooks are added or removed); each is ' +
        'enabled when its status is active. `claudeCode` is the Claude Code ' +
        'event wiring in .claude/settings.json that `monomind init hooks` ' +
        'writes — keyed by event and handler script, not by these names. A hook ' +
        'can be registered here without that wiring being present. Registry ' +
        'entries carry no priority, execution count or last-executed timestamp: ' +
        'nothing persists those. The only recorded execution data is ' +
        '`claudeCode.invocations` — per-handler counters from ' +
        '.monomind/metrics/hook-latency.json, in the wiring name space, not this one.',
      hooks: hooks.map((hook) => ({ ...hook, enabled: hook.status === 'active' })),
      total: hooks.length,
      claudeCode: readClaudeCodeHookWiring(),
    };
  },
};
