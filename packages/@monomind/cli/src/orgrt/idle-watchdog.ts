// packages/@monomind/cli/src/orgrt/idle-watchdog.ts
// Extracted from daemon.ts — the per-org idle watchdog started by startOrg.
import { wakeDueBlockRechecks } from './block-recheck.js';
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import { startUnreadWatch } from './documents/unread-watch-run.js';
import { hasActiveEndpointWait } from './endpoint-roles.js';
import {
  advanceHold,
  type HoldTrack,
  hookedOnWork,
  type IdleHoldState,
  noProgressRoles,
  projectIdleNudge,
  projectIdleStop,
  type WaitHold,
  writeIdleRecord,
} from './idle-deadline.js';
import { startLeadWatch } from './lead-watch.js';
import { taskTag } from './loadouts.js';
import * as questionOps from './questions.js';
import type { OrgRole } from './types.js';
import { WriteLedger } from './write-ledger.js';

/** Idle watchdog's per-tick recovery check: given the previous nudge timestamp,
 *  the cumulative nudge count, and the timestamp of the most recent real tool
 *  call, returns the nudge count that should carry forward now that fresh
 *  activity means the org is no longer idle.
 *
 *  `nudgedAt !== 0` means we're recovering from an outstanding nudge. Resetting
 *  the counter here means it only ever tracks UNRESOLVED idle spells in a row,
 *  not a lifetime total — a long-running org that goes idle and recovers any
 *  number of times (e.g. periodic checkpoints on a slow background task) is
 *  never punished for having had several separate, healthy idle spells over
 *  its lifetime. Before this existed, `nudges` only ever incremented, so a run
 *  that answered every single nudge with real work still hit the "org idle
 *  again after 3 nudges" cap and got force-stopped on its 4th idle spell —
 *  observed live killing an in-progress 24h soak test under 90 minutes in.
 *
 *  But "recovering" must mean genuine forward progress, not just any bus
 *  event — a bare, content-free reply to the nudge (a boss that answers with
 *  "✓ Complete" and calls no tools at all) still updates lastActivity, so the
 *  org isn't flagged as silent, but it accomplishes nothing: nobody outside
 *  the boss's own turn ever sees it, since role coordination only happens via
 *  tool calls (org_send, org_task, ...). Requiring `lastToolActivity >=
 *  nudgedAt` — a real tool call happened AFTER this nudge was sent — closes
 *  that gap: observed live, a boss stuck responding to four consecutive
 *  10-minute nudges with one-line acknowledgments and zero tool calls looped
 *  indefinitely making no progress, because every trivial reply reset the cap
 *  that was supposed to catch exactly this. */
export function resolvedIdleNudgeCount(
  nudgedAt: number,
  nudges: number,
  lastToolActivity: number,
): number {
  return nudgedAt !== 0 && lastToolActivity >= nudgedAt ? 0 : nudges;
}

/** What the bus subscriber in startOrgInner tracks and the watchdog reads. */
export interface IdleActivity {
  lastActivity: () => number;
  lastToolActivity: () => number;
  roleActivity: Map<string, number>;
  noProgressAlarmed: Set<string>;
}

export function startIdleWatchdog(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  bossRole: OrgRole,
  activity: IdleActivity,
): void {
  const { def, bus, run } = running;
  const { roleActivity, noProgressAlarmed } = activity;
  // Two runtime watches that need the same bus and activity map: write
  // verification (run_config.verify_writes, default on) and the lead watch
  // (run_config.lead_watch, default on). Neither depends on idle_minutes.
  if (def.run_config.verify_writes !== false) {
    const ledger = new WriteLedger(() => [running.workdir ?? daemon.root, daemon.root]);
    running.writeLedger = ledger;
    bus.subscribe((e) => ledger.observe(e));
  }
  const stopLeadWatch = startLeadWatch(daemon, name, running, roleActivity);
  const stopUnreadWatch = startUnreadWatch(daemon, name, running); // sections orgs only (P3.13)
  const stopWatches =
    stopLeadWatch && stopUnreadWatch
      ? () => {
          stopLeadWatch();
          stopUnreadWatch();
        }
      : (stopLeadWatch ?? stopUnreadWatch);
  if (stopWatches) daemon.leadWatches.set(name, stopWatches);
  // Idle watchdog: a hung tool call (or a run that quietly finished without
  // org_complete) produces no bus events, and every agent just waits. After
  // idle_minutes of silence, nudge the boss to complete or reassign; if the
  // nudge itself produces no activity (boss hung/crashed), or the org keeps
  // going idle after MAX_IDLE_NUDGES nudges in a row without ever recovering
  // (see resolvedIdleNudgeCount), stop the run instead of letting it freeze
  // forever. idle_minutes: 0 disables.
  const idleMs = (def.run_config.idle_minutes ?? 10) * 60_000;
  if (idleMs > 0) {
    const MAX_IDLE_NUDGES = 3;
    let nudgedAt = 0;
    let nudges = 0;
    let stopping = false;
    const idleStop = (msg: string): void => {
      stopping = true;
      bus.emit({ type: 'audit', reason: 'idle-stop', msg });
      // #302: closedBy: 'idle-stop' — the truth gate at finishStop's
      // history write reads this to record what actually happened
      // (including any runnable work left in org_tasks) instead of
      // letting a null outcome default to a plain "completed".
      daemon
        .stopOrg(name, { closedBy: 'idle-stop' })
        .catch((err) =>
          console.error(`org ${name}: idle-stop failed:`, err instanceof Error ? err.message : err),
        );
    };
    // #296: publish the projected stop time for `org status --json`. Only
    // written when it changes; a failed write must not throw out of the
    // interval (that would reach the process crash handlers).
    let published = '';
    const publishDeadline = (hold: IdleHoldState | null): void => {
      if (stopping) return;
      const bossRt = running.agents.get(bossRole.id);
      const clock = {
        lastActivity: activity.lastActivity(),
        nudgedAt,
        nudges,
        maxNudges: MAX_IDLE_NUDGES,
        idleMs,
        bossReachable: bossRt?.status === 'running' && !bossRt.mailbox.isClosed,
      };
      const at = hold ? null : new Date(projectIdleStop(clock)).toISOString();
      const nudgeAt = hold ? null : projectIdleNudge(clock);
      const nextNudge = nudgeAt === null ? null : new Date(nudgeAt).toISOString();
      const key = `${at}|${nextNudge}|${hold?.reason ?? null}|${hold?.until ?? null}`;
      if (key === published) return;
      try {
        writeIdleRecord(daemon.root, name, {
          run,
          idle_minutes: idleMs / 60_000,
          idle_stop_at: at,
          next_nudge_at: nextNudge,
          hold,
        });
        published = key;
      } catch (err) {
        console.error(
          `org ${name}: could not write the idle deadline:`,
          err instanceof Error ? err.message : err,
        );
      }
    };
    // ADR-O001 D4 — Gas Town's "30 minutes hooked without progress" alarm.
    // The org-wide idle clock is silent while a hold is in force, so a role
    // that is nominally running and producing nothing gets its own, loud
    // audit event. Once per spell: the bus subscriber clears the flag as
    // soon as the role emits anything.
    const alarmNoProgress = (now: number): void => {
      // Only a role with work can be stalled on it: one with no task and no
      // mail, parked on its mailbox (or with its process down after
      // session_idle_exit_ms), is waiting, not hooked.
      const withTask = new Set(
        (running.taskDag?.all() ?? []).filter((t) => t.status === 'running').map((t) => t.assignee),
      );
      const stalled = noProgressRoles(
        [...running.agents].map(([id, rt]) => ({
          id,
          working:
            rt.status === 'running' &&
            !rt.mailbox.isClosed &&
            hookedOnWork({
              runningTask: withTask.has(id),
              queuedMail: rt.mailbox.peek() !== undefined,
              awaitingMail: rt.mailbox.awaitingMail,
            }),
          lastActivity: roleActivity.get(id) ?? activity.lastActivity(),
          alarmed: noProgressAlarmed.has(id),
        })),
        now,
      );
      for (const role of stalled) {
        noProgressAlarmed.add(role.id);
        bus.emit({
          type: 'audit',
          from: role.id,
          reason: 'no-progress',
          msg:
            `role "${role.id}" has been running for ${Math.round(role.silentMs / 60_000)}m ` +
            `without a single bus event — it is hooked but producing nothing`,
          data: { role: role.id, silentMinutes: Math.round(role.silentMs / 60_000) },
        });
      }
    };
    // The legitimate waits the watchdog holds through — every one of them
    // with a deadline attached by advanceHold (ADR-O001 D4).
    const holdReason = (): WaitHold | { reason: WaitHold; until: number } | null => {
      if (daemon.restarting.has(name)) return 'restarting'; // boss auto-restart in flight
      // A pending gate means the org is legitimately waiting for human input
      const pendingGates = daemon.readGates(name).gates.filter((g) => g.status === 'pending');
      if (pendingGates.length > 0) return 'pending-gate';
      // Bug 3: a pending ask_human question is the same kind of legitimate
      // wait as a pending gate — askHuman()'s receipt tells the role to end
      // its turn and wait for the resolution, so a role that follows that
      // instruction and goes quiet looks identical to a genuinely stalled
      // agent. Without this check the watchdog nudges (and, after enough
      // nudges, idle-stops) an org that's simply waiting on a human answer
      // that's already on its way.
      //
      // ADR-O001 D4: only a question the asker declared BLOCKING counts. The
      // 8.3-hour stall was held open by a question whose own text opened
      // with "no answer needed for the run to continue; I am not blocking on
      // this" — it suppressed the watchdog exactly like a real blocker.
      if (questionOps.pendingBlockingQuestions(daemon.root, name).length > 0)
        return 'pending-question';
      // M1 (C-41): a pending tool approval is the same kind of legitimate
      // wait — the role was told to wait for `org approve/deny`.
      if ((daemon.approvals.get(name) ?? []).some((a) => a.approved === null))
        return 'pending-approval';
      // M2 (C-41): a delivered endpoint message whose reply is still due.
      if (hasActiveEndpointWait(running)) return 'endpoint-reply-due';
      // A task blocked on a real-world time still in the future is
      // legitimate waiting, same as a pending gate — don't nudge about it.
      // Its deadline is the time the asker actually named, not the default
      // hold TTL, so a block set hours out is honoured exactly.
      const blockedUntil = running.taskDag?.activeBlockUntil(Date.now()) ?? null;
      if (blockedUntil !== null) return { reason: 'task-blocked', until: blockedUntil };
      return null;
    };
    // Auto-resume any task whose org_task_block time has passed: flip it
    // back to 'running' and re-push it into the assignee's mailbox, same as
    // a fresh dispatch. This IS real activity, so it feeds the normal
    // idleFor check rather than short-circuiting it — an unblocked task
    // should reset the idle clock, not just silently update state nobody
    // notices until the next nudge. Runs on every tick, a hold in force
    // included: a block that expires mid-wait is real work again.
    const resumeExpiredBlocks = (): void => {
      wakeDueBlockRechecks(running, Date.now()); // #329: every block is re-checked
      const unblocked = running.taskDag?.unblockExpired(Date.now()) ?? [];
      for (const task of unblocked) {
        const agent = running.agents.get(task.assignee);
        if (agent && !agent.mailbox.isClosed) {
          agent.mailbox.push(`${taskTag(task)} Block expired — resuming: ${task.title}`);
        }
        bus.emit({
          type: 'status',
          from: 'dag',
          reason: 'task-unblocked',
          msg: `task ${task.id} block expired — resumed and re-dispatched to ${task.assignee}`,
          data: { taskId: task.id, assignee: task.assignee },
        });
      }
    };
    // The normal idle path: nudge the boss, then stop if the nudge produced
    // nothing. Runs only when nothing (still) holds the watchdog.
    const check = (): void => {
      const idleFor = Date.now() - activity.lastActivity();
      if (idleFor < idleMs) {
        nudges = resolvedIdleNudgeCount(nudgedAt, nudges, activity.lastToolActivity());
        nudgedAt = 0;
        return;
      }
      if (nudgedAt === 0) {
        if (nudges >= MAX_IDLE_NUDGES) {
          idleStop(`org idle again after ${nudges} nudges — stopping run`);
          return;
        }
        const bossRt = running.agents.get(bossRole.id);
        // #205: a budget-exhausted boss closed its own mailbox on
        // purpose (session.ts) — that's a recoverable pause, not the
        // same "unreachable" condition as a crash. Name it distinctly so
        // the operator's remedy (raise the budget, resume) is obvious
        // instead of reading like the run died.
        const budgetReason = bossRt?.mailbox.closeReason;
        if (budgetReason === 'token-budget' || budgetReason === 'usd-budget') {
          idleStop(
            `org idle for ${Math.round(idleFor / 60_000)}m and boss "${bossRole.id}" is over its ` +
              `${budgetReason === 'token-budget' ? 'token' : 'USD'} budget — raise the role's ` +
              `${budgetReason === 'token-budget' ? 'budget_tokens' : 'budget_usd'} (or run_config's) and resume from checkpoint — stopping run`,
          );
          return;
        }
        if (bossRt?.status !== 'running' || bossRt.mailbox.isClosed) {
          idleStop(
            `org idle for ${Math.round(idleFor / 60_000)}m and boss "${bossRole.id}" is unreachable — stopping run`,
          );
          return;
        }
        nudges++;
        nudgedAt = Date.now();
        bus.emit({
          type: 'audit',
          from: bossRole.id,
          reason: 'idle-nudge',
          msg: `no org activity for ${Math.round(idleFor / 60_000)}m — nudging boss (${nudges}/${MAX_IDLE_NUDGES})`,
        });
        bossRt.mailbox.push(
          `[watchdog] No activity in org "${name}" for ${Math.round(idleFor / 60_000)} minute(s). ` +
            `Check org_tasks first, then pick ONE: (1) the org's full stated goal is achieved or clearly cannot be — call org_complete now (this ends the run for good, not just this batch); ` +
            `(2) someone has stalled or unstarted work — check on your team via org_send and reassign it; ` +
            `(3) the current task batch is done but the goal has more scope left — do NOT call org_complete for this case, instead dispatch the next batch of work with org_task/createTask so the org keeps making progress; ` +
            `(4) a task is stuck 'running' only because it's genuinely waiting on a real-world time (a scheduled process, a deadline) and there is nothing else to dispatch right now — do NOT just leave it and re-confirm this every time you get nudged, call org_task_block(taskId, untilIso, reason) instead so this watchdog stops nudging you about it and auto-resumes the task when the time arrives.`,
        );
      } else if (Date.now() - nudgedAt >= idleMs) {
        idleStop(
          `nudge produced no activity for another ${Math.round(idleMs / 60_000)}m — boss appears hung, stopping run`,
        );
      }
    };
    // One watchdog tick. The hold is resolved FIRST and with a deadline, so
    // a wait that outlives its deadline hands the run back to the idle path
    // instead of suppressing it forever (ADR-O001 D4).
    let holdTrack: HoldTrack | null = null;
    const tick = (): IdleHoldState | null => {
      const now = Date.now();
      alarmNoProgress(now);
      resumeExpiredBlocks();
      const step = advanceHold(holdTrack, holdReason(), now);
      holdTrack = step.track;
      if (step.expired) {
        bus.emit({
          type: 'audit',
          reason: 'hold-expired',
          msg:
            `the "${step.expired}" hold on org "${name}" outlived its deadline — the idle ` +
            `watchdog is running again and will nudge, then stop the run if nothing happens`,
          data: { hold: step.expired },
        });
      }
      if (step.hold) return step.hold;
      check();
      return null;
    };
    const initialHold = advanceHold(null, holdReason(), Date.now());
    holdTrack = initialHold.track;
    publishDeadline(initialHold.hold);
    const wd = setInterval(
      () => publishDeadline(tick()),
      Math.max(200, Math.min(idleMs / 2, 30_000)),
    );
    (wd as { unref?: () => void }).unref?.();
    daemon.watchdogs.set(name, wd);
  } else {
    try {
      writeIdleRecord(daemon.root, name, {
        run,
        idle_minutes: 0,
        idle_stop_at: null,
        hold: { reason: 'disabled', until: null },
      });
    } catch (err) {
      console.error(
        `org ${name}: could not write the idle deadline:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
