// packages/@monomind/cli/src/orgrt/dag-dispatch.ts

import { holdForBudgetClosedAssignee, releaseBudgetHolds } from './budget-closure.js';
import { activeRoleCount, type OrgDaemon, type RunningOrg } from './daemon.js';
import { holdTaskLine, resolveHeld, settleHeld } from './dispatch-hold.js';
import { taskTag } from './loadouts.js';
import { deliverQueuedFor } from './scheduler-integration.js';
import { resolveSessionScope, taskKeyOf } from './session-ledger.js';
import type { OrgTask } from './task-dag.js';
import { dispatchLine } from './task-provenance.js';

/** How long an auto-dispatched task is held before it enters the assignee's
 *  mailbox.
 *
 *  #275: a coordinator routinely calls org_task and, in the same turn, org_send
 *  with the briefing that task is about. Each push is its own mailbox entry and
 *  Mailbox.stream() yields one entry per SDK user turn, so an immediate push
 *  made the assignee's first turn the bare task title with the briefing
 *  stranded behind it — the role saw a title with no context and had to ask for
 *  a resend. Holding the dispatch for a beat lets the same-turn message join
 *  it, and both arrive as one message. Long enough for the rest of a tool-call
 *  batch to land, short enough to be invisible next to an LLM turn. */
export const DISPATCH_COALESCE_MS = 500;

/** Hold `line` for the assignee, merging it with anything else queued for the
 *  same coalescing window (further dispatches, and same-turn messages folded in
 *  by cross-org.ts's pushMessage). The recipient is resolved again at flush
 *  time so a role replaced during the window gets the message in its new
 *  mailbox rather than the retired one. A line about `taskId` is withdrawn
 *  if the task is cancelled first (dispatch-hold.ts); `received` says the
 *  assignee already has the task (a follow-up, not its dispatch). */
export function queueDispatch(
  running: RunningOrg,
  assignee: string,
  line: string | Promise<string>,
  taskId?: string,
  received = false,
): void {
  if (!running.pendingDispatch) running.pendingDispatch = new Map();
  const open = running.pendingDispatch.get(assignee);
  if (open) {
    open.lines.push(line);
    if (taskId) holdTaskLine(running, open, line, taskId, received);
    return;
  }
  const entry = {
    lines: [line] as (string | Promise<string>)[],
    timer: undefined as unknown as ReturnType<typeof setTimeout>,
  };
  entry.timer = setTimeout(() => {
    if (entry.lines.every((l) => typeof l === 'string')) {
      running.pendingDispatch?.delete(assignee);
      const lines = entry.lines as string[];
      deliverDispatch(running, assignee, settleHeld(running, entry, lines, lines));
      return;
    }
    // A line is still resolving (per-task skill suggestion). Keep the entry
    // open so same-turn messages keep joining it (#275), and deliver once no
    // line arrived or was withdrawn while waiting.
    void (async () => {
      const { held, lines } = await resolveHeld(entry);
      running.pendingDispatch?.delete(assignee);
      deliverDispatch(running, assignee, settleHeld(running, entry, held, lines));
    })();
  }, DISPATCH_COALESCE_MS);
  entry.timer.unref?.();
  if (taskId) holdTaskLine(running, entry, line, taskId, received);
  running.pendingDispatch.set(assignee, entry);
}

/** The recipient is resolved at delivery time so a role replaced during the
 *  window gets the message in its new mailbox rather than the retired one. */
function deliverDispatch(running: RunningOrg, assignee: string, lines: string[]): void {
  const mailbox = running.agents.get(assignee)?.mailbox;
  if (!mailbox || mailbox.isClosed || lines.length === 0) return;
  // ADR-O001 D3: in task scope a message is routed to the model session of
  // the task it names, so a batch naming several tasks has to stay apart.
  const role = running.def?.roles.find((r) => r.id === assignee);
  if (role && resolveSessionScope(role, running.def) === 'task') {
    for (const line of lines) mailbox.push(line);
    return;
  }
  mailbox.push(batchOrder(lines).join('\n\n'));
}

/** One message is routed, and counted against the session cap, by the task tags
 *  it opens paragraphs with (messageTaskIds), and a mail's body is never read for
 *  one. A batch therefore puts its task paragraphs first, in arrival order, and
 *  the mail folded in after them, also in arrival order: whatever order the lines
 *  were queued in, the same lines give the same message. */
export function batchOrder(lines: string[]): string[] {
  const tagged = lines.filter((l) => taskKeyOf(l) !== undefined);
  return [...tagged, ...lines.filter((l) => taskKeyOf(l) === undefined)];
}

/** A role can end its turn with its own task still open and nothing notices.
 *  On the 2.15.6 release run the publisher reported its results with org_send
 *  and ended its turn without calling org_task_done: the coordinator waited on
 *  a completion that never came and the run sat still for ~10 minutes until a
 *  human nudged it, because the only backstop is the org-wide idle watchdog
 *  (run_config.idle_minutes — 45 in that org).
 *
 *  Called when the role's turn ends (its session goes idle / its process
 *  parks). Deliberately narrow, so it stays a nudge and not a second watchdog:
 *  only a 'running' task — which means dispatched, and excludes a task blocked
 *  on a real-world time (org_task_block) and one whose close was refused and
 *  requeued — only when nothing else is queued or coalescing for the assignee
 *  (it would be mid-turn again, possibly on a task it has not received yet),
 *  and at most once per task per dispatch (dispatchReadyTasks re-arms it).
 *  A task the role DID close this turn is terminal by now, so it is skipped by
 *  the same status check. The idle watchdog is untouched. */
export function nudgeOpenTasksAtTurnEnd(running: RunningOrg, role: string): void {
  if (!running.taskDag) return;
  const agent = running.agents.get(role);
  if (!agent || agent.mailbox.isClosed) return;
  if (agent.mailbox.peek() !== undefined || running.pendingDispatch?.has(role)) return;
  const roleDef = running.def?.roles.find((r) => r.id === role);
  const needsEvidence =
    running.def?.run_config.completion_evidence === true && roleDef?.deliberative !== true;
  for (const task of running.taskDag.all()) {
    if (task.assignee !== role || task.status !== 'running') continue;
    if (!running.nudgedOpenTasks) running.nudgedOpenTasks = new Set();
    if (running.nudgedOpenTasks.has(task.id)) continue;
    running.nudgedOpenTasks.add(task.id);
    running.bus.emit({
      type: 'audit',
      from: role,
      reason: 'task-open-at-turn-end',
      msg: `"${role}" ended its turn with task ${task.id} still open — nudging it to close or block it`,
      data: { taskId: task.id, assignee: role, title: task.title },
    });
    queueDispatch(
      running,
      role,
      `${taskTag(task)} STILL OPEN — your turn ended and "${task.title}" is still assigned to you and not closed. Reporting the work in a message does not close it: call org_task_done with taskId "${task.id}"${
        needsEvidence
          ? ' and `evidence` — the commit the work sits on plus every acceptance command you ran with its real exit code'
          : ''
      }. If it genuinely cannot finish yet, call org_task_block with the time it can resume instead of leaving it open.`,
      task.id,
      true,
    );
  }
}

/** ADR-O001 D7: a task asked for a loadout its assignee's LIVE session was not
 *  built with. The session's system prompt is never edited mid-session, so the
 *  task is still delivered (liveness first) and the gap is recorded instead —
 *  an operator can see which work ran under which loadout. D3 (task-keyed
 *  sessions) removes this case by building a session per (role, task). */
function noteLoadoutMismatch(
  running: RunningOrg,
  task: OrgTask,
  sessionLoadout: string | undefined,
): void {
  if (!task.loadout || task.loadout === sessionLoadout) return;
  // D3: a task-scoped assignee builds a session per task with that task's
  // loadout, so there is no live session to mismatch.
  const role = running.def?.roles.find((r) => r.id === task.assignee);
  if (role && resolveSessionScope(role, running.def) === 'task') return;
  running.bus.emit({
    type: 'status',
    from: 'dag',
    reason: 'loadout-mismatch',
    msg: `task ${task.id} selected loadout "${task.loadout}" but "${task.assignee}"'s live session was built with ${sessionLoadout ? `"${sessionLoadout}"` : 'no loadout'} — delivered without changing its system prompt`,
    data: {
      taskId: task.id,
      assignee: task.assignee,
      taskLoadout: task.loadout,
      sessionLoadout: sessionLoadout ?? null,
    },
  });
}

export function dispatchReadyTasks(daemon: OrgDaemon, org: string, running: RunningOrg): void {
  if (!running.taskDag) return;
  // #343: tasks held for a budget-closed assignee go out again once it reopens.
  releaseBudgetHolds(running);
  for (const task of running.taskDag.ready()) {
    // A task going out again (first dispatch, or back after a refused close)
    // is worth one more turn-end nudge — see nudgeOpenTasksAtTurnEnd.
    running.nudgedOpenTasks?.delete(task.id);
    // Resolve the assignee BEFORE marking the task running: a task's status
    // must not flip to 'running' unless we are actually about to hand it to
    // a live recipient — otherwise it's stuck there forever with no way for
    // anything else in this codebase to detect the orphaned state. Mirrors
    // the `agent && !agent.mailbox.isClosed` guard used at every other
    // `.mailbox.push(` call site in this file/daemon.ts (e.g. approvals.ts:130).
    const agent = running.agents.get(task.assignee);
    const pending = running.pendingRoles?.get(task.assignee);
    if (agent && !agent.mailbox.isClosed) {
      running.taskDag.markRunning(task.id);
      noteLoadoutMismatch(running, task, agent.loadout);
      queueDispatch(running, task.assignee, dispatchLine(daemon, running, task), task.id);
      running.bus.emit({
        type: 'status',
        from: 'dag',
        reason: 'task-dispatched',
        msg: `task ${task.id} dispatched to ${task.assignee}`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    } else if (agent) {
      // #343: closed for budget — hold the task with the reason instead.
      if (holdForBudgetClosedAssignee(running, task)) continue;
      // Assignee resolves to a role that's crashed or otherwise closed its
      // mailbox — pushing would silently no-op. Leave the task 'ready' (not
      // 'running') so it stays visible and retriable instead of stuck in
      // permanent limbo with a false "dispatched" audit trail.
      running.bus.emit({
        type: 'audit',
        from: 'dag',
        reason: 'dispatch-recipient-unavailable',
        msg: `task ${task.id} not dispatched — assignee "${task.assignee}" is crashed or unreachable`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    } else if (pending) {
      running.pendingRoles?.delete(task.assignee);
      // Same max_concurrent_agents gate as deliver() / cross-org lazy spawns.
      // The task stays 'ready'; the deferred spawn re-runs this dispatch once
      // the role is actually up, so the task is picked up then.
      const concurrencyLimit = running.def.run_config.max_concurrent_agents;
      if (concurrencyLimit != null && activeRoleCount(running) >= concurrencyLimit) {
        running.bus.emit({
          type: 'audit',
          from: task.assignee,
          reason: 'concurrency-limit',
          msg: `deferring lazy spawn of "${task.assignee}" for task ${task.id}: org is at its max_concurrent_agents ceiling (${concurrencyLimit})`,
          data: { taskId: task.id, assignee: task.assignee },
        });
        // #551: the role stays resolvable (running.deferredSpawns) and
        // the deferred spawn dispatches its ready tasks once it is up.
        daemon.scheduleConcurrencyDeferredSpawn(org, running, pending, (role) =>
          running.spawnRole?.(role),
        );
        running.deferredSpawns?.get(task.assignee)?.noted.add(task.id);
        continue;
      }
      // spawnRole registers the runtime synchronously, so the agent is either
      // live right now or the spawn failed — only mark 'running' in the former
      // case, so a failed spawn leaves the task 'ready' and retriable.
      running.spawnRole?.(pending);
      const spawned = running.agents.get(task.assignee);
      if (spawned && !spawned.mailbox.isClosed) {
        running.taskDag.markRunning(task.id);
        noteLoadoutMismatch(running, task, spawned.loadout);
        queueDispatch(running, task.assignee, dispatchLine(daemon, running, task), task.id);
        running.bus.emit({
          type: 'status',
          from: 'dag',
          reason: 'task-dispatched',
          msg: `task ${task.id} dispatched to ${task.assignee}`,
          data: { taskId: task.id, assignee: task.assignee },
        });
        // Messages queued for it while it could not start — deferred, or held
        // back by a budget closure a reload has since lifted.
        void deliverQueuedFor(daemon, org, running, task.assignee);
      } else if (!holdForBudgetClosedAssignee(running, task)) {
        running.bus.emit({
          type: 'audit',
          from: 'dag',
          reason: 'dispatch-recipient-unavailable',
          msg: `task ${task.id} not dispatched — lazy spawn of "${task.assignee}" did not produce a live agent`,
          data: { taskId: task.id, assignee: task.assignee },
        });
      }
    } else if (running.deferredSpawns?.has(task.assignee)) {
      // #551: its lazy spawn is waiting for a max_concurrent_agents slot or for
      // host resources — the task waits 'ready' and goes out once the role is
      // up. Said once per task.
      const { noted, gate } = running.deferredSpawns.get(task.assignee)!;
      if (noted.has(task.id)) continue;
      noted.add(task.id);
      running.bus.emit({
        type: 'audit',
        from: task.assignee,
        reason: gate === 'concurrency' ? 'concurrency-limit' : 'resource-pressure',
        msg:
          gate === 'concurrency'
            ? `task ${task.id} waiting — "${task.assignee}" is deferred by max_concurrent_agents (${running.def.run_config.max_concurrent_agents}) and starts when a slot frees`
            : `task ${task.id} waiting — "${task.assignee}" is deferred by host resource pressure and starts when resources free`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    } else {
      // No live agent and no pending role for this assignee — it doesn't
      // resolve to anything (typo at task-creation time, or the role was
      // removed from the org definition since). Leave the task 'ready'
      // instead of marking it 'running' with no owner: nothing else in this
      // codebase can detect a "running but no owner" task, so it would be
      // silently stuck forever with zero observability.
      // #552: a role the org-wide budget ceiling kept from spawning is known —
      // hold its task with the reason instead.
      if (holdForBudgetClosedAssignee(running, task)) continue;
      running.bus.emit({
        type: 'audit',
        from: 'dag',
        reason: 'dispatch-assignee-unresolved',
        msg: `task ${task.id} not dispatched — assignee "${task.assignee}" does not resolve to a known agent or role`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    }
  }
}
