// packages/@monomind/cli/src/commands/org.ts
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { migrateOrgFile } from '../orgrt/migrate.js';
import { readHistory } from '../orgrt/reporting.js';

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
  // endsWith, not includes: substring matching hid legitimate orgs whose NAME
  // merely contains an artifact suffix anywhere (e.g. "state-machine.json",
  // "issues-triage.json") — and anything hidden here is also invisible to
  // run/list/serve while `org delete <sibling>` would still remove its files.
  return readdirSync(orgsDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('._') && !f.endsWith('.v1.json')
      && !ORG_ARTIFACT_SUFFIXES.some(suf => f.endsWith(`${suf}.json`)));
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
      // Same KG entity glossary the live daemon injects — the preview must
      // match what sessions actually receive.
      const glossary = await (async () => {
        try {
          const kg = await import('../memory/memory-kg.js');
          return await kg.kgGlossary({ dbPath: join(process.cwd(), '.monomind', 'org-memory') });
        } catch { return []; }
      })();
      log(output.info(`DRY RUN — org ${name}: ${def.roles.length} roles, ${perRole} tokens each, goal: ${taskFlag ?? def.goal}`));
      for (const role of def.roles) {
        log(output.info(`\n─── ${role.id} (${role.title || role.type})${role.adapter_config?.model ? ` [${role.adapter_config.model}]` : ''} ───`));
        log(buildRolePrompt(role, { name: def.name, goal: (taskFlag as string | undefined) ?? def.goal }, roster, glossary));
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

  // stopfile poll lets `org stop` work from another terminal; the daemon can
  // also stop the org itself (boss called org_complete, or the idle watchdog
  // fired) — detect that via getOrg() so the CLI exits instead of polling a
  // stopfile forever after a finished run. Clear any stale stopfile from a
  // previous run before polling.
  clearStopfile(ctx.cwd, name);
  const stopfile = join(ctx.cwd, ORG_DIR, name, 'stop');
  await new Promise<void>(resolvePromise => {
    const iv = setInterval(() => {
      if (existsSync(stopfile) || !daemon.getOrg(name)) { clearInterval(iv); resolvePromise(); }
    }, 2000);
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
  // The stopfile is only meaningful to a process that polls it (`org run` and, since
  // this fix, `org serve`). Writing it for an org that nothing is running was a silent
  // no-op that still reported "daemon exits within 2s" — say what's actually true.
  let rt: { status?: string; run?: string; pid?: number } | undefined;
  try { rt = JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, name, 'runtime.json'), 'utf8')); } catch { /* never run */ }
  if (rt?.status !== 'running') {
    log(output.warning(`Org "${name}" is not running (runtime state: ${rt?.status ?? 'never run'}) — nothing to stop.`));
    return { success: false, message: 'org not running' };
  }
  if (rt.pid) {
    let alive = true;
    try { process.kill(rt.pid, 0); } catch { alive = false; }
    if (!alive) {
      log(output.warning(`Org "${name}" is not running — runtime.json says running but pid ${rt.pid} is gone (crashed daemon).`));
      log(output.info(`Clear the stale record with: monomind org mark-complete ${name}`));
      return { success: false, message: 'org crashed — use mark-complete' };
    }
  }
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'stop'), new Date().toISOString());
  log(output.info(`Stop requested for "${name}" (pid ${rt.pid}) — the daemon picks it up within ~2s.`));
  return { success: true, message: `stop requested for ${name} (daemon exits within 2s)` };
};

const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
  let name: string | undefined;
  if (ctx.args[0]) {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    name = validated.name;
    // A named org that doesn't exist must error, not report "never run" with exit 0.
    if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
      log(output.error(`Org not found: ${name}`));
      return { success: false, message: 'org not found' };
    }
  }
  const orgDir = join(ctx.cwd, ORG_DIR);
  const targets = name ? [name] : (existsSync(orgDir)
    ? listOrgConfigFiles(orgDir).map(f => f.replace(/\.json$/, ''))
    : []);
  for (const t of targets) {
    const rt = join(orgDir, t, 'runtime.json');
    let state: { status: string; run?: string; pid?: number; abandonedRoles?: string[] } = { status: 'never run' };
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
    if ((state.status === 'running' || state.status === 'crashed') && state.pid) {
      const pidGone = state.status === 'crashed' || (() => {
        try { process.kill(state.pid!, 0); return false; }
        catch { return true; }
      })();
      if (pidGone) {
        let heartbeatHint = '';
        try {
          const hb = JSON.parse(readFileSync(join(ctx.cwd, '.monomind', 'serve-heartbeat.json'), 'utf8'));
          heartbeatHint = ` (last heartbeat: ${hb.updatedAt})`;
        } catch { /* no heartbeat file — daemon predates this change or was already cleaned up */ }
        const closedBy = (state as { closedBy?: string }).closedBy;
        const label = closedBy === 'crash-handler' ? 'crashed (caught by crash handler)' : `crashed (runtime.json says ${state.status} but pid ${state.pid} is gone)`;
        log(output.warning(`${t}: ${label}${heartbeatHint}${state.run ? ` — run ${state.run}` : ''} — close it out with "monomind org mark-complete ${t}"`));
        continue;
      }
    }
    const line = `${t}: ${state.status}${state.run ? ` (run ${state.run}, pid ${state.pid})` : ''}`;
    // A role that never spawned is a silent capability hole — an org with no
    // tester still reports a clean "running". Say it on the status line.
    if (state.abandonedRoles?.length) {
      log(output.warning(`${line} — DEGRADED: ${state.abandonedRoles.length} role(s) never spawned: ${state.abandonedRoles.join(', ')}`));
    } else {
      log(output.info(line));
    }
  }
  return { success: true };
};

/** One pass of the `org serve` stopfile poll.
 *
 * `monomind org stop <name>` writes `.monomind/orgs/<name>/stop`. `org run` has always
 * polled that file; `org serve` did not — so against a serve daemon `org stop` was a
 * silent no-op that still printed "daemon exits within 2s" and exited 0 while the org
 * kept running. Stops every running org whose stopfile is present, then clears the
 * stopfile so the next scheduled iteration isn't killed on sight.
 *
 * Returns the names it stopped (awaited), so callers/tests don't have to guess. */
export const pollStopfiles = async (cwd: string, daemon: OrgDaemon): Promise<string[]> => {
  const stopped: string[] = [];
  for (const name of daemon.listRunning()) {
    if (!existsSync(join(cwd, ORG_DIR, name, 'stop'))) continue;
    log(output.info(`org ${name}: stop requested — shutting it down`));
    try {
      await daemon.stopOrg(name);
      stopped.push(name);
    } catch (err) {
      console.error(`org ${name}: stop failed:`, err);
    } finally {
      clearStopfile(cwd, name);
    }
  }
  return stopped;
};

/**
 * Emit a supervisor unit for `org serve`.
 *
 * Why this is an EXTERNAL supervisor and not an `--supervise` flag: the daemon
 * already logs every death it can observe — signals, uncaught exceptions,
 * unhandled rejections, and the event loop draining. The one death it cannot
 * observe is SIGKILL, which is what the OOM killer sends, and which is the
 * suspected cause of the reported disappearance (its org logs showed repeated
 * low-memory warnings). No in-process handler survives SIGKILL, so a daemon
 * that restarts itself is theatre for exactly the case that matters. Only
 * something outside the process can bring it back.
 *
 * launchd and systemd both already do this well, so this generates a correct
 * unit rather than reimplementing them.
 */
const supervisorAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const cwd = resolve(ctx.cwd || process.cwd());
  const requested = String(ctx.flags.format ?? '').trim().toLowerCase();
  const format = requested || (process.platform === 'darwin' ? 'launchd' : 'systemd');
  if (format !== 'launchd' && format !== 'systemd') {
    log(output.error(`Unknown --format "${requested}" — expected launchd or systemd.`));
    return { success: false, message: 'unknown supervisor format' };
  }

  // argv[1] is this CLI's entry point — the same resolution `init` uses when it
  // spawns a watcher. A supervisor must not depend on PATH or npx resolving to
  // the same version later.
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : 'monomind';
  const node = process.execPath;
  // Per-project identity. The unit bakes in a WorkingDirectory, so a constant
  // Label and filename meant `--install` from a second project silently
  // OVERWROTE the first project's unit — one file, the first daemon left
  // unsupervised, no warning. Verified before fixing: installing from projA
  // then projB left a single unit pointing at projB.
  //
  // The hash keeps it unique for two directories with the same basename; the
  // basename keeps it recognisable in `launchctl list` / `systemctl --user`.
  const slug = `${(cwd.split(/[\\/]/).pop() || 'org').replace(/[^A-Za-z0-9._-]/g, '-')}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
  const label = `com.monomind.org-serve.${slug}`;
  const logPath = join(cwd, '.monomind', 'org-serve.log');

  const unit = format === 'launchd'
    ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cliEntry}</string>
    <string>org</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <!-- KeepAlive restarts the daemon however it died, including SIGKILL. -->
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`
    : `[Unit]
Description=monomind org serve (${cwd})
After=network.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${node} ${cliEntry} org serve
# Restart however it died, including an OOM kill.
Restart=always
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;

  const target = format === 'launchd'
    ? `~/Library/LaunchAgents/${label}.plist`
    : `~/.config/systemd/user/monomind-org-serve-${slug}.service`;

  if (ctx.flags.install === true) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) {
      log(output.error('Cannot resolve a home directory to install into — write the unit manually.'));
      return { success: false, message: 'no home directory' };
    }
    const dest = format === 'launchd'
      ? join(home, 'Library', 'LaunchAgents', `${label}.plist`)
      : join(home, '.config', 'systemd', 'user', `monomind-org-serve-${slug}.service`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, unit);
    log(output.success(`Wrote ${dest}`));
    log(output.info(
      format === 'launchd'
        ? `Load it with: launchctl load -w ${dest}`
        : `Load it with: systemctl --user daemon-reload && systemctl --user enable --now monomind-org-serve-${slug}`,
    ));
    return { success: true, message: `supervisor unit written to ${dest}` };
  }

  log(unit);
  log(output.info(`Write this to ${target}, or re-run with --install to do it for you.`));
  log(output.info(
    'Why a supervisor: the daemon logs every death it can observe, but an OOM kill is SIGKILL — ' +
    'uncatchable by design, so nothing in-process can restart after one.',
  ));
  return { success: true, message: `${format} unit emitted` };
};

const serveAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const crossProcess = ctx.flags['crossProcess'] !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`);
  }

  // Crash handlers: log the reason and persist crashed state so `org status`
  // shows what happened instead of a silent "pid is gone".
  const crashExit = (label: string, err: unknown): void => {
    try { console.error(`[org serve] ${label}:`, err); } catch { /* stderr gone */ }
    daemon.persistCrashStateAll();
    daemon.clearHeartbeat();
    process.exitCode = 1;
  };
  process.on('uncaughtException', (err) => { crashExit('uncaughtException', err); process.exit(1); });
  process.on('unhandledRejection', (err) => { crashExit('unhandledRejection', err); process.exit(1); });

  // Termination diagnostics (#45). The two handlers above only cover errors
  // raised *inside* the daemon. A report of the daemon vanishing after hours
  // had a log holding nothing but its startup lines, because the ways a daemon
  // usually dies were all unhandled:
  //
  //   - a signal (SIGTERM from a supervisor/OS, SIGHUP when a terminal closes)
  //   - the event loop simply draining, which exits 0 and says nothing at all
  //
  // Both now announce themselves. Note what this deliberately cannot cover:
  // SIGKILL, which is what the OOM killer sends, is uncatchable by design — no
  // in-process handler can ever log it. That case is instead made *inferable*:
  // every shutdown path below prints a terminal line, so a log that starts and
  // then stops with no such line means the process was killed from outside
  // (OOM being the usual culprit, and the reporter's org logs did show memory
  // pressure). Absence of a shutdown line is now evidence, not ambiguity.
  let shuttingDown = false;
  const announceExit = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { console.error(`[org serve] shutting down: ${reason}`); } catch { /* stderr gone */ }
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      announceExit(`received ${sig}`);
      try { daemon.persistCrashStateAll(); daemon.clearHeartbeat(); } catch { /* best effort */ }
      // A daemon holds ref'd timers, so it will not drain on its own; an
      // explicit exit is required here and is the intended signal semantics.
      process.exit(sig === 'SIGTERM' || sig === 'SIGINT' ? 0 : 1);
    });
  }
  process.on('exit', (code) => {
    // Last word on the way out. Reached for the "event loop drained" case,
    // which previously produced a completely silent disappearance.
    announceExit(`process exiting with code ${code}`);
  });

  // Heartbeat: write every 30s so `org status` can tell "alive but busy" from
  // "daemon gone" without relying on pid liveness alone.
  daemon.writeHeartbeat();
  const heartbeatInterval = setInterval(() => { daemon.writeHeartbeat(); }, 30_000);
  heartbeatInterval.unref?.();

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
      // A deadline stop still lands on agents mid-tool-call. The 15s abort
      // bound threw that work away; a minute is enough to finish an edit or a
      // test run and flush, and still well inside any sane interval.
      await daemon.stopOrg(name, { drainMs: 60_000 }).catch(err => console.error(`org ${name}: stop failed:`, err));
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
          // Due = never run, or last run ended longer ago than the interval.
          // Without this, starting the daemon meant waiting a full period
          // before anything happened at all; gating on due-ness means a
          // restart doesn't stampede every scheduled org back into a run.
          const lastEnded = readHistory(ctx.cwd, stem).at(-1)?.endedAt ?? 0;
          const due = Date.now() - lastEnded >= ms;
          sched.add(stem, ms, due);
          log(output.info(`scheduled org ${stem} every ${Math.round(ms / 60_000)}m${due ? ' — due now, starting first run' : ''}`));
        }
      } catch (err) {
        log(output.warning(`org file ${f}: could not parse — skipping (${err instanceof Error ? err.message : 'invalid JSON'})`));
      }
    }
  }

  const stopPoll = setInterval(() => { void pollStopfiles(ctx.cwd, daemon); }, 2000);
  stopPoll.unref?.();

  await new Promise<void>(r => { process.once('SIGINT', () => r()); process.once('SIGTERM', () => r()); });
  clearInterval(stopPoll);
  clearInterval(heartbeatInterval);
  sched.stop();
  await daemon.stopAll();
  daemon.clearHeartbeat();
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
        const rt = JSON.parse(readFileSync(join(orgsDir, stem, 'runtime.json'), 'utf8')) as { status?: string; pid?: number };
        status = rt.status ?? status;
        // Same liveness rule as `org status`: a 'running' record with a dead
        // pid is a crashed daemon, not a running org — list must not disagree.
        if (status === 'running' && rt.pid) {
          try { process.kill(rt.pid, 0); } catch { status = 'crashed'; }
        }
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

/** Clear a stale `running` record from runtime.json. This is the state `org status`
 *  reads, so mark-complete MUST touch it — the dashboard's run:complete event alone
 *  left `org status` reporting the same "crashed" line it had just told the user to
 *  fix with this exact command. Refuses when the recorded pid is still alive: a live
 *  daemon would just rewrite the file, and `org stop` is the right command there. */
const clearStaleRuntime = (cwd: string, name: string):
  { cleared: true; run?: string } | { cleared: false; reason: 'absent' | 'not-running' | 'alive' | 'unreadable'; detail?: string } => {
  const rtPath = join(cwd, ORG_DIR, name, 'runtime.json');
  if (!existsSync(rtPath)) return { cleared: false, reason: 'absent' };
  let rt: { status?: string; run?: string; pid?: number };
  try {
    rt = JSON.parse(readFileSync(rtPath, 'utf8'));
  } catch (err) {
    return { cleared: false, reason: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (rt.status !== 'running' && rt.status !== 'crashed') return { cleared: false, reason: 'not-running' };
  if (rt.status === 'running' && rt.pid) {
    try { process.kill(rt.pid, 0); return { cleared: false, reason: 'alive', detail: String(rt.pid) }; }
    catch { /* pid is gone — this is exactly the stale case mark-complete exists for */ }
  }
  // Same shape stopOrg's persistState() writes, so every reader (org status,
  // isOrgRunning, the mastermind-org* skills' jq checks) sees a stopped org.
  writeFileSync(rtPath, JSON.stringify(
    { status: 'stopped', run: rt.run, pid: rt.pid, updated: new Date().toISOString(), closedBy: 'mark-complete' },
    null, 2));
  return { cleared: true, run: rt.run };
};

const markCompleteAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgName = ctx.args[0];
  if (!orgName || !ORG_NAME_RE.test(orgName)) {
    log(output.error('Usage: monomind org mark-complete <name>'));
    return { success: false, message: 'valid org name required' };
  }
  const cwd = resolve(ctx.cwd || process.cwd());

  // Reject an org that does not exist, using the same check as runAction. Without
  // it `org mark-complete nosuchorg` printed "local state was cleared" and exited
  // 0 — a typo looked like a successful cleanup.
  const orgsDir = join(cwd, ORG_DIR);
  if (!existsSync(join(orgsDir, `${orgName}.json`))) {
    const known = existsSync(orgsDir) ? listOrgConfigFiles(orgsDir).map(f => f.replace(/\.json$/, '')) : [];
    log(output.error(`Org not found: ${orgName}${known.length ? ` — available: ${known.join(', ')}` : ''}`));
    return { success: false, message: 'org not found' };
  }

  // 1) Local runtime.json — the state `org status` actually reads. Done first and
  //    independently of the dashboard so the recommended remedy works with no server.
  const local = clearStaleRuntime(cwd, orgName);
  if (!local.cleared && local.reason === 'alive') {
    log(output.error(`Org "${orgName}" is still running (pid ${local.detail}) — stop it with "monomind org stop ${orgName}" instead.`));
    return { success: false, message: 'org is running' };
  }
  if (local.cleared) log(output.success(`Cleared stale runtime state for "${orgName}"${local.run ? ` (run ${local.run})` : ''}.`));
  else if (local.reason === 'unreadable') log(output.warning(`runtime.json for "${orgName}" is unreadable (${local.detail}) — left untouched.`));
  else log(output.info(`No stale runtime state for "${orgName}" (runtime.json ${local.reason === 'absent' ? 'absent' : 'already not running'}).`));

  // 2) Dashboard run:complete event — best effort. A missing/unauthorized dashboard
  //    must not make the command fail after the local state was already cleared.
  let ctrlUrl = 'http://localhost:4242';
  try {
    const ctl = JSON.parse(readFileSync(join(cwd, '.monomind', 'control.json'), 'utf8'));
    if (ctl.url) ctrlUrl = ctl.url;
  } catch { /* default */ }
  try {
    // All dashboard /api routes are auth-gated — attach the local session token.
    let auth = '';
    try { auth = readFileSync(join(cwd, '.monomind', 'dashboard-token'), 'utf8').trim(); } catch { /* server may be pre-auth */ }
    const res = await fetch(`${ctrlUrl}/api/orgs/${encodeURIComponent(orgName)}/mark-complete`, {
      method: 'POST',
      headers: auth ? { 'x-monomind-token': auth } : {},
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(output.warning(`Dashboard not updated (${res.status}: ${(body as { error?: string }).error || 'unknown error'}) — ${local.cleared ? 'local state was cleared' : 'there was no local state to clear'}.`));
    } else {
      const runId = (body as { runId?: string }).runId;
      log(output.success(`Dashboard run marked complete for "${orgName}"${runId ? ` (run ${runId})` : ''}.`));
    }
  } catch (err) {
    log(output.warning(`Dashboard unreachable at ${ctrlUrl} (${err instanceof Error ? err.message : 'error'}) — ${local.cleared ? 'local state was cleared' : 'there was no local state to clear'}.`));
  }
  return local.cleared
    ? { success: true, message: `run marked complete for ${orgName}` }
    : { success: true, message: `nothing to clear for ${orgName}` };
};

const migrateAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  const cwd = ctx.cwd;
  const cfgPath = join(cwd, ORG_DIR, `${name}.json`);
  if (!existsSync(cfgPath)) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgRunning(cwd, name)) {
    log(output.error(`Org "${name}" is currently running — stop it first, then migrate.`));
    return { success: false, message: 'org is running' };
  }
  try {
    const outcome = migrateOrgFile(cfgPath, join(cwd, ORG_DIR, `${name}.v1.json`));
    if (outcome.status === 'already-v2') {
      log(output.info(`${name}: already v2 — nothing to migrate.`));
      return { success: true, message: 'already v2' };
    }
    log(output.success(`${name}: migrated to v2 (backup: ${name}.v1.json)`));
    for (const d of outcome.dropped) log(output.info(`  dropped v1 field: ${d}`));
    for (const n of outcome.notes) log(output.info(`  ${n}`));
    log(output.info(`  run it with: monomind org run ${name}`));
    return { success: true, message: `migrated ${name}` };
  } catch (err) {
    log(output.error(`Cannot migrate ${name}: ${err instanceof Error ? err.message : String(err)}`));
    return { success: false, message: 'migration produced an invalid config' };
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
      name: 'supervisor',
      description: 'Print (or --install) a launchd/systemd unit that keeps `org serve` running',
      options: [
        { name: 'format', description: 'launchd or systemd (default: platform)', type: 'string' },
        { name: 'install', description: 'Write the unit into the per-user location', type: 'boolean' },
      ],
      action: supervisorAction,
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
      name: 'memory', description: 'Inspect an org\'s cross-run memory and knowledge graph (stats | search <query> | rules | rollback <run-ref>)',
      examples: [
        { command: 'monomind org memory growth stats', description: 'KG size and namespaces' },
        { command: 'monomind org memory growth search "launch checklist"', description: 'Search org memory + KG' },
        { command: 'monomind org memory growth rollback run:m4x2', description: 'Delete everything one run wrote to the KG' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const sub = String(ctx.args[1] ?? 'stats');
        const { join } = await import('node:path');
        const dbPath = join(process.cwd(), '.monomind', 'org-memory');
        const kg = await import('../memory/memory-kg.js');
        const bridge = await import('../memory/memory-bridge.js');
        try {
          if (sub === 'stats') {
            const [stats, glossary, backend] = await Promise.all([
              kg.kgStats({ dbPath }), kg.kgGlossary({ dbPath, limit: 15 }), bridge.bridgeGetBackendStats(dbPath),
            ]);
            log(output.info(`Knowledge graph: ${stats.nodes} entities, ${stats.edges} relations, ${stats.rules} rules`));
            if (glossary.length) log(output.info(`Top entities: ${glossary.join(', ')}`));
            const byNs = backend?.entriesByNamespace ?? {};
            for (const [ns, count] of Object.entries(byNs)) log(output.info(`  ${ns}: ${count} entries`));
            return { success: true, message: 'org memory stats', data: { ...stats, namespaces: byNs } };
          }
          if (sub === 'search') {
            const q = ctx.args.slice(2).join(' ');
            if (!q) return { success: false, message: 'usage: org memory <org> search <query>' };
            const [mem, graph] = await Promise.all([
              bridge.bridgeSearchEntries({ query: q, namespace: `org:${v.name}`, limit: 5, dbPath }),
              kg.kgSearch({ query: q, dbPath, limit: 8 }),
            ]);
            for (const r of mem?.results ?? []) log(output.info(`[${r.score.toFixed(2)}] ${r.key}: ${r.content.slice(0, 160)}`));
            if (graph.context) log(output.info(`\nKnowledge graph:\n${graph.context}`));
            return { success: true, message: `${(mem?.results ?? []).length} memories, ${graph.triplets.length} triplets` };
          }
          if (sub === 'rules') {
            const rules = await kg.kgListRules({ dbPath, limit: 50 });
            for (const r of rules) log(output.info(`- ${r.rule.slice(0, 200)}`));
            return { success: true, message: `${rules.length} rules`, data: { rules } };
          }
          if (sub === 'rollback') {
            const ref = ctx.args[2];
            if (!ref) return { success: false, message: 'usage: org memory <org> rollback <origin-ref> (e.g. run:m4x2)' };
            const res = await kg.kgRollback({ originRef: ref, dbPath });
            log(output.info(`Rolled back ${ref}: ${res.deleted} deleted, ${res.retained} retained (shared with other origins)`));
            return { success: res.success, message: `rollback ${ref}`, data: res };
          }
          return { success: false, message: `unknown subcommand "${sub}" — use stats | search | rules | rollback` };
        } finally {
          await bridge.shutdownBridge().catch(() => { /* best effort */ });
        }
      },
    },
    {
      name: 'questions', description: 'List pending ask_human questions from an org\'s agents',
      options: [{ name: 'all', description: 'Include answered questions', type: 'boolean' }],
      examples: [{ command: 'monomind org questions growth', description: 'Show unanswered questions' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { questionsAction } = await import('./org-observe.js');
        return questionsAction(ctx, v.name);
      },
    },
    {
      name: 'answer', description: 'Answer a pending ask_human question (live if the org is running, queued otherwise)',
      examples: [{ command: 'monomind org answer growth q-123-ab "yes, ship it"', description: 'Answer question q-123-ab' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { answerAction } = await import('./org-observe.js');
        return answerAction(ctx, v.name);
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
    {
      name: 'migrate', description: 'Convert a v1 org config (topology/board/loop) to the v2 daemon shape',
      examples: [{ command: 'monomind org migrate growth', description: 'Migrate one org; original saved as growth.v1.json' }],
      action: migrateAction,
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
    const message = 'usage: monomind org <run|stop|status|serve|test-loop|logs|report|questions|answer|create|validate|migrate|list|delete|mark-complete>';
    log(output.error(message));
    return { success: false, message };
  },
};

export default orgCommand;
