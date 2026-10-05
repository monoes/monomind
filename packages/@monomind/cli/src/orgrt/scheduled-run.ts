// packages/@monomind/cli/src/orgrt/scheduled-run.ts
// One scheduled tick of `org serve`: start the org through startOrg (so the host preflight, the eval gate and
// the daemon lock apply exactly as for a manual start), bound the run to max_run, then stop it. Every start is
// a fresh run with its own run id and its own document store (docs/<run>/), so a recurring sections org needs
// no carry-forward. A tick that cannot start, or has nothing to start, leaves a line in
// `.monomind/orgs/<name>/schedule-audit.jsonl` (and on the run's own bus, when one is live).
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgDaemon } from './daemon.js';
import { parseSchedule } from './scheduler.js';
import { ORG_DIR } from './types.js';

export const SCHEDULE_AUDIT_FILE = 'schedule-audit.jsonl';

export type ScheduleAuditEvent =
  | 'scheduled-start-refused'
  | 'scheduled-tick-skipped'
  | 'scheduled-tick-deferred';

/** Best effort: an audit write that fails must never fail the tick. */
export function auditScheduledTick(
  daemon: OrgDaemon,
  name: string,
  event: ScheduleAuditEvent,
  msg: string,
): void {
  if (daemon.hasOrgDef(name)) {
    try {
      const dir = join(daemon.root, ORG_DIR, name);
      mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, SCHEDULE_AUDIT_FILE),
        `${JSON.stringify({ ts: Date.now(), event, msg })}\n`,
      );
    } catch {
      /* best effort */
    }
  }
  daemon.orgs.get(name)?.bus.emit({ type: 'audit', reason: event, msg });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

export async function runScheduledIteration(
  daemon: OrgDaemon,
  name: string,
  intervalMs: number,
): Promise<void> {
  // Only ever stop a run THIS tick started. The runfile poll can start an org out-of-band, and the
  // scheduler has no visibility into that — so a tick landing on an already-running org yields.
  if (daemon.orgs.has(name) || daemon.startingOrgs.has(name)) {
    auditScheduledTick(
      daemon,
      name,
      'scheduled-tick-skipped',
      `a run of "${name}" is already live — this tick yields`,
    );
    return;
  }
  let startedHere = false;
  try {
    try {
      await daemon.startOrg(name);
    } catch (err) {
      auditScheduledTick(
        daemon,
        name,
        'scheduled-start-refused',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
    startedHere = true;
    // Scheduled iterations are time-bounded: agents' `done` promises only resolve after stopOrg closes the
    // mailboxes, so waiting on them alone deadlocks. Race against a max-run timeout, then ALWAYS stopOrg
    // (idempotent — it resolves `done` and flushes).
    let org = daemon.getOrg(name);
    const maxRun = (org?.def as { run_config?: { max_run?: string | number } } | undefined)
      ?.run_config?.max_run;
    // Default to the full interval: a missed tick catches up the moment a run ends (OrgScheduler.pending),
    // so a run may safely use its whole interval. Set run_config.max_run to bound it tighter or looser.
    const deadline = Date.now() + (parseSchedule(maxRun) ?? intervalMs);
    while (org && deadline > Date.now()) {
      const done = Promise.allSettled([...org.agents.values()].map((a) => a.done));
      await Promise.race([done, sleep(deadline - Date.now())]);
      // A boss auto-restart stops the run and starts a fresh one under the same name: stay with the
      // restarted run, so it is still bounded by this tick instead of being left running unsupervised.
      while (daemon.restarting.has(name) && Date.now() < deadline) await sleep(50);
      const current = daemon.getOrg(name);
      if (current === org) break;
      org = current;
    }
  } catch (err) {
    console.error(`org ${name}: scheduled run failed:`, err);
  } finally {
    // A deadline stop still lands on agents mid-tool-call; a minute is enough to finish an edit or a test run
    // and flush. #302: tag the real cause — a scheduled run hitting its own deadline is the same shape as an
    // idle-stop and must not be rendered as a clean, boss-attributed outcome.
    if (startedHere) {
      await daemon
        .stopOrg(name, { drainMs: 60_000, closedBy: 'scheduled-deadline' })
        .catch((err) => console.error(`org ${name}: stop failed:`, err));
    }
  }
}
