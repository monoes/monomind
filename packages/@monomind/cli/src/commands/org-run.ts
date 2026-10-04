// packages/@monomind/cli/src/commands/org-run.ts
//
// `monomind org run` — start an org as a foreground daemon.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvalPendingNotice, parseAutoApproveFlag } from '../orgrt/approvals.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import { sectionsOrgRefusal } from '../orgrt/documents/eval-gate.js';
import { readRunEvents } from '../orgrt/reporting.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import {
  clearReloadfile,
  clearStopfile,
  listOrgConfigFiles,
  liveServeDaemonPid,
  validateOrgName,
} from './org-control.js';
import {
  type RunTerminalState,
  runOutcomeResult,
  runtimeState,
  waitForRunEnd,
} from './org-poll.js';
import { type RunEndInput, runEndLine } from './org-run-end.js';
import { checkV1Config, printCostEstimate, printDryRun } from './org-run-preview.js';
import { ensureOrgSignedForRun } from './org-sign.js';
import { reconcileStaleRun } from './org-stale-run.js';

const log = (text: string): void => {
  console.log(text);
};

interface RunArgs {
  name: string;
  taskFlag: unknown;
  autoApprove: { tools: string[] };
  orgsDir: string;
}

/** Validate `org run`'s name, --task and --auto-approve, and that the org
 *  exists — all before any side effects. */
function resolveRunArgs(ctx: CommandContext): RunArgs | CommandResult {
  if (!ctx.args[0])
    return { success: false, message: 'org name required: monomind org run <name> [--task "..."]' };
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  // A repeated --task flag is promoted to an array by the parser (deliberate,
  // documented behavior elsewhere — repeats never silently drop a value); a
  // plain `as string` cast would let that array flow straight into the org's
  // goal and get stringified as "a,b" with no warning. Checked before any
  // side effects (starting the xdeliver listener) run.
  const taskFlag = ctx.flags.task;
  if (Array.isArray(taskFlag))
    return { success: false, message: '--task was passed more than once — pass it exactly once' };
  const autoApprove = parseAutoApproveFlag(ctx.flags.autoApprove);
  if ('error' in autoApprove) return { success: false, message: autoApprove.error };
  // Fail before any side effects (inbox server) when the org doesn't exist.
  const orgsDir = join(ctx.cwd, ORG_DIR);
  if (!existsSync(join(orgsDir, `${name}.json`))) {
    const known = existsSync(orgsDir)
      ? listOrgConfigFiles(orgsDir).map((f) => f.replace(/\.json$/, ''))
      : [];
    log(
      output.error(
        `Org not found: ${name}${known.length ? ` — available: ${known.join(', ')}` : ' — create one with /mastermind:createorg'}`,
      ),
    );
    return { success: false, message: 'org not found' };
  }
  return { name, taskFlag, autoApprove, orgsDir };
}

/** Hand `org run` to a live `org serve` daemon (pid `serveOwner`) via its
 *  runfile, and wait for the daemon to acknowledge it. */
async function handOffToServeDaemon(
  orgsDir: string,
  name: string,
  serveOwner: number,
  taskFlag: unknown,
  autoApprove: RunArgs['autoApprove'],
): Promise<CommandResult> {
  // The runfile carries only the task; the serve daemon would drop the list.
  if (autoApprove.tools.length)
    return {
      success: false,
      message: `--auto-approve cannot be handed to the running "org serve" daemon (pid ${serveOwner}) — set the roles' policy.autoApproveTools instead`,
    };
  mkdirSync(join(orgsDir, name), { recursive: true });
  // The task rides along in the runfile. Dropping it here would have made
  // `org run <name> --task "..."` silently start a generic cycle — the flag
  // accepted, the instruction discarded.
  const runfile = join(orgsDir, name, 'run');
  writeFileSync(runfile, JSON.stringify({ ts: Date.now(), task: taskFlag ?? null }), 'utf8');
  // Ack: the serve daemon's runfile poll consumes (deletes) the file within
  // one tick (~2s). The liveness check above is racy — a pid can die or be
  // recycled between the check and the poll, leaving a runfile nobody reads
  // while we report success. Verify consumption; on timeout, retract the
  // runfile and fail loudly instead of losing the run.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && existsSync(runfile)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (existsSync(runfile)) {
    rmSync(runfile, { force: true });
    log(
      output.error(
        `org ${name}: serve daemon (pid ${serveOwner}) did not pick up the run within 15s — it is dead or wedged.`,
      ),
    );
    log(
      output.info(
        `Remove the stale heartbeat (.monomind/serve-heartbeat.json) and retry, or start a fresh daemon with: monomind org serve`,
      ),
    );
    return { success: false, message: 'serve daemon did not acknowledge the run request' };
  }
  log(
    output.info(
      `org ${name}: start requested from the serve daemon (pid ${serveOwner}) — acknowledged`,
    ),
  );
  log(output.dim(`  watch it with: monomind org logs ${name} --follow`));
  return { success: true, message: 'start requested' };
}

// #206 follow-up: without this, an uncaught error in this process left
// runtime.json's status stuck at 'running' (finishStop never runs), and
// runOutcomeResult's status === 'crashed' branch — the one meant to
// surface *why* the run failed — could never actually fire for `org run`,
// since nothing here ever wrote 'crashed'. Mirrors serveAction's
// crashExit, but deliberately does NOT touch SIGINT/SIGTERM — those are
// already handled by runAction's wait loop as a graceful stop, and
// registering a second, competing handler here would race it.
function installCrashHandlers(
  daemon: OrgDaemon,
  printRunEnd: (final: RunTerminalState, how: Omit<RunEndInput, 'final' | 'events'>) => void,
): void {
  process.on('uncaughtException', (err) => {
    try {
      console.error('[org run] uncaughtException:', err);
    } catch {
      /* stderr gone */
    }
    const error = `uncaughtException: ${err instanceof Error ? err.message : String(err)}`;
    daemon.persistCrashStateAll(error);
    printRunEnd({ status: 'crashed', error }, {});
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    try {
      console.error('[org run] unhandledRejection:', err);
    } catch {
      /* stderr gone */
    }
    const error = `unhandledRejection: ${err instanceof Error ? err.message : String(err)}`;
    daemon.persistCrashStateAll(error);
    printRunEnd({ status: 'crashed', error }, {});
    process.exit(1);
  });
}

// P1-12: Print the dashboard URL so CLI users know where to look.
// The dashboard is normally spawned by a Claude Code SessionStart hook
// (.claude/helpers/control-start.cjs) — but `org run` doesn't require
// Claude Code, and even when the hook exists it only fires once at
// session start, not per org run. If control.json is stale (points at a
// dead pid, a server rooted in a different project, or one that no longer
// accepts our dashboard-token — the exact case control-start.cjs's own
// "already running" check now self-heals, see its staleAuth handling),
// `org run` used to just print whatever URL was on file with zero
// verification. Actively (re)run the same control-start.cjs the hook
// uses, from this project's own .claude/helpers/ if it's been set up
// (monomind init), so a stale/dead/mismatched dashboard gets healed on
// every org run instead of silently trusting old state.
async function printDashboardUrl(cwd: string): Promise<void> {
  const controlPath = join(cwd, '.monomind', 'control.json');
  const controlStartPath = join(cwd, '.claude', 'helpers', 'control-start.cjs');
  if (existsSync(controlStartPath)) {
    try {
      const { spawnSync } = await import('node:child_process');
      spawnSync(process.execPath, [controlStartPath], {
        cwd,
        // #423: the SessionStart hook only starts the dashboard on opt-in;
        // `org run` asks for it explicitly unless the user turned it off.
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: cwd,
          MONOMIND_HOOK_QUIET: '1',
          MONOMIND_DASHBOARD_AUTOSTART: process.env.MONOMIND_DASHBOARD_AUTOSTART || '1',
        },
        timeout: 5000,
        stdio: 'ignore',
      });
    } catch {
      /* best-effort — fall through to whatever control.json already has */
    }
  }
  if (existsSync(controlPath)) {
    try {
      const ctl = JSON.parse(readFileSync(controlPath, 'utf8')) as { port?: number; url?: string };
      const dashUrl =
        ctl.url || (ctl.port ? `http://localhost:${ctl.port}` : 'http://localhost:4242');
      log(output.dim(`  Dashboard: ${dashUrl}`));
    } catch {
      /* non-critical */
    }
  } else if (existsSync(controlStartPath)) {
    // control-start.cjs ran above (spawnSync'd synchronously with a 5s cap)
    // but control.json still doesn't exist — its own confirm-mode child is
    // still working in the background (npx cold-resolve etc., #142/#144)
    // rather than having failed outright. Point at the default port; the
    // confirm process will correct control.json once it lands.
    log(
      output.dim(
        '  Dashboard: http://localhost:4242 (starting — check back in a few seconds if unreachable)',
      ),
    );
  } else {
    log(
      output.dim(
        '  Dashboard: run `monomind init` to set up .claude/helpers/, then re-run to launch it automatically',
      ),
    );
  }
}

export const runAction = async (ctx: CommandContext): Promise<CommandResult> => {
  // Org runs skip local embeddings entirely — on some machines
  // @huggingface/transformers' native ONNX runtime crashes the whole
  // process (a libc++abi terminate, not a catchable JS error) the moment
  // any memory/KG lookup tries to load its model. A crashed unattended org
  // run is much worse than one that falls back to keyword-only memory
  // search — see the matching guards in memory-bridge.ts/embedding-operations.ts.
  // The embedding-model crash above has a sibling: loadReranker() in
  // memory-bridge.ts loads a SEPARATE cross-encoder model
  // (cross-encoder/ettin-reranker-32m-v1, its own tokenizer architecture)
  // for search-result reranking, independent of the embedder guard above —
  // reranking runs on (query, passage) text pairs directly, so it can
  // still fire and hit the same native crash even with embeddings off.
  // disableLocalModels() turns off both, for THIS process only. It used to be
  // MONOMIND_NO_LOCAL_EMBEDDINGS=1 / MONOMIND_RERANKER=0 on process.env, which
  // every role's CLI and every command a role ran inherited — so a role's own
  // `monomind memory search` silently fell back to keyword-only (#249).
  const { disableLocalModels } = await import('../memory/memory-bridge.js');
  disableLocalModels();
  const resolved = resolveRunArgs(ctx);
  if ('success' in resolved) return resolved;
  const { name, taskFlag, autoApprove, orgsDir } = resolved;
  if (ctx.flags.dryRun === true) return printDryRun(ctx.cwd, orgsDir, name, taskFlag);
  // #502: before a serve handoff too — the daemon would refuse an unsigned
  // org, but this process would already have reported the start as acknowledged.
  const unsigned = await ensureOrgSignedForRun(ctx, name);
  if (unsigned) return unsigned;
  // Sections spec 9.2: refuse here, before a serve handoff would acknowledge it.
  const sectionsRefusal = sectionsOrgRefusal(orgsDir, name);
  if (sectionsRefusal) {
    log(output.error(`Could not start org ${name}: ${sectionsRefusal}`));
    return { success: false, message: 'sections org requires the eval harness' };
  }
  // A live `org serve` daemon already owns this project's orgs. Starting our
  // own here would put two processes on one runtime.json and one broker lease,
  // so hand the request to the daemon via its runfile instead of racing it.
  const serveOwner = liveServeDaemonPid(ctx.cwd);
  if (serveOwner != null)
    return handOffToServeDaemon(orgsDir, name, serveOwner, taskFlag, autoApprove);

  // #573: a record left 'running' by a run that is gone is closed out here;
  // one whose recorded process is still alive means a second process would
  // share its runtime.json and broker lease, so refuse.
  const prior = reconcileStaleRun(ctx.cwd, name, 'org run');
  if (prior.outcome === 'crashed') {
    log(
      output.warning(
        `org ${name}: previous run${prior.run ? ` ${prior.run}` : ''} was not running (${prior.reason}) — marked crashed`,
      ),
    );
  } else if (prior.outcome === 'live' && prior.pid != null) {
    log(
      output.error(
        `org ${name} is already running (pid ${prior.pid}) — stop it first with "monomind org stop ${name}"`,
      ),
    );
    return { success: false, message: 'org already running' };
  }

  const crossProcess = ctx.flags.crossProcess !== false;

  const v1Refusal = checkV1Config(orgsDir, name);
  if (v1Refusal) return v1Refusal;

  const budgetUsd = ctx.flags.budgetUsd as number | undefined;
  const skipConfirm = ctx.flags.yes === true;
  const costRefusal = await printCostEstimate(orgsDir, name, budgetUsd, skipConfirm);
  if (costRefusal) return costRefusal;

  const resumeFlag = ctx.flags.resume === true;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
  }
  let running: Awaited<ReturnType<typeof daemon.startOrg>>;
  try {
    running = await daemon.startOrg(name, taskFlag as string | undefined, {
      resume: resumeFlag,
      autoApprove: autoApprove.tools,
    });
  } catch (err) {
    // Don't leave the inbox server holding the event loop open on a failed start.
    srv?.close();
    await daemon.stopAll().catch(() => {
      /* nothing started */
    });
    const detail = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof Error && err.name === 'ZodError'
        ? ` — run "monomind org validate ${name}" for details`
        : '';
    log(output.error(`Could not start org ${name}: ${detail}${hint}`));
    return { success: false, message: 'org start failed' };
  }
  log(
    output.info(
      `org ${name} running (${running.def.roles.length} agents, run ${running.run}) — Ctrl-C or "monomind org stop ${name}" to stop`,
    ),
  );
  // #345: a role waiting on a tool approval is otherwise silent in this log.
  running.bus.subscribe((e) => {
    const notice = approvalPendingNotice(name, e);
    if (notice) log(output.warning(notice));
  });
  // The run log's last line: outcome, wall time, total cost (every exit path
  // below, crash handlers included), so a detached run's log has an ending.
  const startedAt = Date.now();
  const printRunEnd = (final: RunTerminalState, how: Omit<RunEndInput, 'final' | 'events'>) => {
    try {
      const events = readRunEvents(ctx.cwd, name, running.run);
      const wallMs = Date.now() - startedAt;
      log(output.info(runEndLine({ name, run: running.run, wallMs, final, events, ...how })));
    } catch {
      /* best-effort — never mask the run's real exit */
    }
  };

  installCrashHandlers(daemon, printRunEnd);

  await printDashboardUrl(ctx.cwd);

  // stopfile poll lets `org stop` work from another terminal; the daemon can
  // also stop the org itself (boss called org_complete, or the idle watchdog
  // fired) — detect that via getOrg() so the CLI exits instead of polling a
  // stopfile forever after a finished run. Clear any stale stop or reload
  // request from a previous run before polling.
  clearStopfile(ctx.cwd, name);
  clearReloadfile(ctx.cwd, name);
  // #206: a human explicitly running `monomind org stop` is a deliberate,
  // successful action regardless of how the run itself ended — capture that
  // BEFORE clearStopfile() below wipes the file, so it isn't lost.
  const { stoppedManually, signal } = await waitForRunEnd(ctx.cwd, name, daemon);
  clearStopfile(ctx.cwd, name);
  await daemon.stopAll();
  srv?.close();
  printRunEnd(runtimeState(ctx.cwd, name), { stoppedManually, signal });

  if (stoppedManually) return { success: true, message: `org ${name} stopped` };

  // #206: 'org run' used to exit 0 unconditionally here — a crashed or
  // watchdog-stopped run was indistinguishable from a completed one to any
  // script or supervisor (launchd/systemd) driving off the exit code. Re-read
  // the daemon's final record (same runtime.json pattern isOrgRunning/
  // statusAction already use below) and only report success for a run that
  // actually finished its goal via org_complete.
  return runOutcomeResult(name, runtimeState(ctx.cwd, name));
};
