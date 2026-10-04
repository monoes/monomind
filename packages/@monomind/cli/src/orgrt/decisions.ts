// packages/@monomind/cli/src/orgrt/decisions.ts
// Extracted from daemon.ts — decision gates, decision trace, and task DAG operations.
import { blockRecheckMs } from './block-recheck.js';
import { activeRoleCount, type OrgDaemon } from './daemon.js';
import { dispatchReadyTasks } from './dag-dispatch.js';
import { closedAssignmentRefusal } from './documents/section-budget-run.js';
import { checkLoadoutSelection } from './loadouts.js';
import type { TaskReferences } from './packet.js';
import { buildReviewPacket, reviewDiff } from './review-packet.js';
import { stopCancelledTaskWork } from './task-cancel.js';
import type { TaskPick } from './task-match.js';
import { recordTaskPick } from './task-provenance.js';

export { currentHeadSha, dagCompleteTask, localHeads } from './dag-complete.js';
export {
  DISPATCH_COALESCE_MS,
  dispatchReadyTasks,
  nudgeOpenTasksAtTurnEnd,
  queueDispatch,
} from './dag-dispatch.js';
export {
  createGate,
  gatesFor,
  gatesPath,
  listGates,
  readGates,
  recordDecision,
  resolveGate,
  writeGates,
} from './decision-gates.js';
export { dispatchLine, openTaskCount, recordSkillLoad } from './task-provenance.js';

// ── Task DAG operations ─────────────────────────────────────────────────

export function dagCreateTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  title: string,
  assignee: string,
  deps: string[],
  loadout?: string,
  brief?: string,
  pick?: TaskPick,
  references?: TaskReferences,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  // ADR-O001 D7: the boss SELECTS from the catalog; anything else is refused
  // before a task row exists, so no task can carry an unresolvable loadout.
  const refusal = checkLoadoutSelection(running.def, loadout);
  if (refusal) return JSON.stringify({ error: refusal });
  const closed = closedAssignmentRefusal(running, assignee); // P4.6: its section is at its USD allocation
  if (closed) return JSON.stringify({ error: closed });
  try {
    const task = running.taskDag.add(title, assignee, deps, loadout, brief, references);
    task.createdBy = role;
    recordTaskPick(running, task, role, pick);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-created',
      msg: `task ${task.id} created: "${title}" → ${assignee}`,
      data: {
        taskId: task.id,
        assignee,
        deps,
        status: task.status,
        ...(loadout ? { loadout } : {}),
      },
    });
    if (task.status === 'ready') dispatchReadyTasks(daemon, org, running);
    return JSON.stringify(task);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/** org_tasks: every task, or just `taskId` (its row carries the result and
 *  latest evidence) — the full listing of a long run gets spilled to a file. */
export function dagListTasks(daemon: OrgDaemon, org: string, taskId?: string): string {
  const dag = daemon.orgs.get(org)?.taskDag;
  if (!taskId) return JSON.stringify(dag?.all() ?? [], null, 2);
  const task = dag?.get(taskId);
  return task
    ? JSON.stringify(task, null, 2)
    : JSON.stringify({ error: `task "${taskId}" not found` });
}

export interface PlanTaskSpec {
  name: string;
  title: string;
  assignee: string;
  after?: string[];
  /** ADR-O001 D7: selected catalog loadout, recorded on the created task. */
  loadout?: string;
  /** Instructions sent with the task's dispatch (OrgTask.brief). */
  brief?: string;
  /** Phase 2 packet references (OrgTask.references). */
  references?: TaskReferences;
}

export function dagPlanGraph(
  daemon: OrgDaemon,
  org: string,
  role: string,
  specs: PlanTaskSpec[],
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  // D7: check every selection before creating anything — a half-created plan
  // would be worse than a refused one.
  for (const s of specs) {
    const refusal = checkLoadoutSelection(running.def, s.loadout);
    if (refusal) return JSON.stringify({ error: `spec "${s.name}": ${refusal}` });
    const closed = closedAssignmentRefusal(running, s.assignee); // P4.6
    if (closed) return JSON.stringify({ error: `spec "${s.name}": ${closed}` });
  }
  try {
    const nameToId = new Map<string, string>();
    const created: { name: string; id: string; title: string; assignee: string; status: string }[] =
      [];
    const pending = [...specs];
    let progress = true;
    while (pending.length > 0 && progress) {
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i];
        const afters = s.after ?? [];
        if (!afters.every((a) => nameToId.has(a) || running.taskDag?.get(a))) continue;
        const depIds = afters.map((a) => nameToId.get(a) ?? a);
        const task = running.taskDag.add(
          s.title,
          s.assignee,
          depIds,
          s.loadout,
          s.brief,
          s.references,
        );
        task.createdBy = role;
        nameToId.set(s.name, task.id);
        created.push({
          name: s.name,
          id: task.id,
          title: task.title,
          assignee: task.assignee,
          status: task.status,
        });
        pending.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (pending.length > 0) {
      return JSON.stringify({
        error: `unresolved dependencies in plan: ${pending.map((s) => s.name).join(', ')}`,
        created,
      });
    }
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'plan-graph',
      msg: `planned ${created.length} tasks: ${created.map((c) => `${c.name}→${c.id}`).join(', ')}`,
      data: { count: created.length, tasks: created.map((c) => ({ name: c.name, id: c.id })) },
    });
    dispatchReadyTasks(daemon, org, running);
    return JSON.stringify({ planned: created.length, tasks: created });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export function dagSplitTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  parentId: string,
  children: { title: string; assignee: string }[],
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  for (const c of children) {
    const closed = closedAssignmentRefusal(running, c.assignee); // P4.6
    if (closed) return JSON.stringify({ error: closed });
  }
  try {
    const created = running.taskDag.split(parentId, children);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-split',
      msg: `task ${parentId} split into ${created.map((t) => t.id).join(', ')}`,
      data: { parentId, children: created.map((t) => t.id) },
    });
    dispatchReadyTasks(daemon, org, running);
    return JSON.stringify({
      split: parentId,
      children: created.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export function dagMergeTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  sourceId: string,
  targetId: string,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  try {
    const target = running.taskDag.merge(sourceId, targetId);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-merged',
      msg: `task ${sourceId} merged into ${targetId}`,
      data: { sourceId, targetId },
    });
    dispatchReadyTasks(daemon, org, running);
    return JSON.stringify({
      merged: sourceId,
      into: targetId,
      target: { id: target.id, title: target.title, status: target.status },
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export function dagCancelTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  reason?: string,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  try {
    const task = running.taskDag.get(taskId);
    const priorStatus = task?.status;
    const promoted = running.taskDag.cancel(taskId, reason);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-cancelled',
      msg: `task ${taskId} cancelled${reason ? `: ${reason}` : ''}${promoted.length ? ` — ${promoted.map((t) => t.id).join(', ')} now ready` : ''}`,
      data: { taskId, reason, promoted: promoted.map((t) => t.id) },
    });
    if (task && priorStatus) stopCancelledTaskWork(running, task, role, priorStatus, reason);
    if (promoted.length > 0) dispatchReadyTasks(daemon, org, running);
    return JSON.stringify({
      cancelled: taskId,
      promoted: promoted.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export function dagBlockTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  untilIso: string,
  reason?: string,
  recheckAfterMinutes?: number,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  const untilMs = Date.parse(untilIso);
  if (Number.isNaN(untilMs))
    return JSON.stringify({ error: `"${untilIso}" is not a valid ISO date/time` });
  try {
    const every = blockRecheckMs(
      running.def?.run_config.block_recheck_minutes,
      recheckAfterMinutes,
    );
    const task = running.taskDag.block(taskId, untilMs, reason, every);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-blocked',
      msg: `task ${taskId} blocked until ${new Date(untilMs).toISOString()}${reason ? `: ${reason}` : ''}`,
      data: { taskId, blockedUntil: untilMs, reason },
    });
    return JSON.stringify({
      blocked: taskId,
      until: new Date(untilMs).toISOString(),
      status: task.status,
      nextRecheck: new Date(task.recheckAt ?? untilMs).toISOString(),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/** ADR-O001 D6: hand an artifact-only reviewer a runtime-built packet for
 *  `taskId` — the issue, the runtime's own diff, and the latest submitted
 *  evidence. The caller supplies ids and a ref only, never text, so nothing
 *  the doer wrote about the work reaches the reviewer. */
export function dagRequestReview(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  reviewer: string,
  base = 'main',
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  const target = running.def.roles.find((r) => r.id === reviewer);
  if (target?.review_input !== 'artifact-only') {
    return JSON.stringify({
      error: `org_review refused: "${reviewer}" is not an artifact-only reviewer (review_input: 'artifact-only'). Send ordinary work with org_send or org_task instead.`,
    });
  }
  const task = running.taskDag.get(taskId);
  if (!task) return JSON.stringify({ error: `task "${taskId}" not found` });
  const evidence = task.lastEvidence;
  if (!evidence) {
    return JSON.stringify({
      error: `org_review refused: task ${taskId} has no evidence yet — its assignee submits it with org_task_done (headSha plus the acceptance commands it ran). Without it there is nothing checkable to review.`,
    });
  }
  let agent = running.agents.get(reviewer);
  const pending = running.pendingRoles?.get(reviewer);
  if (!agent && pending) {
    const limit = running.def.run_config.max_concurrent_agents;
    if (limit != null && activeRoleCount(running) >= limit) {
      return JSON.stringify({
        error: `org_review deferred: "${reviewer}" is not running and the org is at max_concurrent_agents (${limit}). Request the review again once a role finishes.`,
      });
    }
    running.pendingRoles?.delete(reviewer);
    running.spawnRole?.(pending);
    agent = running.agents.get(reviewer);
  }
  if (!agent || agent.mailbox.isClosed) {
    return JSON.stringify({ error: `org_review refused: reviewer "${reviewer}" is unavailable` });
  }
  const packet = buildReviewPacket({
    taskId,
    issue: task.title,
    evidence,
    diff: reviewDiff(running.workdir ?? daemon.root, base, evidence.headSha),
    replyTo: role,
    base,
  });
  agent.mailbox.push(packet);
  running.bus.emit({
    type: 'audit',
    from: role,
    to: reviewer,
    reason: 'review-requested',
    msg: `artifact-only review of ${taskId} @ ${evidence.headSha} sent to ${reviewer}`,
    data: { taskId, reviewer, headSha: evidence.headSha, base },
  });
  return JSON.stringify({ requested: taskId, reviewer, headSha: evidence.headSha });
}
