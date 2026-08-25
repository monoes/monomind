// packages/@monomind/cli/src/commands/org-observe.ts
// Read-side org subcommands (logs / report) + template scaffolding (create).
// Kept out of org.ts to respect the 500-line file ceiling.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchCheckpoint } from '../orgrt/checkpoint-ops.js';
import { checkOrgStructure } from '../orgrt/migrate.js';
import {
  formatEvent,
  listRunDirs,
  readHistory,
  readRunEvents,
  summarizeRun,
} from '../orgrt/reporting.js';
import { resolveModel } from '../orgrt/session.js';
import { buildFromTemplate, ORG_TEMPLATES } from '../orgrt/templates.js';
import { type BusEvent, type DecisionGate, ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import { listOrgConfigFiles, validateOrgName } from './org.js';

const log = (text: string): void => {
  console.log(text);
};

// ─── Agent Exec Protocol JSON output (doc/agent-exec-protocol.md §7) ────────
// Org observe commands emit machine JSON under the global `--format json`
// flag: one JSON object on stdout, diagnostics on stderr only. Envelope for
// lists {v, org, items}; singletons are bare objects carrying v.

/** True when this invocation asked for protocol JSON output. */
export const orgJson = (ctx: CommandContext): boolean => ctx.flags.format === 'json';

/** Print one protocol JSON payload on stdout (compact — one line, NDJSON-safe
 *  for line-oriented callers) and return a success result. */
export const printOrgJson = (payload: Record<string, unknown>): CommandResult => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return { success: true, data: payload };
};

/** Validate org config(s) against OrgDefSchema — the exact parse `org run`/`org serve`
 * perform — plus the structural invariants the runtime assumes but the schema can't
 * express (single root role, resolvable reports_to, unique ids, parseable schedule). */
export const validateAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgsDir = join(ctx.cwd || process.cwd(), ORG_DIR);
  let files: string[];
  if (ctx.args[0]) {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    files = [`${validated.name}.json`];
  } else {
    if (!existsSync(orgsDir))
      return {
        success: false,
        message: 'no orgs directory — create an org first with /mastermind:createorg',
      };
    files = listOrgConfigFiles(orgsDir);
    if (!files.length) return { success: false, message: 'no org configs found' };
  }
  let failed = 0;
  for (const f of files) {
    const stem = f.replace(/\.json$/, '');
    const path = join(orgsDir, f);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!existsSync(path)) {
      log(output.error(`${stem}: not found (${path})`));
      failed++;
      continue;
    }
    try {
      const def = OrgDefSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      errors.push(...checkOrgStructure(def));
      if (def.name !== stem)
        warnings.push(
          `def.name "${def.name}" differs from filename — the runtime addresses this org as "${stem}"`,
        );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    for (const w of warnings) log(output.warning(`${stem}: ${w}`));
    if (errors.length) {
      failed++;
      for (const e of errors) log(output.error(`${stem}: ${e}`));
    } else {
      log(
        output.success(
          `${stem}: valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
        ),
      );
    }
  }
  return failed
    ? { success: false, message: `${failed} of ${files.length} org config(s) failed validation` }
    : { success: true, message: `${files.length} org config(s) valid` };
};

// Run ids are joined into filesystem paths — enforce the daemon's own id shape
// so a crafted --run can't traverse out of the org directory (same reason the
// org-name guard exists).
const RUN_ID_RE = /^run-[A-Za-z0-9-]+$/;
const resolveRun = (cwd: string, name: string, runFlag: unknown): string | null => {
  if (typeof runFlag === 'string' && runFlag) return RUN_ID_RE.test(runFlag) ? runFlag : null;
  return listRunDirs(cwd, name)[0] ?? null;
};

/** `org logs <name> [--run id] [--role r] [--filter-tool t] [--filter-role r] [--tools-only] [--audit-filter allow|deny] [--follow]` — formatted bus.jsonl tail. */
export const logsAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run)
    return {
      success: false,
      message: `no runs found for org ${name} — start one with: monomind org run ${name}`,
    };
  const file = join(ctx.cwd, ORG_DIR, name, run, 'bus.jsonl');
  const roleFilter = typeof ctx.flags.role === 'string' ? ctx.flags.role : null;
  const filterTool = typeof ctx.flags['filter-tool'] === 'string' ? ctx.flags['filter-tool'] : null;
  const filterRole = typeof ctx.flags['filter-role'] === 'string' ? ctx.flags['filter-role'] : null;
  const auditFilter =
    typeof ctx.flags['audit-filter'] === 'string' ? ctx.flags['audit-filter'] : null;
  const toolsOnly = ctx.flags['tools-only'] === true;
  // Protocol JSON mode: full filtered event array, no live tail (§7.2 — the
  // streaming form is `org events --ndjson --follow`).
  if (orgJson(ctx)) {
    if (ctx.flags.follow === true)
      return { success: false, message: 'json output cannot --follow — use: org events --ndjson' };
    const items: BusEvent[] = [];
    const accept = (e: BusEvent): boolean =>
      (!toolsOnly || e.type === 'tool') &&
      (!roleFilter || e.from === roleFilter || e.to === roleFilter) &&
      (!filterTool || e.tool === filterTool) &&
      (!filterRole || e.from === filterRole) &&
      (!auditFilter || e.type !== 'tool' || e.decision === auditFilter);
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line) as BusEvent;
          if (accept(e)) items.push(e);
        } catch {
          /* skip corrupt interior lines — same policy as the tail drain */
        }
      }
    }
    return printOrgJson({ v: 1, org: name, run, items });
  }
  const show = (e: BusEvent): void => {
    if (toolsOnly && e.type !== 'tool') return;
    if (roleFilter && e.from !== roleFilter && e.to !== roleFilter) return;
    if (filterTool && e.tool !== filterTool) return;
    if (filterRole && e.from !== filterRole) return;
    if (auditFilter && e.type === 'tool' && e.decision !== auditFilter) return;
    log(formatEvent(e));
  };
  log(
    output.info(
      `org ${name} — ${run}${roleFilter ? ` (role: ${roleFilter})` : ''}${filterTool ? ` (tool: ${filterTool})` : ''}${filterRole ? ` (filter-role: ${filterRole})` : ''}${auditFilter ? ` (audit-filter: ${auditFilter})` : ''}`,
    ),
  );
  let seenLines = 0;
  const drain = (): void => {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (let i = seenLines; i < lines.length; i++) {
      try {
        show(JSON.parse(lines[i]) as BusEvent);
        seenLines = i + 1;
      } catch {
        // Only the FINAL line can be a partial mid-append write worth
        // retrying; a corrupt interior line would otherwise stall the tail
        // forever — skip it and keep going.
        if (i === lines.length - 1) break;
        seenLines = i + 1;
      }
    }
  };
  drain();
  if (ctx.flags.follow !== true) return { success: true };
  log(output.info('following — Ctrl-C to stop'));
  await new Promise<void>((resolve) => {
    const iv = setInterval(drain, 500);
    process.once('SIGINT', () => {
      clearInterval(iv);
      resolve();
    });
    process.once('SIGTERM', () => {
      clearInterval(iv);
      resolve();
    });
  });
  return { success: true };
};

/**
 * `org watch <name> <role> [--verbose] [--stats]` — live-tail one role's
 * assistant chat text.
 *
 * Every runner (Claude included — this isn't specific to the subprocess CLI
 * runners) funnels through session.ts's shared message loop, which emits
 * each assistant-text chunk onto the bus as a `chat` event. This command is
 * just `logsAction` pre-filtered to that event type + role and formatted as
 * a plain transcript instead of the full annotated event line — a friendlier
 * front door onto infrastructure that already exists and already covers
 * every runtime uniformly. For the fuller event stream (tool calls, audit
 * decisions) use `org logs <name> --role <role> --follow` directly.
 *
 * --verbose additionally interleaves that role's `status` events (session
 * start/end, restart/crash/backoff, state changes) into the transcript, so
 * a human watching sees WHY a role went quiet instead of just silence.
 * --stats prints a running token/cost line off that role's `usage` events
 * (emitted per turn by session.ts, same as --verbose: already-existing bus
 * data, no new instrumentation).
 */
export const watchAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const role = ctx.args[1];
  if (!role) return { success: false, message: 'usage: monomind org watch <org> <role>' };
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run)
    return {
      success: false,
      message: `no runs found for org ${name} — start one with: monomind org run ${name}`,
    };
  const file = join(ctx.cwd, ORG_DIR, name, run, 'bus.jsonl');
  const verbose = ctx.flags.verbose === true;
  const stats = ctx.flags.stats === true;

  let totalTokens = 0;
  let totalCostUsd = 0;

  const show = (e: BusEvent): void => {
    if (e.from !== role) return;
    if (e.type === 'chat') {
      log(`${output.info(`${role}:`)} ${e.msg ?? ''}`);
      return;
    }
    if (verbose && e.type === 'status') {
      log(output.warning(`[${e.reason ?? 'status'}] ${e.msg ?? ''}`));
      return;
    }
    if (stats && e.type === 'usage') {
      const tokens = typeof e.data?.tokens === 'number' ? e.data.tokens : 0;
      const costDelta = typeof e.data?.cost_usd === 'number' ? e.data.cost_usd : 0;
      totalTokens += tokens;
      totalCostUsd += costDelta;
      log(
        output.info(
          `[stats] +${tokens} tokens (total ${totalTokens}) · +$${costDelta.toFixed(4)} (total $${totalCostUsd.toFixed(4)})`,
        ),
      );
    }
  };
  log(
    output.info(
      `watching ${name}/${role} — ${run} (Ctrl-C to stop; org logs ${name} --role ${role} --follow for the full event stream)`,
    ),
  );
  let seenLines = 0;
  const drain = (): void => {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (let i = seenLines; i < lines.length; i++) {
      try {
        show(JSON.parse(lines[i]) as BusEvent);
        seenLines = i + 1;
      } catch {
        if (i === lines.length - 1) break; // only the final line may be a mid-append partial write
        seenLines = i + 1;
      }
    }
  };
  drain();
  if (ctx.flags.follow === false) return { success: true }; // --follow=false opts out of the default live tail
  await new Promise<void>((resolve) => {
    const iv = setInterval(drain, 500);
    process.once('SIGINT', () => {
      clearInterval(iv);
      resolve();
    });
    process.once('SIGTERM', () => {
      clearInterval(iv);
      resolve();
    });
  });
  return { success: true };
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
      const outcome = h.outcome
        ? `${h.outcome.status}: ${h.outcome.summary.slice(0, 60)}`
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
      outcome: s.outcome,
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
    const byRole = new Map<string, { cost: number; tokens: number; messages: number }>();
    for (const [roleId, roleStats] of Object.entries(s.roles)) {
      const acc = byRole.get(roleId) ?? { cost: 0, tokens: 0, messages: 0 };
      acc.cost += roleStats.costUsd ?? 0;
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
          `│ ${roleId.padEnd(16)} │ ${(data.cost.toFixed(4)).padStart(9)} │ ${String(data.tokens).padStart(10)} │ ${String(data.messages).padStart(9)} │`,
        ),
      );
    }
    log(output.info('└──────────────────┴───────────┴────────────┴───────────┘'));
    return { success: true };
  }

  // Per-role budget ceiling: same split the daemon applies (budget ÷ role count),
  // with any explicit policy.maxTokens override. Missing/unreadable config → no ceilings.
  let perRoleBudget: number | null = null;
  const roleCeiling = new Map<string, number>();
  try {
    const def = OrgDefSchema.parse(
      JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, `${name}.json`), 'utf8')),
    );
    perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
    for (const r of def.roles) {
      const max = (r.policy as { maxTokens?: number } | undefined)?.maxTokens;
      roleCeiling.set(r.id, max ?? r.budget_tokens ?? perRoleBudget);
    }
  } catch {
    /* config gone or invalid — report without budget context */
  }
  const budgetNote = (id: string, tokens: number): string => {
    const cap = roleCeiling.get(id);
    if (!cap) return '';
    const pct = Math.round((tokens / cap) * 100);
    return ` (${pct}% of ${cap}${pct >= 100 ? ' — EXHAUSTED' : pct >= 80 ? ' — near limit' : ''})`;
  };
  log(output.info(`ORG REPORT — ${name} / ${run}`));
  log(
    output.info(
      `  Duration: ${s.durationMs != null ? `${Math.round(s.durationMs / 1000)}s` : '?'}   Events: ${s.events}   Messages: ${s.messages}${s.xorgMessages ? ` (+${s.xorgMessages} cross-org)` : ''}`,
    ),
  );
  log(
    output.info(
      `  Tokens: ${s.totalTokens}${perRoleBudget ? ` (budget: ${perRoleBudget}/role)` : ''}${s.totalCostUsd ? `   Cost: $${s.totalCostUsd.toFixed(4)}` : ''}`,
    ),
  );
  if (s.outcome)
    log(
      output.success(`  Outcome: ${s.outcome.status} (by ${s.outcome.by}) — ${s.outcome.summary}`),
    );
  else log(output.warning('  Outcome: not recorded (coordinator never called org_complete)'));
  log(output.info('  Roles:'));
  for (const [id, r] of Object.entries(s.roles)) {
    const wasCutShort = s.cutShort.includes(id);
    const icon = r.crashed ? '✗' : wasCutShort ? '⊘' : '•';
    const suffix = r.crashed ? ' — CRASHED' : wasCutShort ? ' — cut short by stop' : '';
    log(
      output.info(
        `    ${icon} ${id}: ${r.messagesSent} msgs, ${r.toolsAllowed} tools${r.toolsDenied ? ` (${r.toolsDenied} denied)` : ''}, ${r.tokens} tokens${budgetNote(id, r.tokens)}${suffix}`,
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

interface OrgQuestion {
  questionId: string;
  role: string;
  question: string;
  ts: number;
  answer: string | null;
  answeredAt: number | null;
}

/** Read questions.json. A MISSING file legitimately means "no questions" → [].
 *  Any other failure (unreadable, malformed — e.g. a partial daemon write) THROWS:
 *  answerAction rewrites this file from what this returns, so silently coercing a
 *  failed read to [] would atomically replace every recorded question with one. */
const readQuestions = (cwd: string, name: string): OrgQuestion[] => {
  const path = join(cwd, ORG_DIR, name, 'questions.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: { questions?: OrgQuestion[] };
  try {
    parsed = JSON.parse(raw) as { questions?: OrgQuestion[] };
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (parsed?.questions === undefined || parsed.questions === null) return [];
  if (!Array.isArray(parsed.questions)) throw new Error(`${path}: "questions" is not an array`);
  return parsed.questions;
};

/** `org questions <name> [--all]` — list pending (or all) ask_human questions. */
export const questionsAction = async (
  ctx: CommandContext,
  name: string,
): Promise<CommandResult> => {
  let all: OrgQuestion[];
  try {
    all = readQuestions(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Cannot read questions for org ${name}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { success: false, message: 'questions.json unreadable' };
  }
  const shown = ctx.flags.all === true ? all : all.filter((q) => q.answer === null);
  if (orgJson(ctx)) return printOrgJson({ v: 1, org: name, items: shown });
  if (!shown.length) {
    log(
      output.info(
        all.length
          ? `No pending questions for org ${name} (${all.length} answered — use --all).`
          : `No questions recorded for org ${name}.`,
      ),
    );
    return { success: true };
  }
  for (const q of shown) {
    const when = new Date(q.ts).toISOString().replace('T', ' ').slice(0, 16);
    log(
      output.info(
        `${q.answer === null ? '❓' : '✓'} [${q.questionId}] ${when}  ${q.role}: ${q.question}`,
      ),
    );
    if (q.answer !== null) log(output.info(`     ↳ ${q.answer}`));
  }
  if (shown.some((q) => q.answer === null))
    log(output.info(`\nAnswer with: monomind org answer ${name} <question-id> "your answer"`));
  return { success: true };
};

/** `org answer <name> <question-id> <answer...>` — answer a pending ask_human question.
 *  Delivers live via the hosting daemon's /api/answer-question when the org is running
 *  (broker lookup); otherwise records the answer and queues it for the next run. */
export const answerAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const questionId = ctx.args[1];
  const answer = ctx.args.slice(2).join(' ').trim();
  if (!questionId || !answer)
    return {
      success: false,
      message: `usage: monomind org answer ${name} <question-id> "answer text"`,
    };
  let questions: OrgQuestion[];
  try {
    questions = readQuestions(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Cannot read questions for org ${name}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { success: false, message: 'questions.json unreadable — answer not recorded' };
  }
  const q = questions.find((x) => x.questionId === questionId);
  if (!q) {
    log(
      output.error(
        `Question "${questionId}" not found for org ${name} — list with: monomind org questions ${name}`,
      ),
    );
    return { success: false, message: 'question not found' };
  }
  if (q.answer !== null)
    return { success: false, message: `question "${questionId}" was already answered` };

  // Live path: the hosting daemon updates questions.json and pushes into the role's mailbox.
  const { lookupOrg, normalizeCredential } = await import('../orgrt/broker.js');
  const remote = lookupOrg(name);
  if (remote) {
    const cred = normalizeCredential(remote.credential);
    try {
      const res = await fetch(`${remote.url}/api/answer-question`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cred ? { 'x-monomind-cred': cred } : {}),
        },
        body: JSON.stringify({ org: name, role: q.role, questionId, answer }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        if (orgJson(ctx))
          return printOrgJson({
            v: 1, org: name, question_id: questionId, role: q.role, delivery: 'live', answered: true,
          });
        log(output.success(`Answer delivered to ${name}:${q.role} (live).`));
        return { success: true };
      }
      log(
        output.warning(
          `Live delivery rejected (${data.error ?? res.status}) — falling back to offline queue.`,
        ),
      );
    } catch (err) {
      log(
        output.warning(
          `Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`,
        ),
      );
    }
  }

  // Offline path: mirror daemon.answerQuestion's org-not-running branch.
  // RE-READ and merge by questionId just before writing — the pre-fetch
  // snapshot can be up to 10s stale (live-delivery timeout), and rewriting
  // from it would delete questions the daemon appended meanwhile and revert
  // answers it recorded (atomic rename prevents torn writes, not lost updates).
  // A FAILED re-read must abort the write: rewriting from [] would atomically
  // rename a single-question file over every other recorded question.
  let fresh: OrgQuestion[];
  try {
    fresh = readQuestions(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Refusing to rewrite questions.json — ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    log(
      output.warning(
        `The answer was NOT recorded. Fix or restore ${join(ctx.cwd, ORG_DIR, name, 'questions.json')}, then retry.`,
      ),
    );
    return { success: false, message: 'questions.json unreadable — answer not recorded' };
  }
  const freshQ = fresh.find((x) => x.questionId === questionId);
  if (freshQ && freshQ.answer !== null) {
    return {
      success: false,
      message: `question "${questionId}" was answered while this command was running`,
    };
  }
  // Queue BEFORE marking answered (same rule as daemon.answerQuestion): if the
  // append fails, the question must stay pending and answerable. Marking first meant
  // a failed queueMessage recorded the answer as delivered while nothing was queued,
  // and the `already answered` guard then rejected every retry.
  const { queueMessage } = await import('../orgrt/inbox.js');
  try {
    queueMessage(ctx.cwd, name, {
      fromQualified: 'human',
      toRole: q.role,
      subject: `answer:${questionId}`,
      body: `question: ${q.question}\n\nanswer: ${answer}`,
      ts: Date.now(),
    });
  } catch (err) {
    log(
      output.error(
        `Could not queue the answer for ${name}:${q.role} (${err instanceof Error ? err.message : String(err)}) — answer NOT recorded, retry it.`,
      ),
    );
    return { success: false, message: 'queueing failed — answer not recorded' };
  }
  const merged = fresh.some((x) => x.questionId === questionId)
    ? fresh.map((x) => (x.questionId === questionId ? { ...x, answer, answeredAt: Date.now() } : x))
    : [...fresh, { ...q, answer, answeredAt: Date.now() }];
  const dest = join(ctx.cwd, ORG_DIR, name, 'questions.json');
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ questions: merged }, null, 2));
  const { renameSync } = await import('node:fs');
  renameSync(tmp, dest);
  if (orgJson(ctx))
    return printOrgJson({
      v: 1, org: name, question_id: questionId, role: q.role, delivery: 'queued', answered: true,
    });
  log(output.success(`Answer recorded — ${name}:${q.role} receives it when the org next runs.`));
  return { success: true };
};

/** `org inbox <name> --json '{"from":"orgA:role","subject":"...","body":"..."}' [--to role]`
 *  Inbound entrypoint for cross-org/remote delivery — orgrt/remote.ts's deliverRemote()
 *  shells out to exactly this command over SSH. Live path: POST to the hosting daemon's
 *  /api/xdeliver when the org is registered with the broker (mirrors cross-org.ts's
 *  deliverRemote). Offline path: spool into inbox.jsonl, which the daemon drains into
 *  the target role's mailbox on the org's next start (daemon.ts drainInbox) — the same
 *  semantics as a queued human answer. */
export const inboxAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  let payload: { from?: unknown; subject?: unknown; body?: unknown } = {};
  const rawJson = ctx.flags.json;
  if (typeof rawJson === 'string') {
    try {
      payload = JSON.parse(rawJson) as typeof payload;
    } catch {
      return { success: false, message: 'org inbox: --json is not valid JSON' };
    }
  } else {
    payload = { from: ctx.flags.from, subject: ctx.flags.subject, body: ctx.flags.body };
  }
  const from = typeof payload.from === 'string' ? payload.from.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const body = typeof payload.body === 'string' ? payload.body : '';
  if (!from || !body) {
    log(
      output.error('org inbox: payload requires "from" and "body" (via --json or --from/--body)'),
    );
    return { success: false, message: 'inbox payload requires from and body' };
  }

  // Target role: explicit --to, else the org's coordinator (reports_to == null),
  // else the first role — matching where a role-less cross-org message should land.
  let toRole = typeof ctx.flags.to === 'string' ? ctx.flags.to : '';
  if (toRole && !/^[a-z0-9][a-z0-9_-]*$/i.test(toRole)) {
    log(output.error(`Invalid role id: ${toRole}`));
    return { success: false, message: 'invalid role id' };
  }
  if (!toRole) {
    const defPath = join(ctx.cwd, ORG_DIR, `${name}.json`);
    if (!existsSync(defPath)) {
      log(output.error(`Org not found: ${name}`));
      return { success: false, message: 'org not found' };
    }
    try {
      const def = JSON.parse(readFileSync(defPath, 'utf8')) as {
        roles?: { id?: string; reports_to?: string | null }[];
      };
      const roles = Array.isArray(def.roles) ? def.roles : [];
      toRole = roles.find((r) => r.reports_to == null)?.id ?? roles[0]?.id ?? '';
    } catch (err) {
      log(
        output.error(
          `Could not read org config for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return { success: false, message: 'org config unreadable' };
    }
    if (!toRole) {
      log(output.error(`Org "${name}" has no roles to deliver to — pass --to <role>.`));
      return { success: false, message: 'no deliverable role' };
    }
  }

  // Live path: a hosting daemon registered this org with the broker.
  const { lookupOrg, normalizeCredential } = await import('../orgrt/broker.js');
  const remote = lookupOrg(name);
  if (remote) {
    const [fromOrg, fromRole] = from.includes(':') ? from.split(':', 2) : ['external', from];
    const cred = normalizeCredential(remote.credential);
    try {
      const res = await fetch(`${remote.url}/api/xdeliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cred ? { 'x-monomind-cred': cred } : {}),
        },
        body: JSON.stringify({ fromOrg, fromRole, toOrg: name, toRole, subject, body }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        receipt?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        log(output.success(data.receipt ?? `delivered to ${name}:${toRole}`));
        return { success: true, message: data.receipt ?? 'delivered' };
      }
      log(
        output.warning(
          `Live delivery rejected (${data.error ?? res.status}) — falling back to offline queue.`,
        ),
      );
    } catch (err) {
      log(
        output.warning(
          `Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`,
        ),
      );
    }
  }

  // Offline path: spool; drained into the role's mailbox when the org next starts.
  const { queueMessage } = await import('../orgrt/inbox.js');
  const queued = queueMessage(ctx.cwd, name, {
    fromQualified: from,
    toRole,
    subject,
    body,
    ts: Date.now(),
  });
  if (!queued) {
    log(
      output.error(`Could not queue the message for ${name}:${toRole} (disk full or permissions).`),
    );
    return { success: false, message: 'queueing failed' };
  }
  const receipt = `queued for ${name}:${toRole} (delivered when the org next runs)`;
  log(output.success(receipt));
  return { success: true, message: receipt };
};

/** `org create <name> --template <t> [--goal g] [--schedule s]` — scaffold a config from a template. */
export const createAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const templateName = typeof ctx.flags.template === 'string' ? ctx.flags.template : '';
  if (!templateName) {
    log(output.info(`Available templates: ${Object.keys(ORG_TEMPLATES).join(', ')}`));
    return {
      success: false,
      message:
        'usage: monomind org create <name> --template <template> [--goal "..."] [--schedule 30m]',
    };
  }
  const def = buildFromTemplate(
    templateName,
    name,
    typeof ctx.flags.goal === 'string' ? ctx.flags.goal : undefined,
  );
  if (!def) {
    log(
      output.error(
        `Unknown template "${templateName}" — available: ${Object.keys(ORG_TEMPLATES).join(', ')}`,
      ),
    );
    return { success: false, message: 'unknown template' };
  }
  if (typeof ctx.flags.schedule === 'string') def.schedule = ctx.flags.schedule;
  const file = join(ctx.cwd, ORG_DIR, `${name}.json`);
  if (existsSync(file) && ctx.flags.force !== true) {
    log(output.error(`Org "${name}" already exists — pass --force to overwrite.`));
    return { success: false, message: 'org exists' };
  }
  OrgDefSchema.parse(def); // templates must always produce a runnable config

  // Per-role model — the single most consequential setting the template picked on
  // the user's behalf. Mirror resolveModel() (same helper `org run`'s cost estimate
  // uses) so a role relying on its runtime/vendor default isn't mislabeled here.
  const modelRows = def.roles.map((r) => {
    const explicit = r.adapter_config?.model;
    return {
      id: r.id,
      model: String(explicit ?? resolveModel(r, r.runtime ?? def.runtime, r.provider?.vendor)),
      explicit: !!explicit,
    };
  });
  const printModels = (): void => {
    log(output.bold('  Models:'));
    for (const r of modelRows) {
      log(`    ${r.id.padEnd(20)} ${r.model}${r.explicit ? '' : '  (default)'}`);
    }
  };

  if (ctx.interactive && ctx.flags.yes !== true) {
    log(
      output.bold(
        `\nAbout to create org "${name}" from template "${templateName}" (${def.roles.length} roles):`,
      ),
    );
    printModels();
    const { confirm } = await import('../prompt.js');
    const proceed = await confirm({ message: 'Create this org?', default: true });
    if (!proceed) {
      log(
        output.info(
          'Cancelled — no file written. Adjust --template/--goal, or edit the template, then retry (pass --yes to skip this prompt).',
        ),
      );
      return { success: false, message: 'cancelled by user' };
    }
  }

  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(ctx.cwd, ORG_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify(def, null, 2)}\n`, 'utf8');
  log(
    output.success(
      `Org "${name}" created from template "${templateName}" (${def.roles.length} roles).`,
    ),
  );
  log(
    output.info(
      `  Budget: ${def.run_config.budget_tokens} tokens · Turn limit: ${def.run_config.max_turns_per_message} per message (effectively unlimited by default — set run_config.max_turns_per_message, or a role's own max_turns_per_message, to cap it).`,
    ),
  );
  if (!ctx.interactive || ctx.flags.yes === true) printModels();
  log(output.info(`  Edit the goal/roles in ${file}, then: monomind org run ${name}`));
  return { success: true };
};

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
        roleMetrics?: Record<string, { tokens: number; costUsd: number }>;
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
  const roleData = new Map<string, { tokens: number; costUsd: number; messages: number }>();

  // Add live metrics from runtime.json
  if (rt?.roleMetrics) {
    for (const [roleId, metrics] of Object.entries(rt.roleMetrics)) {
      roleData.set(roleId, {
        tokens: metrics.tokens,
        costUsd: metrics.costUsd,
        messages: 0,
      });
    }
  }

  // Add historical data from summary if available
  if (summary?.roles) {
    for (const [roleId, roleStats] of Object.entries(summary.roles)) {
      const existing = roleData.get(roleId) ?? { tokens: 0, costUsd: 0, messages: 0 };
      roleData.set(roleId, {
        tokens: existing.tokens || roleStats.tokens,
        costUsd: existing.costUsd || roleStats.costUsd,
        messages: roleStats.messagesSent,
      });
    }
  }

  if (orgJson(ctx)) {
    const items: Array<{ role: string; tokens: number; cost_usd: number; messages: number }> = [];
    for (const [roleId, data] of roleData) {
      items.push({ role: roleId, tokens: data.tokens, cost_usd: data.costUsd, messages: data.messages });
    }
    const totals = items.reduce(
      (acc, i) => ({
        tokens: acc.tokens + i.tokens,
        cost_usd: acc.cost_usd + i.cost_usd,
        messages: acc.messages + i.messages,
      }),
      { tokens: 0, cost_usd: 0, messages: 0 },
    );
    return printOrgJson({ v: 1, org: name, run, items, totals });
  }

  if (roleData.size === 0) {
    log(output.info(`No role metrics available yet — metrics populate as agents use tokens.`));
    return { success: true };
  }

  log(output.info('┌──────────────────┬───────────┬────────────┬───────────┐'));
  log(output.info('│ Role             │ Cost ($)  │ Tokens     │ Messages │'));
  log(output.info('├──────────────────┼───────────┼────────────┼───────────┤'));

  let totalCost = 0;
  let totalTokens = 0;
  let totalMessages = 0;

  for (const [roleId, data] of roleData) {
    log(
      output.info(
        `│ ${roleId.padEnd(16)} │ ${(data.costUsd.toFixed(4)).padStart(9)} │ ${String(data.tokens).padStart(10)} │ ${String(data.messages).padStart(9)} │`,
      ),
    );
    totalCost += data.costUsd;
    totalTokens += data.tokens;
    totalMessages += data.messages;
  }

  log(output.info('├──────────────────┼───────────┼────────────┼───────────┤'));
  log(
    output.info(
      `│ ${('TOTAL').padEnd(16)} │ ${(totalCost.toFixed(4)).padStart(9)} │ ${String(totalTokens).padStart(10)} │ ${String(totalMessages).padStart(9)} │`,
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

  const roles = Array.from(roleSet).sort();

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

/** `org approve <org> <role> <action>` — approve a pending tool/action approval */
/** Shared by approveAction/denyAction: try the live daemon first (updates its
 *  in-memory state and notifies the waiting agent's mailbox immediately), and
 *  fall back to writing approvals.json directly when the org isn't running or
 *  the daemon is unreachable — mirrors answerAction's live-then-offline shape. */
async function resolveApproval(
  ctx: CommandContext,
  name: string,
  role: string,
  action: string,
  approved: boolean,
): Promise<CommandResult> {
  const verb = approved ? 'approved' : 'denied';

  const { lookupOrg, normalizeCredential } = await import('../orgrt/broker.js');
  const remote = lookupOrg(name);
  if (remote) {
    const cred = normalizeCredential(remote.credential);
    try {
      const res = await fetch(`${remote.url}/api/set-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cred ? { 'x-monomind-cred': cred } : {}),
        },
        body: JSON.stringify({ org: name, role, action, approved }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        if (orgJson(ctx))
          return printOrgJson({
            v: 1, org: name, role, action, approved, delivery: 'live',
          });
        log(
          approved
            ? output.success(`Approved: ${role} may execute ${action} (live).`)
            : output.info(`Denied: ${role} may NOT execute ${action} (live).`),
        );
        return { success: true, message: `${verb} ${action} for ${role}` };
      }
      log(
        output.warning(
          `Live delivery rejected (${data.error ?? res.status}) — falling back to offline queue.`,
        ),
      );
    } catch (err) {
      log(
        output.warning(
          `Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`,
        ),
      );
    }
  }

  // Offline path: org isn't live (or the live call failed) — write approvals.json directly.
  const approvalsPath = join(ctx.cwd, ORG_DIR, name, 'approvals.json');
  if (!existsSync(approvalsPath)) {
    return { success: false, message: `no pending approvals for org ${name}` };
  }
  const data = JSON.parse(readFileSync(approvalsPath, 'utf8'));
  const pending = data.approvals ?? [];
  const item = pending.find(
    (a: { roleId: string; action: string }) => a.roleId === role && a.action === action,
  );

  if (!item) {
    return {
      success: false,
      message: `no pending approval found for role ${role} action ${action}`,
    };
  }

  item.approved = approved;
  item.ts = Date.now();
  writeFileSync(approvalsPath, JSON.stringify({ approvals: pending }, null, 2));

  if (orgJson(ctx))
    return printOrgJson({ v: 1, org: name, role, action, approved, delivery: 'recorded' });
  log(
    approved
      ? output.success(`Approved: ${role} may execute ${action}`)
      : output.info(`Denied: ${role} may NOT execute ${action}`),
  );
  return { success: true, message: `${verb} ${action} for ${role}` };
}

/** `org approve <org> <role> <action>` — approve a pending tool/action approval */
export const approveAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const role = ctx.args[1];
  const action = ctx.args[2];
  if (!role || !action) {
    return { success: false, message: 'usage: org approve <org> <role> <action>' };
  }
  return resolveApproval(ctx, name, role, action, true);
};

/** `org deny <org> <role> <action>` — deny a pending tool/action approval */
export const denyAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const role = ctx.args[1];
  const action = ctx.args[2];
  if (!role || !action) {
    return { success: false, message: 'usage: org deny <org> <role> <action>' };
  }
  return resolveApproval(ctx, name, role, action, false);
};

/** `org replay <org> <run-id>` — time-travel debugging: re-emit a past run's bus
 *  events into a fresh replay run for inspection. This is event-log replay only —
 *  it does not restart agent execution or restore live sessions. To actually
 *  resume an org's execution from where it left off, use `org run --resume`. */
export const replayAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = ctx.args[1];
  if (!run) {
    return { success: false, message: 'usage: org replay <org> <run-id>' };
  }

  const runDir = join(ctx.cwd, ORG_DIR, name, run);
  if (!existsSync(runDir)) {
    return { success: false, message: `run ${run} not found for org ${name}` };
  }

  const busFile = join(runDir, 'bus.jsonl');
  if (!existsSync(busFile)) {
    return { success: false, message: `no bus events found for run ${run}` };
  }

  log(output.info(`Replaying org ${name} events from checkpoint ${run}...`));

  // Create daemon and replay the bus events for debugging/inspection
  const { OrgDaemon } = await import('../orgrt/daemon.js');
  const daemon = new OrgDaemon(ctx.cwd, { forward: false });

  const resumed = await daemon.replayFrom(name, run);
  if (!resumed) {
    return {
      success: false,
      message: `replay failed - check bus.jsonl and org config for ${name} are valid`,
    };
  }

  log(output.success(`Org ${name} events replayed from ${run} as run ${resumed.run}`));
  log(output.info(`Use: monomind org logs ${name} --run ${resumed.run} to inspect events.`));
  log(
    output.info(
      `This is debug replay only — it does not restart agent execution. To resume live execution, use: monomind org run ${name} --resume`,
    ),
  );

  return { success: true, message: `replayed events from checkpoint ${run} as ${resumed.run}` };
};

/** `org resume-from <org>` — resume live execution from the org's persisted
 *  checkpoint (runtime.json): restores mailbox queues, policy/token counters,
 *  and session state, subject to checkpoint TTL and checksum validation. Unlike
 *  `replay`, this restarts real agent execution via `startOrg(..., { resume: true })`. */
export const resumeFromAction = async (
  ctx: CommandContext,
  name: string,
): Promise<CommandResult> => {
  log(output.info(`Resuming org ${name} from checkpoint...`));

  const { OrgDaemon } = await import('../orgrt/daemon.js');
  const daemon = new OrgDaemon(ctx.cwd, { forward: false });

  const resumed = await daemon.resumeOrg(name);
  if (!resumed) {
    return {
      success: false,
      message: `resume failed for ${name} - check runtime.json checkpoint is present, unexpired, and valid`,
    };
  }

  log(output.success(`Org ${name} resumed - ${resumed.agents.size} role(s) restored`));
  log(output.info(`Stop with: monomind org stop ${name}`));

  return { success: true, message: `resumed ${name} - ${resumed.agents.size} role(s) restored` };
};

/** `org branch <org> <run-id> <branch-name>` — snapshot a run's event log for replay.
 *  This is NOT an executable what-if scenario: it copies bus.jsonl into a new
 *  run directory tagged with a `.branch-source` marker so it can be inspected
 *  or replayed later; it does not fork or re-run agent execution.
 *  Delegates to the shared, atomic (tmp+rename) implementation in checkpoint-ops.ts. */
export const branchAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = ctx.args[1];
  const branchName = ctx.args[2];
  if (!run || !branchName) {
    return { success: false, message: 'usage: org branch <org> <run-id> <branch-name>' };
  }

  const result = branchCheckpoint(ctx.cwd, name, run, branchName);
  if (!result.ok) {
    return { success: false, message: result.error };
  }

  log(output.success(`Created branch "${branchName}" from ${run} as ${result.branchRun}`));
  return { success: true, message: `branch ${branchName} created as ${result.branchRun}` };
};

/** `org decisions <org> [--run id]` — show Rifft-style decision traces */
export const decisionsAction = async (
  ctx: CommandContext,
  name: string,
): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run) {
    return { success: false, message: `no runs found for org ${name}` };
  }

  const events = readRunEvents(ctx.cwd, name, run);
  if (!events.length) {
    return { success: false, message: `run ${run} has no recorded events` };
  }

  // Filter decision trace events
  const decisionEvents = events.filter(
    (e) =>
      e.type === 'audit' && e.reason === 'decision-trace' && e.data && typeof e.data === 'object',
  );

  if (orgJson(ctx)) {
    return printOrgJson({
      v: 1,
      org: name,
      run,
      items: decisionEvents.map((e) => ({
        ts: e.ts,
        role: e.from ?? 'system',
        ...(e.data as Record<string, unknown>),
      })),
    });
  }

  if (!decisionEvents.length) {
    log(output.info(`No decision traces found in ${run}`));
    return { success: true };
  }

  log(output.info(`Decision traces for ${name} / ${run} (${decisionEvents.length} decisions):`));
  log(output.info('┌──────────────────┬─────────────┬────────────────────────────────────────┐'));
  log(output.info('│ Role             │ Type        │ Context                                │'));
  log(output.info('├──────────────────┼─────────────┼────────────────────────────────────────┤'));

  for (const e of decisionEvents) {
    const role = e.from ?? 'system';
    const type = (e.data as { decisionType?: string }).decisionType ?? 'unknown';
    const context = (e.data as { context?: string }).context ?? '-';
    log(output.info(`│ ${role.padEnd(16)} │ ${type.padEnd(11)} │ ${context.padEnd(38)} │`));
  }

  log(output.info('└──────────────────┴─────────────┴────────────────────────────────────────┘'));

  return { success: true, message: `${decisionEvents.length} decision traces` };
};

// ── Decision gates ──────────────────────────────────────────────────────

function readGatesFile(cwd: string, org: string): { gates: DecisionGate[] } {
  try {
    return JSON.parse(readFileSync(join(cwd, ORG_DIR, org, 'gates.json'), 'utf8'));
  } catch {
    return { gates: [] };
  }
}

/** Read gates.json for a write path. A MISSING file legitimately means "no gates" → [].
 *  Any other failure (unreadable, malformed — e.g. a partial daemon write) THROWS:
 *  gateResolveAction rewrites this file from what this returns, so silently coercing a
 *  failed read to [] would surface a real I/O error as "gate not found" and a
 *  subsequent write would replace every recorded gate with just this one. */
function readGatesFileStrict(cwd: string, org: string): { gates: DecisionGate[] } {
  const path = join(cwd, ORG_DIR, org, 'gates.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { gates: [] };
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: { gates?: DecisionGate[] };
  try {
    parsed = JSON.parse(raw) as { gates?: DecisionGate[] };
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (parsed?.gates === undefined || parsed.gates === null) return { gates: [] };
  if (!Array.isArray(parsed.gates)) throw new Error(`${path}: "gates" is not an array`);
  return { gates: parsed.gates };
}

export const gatesAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const data = readGatesFile(ctx.cwd, name);
  const showAll = ctx.flags.all === true;
  const gates = showAll ? data.gates : data.gates.filter((g) => g.status === 'pending');

  if (orgJson(ctx)) return printOrgJson({ v: 1, org: name, items: gates });

  if (!gates.length) {
    log(
      output.info(
        showAll
          ? `No gates for org "${name}"`
          : `No pending gates for org "${name}" (use --all to include resolved)`,
      ),
    );
    return { success: true };
  }

  log(output.info(`${showAll ? 'All' : 'Pending'} gates for org "${name}" (${gates.length}):\n`));
  for (const g of gates) {
    const status =
      g.status === 'pending'
        ? '⏳ pending'
        : g.status === 'approved'
          ? '✅ approved'
          : '❌ rejected';
    log(output.info(`  ${g.id}  ${status}  role:${g.roleId}`));
    log(output.info(`    name: ${g.name}`));
    log(output.info(`    desc: ${g.description}`));
    if (g.resolution) log(output.info(`    resolution: ${g.resolution}`));
    log('');
  }
  return { success: true, message: `${gates.length} gate(s)` };
};

export const gateResolveAction = async (
  ctx: CommandContext,
  name: string,
  approved: boolean,
): Promise<CommandResult> => {
  const gateId = ctx.args[1];
  const resolution = ctx.args.slice(2).join(' ') || undefined;
  if (!gateId)
    return {
      success: false,
      message: `usage: monomind org gate-${approved ? 'approve' : 'reject'} ${name} <gate-id> [resolution]`,
    };

  let data: { gates: DecisionGate[] };
  try {
    data = readGatesFileStrict(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Cannot read gates for org ${name}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { success: false, message: 'gates.json unreadable — gate not resolved' };
  }
  const gate = data.gates.find((g) => g.id === gateId);
  if (!gate) return { success: false, message: `gate "${gateId}" not found for org "${name}"` };
  if (gate.status !== 'pending')
    return { success: false, message: `gate "${gateId}" already resolved (${gate.status})` };

  const { lookupOrg, normalizeCredential } = await import('../orgrt/broker.js');
  const remote = lookupOrg(name);
  if (remote) {
    const cred = normalizeCredential(remote.credential);
    try {
      const res = await fetch(`${remote.url}/api/resolve-gate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cred ? { 'x-monomind-cred': cred } : {}),
        },
        body: JSON.stringify({ org: name, gateId, approved, resolution }),
        signal: AbortSignal.timeout(10_000),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        if (orgJson(ctx))
          return printOrgJson({
            v: 1, org: name, gate_id: gateId,
            status: approved ? 'approved' : 'rejected', delivery: 'live',
          });
        log(output.success(`Gate ${gateId} ${approved ? 'approved' : 'rejected'} (live).`));
        return { success: true, message: `gate ${approved ? 'approved' : 'rejected'}` };
      }
      log(
        output.warning(
          `Live resolution rejected (${d.error ?? res.status}) — falling back to offline queue.`,
        ),
      );
    } catch (err) {
      log(
        output.warning(
          `Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`,
        ),
      );
    }
  }

  // Offline path: no live daemon hosts this org (or the live call failed) —
  // resolve gates.json directly, same as resolveApproval's offline branch.
  // Re-read fresh (mirrors answerAction/resolveApproval) in case a live
  // daemon resolved this gate concurrently while the live call above was
  // in flight or timing out.
  const { writeGates } = await import('../orgrt/decisions.js');
  let fresh: { gates: DecisionGate[] };
  try {
    fresh = readGatesFileStrict(ctx.cwd, name);
  } catch (err) {
    log(
      output.error(
        `Refusing to rewrite gates.json — ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    log(
      output.warning(
        `The gate was NOT resolved. Fix or restore ${join(ctx.cwd, ORG_DIR, name, 'gates.json')}, then retry.`,
      ),
    );
    return { success: false, message: 'gates.json unreadable — gate not resolved' };
  }
  const idx = fresh.gates.findIndex((g) => g.id === gateId);
  if (idx === -1)
    return { success: false, message: `gate "${gateId}" not found for org "${name}"` };
  if (fresh.gates[idx].status !== 'pending') {
    return {
      success: false,
      message: `gate "${gateId}" already resolved (${fresh.gates[idx].status})`,
    };
  }
  fresh.gates[idx] = {
    ...fresh.gates[idx],
    status: approved ? 'approved' : 'rejected',
    resolvedAt: Date.now(),
    resolvedBy: 'human',
    resolution,
  };
  writeGates(ctx.cwd, name, fresh);

  if (orgJson(ctx))
    return printOrgJson({
      v: 1, org: name, gate_id: gateId,
      status: approved ? 'approved' : 'rejected', delivery: 'recorded',
    });
  log(
    output.success(
      `Gate ${gateId} ${approved ? 'approved' : 'rejected'} — ${name} picks it up on its next cycle.`,
    ),
  );
  return { success: true, message: `gate ${approved ? 'approved' : 'rejected'} (queued)` };
};

// ─── org events — the only genuinely new org command (plan D12) ─────────────

/** Resolve a `--since` cursor: an event id (skip everything at/before it) or
 *  an ISO-8601 timestamp (skip older events). Returns null when unusable. */
function parseSinceCursor(raw: unknown): { id?: string; iso?: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (/^run-[A-Za-z0-9-]+/.test(raw)) return { id: raw };
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? { iso: raw } : null;
}

/** `org events <name> [--run id] [--follow] [--since <eventId|iso>] [--ndjson]`
 *  — live tail of a run's bus.jsonl as NDJSON, one BusEvent per line
 *  (protocol §7.3). This is the machine streaming surface; `org logs` stays
 *  the human one. NDJSON is the only output mode (--ndjson accepted for
 *  spec symmetry). */
export const eventsAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags.run);
  if (!run)
    return {
      success: false,
      message: `no runs found for org ${name} — start one with: monomind org run ${name}`,
    };
  const file = join(ctx.cwd, ORG_DIR, name, run, 'bus.jsonl');
  const since = parseSinceCursor(ctx.flags.since);

  let skippedPastId = !since?.id; // true = no id cursor, nothing to skip
  let seenLines = 0;
  const emitLine = (line: string): void => {
    let e: BusEvent;
    try {
      e = JSON.parse(line) as BusEvent;
    } catch {
      return; // corrupt interior line — skip, same policy as logsAction
    }
    if (since?.id) {
      if (!skippedPastId) {
        if (e.id === since.id) skippedPastId = true;
        return; // everything strictly before the cursor is replay-suppressed
      }
    }
    if (since?.iso && Date.parse(since.iso) && new Date(e.ts).getTime() < Date.parse(since.iso))
      return;
    process.stdout.write(`${JSON.stringify(e)}\n`);
  };

  const drain = (): void => {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (let i = seenLines; i < lines.length; i++) {
      // Only the FINAL line can be a partial mid-append write worth retrying.
      if (i === lines.length - 1) {
        try {
          JSON.parse(lines[i]);
        } catch {
          break;
        }
      }
      emitLine(lines[i]);
      seenLines = i + 1;
    }
  };
  drain();
  if (ctx.flags.follow !== true) return { success: true };
  await new Promise<void>((resolve) => {
    const iv = setInterval(drain, 500);
    process.once('SIGINT', () => {
      clearInterval(iv);
      resolve();
    });
    process.once('SIGTERM', () => {
      clearInterval(iv);
      resolve();
    });
  });
  return { success: true };
};
