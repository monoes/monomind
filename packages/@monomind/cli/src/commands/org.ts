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

export function validateOrgName(name: string | undefined): { ok: true; name: string } | { ok: false; result: CommandResult } {
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
export function listOrgConfigFiles(orgsDir: string): string[] {
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
  // Fail before any side effects (inbox server) when the org doesn't exist.
  const orgsDir = join(ctx.cwd, ORG_DIR);
  if (!existsSync(join(orgsDir, `${name}.json`))) {
    const known = existsSync(orgsDir) ? listOrgConfigFiles(orgsDir).map(f => f.replace(/\.json$/, '')) : [];
    log(output.error(`Org not found: ${name}${known.length ? ` — available: ${known.join(', ')}` : ' — create one with /mastermind:createorg'}`));
    return { success: false, message: 'org not found' };
  }
  if (ctx.flags['dryRun'] === true) {
    // Validate + preview each role's actual briefing without spawning sessions.
    try {
      const def = OrgDefSchema.parse(JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')));
      const { buildRolePrompt } = await import('../orgrt/session.js');
      const roster = def.roles.map(r => r.id);
      const perRole = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
      log(output.info(`DRY RUN — org ${name}: ${def.roles.length} roles, ${perRole} tokens each, goal: ${taskFlag ?? def.goal}`));
      for (const role of def.roles) {
        log(output.info(`\n─── ${role.id} (${role.title || role.type})${role.adapter_config?.model ? ` [${role.adapter_config.model}]` : ''} ───`));
        log(buildRolePrompt(role, { name: def.name, goal: (taskFlag as string | undefined) ?? def.goal }, roster));
      }
      return { success: true, message: 'dry run complete — no sessions started' };
    } catch (err) {
      log(output.error(`Config invalid: ${err instanceof Error ? err.message : String(err)}`));
      return { success: false, message: 'invalid org config' };
    }
  }
  const crossProcess = ctx.flags['crossProcess'] !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`);
  }
  let running: Awaited<ReturnType<typeof daemon.startOrg>>;
  try {
    running = await daemon.startOrg(name, taskFlag as string | undefined);
  } catch (err) {
    // Don't leave the inbox server holding the event loop open on a failed start.
    srv?.close();
    await daemon.stopAll().catch(() => { /* nothing started */ });
    const detail = err instanceof Error ? err.message : String(err);
    const hint = err instanceof Error && err.name === 'ZodError'
      ? ` — run "monomind org validate ${name}" for details` : '';
    log(output.error(`Could not start org ${name}: ${detail}${hint}`));
    return { success: false, message: 'org start failed' };
  }
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

/** True when runtime.json records a running org whose recorded pid is still alive. */
const isOrgRunning = (cwd: string, name: string): boolean => {
  try {
    const rt = JSON.parse(readFileSync(join(cwd, ORG_DIR, name, 'runtime.json'), 'utf8')) as
      { status?: string; pid?: number };
    if (rt.status !== 'running' || !rt.pid) return false;
    process.kill(rt.pid, 0); // throws if the pid is gone (crashed daemon left a stale file)
    return true;
  } catch {
    return false;
  }
};

const stopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
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
    // A "running" record whose pid is gone means the daemon died without its
    // stopOrg cleanup — surface that instead of reporting it as still running.
    if (state.status === 'running' && state.pid) {
      try {
        process.kill(state.pid, 0);
      } catch {
        log(output.warning(`${t}: crashed (runtime.json says running but pid ${state.pid} is gone)${state.run ? ` — run ${state.run}` : ''} — close it out with "monomind org mark-complete ${t}"`));
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
  if (isOrgRunning(cwd, orgName) && ctx.flags['force'] !== true) {
    log(output.error(`Org "${orgName}" is currently running — stop it first (monomind org stop ${orgName}) or pass --force.`));
    return { success: false, message: 'org is running' };
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
        { name: 'dry-run', description: 'Validate and print each role\'s briefing without starting any agent sessions', type: 'boolean' },
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
      name: 'logs', description: 'Show (or follow) the formatted event log of an org run',
      options: [
        { name: 'run', description: 'Run id (default: latest)', type: 'string' },
        { name: 'role', description: 'Only events from/to this role', type: 'string' },
        { name: 'follow', short: 'f', description: 'Keep tailing until Ctrl-C', type: 'boolean' },
      ],
      examples: [{ command: 'monomind org logs growth --follow', description: 'Live-tail the latest run' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { logsAction } = await import('./org-observe.js');
        return logsAction(ctx, v.name);
      },
    },
    {
      name: 'report', description: 'Summarize an org run: outcome, per-role activity, tokens, assets, crashes',
      options: [
        { name: 'run', description: 'Run id (default: latest)', type: 'string' },
        { name: 'all', description: 'List all recorded runs from history', type: 'boolean' },
      ],
      examples: [{ command: 'monomind org report growth', description: 'Report on the latest run' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { reportAction } = await import('./org-observe.js');
        return reportAction(ctx, v.name);
      },
    },
    {
      name: 'create', description: 'Scaffold an org config from a starter template',
      options: [
        { name: 'template', description: 'content-team | dev-team | research-pod', type: 'string' },
        { name: 'goal', description: 'Org goal (defaults to the template\'s placeholder)', type: 'string' },
        { name: 'schedule', description: 'Daemon schedule, e.g. 30m or 2h', type: 'string' },
        { name: 'force', description: 'Overwrite an existing org config', type: 'boolean' },
      ],
      examples: [{ command: 'monomind org create blog --template content-team --goal "3 posts/week"', description: 'Create a content org' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { createAction } = await import('./org-observe.js');
        return createAction(ctx, v.name);
      },
    },
    {
      name: 'validate', description: 'Validate org config(s) against the runtime schema and structural invariants',
      examples: [
        { command: 'monomind org validate growth', description: 'Validate one org config' },
        { command: 'monomind org validate', description: 'Validate every org config in the project' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const { validateAction } = await import('./org-observe.js');
        return validateAction(ctx);
      },
    },
    { name: 'list', description: 'List all orgs in the current project', action: listAction },
    {
      name: 'delete', description: 'Delete an org and all its data',
      options: [
        { name: 'yes', short: 'y', description: 'Skip confirmation', type: 'boolean' },
        { name: 'force', description: 'Delete even if the org appears to be running', type: 'boolean' },
      ],
      action: deleteAction,
    },
    { name: 'mark-complete', description: 'Manually close a stale/crashed run', action: markCompleteAction },
  ],
  examples: [{ command: 'monomind org run my-org', description: 'Run an org under full daemon control' }],
  action: async (): Promise<CommandResult> => {
    // index.ts's dispatcher never prints result.message on a failed action —
    // it only exits with result.exitCode — so this must log itself or bare
    // `monomind org` exits silently with code 1 and zero output.
    const message = 'usage: monomind org <run|stop|status|serve|test-loop|logs|report|create|validate|list|delete|mark-complete>';
    log(output.error(message));
    return { success: false, message };
  },
};

export default orgCommand;
