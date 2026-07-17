// packages/@monomind/cli/src/commands/org.ts
import { readFileSync, existsSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';

const log = (text: string): void => { console.log(text); };

/** Org names are used to build filesystem paths under .monomind/orgs — reject
 * anything that isn't a plain identifier to prevent path traversal (e.g.
 * `monomind org stop '../../../../tmp/x'`). */
const ORG_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function validateOrgName(name: string | undefined): { ok: true; name: string } | { ok: false; result: CommandResult } {
  if (!name) return { ok: false, result: { success: false, message: 'org name required' } };
  if (!ORG_NAME_RE.test(name)) {
    log(output.error(`Invalid org name: ${name}`));
    return { ok: false, result: { success: false, message: 'invalid org name' } };
  }
  return { ok: true, name };
}

/** Suffixes of org-internal artifact files (state/goals/threads/etc) that
 * share the `<org>.json`/`.jsonl` naming pattern with the org's own config
 * file. Single source of truth for both listOrgConfigFiles() (which must
 * exclude them when discovering real org configs) and deleteAction (which
 * must remove all of them when deleting an org). */
const ORG_ARTIFACT_SUFFIXES = [
  '-state', '-goals', '-threads', '-activity', '-approvals', '-members', '-secrets', '-budgets',
  '-routines', '-issues', '-projects', '-workspaces', '-worktrees', '-environments',
  '-plugins', '-adapters', '-join-requests', '-bootstrap', '-project-workspaces',
  '-approval-comments', '-skills',
];
function listOrgConfigFiles(orgsDir: string): string[] {
  return readdirSync(orgsDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('._') && !ORG_ARTIFACT_SUFFIXES.some(suf => f.includes(suf)));
}

/** Remove a lingering stopfile so a fresh `org run` doesn't self-terminate. */
export const clearStopfile = (cwd: string, name: string): void => {
  rmSync(join(cwd, ORG_DIR, name, 'stop'), { force: true });
};

const runAction = async (ctx: CommandContext): Promise<CommandResult> => {
  if (!ctx.args[0]) return { success: false, message: 'org name required: monomind org run <name> [--task "..."]' };
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  // A repeated --task flag is promoted to an array by the parser (deliberate,
  // documented behavior elsewhere — repeats never silently drop a value); a
  // plain `as string` cast would let that array flow straight into the org's
  // goal and get stringified as "a,b" with no warning. Checked before any
  // side effects (starting the xdeliver listener) run.
  const taskFlag = ctx.flags['task'];
  if (Array.isArray(taskFlag)) return { success: false, message: '--task was passed more than once — pass it exactly once' };
  const crossProcess = ctx.flags['crossProcess'] !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`);
  }
  const running = await daemon.startOrg(name, taskFlag as string | undefined);
  log(output.info(`org ${name} running (${running.def.roles.length} agents, run ${running.run}) — Ctrl-C or "monomind org stop ${name}" to stop`));

  // stopfile poll lets `org stop` work from another terminal;
  // clear any stale stopfile from a previous run before polling
  clearStopfile(ctx.cwd, name);
  const stopfile = join(ctx.cwd, ORG_DIR, name, 'stop');
  await new Promise<void>(resolvePromise => {
    const iv = setInterval(() => { if (existsSync(stopfile)) { clearInterval(iv); resolvePromise(); } }, 2000);
    process.once('SIGINT', () => { clearInterval(iv); resolvePromise(); });
    process.once('SIGTERM', () => { clearInterval(iv); resolvePromise(); });
  });
  clearStopfile(ctx.cwd, name);
  await daemon.stopAll();
  srv?.close();
  return { success: true, message: `org ${name} stopped` };
};

const stopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'stop'), new Date().toISOString());
  return { success: true, message: `stop requested for ${name} (daemon exits within 2s)` };
};

const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
  let name: string | undefined;
  if (ctx.args[0]) {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    name = validated.name;
  }
  const orgDir = join(ctx.cwd, ORG_DIR);
  const targets = name ? [name] : (existsSync(orgDir)
    ? listOrgConfigFiles(orgDir).map(f => f.replace(/\.json$/, ''))
    : []);
  for (const t of targets) {
    const rt = join(orgDir, t, 'runtime.json');
    let state: { status: string; run?: string; pid?: number } = { status: 'never run' };
    if (existsSync(rt)) {
      try {
        state = JSON.parse(readFileSync(rt, 'utf8'));
      } catch (err) {
        log(output.warning(`${t}: could not read runtime.json (${err instanceof Error ? err.message : 'corrupt/truncated file'})`));
        continue;
      }
    }
    log(output.info(`${t}: ${state.status}${state.run ? ` (run ${state.run}, pid ${state.pid})` : ''}`));
  }
  return { success: true };
};

const serveAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const crossProcess = ctx.flags['crossProcess'] !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`);
  }
  log(output.info('org daemon serving — Ctrl-C to stop'));

  // schedule orgs whose definition declares an interval (e.g. "15m", "2h")
  const { OrgScheduler, parseSchedule } = await import('../orgrt/scheduler.js');
  const sched = new OrgScheduler(async (name, intervalMs) => {
    try {
      await daemon.startOrg(name);
      // Scheduled iterations are time-bounded: agents' `done` promises only
      // resolve after stopOrg closes the mailboxes, so waiting on them alone
      // deadlocks. Race against a max-run timeout, then ALWAYS stopOrg
      // (idempotent — it resolves `done` and flushes).
      const org = daemon.getOrg(name);
      const allDone = org
        ? Promise.allSettled([...org.agents.values()].map(a => a.done))
        : Promise.resolve([]);
      const maxRun = (org?.def as { run_config?: { max_run?: string | number } } | undefined)?.run_config?.max_run;
      const maxMs = parseSchedule(maxRun) ?? Math.min(intervalMs, 600_000); // cap: schedule interval or 10 min
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([allDone, new Promise<void>(r => {
        timer = setTimeout(r, maxMs);
        timer.unref?.();
      })]);
      if (timer) clearTimeout(timer);
    } catch (err) {
      console.error(`org ${name}: scheduled run failed:`, err);
    } finally {
      await daemon.stopOrg(name).catch(err => console.error(`org ${name}: stop failed:`, err));
    }
  });
  const orgDir = join(ctx.cwd, ORG_DIR);
  if (existsSync(orgDir)) {
    for (const f of listOrgConfigFiles(orgDir)) {
      try {
        const def = JSON.parse(readFileSync(join(orgDir, f), 'utf8'));
        const ms = parseSchedule(def.schedule);
        if (ms) {
          // register by filename stem — that's what startOrg loads
          const stem = f.replace(/\.json$/, '');
          if (def.name && def.name !== stem) log(output.warning(`org file ${f}: def.name "${def.name}" differs from filename — scheduling as "${stem}"`));
          sched.add(stem, ms);
          log(output.info(`scheduled org ${stem} every ${Math.round(ms / 60_000)}m`));
        }
      } catch (err) {
        log(output.warning(`org file ${f}: could not parse — skipping (${err instanceof Error ? err.message : 'invalid JSON'})`));
      }
    }
  }

  await new Promise<void>(r => { process.once('SIGINT', () => r()); process.once('SIGTERM', () => r()); });
  sched.stop();
  await daemon.stopAll();
  srv?.close();
  return { success: true };
};

const testLoopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  // non-literal specifier: test-loop.ts lands in a later task; keeps tsc clean until then
  const testLoopModule = '../orgrt/test-loop.js';
  const { runTestLoop } = await import(testLoopModule) as
    { runTestLoop: (cwd: string, times: number) => Promise<{ summary: string; failed: number }> };
  const n = Number(ctx.flags['times'] ?? ctx.flags['n'] ?? 5);
  const report = await runTestLoop(ctx.cwd, n);
  log(output.info(report.summary));
  return { success: report.failed === 0, message: report.summary };
};

/** Validate org config(s) against OrgDefSchema — the exact parse `org run`/`org serve`
 * perform — plus the structural invariants the runtime assumes but the schema can't
 * express (single root role, resolvable reports_to, unique ids, parseable schedule). */
const validateAction = async (ctx: CommandContext): Promise<CommandResult> => {
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
  const { parseSchedule } = await import('../orgrt/scheduler.js');
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

// ---- legacy management subcommands (list / delete / mark-complete) ----

const listAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgsDir = join(ctx.cwd || process.cwd(), ORG_DIR);
  if (!existsSync(orgsDir)) {
    log(output.info('No orgs directory found. Create an org first with /mastermind:createorg'));
    return { success: true };
  }
  const configs = listOrgConfigFiles(orgsDir);
  if (!configs.length) {
    log(output.info('No orgs found.'));
    return { success: true };
  }
  log(output.info(`Found ${configs.length} org(s):`));
  for (const f of configs) {
    const stem = f.replace(/\.json$/, '');
    let detail = '';
    try {
      const def = JSON.parse(readFileSync(join(orgsDir, f), 'utf8')) as
        { goal?: string; schedule?: string | number | null; roles?: unknown[] };
      const roles = Array.isArray(def.roles) ? def.roles.length : 0;
      const sched = def.schedule ? `every ${def.schedule}` : 'manual';
      let status = 'never run';
      try {
        status = (JSON.parse(readFileSync(join(orgsDir, stem, 'runtime.json'), 'utf8')) as { status?: string }).status ?? status;
      } catch { /* no runtime state yet */ }
      const goal = typeof def.goal === 'string' && def.goal
        ? ` — ${def.goal.length > 60 ? `${def.goal.slice(0, 57)}...` : def.goal}` : '';
      detail = `  (${roles} role${roles === 1 ? '' : 's'}, ${sched}, ${status})${goal}`;
    } catch {
      detail = '  (unreadable config — run `monomind org validate`)';
    }
    log(output.info(`  • ${stem}${detail}`));
  }
  return { success: true };
};

const deleteAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgName = ctx.args[0];
  if (!orgName) {
    log(output.error('Usage: monomind org delete <name>'));
    return { success: false, message: 'org name required' };
  }
  if (!ORG_NAME_RE.test(orgName)) {
    log(output.error(`Invalid org name: ${orgName}`));
    return { success: false, message: 'invalid org name' };
  }
  const confirmed = ctx.flags['yes'] === true || ctx.args.includes('--yes') || ctx.args.includes('-y');
  if (!confirmed) {
    log(output.warning(`This will permanently delete org "${orgName}" and all its data.`));
    log(output.warning('Pass --yes to confirm.'));
    return { success: false, message: 'confirmation required' };
  }
  const cwd = resolve(ctx.cwd || process.cwd());
  const orgsDir = join(cwd, ORG_DIR);
  const configFile = join(orgsDir, `${orgName}.json`);
  if (!existsSync(configFile)) {
    log(output.error(`Org not found: ${orgName}`));
    return { success: false, message: 'org not found' };
  }
  let removed = 0;
  for (const suf of ['', ...ORG_ARTIFACT_SUFFIXES]) {
    for (const ext of ['.json', '.jsonl']) {
      const f = join(orgsDir, `${orgName}${suf}${ext}`);
      try { if (existsSync(f)) { unlinkSync(f); removed++; } } catch { /* ignore */ }
    }
  }
  try { unlinkSync(join(orgsDir, '.stops', `${orgName}.stop`)); } catch { /* ignore */ }
  const orgSubDir = join(orgsDir, orgName);
  try { if (existsSync(orgSubDir)) rmSync(orgSubDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { unlinkSync(join(cwd, '.monomind', 'loops', `${orgName}.md`)); } catch { /* ignore */ }
  try { unlinkSync(join(orgsDir, `${orgName}-run.md`)); } catch { /* ignore */ }
  log(output.success(`Org "${orgName}" deleted (${removed} file(s) removed).`));
  return { success: true };
};

const markCompleteAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgName = ctx.args[0];
  if (!orgName || !ORG_NAME_RE.test(orgName)) {
    log(output.error('Usage: monomind org mark-complete <name>'));
    return { success: false, message: 'valid org name required' };
  }
  const cwd = resolve(ctx.cwd || process.cwd());
  let ctrlUrl = 'http://localhost:4242';
  try {
    const ctl = JSON.parse(readFileSync(join(cwd, '.monomind', 'control.json'), 'utf8'));
    if (ctl.url) ctrlUrl = ctl.url;
  } catch { /* default */ }
  try {
    const res = await fetch(`${ctrlUrl}/api/orgs/${encodeURIComponent(orgName)}/mark-complete`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(output.error(`mark-complete failed (${res.status}): ${(body as { error?: string }).error || 'unknown error'}`));
      return { success: false, message: 'server rejected mark-complete' };
    }
    const runId = (body as { runId?: string }).runId;
    log(output.success(`Run marked complete for org "${orgName}"${runId ? ` (run ${runId})` : ''}.`));
    return { success: true };
  } catch (err) {
    log(output.error(`Dashboard server unreachable at ${ctrlUrl} — is it running? (${err instanceof Error ? err.message : 'error'})`));
    return { success: false, message: 'server unreachable' };
  }
};

export const orgCommand: Command = {
  name: 'org',
  description: 'SDK-based org runtime — run agent organizations as a controlled daemon',
  subcommands: [
    {
      name: 'run', description: 'Start an org (foreground daemon)',
      options: [
        { name: 'task', description: 'Override the org goal for this run', type: 'string' },
        { name: 'cross-process', description: 'Discover and message orgs hosted by other monomind processes on this machine (default true)', type: 'boolean', default: true },
      ],
      examples: [{ command: 'monomind org run growth --task "weekly report"', description: 'Run the growth org once with a task' }],
      action: runAction,
    },
    { name: 'stop', description: 'Request a running org daemon to stop', action: stopAction },
    { name: 'status', description: 'Show runtime state of orgs', action: statusAction },
    {
      name: 'serve', description: 'Start the daemon server only (hosts scheduled orgs)',
      options: [
        { name: 'cross-process', description: 'Discover and message orgs hosted by other monomind processes on this machine (default true)', type: 'boolean', default: true },
      ],
      action: serveAction,
    },
    {
      name: 'test-loop', description: 'Run the org e2e verification loop N times',
      options: [{ name: 'times', short: 'n', description: 'Iterations', type: 'number', default: 5 }],
      action: testLoopAction,
    },
    {
      name: 'validate', description: 'Validate org config(s) against the runtime schema and structural invariants',
      examples: [
        { command: 'monomind org validate growth', description: 'Validate one org config' },
        { command: 'monomind org validate', description: 'Validate every org config in the project' },
      ],
      action: validateAction,
    },
    { name: 'list', description: 'List all orgs in the current project', action: listAction },
    {
      name: 'delete', description: 'Delete an org and all its data',
      options: [{ name: 'yes', short: 'y', description: 'Skip confirmation', type: 'boolean' }],
      action: deleteAction,
    },
    { name: 'mark-complete', description: 'Manually close a stale/crashed run', action: markCompleteAction },
  ],
  examples: [{ command: 'monomind org run my-org', description: 'Run an org under full daemon control' }],
  action: async (): Promise<CommandResult> => {
    // index.ts's dispatcher never prints result.message on a failed action —
    // it only exits with result.exitCode — so this must log itself or bare
    // `monomind org` exits silently with code 1 and zero output.
    const message = 'usage: monomind org <run|stop|status|serve|test-loop|validate|list|delete|mark-complete>';
    log(output.error(message));
    return { success: false, message };
  },
};

export default orgCommand;
