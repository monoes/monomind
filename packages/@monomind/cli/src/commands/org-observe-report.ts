// packages/@monomind/cli/src/commands/org-observe-report.ts
//
// `monomind org report | costs | flow` — run summaries, per-role cost
// tables and the Mermaid flow export.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readContextLog, summarizeContextLog } from '../orgrt/context-log.js';
import { roleTokensNote, type TokenBasis } from '../orgrt/report-budget.js';
import { readHistory, readRunEvents, summarizeRun } from '../orgrt/reporting.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import { endpointRoleIds, orgJson, printOrgJson, resolveRun } from './org-observe-shared.js';

const log = (text: string): void => {
  console.log(text);
};

/** `org report <name> [--run id] [--all] [--by-role] [--format mermaid]` — summarize a run (or list run history). */
export const reportAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  if (ctx.flags.all === true) {
    const history = readHistory(ctx.cwd, name);
    if (!history.length) return { success: false, message: `no run history for org ${name}` };
    if (orgJson(ctx)) return printOrgJson({ v: 1, org: name, items: history });
    log(output.info(`org ${name} — ${history.length} recorded run(s):`));
    for (const h of history) {
      const dur = h.durationMs != null ? `${Math.round(h.durationMs / 1000)}s` : '?';
      // #302: an honest "why", not a bare "no outcome recorded", when the
      // truth gate actually knows the real cause (idle-stop, failed-start, a
      // boss-restart giving up) and whether work was left outstanding.
      const outcome = h.outcome
        ? `${h.outcome.status}: ${h.outcome.summary.slice(0, 60)}`
        : h.closedBy && h.closedBy !== 'org-complete'
          ? `no outcome recorded — ended via ${h.closedBy}${h.runnableTasksAtStop > 0 ? `, ${h.runnableTasksAtStop} task(s) left` : ''}`
          : 'no outcome recorded';
      log(
        output.info(
          `  • ${h.run}  ${dur}  ${h.totalTokens} tokens  ${h.messages} msgs  — ${outcome}`,
        ),
      );
    }
    return { success: true };
  }
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run) return { success: false, message: `no runs found for org ${name}` };
  const events = readRunEvents(ctx.cwd, name, run);
  if (!events.length) return { success: false, message: `run ${run} has no recorded events` };
  const s = summarizeRun(events);
  // M2: endpoint roles are automations — they have no row in the role tables.
  const endpointIds = endpointRoleIds(ctx.cwd, name);
  for (const id of endpointIds) delete s.roles[id];

  // --context: per-call context and cache figures from the run's context.jsonl.
  if (ctx.flags.context === true) {
    const rows = summarizeContextLog(readContextLog(join(ctx.cwd, ORG_DIR, name, run)));
    for (const id of endpointIds) {
      const i = rows.findIndex((r) => r.role === id);
      if (i >= 0) rows.splice(i, 1);
    }
    if (orgJson(ctx)) return printOrgJson({ v: 1, org: name, run, context: rows });
    if (!rows.length) {
      log(
        output.info(
          `no context log for ${name} / ${run} (a run from before it was kept, or no model calls)`,
        ),
      );
      return { success: true };
    }
    const n = (v: number): string => Math.round(v).toLocaleString('en-US');
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    log(output.info(`Context per model call for ${name} / ${run}:`));
    for (const r of rows) {
      const start =
        r.start_write_share === null
          ? 'no cache at session start'
          : `session start ${n(r.start_cache_write_tokens)} written / ${n(r.start_cache_read_tokens)} read (${pct(r.start_write_share)} written)`;
      log(
        output.info(
          `  ${r.role.padEnd(22)} ${r.calls} calls, ${r.sessions} session(s) · context mean ${n(r.mean_context_tokens)} / max ${n(r.max_context_tokens)} · cache hit ${pct(r.cache_hit_ratio)} · ${start}`,
        ),
      );
    }
    return { success: true };
  }

  // Protocol JSON mode (§7.2): the run summary as a bare object. Emitted
  // before the human-only flag modes (mermaid/audit/by-role) — those render
  // views of the same summary and have no JSON shape defined by the spec.
  if (orgJson(ctx)) {
    return printOrgJson({
      v: 1,
      org: name,
      run,
      duration_ms: s.durationMs,
      events: s.events,
      messages: s.messages,
      xorg_messages: s.xorgMessages,
      total_tokens: s.totalTokens,
      total_cost_usd: s.totalCostUsd,
      // false: some usage carried no cost, so total_cost_usd is a lower bound.
      cost_complete: s.costComplete,
      outcome: s.outcome,
      blocker: s.blocker,
      blocker_detail: s.blockerDetail,
      closed_by: s.closedBy,
      runnable_tasks_at_stop: s.runnableTasksAtStop,
      cut_short: s.cutShort,
      crashes: s.crashes,
      roles: s.roles,
      assets: s.assets,
    });
  }

  // Mermaid flowchart (--format mermaid flag)
  if (ctx.flags.format === 'mermaid') {
    // Extract message flow from events
    const messageEvents = events.filter((e) => e.type === 'message' || e.type === 'xorg');
    const roleSet = new Set<string>();
    const edges = new Set<string>();

    for (const e of messageEvents) {
      if (e.from) {
        const fromRole = e.from.includes(':') ? e.from.split(':')[1] : e.from;
        roleSet.add(fromRole);
        if (e.to) {
          const toRole = e.to.includes(':') ? e.to.split(':')[1] : e.to;
          roleSet.add(toRole);
          const edge = `${fromRole} -->|${e.subject || 'msg'}| ${toRole}`;
          edges.add(edge);
        }
      }
    }

    const roles = Array.from(roleSet).sort();

    log(output.info(`flowchart TD`));
    log(output.info(`  %% Org flow for ${name} / ${run}`));
    log(output.info(`  %% ${messageEvents.length} messages exchanged`));
    log(output.info(`  `));

    // Define role nodes with styling
    for (const role of roles) {
      log(output.info(`  ${role}[${role}]`));
    }
    log(output.info(`  `));

    // Add edges for messages
    for (const edge of edges) {
      log(output.info(`  ${edge}`));
    }

    log(output.info(`  `));
    log(output.info(`classDef bossNode fill:#f9f,stroke:#333,stroke-width:2px`));
    log(output.info(`classDef workerNode fill:#bbf,stroke:#333,stroke-width:1px`));

    return { success: true, message: `Mermaid flowchart exported for ${name} / ${run}` };
  }

  // Tool audit filter (--audit flag) - show only tool decision events
  if (ctx.flags.audit === true) {
    let toolEvents = events.filter((e) => e.type === 'tool');
    // Optional --tool flag filters to a specific tool name
    if (typeof ctx.flags.tool === 'string' && ctx.flags.tool) {
      const toolName = ctx.flags.tool;
      toolEvents = toolEvents.filter((e) => e.tool === toolName);
    }
    if (!toolEvents.length) {
      const toolFilter = typeof ctx.flags.tool === 'string' ? ` for tool "${ctx.flags.tool}"` : '';
      log(output.info(`No tool events found${toolFilter} in ${run}`));
      return { success: true };
    }
    log(output.info(`Tool audit trail for ${name} / ${run} (${toolEvents.length} events):`));
    log(
      output.info(
        '┌──────────────────┬─────────────────────────┬──────────┬──────────────────────────────────────┐',
      ),
    );
    log(
      output.info(
        '│ Role             │ Tool                    │ Decision │ Reason                                │',
      ),
    );
    log(
      output.info(
        '├──────────────────┼─────────────────────────┼──────────┼──────────────────────────────────────┤',
      ),
    );
    for (const e of toolEvents) {
      const role = e.from ?? 'system';
      const tool = e.tool ?? 'unknown';
      const decision = e.decision === 'deny' ? 'DENY' : 'ALLOW';
      const reason = e.reason || '-';
      log(
        output.info(
          `│ ${role.padEnd(16)} │ ${tool.padEnd(23)} │ ${decision.padEnd(8)} │ ${reason.padEnd(38)} │`,
        ),
      );
    }
    log(
      output.info(
        '└──────────────────┴─────────────────────────┴──────────┴──────────────────────────────────────┘',
      ),
    );
    return { success: true };
  }

  // Per-role cost breakdown (--by-role flag)
  if (ctx.flags['by-role'] === true) {
    const byRole = new Map<string, { cost: number | null; tokens: number; messages: number }>();
    for (const [roleId, roleStats] of Object.entries(s.roles)) {
      const acc = byRole.get(roleId) ?? { cost: null, tokens: 0, messages: 0 };
      if (roleStats.costUsd !== null) acc.cost = (acc.cost ?? 0) + roleStats.costUsd;
      acc.tokens += roleStats.tokens;
      acc.messages += roleStats.messagesSent;
      byRole.set(roleId, acc);
    }
    log(output.info(`Per-role cost breakdown for ${name} / ${run}:`));
    log(output.info('┌──────────────────┬───────────┬────────────┬───────────┐'));
    log(output.info('│ Role             │ Cost ($)  │ Tokens     │ Messages │'));
    log(output.info('├──────────────────┼───────────┼────────────┼───────────┤'));
    for (const [roleId, data] of byRole) {
      log(
        output.info(
          `│ ${roleId.padEnd(16)} │ ${fmtUsd(data.cost).padStart(9)} │ ${String(data.tokens).padStart(10)} │ ${String(data.messages).padStart(9)} │`,
        ),
      );
    }
    log(output.info('└──────────────────┴───────────┴────────────┴───────────┘'));
    return { success: true };
  }

  // Per-role budget ceiling: same split the daemon applies (budget ÷ role count),
  // with any explicit policy.maxTokens override. Missing/unreadable config → no ceilings.
  let perRoleBudget: number | null = null;
  let basis: TokenBasis = 'uncached';
  const roleCeiling = new Map<string, number>();
  try {
    const def = OrgDefSchema.parse(
      JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, `${name}.json`), 'utf8')),
    );
    const sessionRoles = def.roles.filter((r) => r.kind !== 'endpoint');
    perRoleBudget = Math.floor(
      (def.run_config.budget_tokens ?? 1_000_000) / Math.max(1, sessionRoles.length),
    );
    basis = def.run_config.budget_tokens_basis ?? 'uncached';
    for (const r of sessionRoles) {
      const max = (r.policy as { maxTokens?: number } | undefined)?.maxTokens;
      roleCeiling.set(r.id, max ?? r.budget_tokens ?? perRoleBudget);
    }
  } catch {
    /* config gone or invalid — report without budget context */
  }
  log(output.info(`ORG REPORT — ${name} / ${run}`));
  log(
    output.info(
      `  Duration: ${s.durationMs != null ? `${Math.round(s.durationMs / 1000)}s` : '?'}   Events: ${s.events}   Messages: ${s.messages}${s.xorgMessages ? ` (+${s.xorgMessages} cross-org)` : ''}`,
    ),
  );
  log(
    output.info(
      `  Tokens: ${s.totalTokens}${perRoleBudget ? ` (budget: ${perRoleBudget}/role ${basis === 'billable' ? 'billable' : 'in+out'})` : ''}${s.totalCostUsd ? `   Cost: $${s.totalCostUsd.toFixed(4)}` : ''}`,
    ),
  );
  if (s.outcome) {
    // #302: blocker/blockerDetail are top-level on RunSummary (a sibling of
    // outcome, not nested in it — see reporting.ts), rendered here alongside
    // the outcome they were attached to.
    const blockerSuffix = s.blocker
      ? ` [blocker: ${s.blocker}${s.blockerDetail ? ` — ${s.blockerDetail}` : ''}]`
      : '';
    log(
      output.success(
        `  Outcome: ${s.outcome.status} (by ${s.outcome.by}) — ${s.outcome.summary}${blockerSuffix}`,
      ),
    );
  } else if (s.closedBy && s.closedBy !== 'org-complete') {
    // #302 truth gate: a run that never called org_complete still has a real,
    // recorded cause — never leave an operator reading "not recorded" when
    // we actually know the run was idle-stopped, failed to start, or gave up
    // after a boss-restart, and how much runnable work was left behind.
    const pending = s.runnableTasksAtStop > 0 ? `, ${s.runnableTasksAtStop} task(s) left` : '';
    log(output.warning(`  Outcome: not recorded — ended via ${s.closedBy}${pending}`));
  } else {
    log(output.warning('  Outcome: not recorded (coordinator never called org_complete)'));
  }
  log(output.info('  Roles:'));
  for (const [id, r] of Object.entries(s.roles)) {
    const wasCutShort = s.cutShort.includes(id);
    const icon = r.crashed ? '✗' : wasCutShort ? '⊘' : '•';
    const suffix = r.crashed ? ' — CRASHED' : wasCutShort ? ' — cut short by stop' : '';
    log(
      output.info(
        `    ${icon} ${id}: ${r.messagesSent} msgs, ${r.toolsAllowed} tools${r.toolsDenied ? ` (${r.toolsDenied} denied)` : ''}, ${roleTokensNote(r, roleCeiling.get(id), basis)}${suffix}`,
      ),
    );
  }
  if (s.assets.length) {
    log(output.info(`  Assets (${s.assets.length}):`));
    for (const a of s.assets.slice(0, 20)) log(output.info(`    📄 ${a}`));
    if (s.assets.length > 20) log(output.info(`    … and ${s.assets.length - 20} more`));
  }
  return { success: true };
};

/** A cost cell: `unknown` when the runtime reported no cost (never $0). */
function fmtUsd(usd: number | null): string {
  return usd === null ? 'unknown' : usd.toFixed(4);
}

/** `org costs <name> [--run id]` — show per-role cost tracking from runtime.json */
export const costsAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run)
    return {
      success: false,
      message: `no runs found for org ${name} — start one with: monomind org run ${name}`,
    };

  // Read runtime.json for the per-role metrics
  const rtPath = join(ctx.cwd, ORG_DIR, name, 'runtime.json');
  if (!existsSync(rtPath)) {
    return { success: false, message: `no runtime state found for org ${name}` };
  }

  let rt:
    | {
        status?: string;
        run?: string;
        roleMetrics?: Record<string, { tokens: number; costUsd: number | null }>;
      }
    | undefined;
  try {
    rt = JSON.parse(readFileSync(rtPath, 'utf8'));
  } catch (err) {
    log(
      output.error(`Cannot read runtime.json: ${err instanceof Error ? err.message : String(err)}`),
    );
    return { success: false, message: 'runtime.json unreadable' };
  }

  if (rt?.run !== run && !orgJson(ctx)) {
    log(
      output.warning(
        `Note: runtime.json shows run ${rt?.run ?? 'unknown'} — showing metrics for requested run ${run} from history`,
      ),
    );
  }

  // Also check the run summary for cost data
  const events = readRunEvents(ctx.cwd, name, run);
  const summary = events.length ? summarizeRun(events) : null;

  if (!orgJson(ctx)) log(output.info(`Per-role cost breakdown for ${name} / ${run}:`));

  // Combine data from runtime.json (live metrics) and summary (historical)
  // costUsd null = the role's runtime reported no cost (unknown, not $0).
  const roleData = new Map<
    string,
    { tokens: number; costUsd: number | null; costComplete: boolean; messages: number }
  >();
  // M2: endpoint roles are automations — no row in the cost table.
  const endpointIds = endpointRoleIds(ctx.cwd, name);

  // Add live metrics from runtime.json
  if (rt?.roleMetrics) {
    for (const [roleId, metrics] of Object.entries(rt.roleMetrics)) {
      if (endpointIds.has(roleId)) continue;
      roleData.set(roleId, {
        tokens: metrics.tokens,
        // A live $0 is a real cost; only null/missing is unknown (#540).
        costUsd: metrics.costUsd ?? null,
        costComplete: metrics.costUsd !== null && metrics.costUsd !== undefined,
        messages: 0,
      });
    }
  }

  // Add historical data from summary if available
  if (summary?.roles) {
    for (const [roleId, roleStats] of Object.entries(summary.roles)) {
      if (endpointIds.has(roleId)) continue;
      const existing = roleData.get(roleId);
      roleData.set(roleId, {
        tokens: existing?.tokens || roleStats.tokens,
        // The run's own usage events say whether a cost was reported at all;
        // the live metric only fills in a figure they lack.
        costUsd: roleStats.costUsd ?? existing?.costUsd ?? null,
        costComplete: roleStats.costComplete,
        messages: roleStats.messagesSent,
      });
    }
  }

  if (orgJson(ctx)) {
    const items: Array<{
      role: string;
      tokens: number;
      cost_usd: number | null;
      messages: number;
    }> = [];
    for (const [roleId, data] of roleData) {
      items.push({
        role: roleId,
        tokens: data.tokens,
        cost_usd: data.costUsd,
        messages: data.messages,
      });
    }
    const totals = {
      ...items.reduce<{ tokens: number; cost_usd: number | null; messages: number }>(
        (acc, i) => ({
          tokens: acc.tokens + i.tokens,
          cost_usd: i.cost_usd === null ? acc.cost_usd : (acc.cost_usd ?? 0) + i.cost_usd,
          messages: acc.messages + i.messages,
        }),
        { tokens: 0, cost_usd: null, messages: 0 },
      ),
      // false: some role's cost is unknown, so cost_usd is a lower bound.
      cost_complete: [...roleData.values()].every((d) => d.costComplete && d.costUsd !== null),
    };
    return printOrgJson({ v: 1, org: name, run, items, totals });
  }

  if (roleData.size === 0) {
    log(output.info(`No role metrics available yet — metrics populate as agents use tokens.`));
    return { success: true };
  }

  log(output.info('┌──────────────────┬───────────┬────────────┬───────────┐'));
  log(output.info('│ Role             │ Cost ($)  │ Tokens     │ Messages │'));
  log(output.info('├──────────────────┼───────────┼────────────┼───────────┤'));

  let totalCost: number | null = null;
  let totalTokens = 0;
  let totalMessages = 0;

  for (const [roleId, data] of roleData) {
    log(
      output.info(
        `│ ${roleId.padEnd(16)} │ ${fmtUsd(data.costUsd).padStart(9)} │ ${String(data.tokens).padStart(10)} │ ${String(data.messages).padStart(9)} │`,
      ),
    );
    if (data.costUsd !== null) totalCost = (totalCost ?? 0) + data.costUsd;
    totalTokens += data.tokens;
    totalMessages += data.messages;
  }

  log(output.info('├──────────────────┼───────────┼────────────┼───────────┤'));
  log(
    output.info(
      `│ ${('TOTAL').padEnd(16)} │ ${fmtUsd(totalCost).padStart(9)} │ ${String(totalTokens).padStart(10)} │ ${String(totalMessages).padStart(9)} │`,
    ),
  );
  log(output.info('└──────────────────┴───────────┴────────────┴───────────┘'));

  return { success: true };
};

/** `org flow <name> [--run id]` — export org flow as Mermaid diagram */
export const flowAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run)
    return {
      success: false,
      message: `no runs found for org ${name} — start one with: monomind org run ${name}`,
    };

  const events = readRunEvents(ctx.cwd, name, run);
  if (!events.length) return { success: false, message: `run ${run} has no recorded events` };

  // Extract message flow from events
  const messageEvents = events.filter((e) => e.type === 'message' || e.type === 'xorg');
  const roleSet = new Set<string>();
  const edges = new Set<string>();
  const edgeObjects: Array<{ from: string; to: string; subject?: string }> = [];

  for (const e of messageEvents) {
    if (e.from) {
      const fromRole = e.from.includes(':') ? e.from.split(':')[1] : e.from;
      roleSet.add(fromRole);
      if (e.to) {
        const toRole = e.to.includes(':') ? e.to.split(':')[1] : e.to;
        roleSet.add(toRole);
        const edge = `${fromRole} -->|${e.subject || 'msg'}| ${toRole}`;
        edges.add(edge);
        edgeObjects.push({ from: fromRole, to: toRole, subject: e.subject || 'msg' });
      }
    }
  }

  // M2: endpoint roles are automations — not listed as role nodes.
  const endpointIds = endpointRoleIds(ctx.cwd, name);
  const roles = Array.from(roleSet)
    .filter((r) => !endpointIds.has(r))
    .sort();

  // Protocol JSON mode (§7.2): structured roles + edges instead of Mermaid.
  if (orgJson(ctx)) return printOrgJson({ v: 1, org: name, run, roles, edges: edgeObjects });

  log(output.info(`flowchart TD`));
  log(output.info(`  %% Org flow for ${name} / ${run}`));
  log(output.info(`  %% ${messageEvents.length} messages exchanged`));
  log(output.info(`  `));

  // Define role nodes with styling
  for (const role of roles) {
    log(output.info(`  ${role}[${role}]`));
  }
  log(output.info(`  `));

  // Add edges for messages
  for (const edge of edges) {
    log(output.info(`  ${edge}`));
  }

  log(output.info(`  `));
  log(output.info(`classDef bossNode fill:#f9f,stroke:#333,stroke-width:2px`));
  log(output.info(`classDef workerNode fill:#bbf,stroke:#333,stroke-width:1px`));

  return { success: true, message: `Mermaid flowchart exported for ${name} / ${run}` };
};
