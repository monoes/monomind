// packages/@monomind/cli/src/orgrt/budget-closure.ts
//
// #343: a role whose budget_usd / budget_tokens runs out has its session
// closed (session.ts, mailbox.close('usd-budget' | 'token-budget')). Tasks
// assigned to it used to stay 'ready' forever behind a bus warning that the
// assignee was "crashed or unreachable", so the coordinator took it for a
// dispatch stall. Here: such tasks are held as 'blocked' with the reason, the
// coordinator is told, a role nearing its budget_usd is flagged, and a hot
// reload that raises the budget reopens the role with its spend kept.

import { captureCheckpoint } from './checkpoint.js';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { dispatchReadyTasks, queueDispatch } from './decisions.js';
import { taskTag } from './loadouts.js';
import { isRecoverableCloseReason } from './mailbox.js';
import type { PolicyEngine } from './policy.js';
import type { OrgTask } from './task-dag.js';
import type { BusEvent } from './types.js';

/** Share of budget_usd at which the coordinator is warned, once per role per run. */
export const BUDGET_WARN_FRACTION = 0.8;

/** Which of the role's own caps it has spent, or undefined when neither. */
function exhaustedDetail(policy: PolicyEngine): string | undefined {
  if (policy.overBudgetUsd)
    return `budget_usd exhausted ($${policy.usageUsd.toFixed(2)} / $${policy.policy.maxUsd})`;
  if (policy.overBudget)
    return `budget_tokens exhausted (${policy.budgetedUsage} / ${policy.policy.maxTokens})`;
  return undefined;
}

/** Why `roleId`'s session is closed for budget, or undefined when it is not.
 *  A role closed by the org-wide run_config.budget_tokens ceiling carries the
 *  same close reason without being over its own caps. */
export function budgetClosureDetail(running: RunningOrg, roleId: string): string | undefined {
  const rt = running.agents.get(roleId);
  if (!rt?.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) return undefined;
  return (
    exhaustedDetail(rt.policy) ??
    (running.budgetClosed?.has(roleId) ? 'budget exhausted' : 'org-wide budget_tokens exhausted')
  );
}

const holdReason = (roleId: string, detail: string): string =>
  `assignee "${roleId}" closed: ${detail}`;

const remedy = (roleId: string): string =>
  `Raise budget_usd / budget_tokens for "${roleId}" in the org definition and hot-reload it (\`monomind org reload\`) — the role reopens with its spend so far kept — or reassign the work to another role.`;

/** Tell the coordinator (or `preferred`, e.g. the task's creator) — never the
 *  closed role itself. Uses the same coalesced dispatch as task notices. */
function notify(running: RunningOrg, closedRole: string, line: string, preferred?: string): void {
  const to = preferred && preferred !== closedRole ? preferred : running.bossRoleId;
  if (!to || to === closedRole) return;
  queueDispatch(running, to, line);
}

/** Bus hook (daemon.ts's org subscriber): note a per-role budget closure and
 *  warn on the approach to budget_usd. */
export function onBudgetBusEvent(running: RunningOrg, e: BusEvent): void {
  if (!e.from) return;
  if (e.type === 'status' && e.reason === 'budget-exhausted') noteBudgetClosure(running, e.from);
  else if (e.type === 'usage') warnNearBudget(running, e.from);
}

/** The role's session is about to close for budget (session.ts emits the
 *  status event right before mailbox.close). Hold its open tasks — one it was
 *  working would otherwise sit 'running' with no one on it — and tell the
 *  coordinator. Both caps can trip in one turn: noted once. */
function noteBudgetClosure(running: RunningOrg, roleId: string): void {
  const rt = running.agents.get(roleId);
  if (!rt || !running.taskDag) return;
  if (running.budgetClosed?.has(roleId) && rt.mailbox.isClosed) return;
  (running.budgetClosed ??= new Set()).add(roleId);
  const detail = exhaustedDetail(rt.policy) ?? 'budget exhausted';
  const held: OrgTask[] = [];
  for (const t of running.taskDag.all()) {
    if (t.assignee !== roleId || (t.status !== 'ready' && t.status !== 'running')) continue;
    held.push(running.taskDag.holdForAssignee(t.id, holdReason(roleId, detail)));
  }
  const tasks = held.length
    ? ` Its open task(s) are now blocked: ${held.map((t) => `${t.id} ("${t.title}")`).join(', ')}.`
    : '';
  notify(
    running,
    roleId,
    `[budget] "${roleId}" was closed: ${detail}. Tasks assigned to it stay blocked until its budget is raised.${tasks} ${remedy(roleId)}`,
  );
}

function warnNearBudget(running: RunningOrg, roleId: string): void {
  const policy = running.agents.get(roleId)?.policy;
  const cap = policy?.policy.maxUsd;
  if (!policy || cap == null || running.budgetWarned?.has(roleId)) return;
  const spent = policy.usageUsd;
  // At or over the cap the closure notice says it instead.
  if (spent < cap * BUDGET_WARN_FRACTION || spent >= cap) return;
  (running.budgetWarned ??= new Set()).add(roleId);
  const pct = Math.round((spent / cap) * 100);
  running.bus.emit({
    type: 'audit',
    from: roleId,
    reason: 'budget-warning',
    msg: `"${roleId}" has spent $${spent.toFixed(2)} of its $${cap} budget_usd (${pct}%)`,
    data: { roleId, spentUsd: spent, budgetUsd: cap },
  });
  notify(
    running,
    '',
    `[budget] "${roleId}" has spent $${spent.toFixed(2)} of its $${cap} budget_usd (${pct}%). At the cap its session closes and tasks assigned to it are blocked. ${remedy(roleId)}`,
  );
}

/** dispatchReadyTasks, for a task whose assignee's mailbox is closed: when it
 *  was closed for budget, hold the task with the reason, warn, tell the task's
 *  creator (or the coordinator) and return true. The task leaves 'ready', so
 *  this happens once per task. */
export function holdForBudgetClosedAssignee(running: RunningOrg, task: OrgTask): boolean {
  const detail = budgetClosureDetail(running, task.assignee);
  if (!detail || !running.taskDag) return false;
  const reason = holdReason(task.assignee, detail);
  running.taskDag.holdForAssignee(task.id, reason);
  running.bus.emit({
    type: 'audit',
    from: 'dag',
    reason: 'dispatch-recipient-unavailable',
    msg: `task ${task.id} not dispatched — assignee "${task.assignee}" budget exhausted (${detail}); task blocked`,
    data: { taskId: task.id, assignee: task.assignee, blockedReason: reason },
  });
  notify(
    running,
    task.assignee,
    `${taskTag(task)} BLOCKED — "${task.title}" was not dispatched: ${reason}. ${remedy(task.assignee)}`,
    task.createdBy,
  );
  return true;
}

/** Put every budget-held task whose assignee is no longer budget-closed back
 *  to 'ready' — after a reload reopened it, a respawn replaced it, or a resume
 *  left its recoverable close open. Called at the top of dispatchReadyTasks. */
export function releaseBudgetHolds(running: RunningOrg): void {
  if (!running.taskDag) return;
  for (const t of running.taskDag.all()) {
    if (t.status !== 'blocked' || !t.heldForAssignee) continue;
    if (budgetClosureDetail(running, t.assignee) === undefined)
      running.taskDag.releaseAssigneeHold(t.id);
  }
}

/** After a hot reload applied new caps: reopen each role closed for its own
 *  budget that is no longer over it, keeping its spend (the new cap applies
 *  to the total), and re-dispatch its tasks. A role still over its cap stays
 *  closed; its held tasks get the new numbers in their reason. */
export function reopenBudgetClosedRoles(
  daemon: OrgDaemon,
  org: string,
  running: RunningOrg,
): string[] {
  const reopened: string[] = [];
  for (const roleId of [...(running.budgetClosed ?? [])]) {
    const rt = running.agents.get(roleId);
    const role = running.def.roles.find((r) => r.id === roleId);
    if (!rt || !role || !running.spawnRole) continue;
    if (!rt.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) {
      running.budgetClosed?.delete(roleId);
      continue;
    }
    const detail = exhaustedDetail(rt.policy);
    if (detail) {
      for (const t of running.taskDag?.all() ?? []) {
        if (t.assignee === roleId && t.status === 'blocked' && t.heldForAssignee)
          running.taskDag?.holdForAssignee(t.id, holdReason(roleId, detail));
      }
      continue;
    }
    // Resume the role the way a checkpoint resume does (a budget close is
    // recoverable, so the new mailbox opens), one generation on.
    const rc = captureCheckpoint(running).roleState[roleId];
    running.agents.delete(roleId);
    running.spawnRole(role, { ...rc, generation: rc.generation + 1, status: 'running' });
    const next = running.agents.get(roleId);
    if (!next) {
      running.agents.set(roleId, rt);
      continue;
    }
    next.policy.setTokenUsage(rt.policy.tokenUsage);
    next.policy.setUsageUsd(rt.policy.usageUsd);
    running.budgetClosed?.delete(roleId);
    reopened.push(roleId);
    running.bus.emit({
      type: 'audit',
      from: roleId,
      reason: 'role-budget-reopened',
      msg: `"${roleId}" reopened after its budget was raised ($${rt.policy.usageUsd.toFixed(2)} spent so far${role.budget_usd != null ? ` / $${role.budget_usd}` : ''})`,
      data: { roleId, spentUsd: rt.policy.usageUsd, budgetUsd: role.budget_usd ?? null },
    });
  }
  if (reopened.length) dispatchReadyTasks(daemon, org, running);
  return reopened;
}
