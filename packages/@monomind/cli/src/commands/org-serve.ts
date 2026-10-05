import { applyClaudePathFlag } from '../orgrt/claude-selection.js';
// packages/@monomind/cli/src/commands/org-serve.ts
//
// `monomind org serve | supervisor` — the long-running daemon that hosts
// scheduled orgs, and the launchd/systemd unit that keeps it running.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { OrgDaemon } from '../orgrt/daemon.js';
import { orgSignatureEnforced, verifyOrgDef } from '../orgrt/org-signature.js';
import { sweepPlantWatches } from '../orgrt/planted-paths.js';
import { readHistory } from '../orgrt/reporting.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import {
  checkServeLock,
  clearStaleControlFiles,
  isOrgPaused,
  listOrgConfigFiles,
} from './org-control.js';
import { pollReloadfiles, pollRunfiles, pollStopfiles } from './org-poll.js';
import { reconcileAllStaleRuns } from './org-stale-run.js';

const log = (text: string): void => {
  console.log(text);
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
export const supervisorAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const cwd = resolve(ctx.cwd || process.cwd());
  const requested = String(ctx.flags.format ?? '')
    .trim()
    .toLowerCase();
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

  const unit =
    format === 'launchd'
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

  const target =
    format === 'launchd'
      ? `~/Library/LaunchAgents/${label}.plist`
      : `~/.config/systemd/user/monomind-org-serve-${slug}.service`;

  if (ctx.flags.install === true) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) {
      log(
        output.error('Cannot resolve a home directory to install into — write the unit manually.'),
      );
      return { success: false, message: 'no home directory' };
    }
    const dest =
      format === 'launchd'
        ? join(home, 'Library', 'LaunchAgents', `${label}.plist`)
        : join(home, '.config', 'systemd', 'user', `monomind-org-serve-${slug}.service`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, unit);
    log(output.success(`Wrote ${dest}`));
    log(
      output.info(
        format === 'launchd'
          ? `Load it with: launchctl load -w ${dest}`
          : `Load it with: systemctl --user daemon-reload && systemctl --user enable --now monomind-org-serve-${slug}`,
      ),
    );
    return { success: true, message: `supervisor unit written to ${dest}` };
  }

  log(unit);
  log(output.info(`Write this to ${target}, or re-run with --install to do it for you.`));
  log(
    output.info(
      'Why a supervisor: the daemon logs every death it can observe, but an OOM kill is SIGKILL — ' +
        'uncatchable by design, so nothing in-process can restart after one.',
    ),
  );
  return { success: true, message: `${format} unit emitted` };
};

export const serveAction = async (ctx: CommandContext): Promise<CommandResult> => {
  applyClaudePathFlag(ctx.flags);
  // Mutual exclusion: refuse to start a second `org serve` for this project
  // root. Checked before anything else so a refusal never opens a port,
  // registers a broker lease, or starts a scheduled org that a live daemon
  // is already running — see checkServeLock's header for the failure mode
  // this prevents.
  const lock = checkServeLock(ctx.cwd);
  if (!lock.ok) {
    log(
      output.error(
        `org serve: another daemon (pid ${lock.pid}) is already running for this project root.`,
      ),
    );
    log(output.info(`  Check what it's doing with: monomind org status`));
    log(
      output.info(`  Stop it first (Ctrl-C in its terminal, or "kill ${lock.pid}"), then retry.`),
    );
    return { success: false, message: `org serve already running (pid ${lock.pid})` };
  }
  if (lock.staleHeartbeatRemoved) {
    log(
      output.warning(
        'org serve: cleaned up a stale heartbeat left by a previous daemon that did not shut down cleanly.',
      ),
    );
  }
  // #573: runs killed without their stop/crash handlers left runtime.json
  // saying 'running' — close those out before scheduling anything.
  for (const c of reconcileAllStaleRuns(ctx.cwd, 'org serve')) {
    log(
      output.warning(
        `org serve: ${c.org} run${c.run ? ` ${c.run}` : ''} was not running (${c.reason}) — marked crashed`,
      ),
    );
  }
  // See the matching comment in runAction — same rationale, same guard
  // (embedder and reranker, scoped to this process, not exported to roles).
  const { disableLocalModels } = await import('../memory/memory-bridge.js');
  disableLocalModels();
  const crossProcess = ctx.flags.crossProcess !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
  }

  // Crash handlers: log the reason and persist crashed state so `org status`
  // shows what happened instead of a silent "pid is gone". A truly unknown
  // uncaught exception's blast radius can't always be attributed to one org,
  // so the whole process still exits (the safety-first default) — but naming
  // which orgs were in flight at the moment it fired at least tells the
  // operator the blast radius they actually hit, instead of leaving them to
  // guess from an error with no org context.
  const crashExit = (label: string, err: unknown): void => {
    try {
      const running = daemon.listRunning();
      console.error(
        `[org serve] ${label}:`,
        err,
        running.length ? `— orgs in flight: ${running.join(', ')}` : '— no orgs were running',
      );
    } catch {
      try {
        console.error(`[org serve] ${label}:`, err);
      } catch {
        /* stderr gone */
      }
    }
    daemon.persistCrashStateAll(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    daemon.clearHeartbeat();
    process.exitCode = 1;
  };
  process.on('uncaughtException', (err) => {
    crashExit('uncaughtException', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    crashExit('unhandledRejection', err);
    process.exit(1);
  });

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
    try {
      console.error(`[org serve] shutting down: ${reason}`);
    } catch {
      /* stderr gone */
    }
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      announceExit(`received ${sig}`);
      try {
        daemon.persistCrashStateAll();
        daemon.clearHeartbeat();
      } catch {
        /* best effort */
      }
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
  const heartbeatInterval = setInterval(() => {
    daemon.writeHeartbeat();
  }, 30_000);
  heartbeatInterval.unref?.();

  log(output.info('org daemon serving — Ctrl-C to stop'));

  // schedule orgs whose definition declares an interval (e.g. "15m", "2h")
  const { OrgScheduler, parseSchedule } = await import('../orgrt/scheduler.js');
  const { auditScheduledTick, runScheduledIteration } = await import('../orgrt/scheduled-run.js');
  const sched = new OrgScheduler(
    async (name, intervalMs) => {
      if (isOrgPaused(ctx.cwd, name)) return;
      // Run precondition checks before starting a scheduled run
      try {
        const defPath = join(ctx.cwd, ORG_DIR, `${name}.json`);
        if (existsSync(defPath)) {
          const rawDef = JSON.parse(readFileSync(defPath, 'utf8'));
          // #502: prechecks are shell commands from the definition, run by
          // this daemon as the operator — verify the operator's signature on
          // these same bytes before running any of them (startOrg checks too).
          const signed = orgSignatureEnforced()
            ? verifyOrgDef(ctx.cwd, name, rawDef)
            : ({ ok: true } as const);
          if (!signed.ok) {
            log(output.warning(`${signed.message} — skipping scheduled run`));
            return;
          }
          const checks = rawDef?.run_config?.prechecks;
          if (Array.isArray(checks) && checks.length > 0) {
            const { runPrechecks } = await import('../orgrt/prechecks.js');
            const { ok, results } = await runPrechecks(checks, ctx.cwd);
            if (!ok) {
              const failed = results.find((r) => !r.passed);
              log(
                output.warning(
                  `org ${name}: precheck "${failed?.name}" failed — skipping scheduled run`,
                ),
              );
              if (failed?.output) log(output.warning(`  ${failed.output.slice(0, 200)}`));
              return;
            }
          }
        }
      } catch (err) {
        log(
          output.warning(
            `org ${name}: precheck evaluation error — ${err instanceof Error ? err.message : 'unknown'}`,
          ),
        );
      }
      await runScheduledIteration(daemon, name, intervalMs);
    },
    (name) =>
      auditScheduledTick(
        daemon,
        name,
        'scheduled-tick-deferred',
        `a tick landed while "${name}" was still running — held for one catch-up run`,
      ),
  );
  // #264: before anything here can start an org — and so before the stop and
  // reload polls below get their first pass — drop control files a previous
  // daemon left behind, which this one would otherwise act on immediately.
  clearStaleControlFiles(ctx.cwd);
  const orgDir = join(ctx.cwd, ORG_DIR);
  if (existsSync(orgDir)) {
    for (const f of listOrgConfigFiles(orgDir)) {
      try {
        const def = JSON.parse(readFileSync(join(orgDir, f), 'utf8'));
        const ms = parseSchedule(def.schedule);
        if (ms) {
          // register by filename stem — that's what startOrg loads
          const stem = f.replace(/\.json$/, '');
          if (def.name && def.name !== stem)
            log(
              output.warning(
                `org file ${f}: def.name "${def.name}" differs from filename — scheduling as "${stem}"`,
              ),
            );
          // Due = never run, or last run ended longer ago than the interval.
          // Without this, starting the daemon meant waiting a full period
          // before anything happened at all; gating on due-ness means a
          // restart doesn't stampede every scheduled org back into a run.
          const lastEnded = readHistory(ctx.cwd, stem).at(-1)?.endedAt ?? 0;
          const since = lastEnded ? Date.now() - lastEnded : undefined;
          const due = (since ?? Infinity) >= ms;
          if (orgSignatureEnforced()) {
            const signed = verifyOrgDef(ctx.cwd, stem, def);
            if (!signed.ok)
              log(output.warning(`${signed.message} — its scheduled runs are refused until then`));
          }
          sched.add(stem, ms, due, since);
          const waitMin = due ? 0 : Math.round((ms - (since ?? 0)) / 60_000);
          log(
            output.info(
              `scheduled org ${stem} every ${Math.round(ms / 60_000)}m${due ? ' — due now, starting first run' : ` — next run in ~${waitMin}m`}`,
            ),
          );
        }
      } catch (err) {
        log(
          output.warning(
            `org file ${f}: could not parse — skipping (${err instanceof Error ? err.message : 'invalid JSON'})`,
          ),
        );
      }
    }
  }

  // Each poll pass already wraps its own per-org daemon calls in try/catch,
  // but a synchronous throw from something ahead of those (e.g.
  // daemon.listRunning(), listOrgConfigFiles()) still rejects the async
  // function itself. `void`-ing that call, as before, discards the promise
  // without observing a rejection — which becomes an unhandled rejection at
  // the process level and takes down every other org's in-flight run via
  // crashExit, even though the failure was local to one poll pass. .catch()
  // keeps it a per-pass, logged failure instead.
  const stopPoll = setInterval(() => {
    pollStopfiles(ctx.cwd, daemon).catch((err) => {
      console.error('[org serve] stopfile poll failed:', err);
    });
  }, 2000);
  stopPoll.unref?.();
  const runPoll = setInterval(() => {
    pollRunfiles(ctx.cwd, daemon).catch((err) => {
      console.error('[org serve] runfile poll failed:', err);
    });
  }, 2000);
  runPoll.unref?.();
  const reloadPoll = setInterval(() => {
    pollReloadfiles(ctx.cwd, daemon).catch((err) => {
      console.error('[org serve] reloadfile poll failed:', err);
    });
  }, 2000);
  reloadPoll.unref?.();
  // #502 review round 3: quarantine what a role planted, between its sessions too.
  const plantPoll = setInterval(() => {
    sweepPlantWatches().catch((err) =>
      console.error('[org serve] planted-path sweep failed:', err),
    );
  }, 2000);
  plantPoll.unref?.();

  await new Promise<void>((r) => {
    process.once('SIGINT', () => r());
    process.once('SIGTERM', () => r());
  });
  clearInterval(stopPoll);
  clearInterval(runPoll);
  clearInterval(reloadPoll);
  clearInterval(plantPoll);
  clearInterval(heartbeatInterval);
  sched.stop();
  await daemon.stopAll();
  daemon.clearHeartbeat();
  srv?.close();
  return { success: true };
};
