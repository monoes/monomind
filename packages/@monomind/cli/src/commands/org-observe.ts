// packages/@monomind/cli/src/commands/org-observe.ts
// Read-side org subcommands (logs / report) + template scaffolding (create).
// Kept out of org.ts to respect the 500-line file ceiling.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { ORG_DIR, OrgDefSchema, type BusEvent } from '../orgrt/types.js';
import { formatEvent, listRunDirs, readHistory, readRunEvents, summarizeRun } from '../orgrt/reporting.js';
import { ORG_TEMPLATES, buildFromTemplate } from '../orgrt/templates.js';
import { checkOrgStructure } from '../orgrt/migrate.js';
import { listOrgConfigFiles, validateOrgName } from './org.js';

const log = (text: string): void => { console.log(text); };

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
    if (!existsSync(orgsDir)) return { success: false, message: 'no orgs directory — create an org first with /mastermind:createorg' };
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
      if (def.name !== stem) warnings.push(`def.name "${def.name}" differs from filename — the runtime addresses this org as "${stem}"`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    for (const w of warnings) log(output.warning(`${stem}: ${w}`));
    if (errors.length) {
      failed++;
      for (const e of errors) log(output.error(`${stem}: ${e}`));
    } else {
      log(output.success(`${stem}: valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`));
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

/** `org logs <name> [--run id] [--role r] [--follow]` — formatted bus.jsonl tail. */
export const logsAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const run = resolveRun(ctx.cwd, name, ctx.flags['run']);
  if (!run) return { success: false, message: `no runs found for org ${name} — start one with: monomind org run ${name}` };
  const file = join(ctx.cwd, ORG_DIR, name, run, 'bus.jsonl');
  const roleFilter = typeof ctx.flags['role'] === 'string' ? ctx.flags['role'] : null;
  const show = (e: BusEvent): void => {
    if (roleFilter && e.from !== roleFilter && e.to !== roleFilter) return;
    log(formatEvent(e));
  };
  log(output.info(`org ${name} — ${run}${roleFilter ? ` (role: ${roleFilter})` : ''}`));
  let seenLines = 0;
  const drain = (): void => {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (let i = seenLines; i < lines.length; i++) {
      try { show(JSON.parse(lines[i]) as BusEvent); seenLines = i + 1; }
      catch {
        // Only the FINAL line can be a partial mid-append write worth
        // retrying; a corrupt interior line would otherwise stall the tail
        // forever — skip it and keep going.
        if (i === lines.length - 1) break;
        seenLines = i + 1;
      }
    }
  };
  drain();
  if (ctx.flags['follow'] !== true) return { success: true };
  log(output.info('following — Ctrl-C to stop'));
  await new Promise<void>(resolve => {
    const iv = setInterval(drain, 500);
    process.once('SIGINT', () => { clearInterval(iv); resolve(); });
    process.once('SIGTERM', () => { clearInterval(iv); resolve(); });
  });
  return { success: true };
};

/** `org report <name> [--run id] [--all]` — summarize a run (or list run history). */
export const reportAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  if (ctx.flags['all'] === true) {
    const history = readHistory(ctx.cwd, name);
    if (!history.length) return { success: false, message: `no run history for org ${name}` };
    log(output.info(`org ${name} — ${history.length} recorded run(s):`));
    for (const h of history) {
      const dur = h.durationMs != null ? `${Math.round(h.durationMs / 1000)}s` : '?';
      const outcome = h.outcome ? `${h.outcome.status}: ${h.outcome.summary.slice(0, 60)}` : 'no outcome recorded';
      log(output.info(`  • ${h.run}  ${dur}  ${h.totalTokens} tokens  ${h.messages} msgs  — ${outcome}`));
    }
    return { success: true };
  }
  const run = resolveRun(ctx.cwd, name, ctx.flags['run']);
  if (!run) return { success: false, message: `no runs found for org ${name}` };
  const events = readRunEvents(ctx.cwd, name, run);
  if (!events.length) return { success: false, message: `run ${run} has no recorded events` };
  const s = summarizeRun(events);
  // Per-role budget ceiling: same split the daemon applies (budget ÷ role count),
  // with any explicit policy.maxTokens override. Missing/unreadable config → no ceilings.
  let perRoleBudget: number | null = null;
  const roleCeiling = new Map<string, number>();
  try {
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, `${name}.json`), 'utf8')));
    perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
    for (const r of def.roles) {
      const max = (r.policy as { maxTokens?: number } | undefined)?.maxTokens;
      roleCeiling.set(r.id, max ?? perRoleBudget);
    }
  } catch { /* config gone or invalid — report without budget context */ }
  const budgetNote = (id: string, tokens: number): string => {
    const cap = roleCeiling.get(id);
    if (!cap) return '';
    const pct = Math.round((tokens / cap) * 100);
    return ` (${pct}% of ${cap}${pct >= 100 ? ' — EXHAUSTED' : pct >= 80 ? ' — near limit' : ''})`;
  };
  log(output.info(`ORG REPORT — ${name} / ${run}`));
  log(output.info(`  Duration: ${s.durationMs != null ? `${Math.round(s.durationMs / 1000)}s` : '?'}   Events: ${s.events}   Messages: ${s.messages}${s.xorgMessages ? ` (+${s.xorgMessages} cross-org)` : ''}`));
  log(output.info(`  Tokens: ${s.totalTokens}${perRoleBudget ? ` (budget: ${perRoleBudget}/role)` : ''}${s.totalCostUsd ? `   Cost: $${s.totalCostUsd.toFixed(4)}` : ''}`));
  if (s.outcome) log(output.success(`  Outcome: ${s.outcome.status} (by ${s.outcome.by}) — ${s.outcome.summary}`));
  else log(output.warning('  Outcome: not recorded (coordinator never called org_complete)'));
  log(output.info('  Roles:'));
  for (const [id, r] of Object.entries(s.roles)) {
    log(output.info(`    ${r.crashed ? '✗' : '•'} ${id}: ${r.messagesSent} msgs, ${r.toolsAllowed} tools${r.toolsDenied ? ` (${r.toolsDenied} denied)` : ''}, ${r.tokens} tokens${budgetNote(id, r.tokens)}${r.crashed ? ' — CRASHED' : ''}`));
  }
  if (s.assets.length) {
    log(output.info(`  Assets (${s.assets.length}):`));
    for (const a of s.assets.slice(0, 20)) log(output.info(`    📄 ${a}`));
    if (s.assets.length > 20) log(output.info(`    … and ${s.assets.length - 20} more`));
  }
  return { success: true };
};

interface OrgQuestion { questionId: string; role: string; question: string; ts: number; answer: string | null; answeredAt: number | null }

const readQuestions = (cwd: string, name: string): OrgQuestion[] => {
  try {
    return (JSON.parse(readFileSync(join(cwd, ORG_DIR, name, 'questions.json'), 'utf8')) as { questions?: OrgQuestion[] }).questions ?? [];
  } catch { return []; }
};

/** `org questions <name> [--all]` — list pending (or all) ask_human questions. */
export const questionsAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const all = readQuestions(ctx.cwd, name);
  const shown = ctx.flags['all'] === true ? all : all.filter(q => q.answer === null);
  if (!shown.length) {
    log(output.info(all.length ? `No pending questions for org ${name} (${all.length} answered — use --all).` : `No questions recorded for org ${name}.`));
    return { success: true };
  }
  for (const q of shown) {
    const when = new Date(q.ts).toISOString().replace('T', ' ').slice(0, 16);
    log(output.info(`${q.answer === null ? '❓' : '✓'} [${q.questionId}] ${when}  ${q.role}: ${q.question}`));
    if (q.answer !== null) log(output.info(`     ↳ ${q.answer}`));
  }
  if (shown.some(q => q.answer === null))
    log(output.info(`\nAnswer with: monomind org answer ${name} <question-id> "your answer"`));
  return { success: true };
};

/** `org answer <name> <question-id> <answer...>` — answer a pending ask_human question.
 *  Delivers live via the hosting daemon's /api/answer-question when the org is running
 *  (broker lookup); otherwise records the answer and queues it for the next run. */
export const answerAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const questionId = ctx.args[1];
  const answer = ctx.args.slice(2).join(' ').trim();
  if (!questionId || !answer) return { success: false, message: `usage: monomind org answer ${name} <question-id> "answer text"` };
  const questions = readQuestions(ctx.cwd, name);
  const q = questions.find(x => x.questionId === questionId);
  if (!q) {
    log(output.error(`Question "${questionId}" not found for org ${name} — list with: monomind org questions ${name}`));
    return { success: false, message: 'question not found' };
  }
  if (q.answer !== null) return { success: false, message: `question "${questionId}" was already answered` };

  // Live path: the hosting daemon updates questions.json and pushes into the role's mailbox.
  const { lookupOrg } = await import('../orgrt/broker.js');
  const remote = lookupOrg(name);
  if (remote) {
    try {
      const res = await fetch(`${remote.url}/api/answer-question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org: name, role: q.role, questionId, answer }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        log(output.success(`Answer delivered to ${name}:${q.role} (live).`));
        return { success: true };
      }
      log(output.warning(`Live delivery rejected (${data.error ?? res.status}) — falling back to offline queue.`));
    } catch (err) {
      log(output.warning(`Hosting daemon unreachable (${err instanceof Error ? err.message : 'error'}) — falling back to offline queue.`));
    }
  }

  // Offline path: mirror daemon.answerQuestion's org-not-running branch.
  // RE-READ and merge by questionId just before writing — the pre-fetch
  // snapshot can be up to 10s stale (live-delivery timeout), and rewriting
  // from it would delete questions the daemon appended meanwhile and revert
  // answers it recorded (atomic rename prevents torn writes, not lost updates).
  const fresh = readQuestions(ctx.cwd, name);
  const freshQ = fresh.find(x => x.questionId === questionId);
  if (freshQ && freshQ.answer !== null) {
    return { success: false, message: `question "${questionId}" was answered while this command was running` };
  }
  const merged = fresh.some(x => x.questionId === questionId)
    ? fresh.map(x => x.questionId === questionId ? { ...x, answer, answeredAt: Date.now() } : x)
    : [...fresh, { ...q, answer, answeredAt: Date.now() }];
  const dest = join(ctx.cwd, ORG_DIR, name, 'questions.json');
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ questions: merged }, null, 2));
  const { renameSync } = await import('node:fs');
  renameSync(tmp, dest);
  const { queueMessage } = await import('../orgrt/inbox.js');
  queueMessage(ctx.cwd, name, {
    fromQualified: 'human', toRole: q.role,
    subject: `answer:${questionId}`,
    body: `question: ${q.question}\n\nanswer: ${answer}`,
    ts: Date.now(),
  });
  log(output.success(`Answer recorded — ${name}:${q.role} receives it when the org next runs.`));
  return { success: true };
};

/** `org create <name> --template <t> [--goal g] [--schedule s]` — scaffold a config from a template. */
export const createAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const templateName = typeof ctx.flags['template'] === 'string' ? ctx.flags['template'] : '';
  if (!templateName) {
    log(output.info(`Available templates: ${Object.keys(ORG_TEMPLATES).join(', ')}`));
    return { success: false, message: 'usage: monomind org create <name> --template <template> [--goal "..."] [--schedule 30m]' };
  }
  const def = buildFromTemplate(templateName, name, typeof ctx.flags['goal'] === 'string' ? ctx.flags['goal'] : undefined);
  if (!def) {
    log(output.error(`Unknown template "${templateName}" — available: ${Object.keys(ORG_TEMPLATES).join(', ')}`));
    return { success: false, message: 'unknown template' };
  }
  if (typeof ctx.flags['schedule'] === 'string') def.schedule = ctx.flags['schedule'];
  const file = join(ctx.cwd, ORG_DIR, `${name}.json`);
  if (existsSync(file) && ctx.flags['force'] !== true) {
    log(output.error(`Org "${name}" already exists — pass --force to overwrite.`));
    return { success: false, message: 'org exists' };
  }
  OrgDefSchema.parse(def); // templates must always produce a runnable config
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(ctx.cwd, ORG_DIR), { recursive: true });
  writeFileSync(file, JSON.stringify(def, null, 2) + '\n', 'utf8');
  log(output.success(`Org "${name}" created from template "${templateName}" (${def.roles.length} roles).`));
  log(output.info(`  Edit the goal/roles in ${file}, then: monomind org run ${name}`));
  return { success: true };
};
