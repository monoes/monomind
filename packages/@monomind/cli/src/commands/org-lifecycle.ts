// packages/@monomind/cli/src/commands/org-lifecycle.ts
//
// `monomind org stop | pause | resume | reload | status` — control-file
// requests to a running org and its runtime-state report.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rolesAccessStatus } from '../orgrt/access-grant.js';
import { readIdleStatus } from '../orgrt/idle-deadline.js';
import { orgSignatureEnforced, verifyOrgDef } from '../orgrt/org-signature.js';
import {
  describeRunOutcome,
  readHistory,
  readRunEvents,
  summarizeRun,
  utcTime,
} from '../orgrt/reporting.js';
import { deadPidReason, recordedPidLiveness } from '../orgrt/run-liveness.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import {
  classifyRun,
  clearPausefile,
  isOrgPaused,
  listOrgConfigFiles,
  validateOrgName,
} from './org-control.js';
import { sectionsJson } from './org-observe-shared.js';
import { reconcileStaleRun, STALE_RUN_CLOSED_BY } from './org-stale-run.js';

const log = (text: string): void => {
  console.log(text);
};

/** #365: `policy.access: 'full'` roles' resolved access/state, for `org
 *  status`. Best-effort — an unreadable/invalid config must never break
 *  `org status` itself, which already tolerates a missing runtime.json. */
function fullAccessRoles(cwd: string, name: string): ReturnType<typeof rolesAccessStatus> {
  try {
    const path = join(cwd, ORG_DIR, `${name}.json`);
    if (!existsSync(path)) return [];
    return rolesAccessStatus(OrgDefSchema.parse(JSON.parse(readFileSync(path, 'utf8'))));
  } catch {
    return [];
  }
}

export const stopAction = async (ctx: CommandContext): Promise<CommandResult> => {
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
  let rt: { status?: string; run?: string; pid?: number; pidStart?: string } | undefined;
  try {
    rt = JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, name, 'runtime.json'), 'utf8'));
  } catch {
    /* never run */
  }
  if (rt?.status !== 'running') {
    log(
      output.warning(
        `Org "${name}" is not running (runtime state: ${rt?.status ?? 'never run'}) — nothing to stop.`,
      ),
    );
    return { success: false, message: 'org not running' };
  }
  if (rt.pid) {
    // #573: a pid now held by another process is as gone as a dead one.
    const liveness = recordedPidLiveness(rt.pid, rt.pidStart);
    if (liveness !== 'alive') {
      log(
        output.warning(
          `Org "${name}" is not running — runtime.json says running but ${deadPidReason(rt.pid, liveness)} (crashed daemon).`,
        ),
      );
      log(output.info(`Clear the stale record with: monomind org mark-complete ${name}`));
      return { success: false, message: 'org crashed — use mark-complete' };
    }
  }
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'stop'), new Date().toISOString());
  log(
    output.info(
      `Stop requested for "${name}" (pid ${rt.pid}) — the daemon picks it up within ~2s.`,
    ),
  );
  return { success: true, message: `stop requested for ${name} (daemon exits within 2s)` };
};

export const pauseAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgPaused(ctx.cwd, name)) {
    log(output.warning(`Org "${name}" is already paused.`));
    return { success: true, message: 'already paused' };
  }
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'pause'), new Date().toISOString());
  log(
    output.info(
      `Org "${name}" paused — current turns will finish, no new cycles will start. Resume with: monomind org resume ${name}`,
    ),
  );
  return { success: true, message: `org ${name} paused` };
};

export const resumeAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!isOrgPaused(ctx.cwd, name)) {
    log(output.warning(`Org "${name}" is not paused.`));
    return { success: true, message: 'not paused' };
  }
  clearPausefile(ctx.cwd, name);
  log(output.info(`Org "${name}" resumed — next scheduled tick will start a cycle.`));
  return { success: true, message: `org ${name} resumed` };
};

export const reloadAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  // The reload signal is a file the running daemon polls — same pattern as stop/pause.
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'reload'), new Date().toISOString());
  log(output.info(`Reload requested for "${name}" — the daemon picks it up within ~2s.`));
  // #502: the daemon refuses a definition that does not verify and keeps the
  // running org on its last verified one — say so here, not only in its log.
  try {
    const raw: unknown = JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, `${name}.json`), 'utf8'));
    const check = orgSignatureEnforced() ? verifyOrgDef(ctx.cwd, name, raw) : { ok: true };
    if (!check.ok && 'message' in check) {
      log(
        output.warning(
          `${check.message} — until then the reload is refused and the running org keeps its last verified definition.`,
        ),
      );
    }
  } catch {
    /* unreadable: the daemon reports it */
  }
  return { success: true, message: `reload requested for ${name}` };
};

export const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
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
  // Protocol JSON mode (agent-exec-protocol.md §7.2): compact runtime state
  // per org — the same liveness rule as the human path (a 'running' record
  // whose pid is gone is a crash, not a running org).
  if (ctx.flags.format === 'json') {
    const orgDir = join(ctx.cwd, ORG_DIR);
    const targets = name
      ? [name]
      : existsSync(orgDir)
        ? listOrgConfigFiles(orgDir).map((f) => f.replace(/\.json$/, ''))
        : [];
    // #365 (capability `org-role-full-access`): every policy.access 'full'
    // role's resolved access/access_state, from config — present whether or
    // not the org has run (#367: a stopped org is when a human reviews and
    // grants). Omitted (not an empty array) when the org declares none.
    const rolesAccess = (t: string) => {
      const accessRoles = fullAccessRoles(ctx.cwd, t);
      return accessRoles.length ? { roles_access: accessRoles } : {};
    };
    const readState = (t: string) => {
      // #573: a 'running' record whose run is dead is closed out first.
      reconcileStaleRun(ctx.cwd, t, 'org status');
      const rt = join(orgDir, t, 'runtime.json');
      if (!existsSync(rt)) return { name: t, status: 'never run', ...rolesAccess(t) };
      try {
        const st = JSON.parse(readFileSync(rt, 'utf8')) as {
          status?: string;
          run?: string;
          pid?: number;
          abandonedRoles?: string[];
          closedBy?: string;
          error?: string;
          memoryError?: string;
        };
        let status = st.status ?? 'never run';
        // #274: an 'idle' run is still a running run to every protocol
        // consumer — only a genuine crash changes the reported status.
        if (status === 'running' || status === 'crashed') {
          if (classifyRun(ctx.cwd, t, st).state === 'crashed') status = 'crashed';
        }
        return {
          name: t,
          status,
          run: st.run,
          pid: st.pid,
          paused: isOrgPaused(ctx.cwd, t),
          abandoned_roles: st.abandonedRoles ?? [],
          closed_by: st.closedBy,
          error: st.error,
          // #293: present only when the run's cross-run memory was not stored.
          memory_error: st.memoryError,
          // #296: when the idle watchdog will stop a running org, or why it won't.
          ...(status === 'running' ? readIdleStatus(ctx.cwd, t, st.run) : {}),
          ...rolesAccess(t),
          ...sectionsJson(ctx.cwd, t, st.run),
        };
      } catch {
        return { name: t, status: 'unreadable-runtime', ...rolesAccess(t) };
      }
    };
    const items = targets.map(readState);
    // Named org → bare singleton; no name → list envelope (protocol §7.1).
    process.stdout.write(`${JSON.stringify(name ? { v: 1, ...items[0] } : { v: 1, items })}\n`);
    return { success: true };
  }
  const orgDir = join(ctx.cwd, ORG_DIR);
  const targets = name
    ? [name]
    : existsSync(orgDir)
      ? listOrgConfigFiles(orgDir).map((f) => f.replace(/\.json$/, ''))
      : [];
  for (const t of targets) {
    reconcileStaleRun(ctx.cwd, t, 'org status'); // #573
    const rt = join(orgDir, t, 'runtime.json');
    let state: { status: string; run?: string; pid?: number; abandonedRoles?: string[] } = {
      status: 'never run',
    };
    if (existsSync(rt)) {
      try {
        state = JSON.parse(readFileSync(rt, 'utf8'));
      } catch (err) {
        log(
          output.warning(
            `${t}: could not read runtime.json (${err instanceof Error ? err.message : 'corrupt/truncated file'})`,
          ),
        );
        continue;
      }
    }
    // A "running" record with no sign of life left means the daemon died
    // without its stopOrg cleanup — surface that instead of reporting it as
    // still running. A stale pid alone is NOT that proof (#274).
    let liveness: ReturnType<typeof classifyRun> | undefined;
    if (state.status === 'running' || state.status === 'crashed') {
      liveness = classifyRun(ctx.cwd, t, state);
      if (liveness.state === 'crashed') {
        let heartbeatHint = '';
        try {
          const hb = JSON.parse(
            readFileSync(join(ctx.cwd, '.monomind', 'serve-heartbeat.json'), 'utf8'),
          );
          heartbeatHint = ` (last heartbeat: ${hb.updatedAt})`;
        } catch {
          /* no heartbeat file — daemon predates this change or was already cleaned up */
        }
        const { closedBy, error } = state as { closedBy?: string; error?: string };
        const label =
          closedBy === 'crash-handler'
            ? 'crashed (caught by crash handler)'
            : closedBy === STALE_RUN_CLOSED_BY && error
              ? `crashed (${error})`
              : `crashed (runtime.json says ${state.status} but pid ${state.pid} is gone and the run has been silent)`;
        log(
          output.warning(
            `${t}: ${label}${heartbeatHint}${state.run ? ` — run ${state.run}` : ''} — close it out with "monomind org mark-complete ${t}"`,
          ),
        );
        continue;
      }
    }
    const paused = isOrgPaused(ctx.cwd, t);
    const statusLabel =
      state.status === 'running'
        ? paused
          ? 'running (PAUSED)'
          : liveness?.state === 'idle'
            ? 'running (idle)'
            : 'running'
        : state.status;
    // Say when the recorded pid is no longer the thing proving it alive, so a
    // pid that doesn't match any process isn't a silent mystery.
    const staleHint =
      liveness?.evidence && liveness.evidence !== 'pid'
        ? ` — recorded pid ${state.pid} is stale; still live per ${liveness.evidence}`
        : '';
    const line = `${t}: ${statusLabel}${state.run ? ` (run ${state.run}, pid ${state.pid})` : ''}${staleHint}`;
    // A role that never spawned is a silent capability hole — an org with no
    // tester still reports a clean "running". Say it on the status line.
    if (state.abandonedRoles?.length) {
      log(
        output.warning(
          `${line} — DEGRADED: ${state.abandonedRoles.length} role(s) never spawned: ${state.abandonedRoles.join(', ')}`,
        ),
      );
    } else {
      log(output.info(line));
    }
    // #365: every policy.access 'full' role's resolved access/state.
    for (const r of fullAccessRoles(ctx.cwd, t)) {
      const label =
        r.access_state === 'active' ? 'full access — active' : `full access — ${r.access_state}`;
      const suffix = r.reason && r.access_state !== 'active' ? ` (${r.reason})` : '';
      if (r.access_state === 'active') log(`  ${r.role}: ${label}`);
      else log(output.warning(`  ${r.role}: ${label}${suffix}`));
    }
    // #293: cross-run memory that was never written. Without this the only
    // symptom is org_recall coming back empty runs later, which points nowhere
    // near a memory backend that failed to load.
    const memoryError = (state as { memoryError?: string }).memoryError;
    if (memoryError) {
      log(
        output.warning(
          `  org memory: last run was NOT saved (${memoryError}) — org_recall will not find it`,
        ),
      );
    }

    // Enriched progress for running orgs
    if (state.status === 'running' && state.run) {
      // #296: when the idle watchdog will stop this org, or why it won't.
      // Say nothing for 'unknown' (no record yet) rather than a misleading zero.
      const idle = readIdleStatus(ctx.cwd, t, state.run);
      if (idle.idle_stop_at) {
        log(
          `  idle stop: in ${fmtDuration(idle.idle_stop_in_seconds! * 1000)} (at ${utcTime(Date.parse(idle.idle_stop_at))})`,
        );
      } else if (idle.idle_hold === 'disabled') {
        log(`  idle watchdog: disabled`);
      } else if (idle.idle_hold && idle.idle_hold !== 'unknown') {
        const until = idle.idle_hold_until
          ? ` until ${utcTime(Date.parse(idle.idle_hold_until))}`
          : '';
        log(`  idle stop: held — ${idle.idle_hold}${until}`);
      }

      const events = readRunEvents(ctx.cwd, t, state.run);
      if (events.length) {
        const summary = summarizeRun(events);
        const elapsed = summary.startedAt ? Date.now() - summary.startedAt : null;
        const elapsedStr = elapsed !== null ? fmtDuration(elapsed) : '?';
        const lastTs = events[events.length - 1].ts;
        const quietMs = Date.now() - lastTs;
        const quietStr = fmtDuration(quietMs);
        const toolCalls = Object.values(summary.roles).reduce(
          (a, r) => a + r.toolsAllowed + r.toolsDenied,
          0,
        );
        const rolesUp = Object.keys(summary.roles).filter((r) => r !== '(system)').length;

        log(
          `  elapsed: ${elapsedStr} | events: ${summary.events} | messages: ${summary.messages} | tools: ${toolCalls}`,
        );
        log(
          `  roles active: ${rolesUp} | tokens: ${fmtNum(summary.totalTokens)} | cost: ${summary.totalCostUsd === null ? 'unknown' : `$${summary.totalCostUsd.toFixed(2)}`}`,
        );
        log(`  quiet since: ${utcTime(lastTs)} (${quietStr} ago)`);
        if (summary.crashes.length) log(output.warning(`  crashes: ${summary.crashes.join(', ')}`));
      }

      // Previous cycle comparison from history
      const history = readHistory(ctx.cwd, t);
      const prev = history.filter((h) => h.run !== state.run).at(-1);
      if (prev) {
        const dur = prev.durationMs !== null ? fmtDuration(prev.durationMs) : '?';
        // #302: never blindly "completed" — describeRunOutcome only says
        // that for a genuine boss outcome, a real crash, or a bare manual
        // stop; every automated stop path (idle-stop, failed-start, a boss
        // restart giving up) reports its own real cause, with the runnable
        // task count if work was left outstanding.
        const outcome = describeRunOutcome(prev);
        log(
          `  prev cycle: ${dur}, ${outcome}, ${prev.events} events, ${fmtNum(prev.totalTokens)} tokens`,
        );
      }
    }
  }
  return { success: true };
};

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
