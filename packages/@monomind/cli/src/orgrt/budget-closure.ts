// packages/@monomind/cli/src/orgrt/budget-closure.ts
//
// #343: a role whose budget_usd / budget_tokens runs out has its session
// closed (session.ts, mailbox.close('usd-budget' | 'token-budget')). Tasks
// assigned to it used to stay 'ready' forever behind a bus warning that the
// assignee was "crashed or unreachable", so the coordinator took it for a
// dispatch stall. Here: such tasks are held as 'blocked' with the reason, the
// coordinator is told, a role nearing its budget_usd / budget_tokens (or the
// org nearing run_config.budget_tokens) is flagged, and a hot reload that
// raises the budget reopens the role with its spend kept. The org-wide
// run_config.budget_tokens ceiling lives here too, so a reload that raises it
// reopens the roles it closed and re-arms it at the new value.

import { captureCheckpoint } from './checkpoint.js';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { dispatchReadyTasks, queueDispatch } from './decisions.js';
import { taskTag } from './loadouts.js';
import { isRecoverableCloseReason } from './mailbox.js';
import type { PolicyEngine } from './policy.js';
import { computeReplacementBudget } from './role-slot.js';
import type { OrgTask } from './task-dag.js';
import type { BusEvent } from './types.js';

/** Share of a budget at which the coordinator is warned: once per role per
 *  run for budget_usd and budget_tokens, once per run for run_config.budget_tokens. */
export const BUDGET_WARN_FRACTION = 0.8;

/** Which of the role's own caps it has spent, or undefined when neither. */
function exhaustedDetail(policy: PolicyEngine): string | undefined {
  if (policy.overBudgetUsd)
    return `budget_usd exhausted ($${policy.usageUsd.toFixed(2)} / $${policy.policy.maxUsd})`;
  if (policy.overBudget)
    return `budget_tokens exhausted (${policy.budgetedUsage} / ${policy.policy.maxTokens})`;
  return undefined;
}

/** The run's spend against run_config.budget_tokens: every live session on
 *  the budgeted basis (ADR-O001 D1), plus what replaced incarnations retired
 *  into their slot (role-slot.ts / respawnRole) — a replacement must not reset
 *  the org's spend. */
export function orgBudgetedUsage(running: RunningOrg): number {
  let used = 0;
  for (const rt of running.agents.values()) used += rt.policy.budgetedUsage;
  for (const slot of running.roleSlots.values()) used += slot.retiredUsage.tokens;
  return used;
}

const orgDetail = (running: RunningOrg): string =>
  `org-wide budget_tokens exhausted (${orgBudgetedUsage(running)} / ${running.def.run_config.budget_tokens})`;

/** Why `roleId`'s session is closed for budget, or undefined when it is not.
 *  A role closed by the org-wide run_config.budget_tokens ceiling carries the
 *  same close reason without being over its own caps. */
export function budgetClosureDetail(running: RunningOrg, roleId: string): string | undefined {
  const rt = running.agents.get(roleId);
  if (!rt?.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) return undefined;
  const own = exhaustedDetail(rt.policy);
  if (own) return own;
  if (running.orgBudgetClosed?.has(roleId)) return orgDetail(running);
  return running.budgetClosed?.has(roleId)
    ? 'budget exhausted'
    : 'org-wide budget_tokens exhausted';
}

const holdReason = (roleId: string, detail: string): string =>
  `assignee "${roleId}" closed: ${detail}`;

const ORG_REMEDY =
  "Raise run_config.budget_tokens in the org definition and hot-reload it (`monomind org reload`) — the closed roles reopen with the run's spend so far kept.";

const remedy = (running: RunningOrg, roleId: string): string =>
  running.orgBudgetClosed?.has(roleId) && !exhaustedDetail(running.agents.get(roleId)!.policy)
    ? `${ORG_REMEDY} Or reassign the work to another role.`
    : `Raise budget_usd / budget_tokens for "${roleId}" in the org definition and hot-reload it (\`monomind org reload\`) — the role reopens with its spend so far kept — or reassign the work to another role.`;

/** Hold `roleId`'s open tasks — one it was working would otherwise sit
 *  'running' with no one on it. */
function holdOpenTasks(running: RunningOrg, roleId: string, detail: string): OrgTask[] {
  const held: OrgTask[] = [];
  for (const t of running.taskDag?.all() ?? []) {
    if (t.assignee !== roleId || (t.status !== 'ready' && t.status !== 'running')) continue;
    held.push(running.taskDag!.holdForAssignee(t.id, holdReason(roleId, detail)));
  }
  return held;
}

/** Re-word `roleId`'s budget-held tasks with the current numbers. */
function refreshHolds(running: RunningOrg, roleId: string): void {
  const detail = budgetClosureDetail(running, roleId);
  if (!detail) return;
  for (const t of running.taskDag?.all() ?? []) {
    if (t.assignee === roleId && t.status === 'blocked' && t.heldForAssignee)
      running.taskDag?.holdForAssignee(t.id, holdReason(roleId, detail));
  }
}

/** Tell the coordinator (or `preferred`, e.g. the task's creator) — never the
 *  closed role itself. Uses the same coalesced dispatch as task notices. */
function notify(running: RunningOrg, closedRole: string, line: string, preferred?: string): void {
  const to = preferred && preferred !== closedRole ? preferred : running.bossRoleId;
  if (!to || to === closedRole) return;
  queueDispatch(running, to, line);
}

/** Bus hook (daemon.ts's org subscriber): enforce the org-wide ceiling, note
 *  a per-role budget closure and warn on the approach to a budget. */
export function onBudgetBusEvent(running: RunningOrg, e: BusEvent): void {
  if (e.type === 'usage') enforceOrgBudget(running);
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
  const held = holdOpenTasks(running, roleId, detail);
  const tasks = held.length
    ? ` Its open task(s) are now blocked: ${held.map((t) => `${t.id} ("${t.title}")`).join(', ')}.`
    : '';
  notify(
    running,
    roleId,
    `[budget] "${roleId}" was closed: ${detail}. Tasks assigned to it stay blocked until its budget is raised.${tasks} ${remedy(running, roleId)}`,
  );
}

/** Bus 'usage' hook: run_config.budget_tokens is an org-wide ceiling, not
 *  just a per-role one — a role's explicit budget_tokens override lets IT
 *  spend more without raising what every other role can spend. Once the run's
 *  total reaches it, close every open mailbox, stop lazy-spawning roles and
 *  hold the closed roles' tasks. Recorded on the running org, so a reload that
 *  raises the ceiling can reopen them and re-arm it (reopenOrgBudgetClosedRoles). */
function enforceOrgBudget(running: RunningOrg): void {
  const cap = running.def.run_config.budget_tokens;
  if (cap == null || running.orgBudgetClosed) return;
  const used = orgBudgetedUsage(running);
  if (used < cap) {
    warnApproach(running, {
      key: 'run_config.budget_tokens',
      budget: 'run_config.budget_tokens',
      line: `the org has used ${used} of its ${cap} run_config.budget_tokens`,
      spent: used,
      cap,
      consequence: `At the ceiling every role's session closes and their tasks are blocked. ${ORG_REMEDY}`,
      data: { spentTokens: used, budgetTokens: cap },
    });
    return;
  }
  const closed = new Set<string>();
  running.orgBudgetClosed = closed;
  if (running.pendingRoles?.size) {
    // prevent lazy spawns after the org budget is exhausted; put back on reopen
    running.orgBudgetPendingRoles = new Map(running.pendingRoles);
    running.pendingRoles.clear();
  }
  for (const [roleId, rt] of running.agents) {
    if (rt.mailbox.isClosed) continue;
    rt.mailbox.close('token-budget');
    closed.add(roleId);
  }
  running.bus.emit({
    type: 'status',
    reason: 'org-budget-exhausted',
    msg: `org-wide token budget exhausted (${used}/${cap}) — closing all roles`,
  });
  for (const roleId of closed) holdOpenTasks(running, roleId, orgDetail(running));
}

function warnNearBudget(running: RunningOrg, roleId: string): void {
  const policy = running.agents.get(roleId)?.policy;
  if (!policy) return;
  const { maxUsd, maxTokens } = policy.policy;
  const consequence = `At the cap its session closes and tasks assigned to it are blocked. ${remedy(running, roleId)}`;
  if (maxUsd != null) {
    const spent = policy.usageUsd;
    warnApproach(running, {
      key: `${roleId}:budget_usd`,
      roleId,
      budget: 'budget_usd',
      line: `"${roleId}" has spent $${spent.toFixed(2)} of its $${maxUsd} budget_usd`,
      spent,
      cap: maxUsd,
      consequence,
      data: { spentUsd: spent, budgetUsd: maxUsd },
    });
  }
  if (maxTokens != null) {
    const spent = policy.budgetedUsage;
    warnApproach(running, {
      key: `${roleId}:budget_tokens`,
      roleId,
      budget: 'budget_tokens',
      line: `"${roleId}" has used ${spent} of its ${maxTokens} budget_tokens`,
      spent,
      cap: maxTokens,
      consequence,
      data: { spentTokens: spent, budgetTokens: maxTokens },
    });
  }
}

/** Once per `key` per run, between BUDGET_WARN_FRACTION and the cap (at or
 *  over it the closure notice says it instead): a `budget-warning` audit event
 *  naming the budget, and a notice to the coordinator. */
function warnApproach(
  running: RunningOrg,
  w: {
    key: string;
    roleId?: string;
    budget: 'budget_usd' | 'budget_tokens' | 'run_config.budget_tokens';
    line: string;
    spent: number;
    cap: number;
    consequence: string;
    data: Record<string, number>;
  },
): void {
  if (running.budgetWarned?.has(w.key)) return;
  if (w.cap <= 0 || w.spent < w.cap * BUDGET_WARN_FRACTION || w.spent >= w.cap) return;
  (running.budgetWarned ??= new Set()).add(w.key);
  const pct = Math.round((w.spent / w.cap) * 100);
  running.bus.emit({
    type: 'audit',
    ...(w.roleId ? { from: w.roleId } : {}),
    reason: 'budget-warning',
    msg: `${w.line} (${pct}%)`,
    data: { ...(w.roleId ? { roleId: w.roleId } : {}), budget: w.budget, ...w.data },
  });
  notify(running, w.roleId ?? '', `[budget] ${w.line} (${pct}%). ${w.consequence}`);
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
    `${taskTag(task)} BLOCKED — "${task.title}" was not dispatched: ${reason}. ${remedy(running, task.assignee)}`,
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

/** Before a reload changes the def: the live roles whose token cap is the one
 *  the def gives them (their own budget_tokens, policy.maxTokens or their even
 *  split of run_config.budget_tokens) — not a replacement's explicit budget. */
export function rolesOnDefTokenCaps(running: RunningOrg): Set<string> {
  const onDef = new Set<string>();
  for (const [roleId, rt] of running.agents) {
    const cap = defTokenCap(running, roleId);
    if (cap !== undefined && rt.policy.policy.maxTokens === cap) onDef.add(roleId);
  }
  return onDef;
}

function defTokenCap(running: RunningOrg, roleId: string): number | undefined {
  const role = running.def.roles.find((r) => r.id === roleId);
  if (!role) return undefined;
  return role.policy?.maxTokens ?? computeReplacementBudget(running.def, roleId);
}

/** After a reload: give each of `onDef`'s live roles the token cap the new def
 *  gives it — a changed run_config.budget_tokens, or one role taking its own
 *  budget_tokens, moves every even-split role's share. */
function reapplyDefTokenCaps(running: RunningOrg, onDef: Set<string>): void {
  for (const roleId of onDef) {
    const policy = running.agents.get(roleId)?.policy;
    const cap = defTokenCap(running, roleId);
    if (!policy || cap === undefined || policy.policy.maxTokens === cap) continue;
    policy.setBudgetCaps({ maxTokens: cap, maxUsd: policy.policy.maxUsd });
  }
}

/** Resume `roleId` the way a checkpoint resume does (a budget close is
 *  recoverable, so the new mailbox opens), one generation on, with its spend
 *  kept. False when it could not be spawned; the closed runtime stays. */
function respawnFromCheckpoint(running: RunningOrg, roleId: string): boolean {
  const rt = running.agents.get(roleId);
  const role = running.def.roles.find((r) => r.id === roleId);
  if (!rt || !role || !running.spawnRole) return false;
  const rc = captureCheckpoint(running).roleState[roleId];
  running.agents.delete(roleId);
  running.spawnRole(role, { ...rc, generation: rc.generation + 1, status: 'running' });
  const next = running.agents.get(roleId);
  if (!next) {
    running.agents.set(roleId, rt);
    return false;
  }
  next.policy.setTokenUsage(rt.policy.tokenUsage);
  next.policy.setUsageUsd(rt.policy.usageUsd);
  return true;
}

/** After a reload: when the run's spend is now under run_config.budget_tokens,
 *  re-arm the ceiling at the new value and reopen the roles it closed (a role
 *  also over its own cap moves to the per-role path). Otherwise they stay
 *  closed and their held tasks get the new numbers. */
function reopenOrgBudgetClosedRoles(running: RunningOrg): string[] {
  const closed = running.orgBudgetClosed;
  if (!closed) return [];
  const cap = running.def.run_config.budget_tokens;
  const used = orgBudgetedUsage(running);
  if (cap != null && used >= cap) {
    for (const roleId of closed) refreshHolds(running, roleId);
    return [];
  }
  running.orgBudgetClosed = undefined;
  if (running.orgBudgetPendingRoles) {
    running.pendingRoles ??= new Map();
    for (const [id, role] of running.orgBudgetPendingRoles)
      if (!running.agents.has(id)) running.pendingRoles.set(id, role);
    running.orgBudgetPendingRoles = undefined;
  }
  const reopened: string[] = [];
  for (const roleId of closed) {
    const rt = running.agents.get(roleId);
    if (!rt?.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) continue;
    if (exhaustedDetail(rt.policy)) (running.budgetClosed ??= new Set()).add(roleId);
    else if (respawnFromCheckpoint(running, roleId)) reopened.push(roleId);
  }
  running.bus.emit({
    type: 'audit',
    reason: 'org-budget-reopened',
    msg: `run_config.budget_tokens raised to ${cap ?? 'none'} (${used} used so far)${reopened.length ? ` — reopened ${reopened.join(', ')}` : ''}`,
    data: { spentTokens: used, budgetTokens: cap ?? null, reopened },
  });
  return reopened;
}

/** After a hot reload applied new caps: re-derive the token caps of `onDef`'s
 *  roles (rolesOnDefTokenCaps, taken before the def changed), reopen the roles
 *  the org-wide ceiling closed if it now allows, then reopen each role closed
 *  for its own budget that is no longer over it, keeping its spend (the new
 *  cap applies to the total), and re-dispatch their tasks. A role still over
 *  its cap stays closed; its held tasks get the new numbers in their reason. */
export function reopenBudgetClosedRoles(
  daemon: OrgDaemon,
  org: string,
  running: RunningOrg,
  onDef: Set<string> = new Set(),
): string[] {
  reapplyDefTokenCaps(running, onDef);
  const reopened = reopenOrgBudgetClosedRoles(running);
  for (const roleId of [...(running.budgetClosed ?? [])]) {
    const rt = running.agents.get(roleId);
    const role = running.def.roles.find((r) => r.id === roleId);
    if (!rt || !role || !running.spawnRole) continue;
    if (!rt.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) {
      running.budgetClosed?.delete(roleId);
      continue;
    }
    if (exhaustedDetail(rt.policy)) {
      refreshHolds(running, roleId);
      continue;
    }
    if (!respawnFromCheckpoint(running, roleId)) continue;
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
