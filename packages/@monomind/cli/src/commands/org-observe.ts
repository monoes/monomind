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
import { parseSchedule } from '../orgrt/scheduler.js';
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
      const ids = def.roles.map(r => r.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length) errors.push(`duplicate role id(s): ${[...new Set(dupes)].join(', ')}`);
      const roots = def.roles.filter(r => r.reports_to === null);
      if (roots.length === 0) errors.push('no root role — exactly one role must have reports_to: null');
      if (roots.length > 1) errors.push(`multiple root roles (${roots.map(r => r.id).join(', ')}) — exactly one may have reports_to: null`);
      for (const r of def.roles) {
        if (r.reports_to !== null && !ids.includes(r.reports_to)) errors.push(`role "${r.id}": reports_to "${r.reports_to}" matches no role id`);
        if (r.reports_to === r.id) errors.push(`role "${r.id}" reports to itself`);
      }
      if (def.schedule != null && parseSchedule(def.schedule) === null) errors.push(`schedule "${def.schedule}" is not parseable — use "<N>s", "<N>m", or "<N>h"`);
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

const resolveRun = (cwd: string, name: string, runFlag: unknown): string | null => {
  if (typeof runFlag === 'string' && runFlag) return runFlag;
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
    for (const l of lines.slice(seenLines)) {
      try { show(JSON.parse(l) as BusEvent); seenLines++; }
      catch { break; } // partial line mid-append — retry it next tick
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
  log(output.info(`ORG REPORT — ${name} / ${run}`));
  log(output.info(`  Duration: ${s.durationMs != null ? `${Math.round(s.durationMs / 1000)}s` : '?'}   Events: ${s.events}   Messages: ${s.messages}${s.xorgMessages ? ` (+${s.xorgMessages} cross-org)` : ''}`));
  log(output.info(`  Tokens: ${s.totalTokens}${s.totalCostUsd ? `   Cost: $${s.totalCostUsd.toFixed(4)}` : ''}`));
  if (s.outcome) log(output.success(`  Outcome: ${s.outcome.status} (by ${s.outcome.by}) — ${s.outcome.summary}`));
  else log(output.warning('  Outcome: not recorded (coordinator never called org_complete)'));
  log(output.info('  Roles:'));
  for (const [id, r] of Object.entries(s.roles)) {
    log(output.info(`    ${r.crashed ? '✗' : '•'} ${id}: ${r.messagesSent} msgs, ${r.toolsAllowed} tools${r.toolsDenied ? ` (${r.toolsDenied} denied)` : ''}, ${r.tokens} tokens${r.crashed ? ' — CRASHED' : ''}`));
  }
  if (s.assets.length) {
    log(output.info(`  Assets (${s.assets.length}):`));
    for (const a of s.assets.slice(0, 20)) log(output.info(`    📄 ${a}`));
    if (s.assets.length > 20) log(output.info(`    … and ${s.assets.length - 20} more`));
  }
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
