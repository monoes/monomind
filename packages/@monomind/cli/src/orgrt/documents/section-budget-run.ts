// orgrt/documents/section-budget-run.ts
//
// Section budget notices and soft closure at run time (org sections plan P4.6; open item 28). Everything here is
// off unless the run has a documents runtime (the sections surface) AND a section budget or `run_config.budget_usd`
// is declared: the evaluator returns at once, so a sections-off org and a sections-on org with no USD budget are
// untouched.
//
// What happens, on each `usage` bus event (the spend snapshot is the corrected one of P4.5: each role's live
// `metrics.costUsd` plus what replaced incarnations retired, through `allocationStatus`):
//  - a section, the root reserve or the org crossing 80 percent of its allocation: one `section-budget-warning`
//    audit event and one durable notice to the section lead and the root (section-budget-notice.ts);
//  - at 100 percent the scope is SOFT-CLOSED: its open mailboxes close with the recoverable reason `usd-budget`
//    (a running session finishes its turn, nothing new is read), its unspawned roles are set aside, its open
//    tasks are held with the reason, new `org_task` / `org_plan_graph` / split assignments into it are refused,
//    the lead and the root are told once, and the closure is recorded in `running.sectionBudget`;
//  - a reload that raises the allocation reopens the scope, with spend kept (`reopenSectionClosures`, called where
//    budget-closure.ts reopens the other budget closures); a reload that lowers it under the spend closes it at
//    once. Nothing is persisted but the notice journal: the closure is re-derived from the spend at the first
//    usage event after a resume (and at start).
// The closure is a backstop and an individual soft stop, never a hard cap: no session is killed.
import {
  exhaustedDetail,
  holdTasksForBudget,
  refreshHolds,
  respawnFromCheckpoint,
} from '../budget-closure.js';
import type { OrgDaemon, RunningOrg } from '../daemon.js';
import { queueDispatch } from '../decisions.js';
import { isRecoverableCloseReason } from '../mailbox.js';
import type { BusEvent, OrgRole } from '../types.js';
import { RUNTIME_SENDER } from './deliver.js';
import { leadFor, sectionLead } from './lead-rules.js';
import { rootRoleId } from './routing.js';
import {
  KIND_BUDGET_CLOSED,
  KIND_BUDGET_WARNING,
  SectionBudgetNotices,
} from './section-budget-notice.js';
import { liveSectionBudgetStatus } from './section-budget-report.js';
import {
  assignmentRefusal,
  closureDetail,
  closureNotice,
  closureRemedy,
  roleWarningCopy,
  type ScopeText,
  scopeLabel,
  usd,
  warningNotice,
} from './section-budget-text.js';
import { sectionBudgetsApply } from './section-budget-wire.js';

type AllocationStatus = NonNullable<ReturnType<typeof liveSectionBudgetStatus>>;
type GroupStatus = AllocationStatus['org'];

/** One closed scope: a section, the root reserve or the org. */
export interface ClosedScope extends ScopeText {
  key: string;
  /** Every role the scope covers when it closed. */
  members: Set<string>;
  /** The roles this closure closed (their mailbox was open); the others were closed already or never started. */
  closedRoles: Set<string>;
  /** Roles not yet spawned, set aside from `pendingRoles` and `deferredSpawns` (put back when it reopens). */
  pending: Map<string, OrgRole>;
  detail: string;
}

export interface SectionBudgetState {
  notices: SectionBudgetNotices;
  closed: Map<string, ClosedScope>;
}

interface Scope extends ScopeText {
  key: string;
  g: GroupStatus;
  members: string[];
  recipients: string[];
}

/** The scopes with an allocation, from a status: each allocated section, the reserve, the org. */
function scopesOf(running: RunningOrg, status: AllocationStatus): Scope[] {
  const root = rootRoleId(running.def) ?? running.bossRoleId;
  const leads = status.sections
    .map((s) => sectionLead(running.def, s.name))
    .filter((x): x is string => !!x);
  const base = (g: GroupStatus): Pick<ScopeText, 'spentUsd' | 'allocationUsd'> => ({
    spentUsd: g.spentUsd,
    allocationUsd: g.allocationUsd as number,
  });
  const out: Scope[] = [];
  for (const s of status.sections) {
    if (s.allocationUsd === undefined) continue;
    const lead = sectionLead(running.def, s.name);
    out.push({
      key: `section:${s.name}`,
      kind: 'section',
      name: s.name,
      g: s,
      ...base(s),
      members: s.roles.map((r) => r.roleId),
      recipients: [...(lead ? [lead] : []), root],
    });
  }
  if (status.reserve.allocationUsd !== undefined)
    out.push({
      key: 'reserve',
      kind: 'reserve',
      g: status.reserve,
      ...base(status.reserve),
      members: status.reserve.roles.map((r) => r.roleId),
      recipients: [root],
    });
  if (status.org.allocationUsd !== undefined)
    out.push({
      key: 'org',
      kind: 'org',
      g: status.org,
      ...base(status.org),
      members: [...status.sections.flatMap((s) => s.roles), ...status.reserve.roles].map(
        (r) => r.roleId,
      ),
      recipients: [root, ...leads],
    });
  return out;
}

const textOf = (c: Pick<ScopeText, 'kind' | 'name' | 'spentUsd' | 'allocationUsd'>): ScopeText => ({
  kind: c.kind,
  ...(c.name !== undefined ? { name: c.name } : {}),
  spentUsd: c.spentUsd,
  allocationUsd: c.allocationUsd,
});

/** Bind the section budget runtime to a started org: the notice journal, its delivery path and the usage hook.
 *  Nothing happens for an org without a documents runtime. */
export function bindSectionBudget(daemon: OrgDaemon, name: string, running: RunningOrg): void {
  if (!running.documents) return;
  const notices = new SectionBudgetNotices(running.documents.dir);
  running.sectionBudget = { notices, closed: new Map() };
  notices.start({
    deliver: (to, subject, body) => daemon.deliver(name, RUNTIME_SENDER, to, subject, body),
    emit: (e) => running.bus.emit({ type: 'audit', from: RUNTIME_SENDER, ...e }),
  });
  running.bus.subscribe((e: BusEvent) => {
    if (e.type === 'usage') evaluateSectionBudgets(running);
    else if (e.type === 'audit' && e.reason === 'budget-warning') copyRoleWarningToLead(running, e);
  });
  evaluateSectionBudgets(running); // a resume with the spend already past an allocation closes it now
}

/** A role's own 80 percent warning also goes to its section lead, unless the lead is the spender or already the
 *  one told (the coordinator). Only where section budgets apply. */
function copyRoleWarningToLead(running: RunningOrg, e: BusEvent): void {
  const roleId = (e.data as { roleId?: string } | undefined)?.roleId;
  if (!roleId || !sectionBudgetsApply(running.def)) return;
  const lead = leadFor(running.def, roleId, running.bossRoleId);
  if (lead === roleId || lead === running.bossRoleId) return;
  queueDispatch(running, lead, roleWarningCopy(e.msg ?? `"${roleId}" is near a budget`));
}

/** The status of the run's spend against its allocations, or undefined when none apply. */
function statusOf(running: RunningOrg): AllocationStatus | undefined {
  return running.sectionBudget ? liveSectionBudgetStatus(running) : undefined;
}

/** The usage hook: warn at 80 percent, close at 100, retry undelivered notices, keep a closed scope closed. */
export function evaluateSectionBudgets(running: RunningOrg): void {
  const st = running.sectionBudget;
  const status = statusOf(running);
  if (!st || !status) return;
  void st.notices.retry();
  recloseStragglers(running, st);
  for (const sc of scopesOf(running, status)) {
    // A role being replaced is counted twice between role-respawn.ts retiring its spend and publishing the
    // replacement (the old incarnation is still in `agents`): judge the scope at the next usage event instead.
    if (sc.members.some((id) => running.respawning.has(id))) continue;
    if (sc.g.state === 'warn') warn(running, st, sc);
    else if (sc.g.state === 'closed' && !st.closed.has(sc.key)) closeScope(running, st, sc);
  }
}

function warn(running: RunningOrg, st: SectionBudgetState, sc: Scope): void {
  const text = warningNotice(sc);
  const isNew = st.notices.owe({
    crossing: `warn:${sc.key}:${sc.allocationUsd}`,
    kind: KIND_BUDGET_WARNING,
    scope: sc.key,
    recipients: sc.recipients,
    ...text,
  });
  if (!isNew) return;
  running.bus.emit({
    type: 'audit',
    reason: 'section-budget-warning',
    msg: `${scopeLabel(sc)} has spent ${usd(sc.spentUsd)} of its ${usd(sc.allocationUsd)} USD allocation (${Math.round((sc.spentUsd / sc.allocationUsd) * 100)}%)`,
    data: {
      scope: sc.key,
      spentUsd: sc.spentUsd,
      allocationUsd: sc.allocationUsd,
      fraction: sc.g.fraction ?? null,
    },
  });
}

/** Soft-close one scope. */
function closeScope(running: RunningOrg, st: SectionBudgetState, sc: Scope): void {
  const entry: ClosedScope = {
    ...textOf(sc),
    key: sc.key,
    members: new Set(sc.members),
    closedRoles: new Set(),
    pending: new Map(),
    detail: closureDetail(sc),
  };
  st.closed.set(sc.key, entry);
  const held = (running.taskDag?.all() ?? [])
    .filter(
      (t) => entry.members.has(t.assignee) && (t.status === 'ready' || t.status === 'running'),
    )
    .map((t) => t.id);
  const cancelled: string[] = [];
  for (const id of sc.members) {
    const rt = running.agents.get(id);
    if (rt) {
      if (!rt.mailbox.isClosed) {
        rt.mailbox.close('usd-budget');
        entry.closedRoles.add(id);
      }
      continue;
    }
    const role = running.pendingRoles?.get(id) ?? running.deferredSpawns?.get(id)?.role;
    if (!role) continue;
    entry.pending.set(id, role);
    running.pendingRoles?.delete(id);
    if (running.deferredSpawns?.delete(id)) cancelled.push(id);
  }
  for (const id of sc.members) holdTasksForBudget(running, id, entry.detail);
  const root = rootRoleId(running.def) ?? running.bossRoleId;
  const rootClosed = entry.members.has(root);
  running.bus.emit({
    type: 'audit',
    reason: 'section-budget-closed',
    msg: `${scopeLabel(sc)} soft-closed: ${usd(sc.spentUsd)} of its ${usd(sc.allocationUsd)} USD allocation (${[...entry.closedRoles].join(', ') || 'no open role'} closed; ${held.length} task(s) held)`,
    data: {
      scope: sc.key,
      spentUsd: sc.spentUsd,
      allocationUsd: sc.allocationUsd,
      closed: [...entry.closedRoles],
      held,
    },
  });
  // The root closed: the human sees the existing org-budget status event (the CLI run-end line and the
  // dashboard already show it); no new channel.
  if (rootClosed)
    running.bus.emit({
      type: 'status',
      reason: 'org-budget-exhausted',
      msg: `${scopeLabel(sc)} USD allocation exhausted (${usd(sc.spentUsd)}/${usd(sc.allocationUsd)}) — the root is closed`,
    });
  for (const id of cancelled)
    running.bus.emit({
      type: 'audit',
      from: id,
      reason: 'deferred-spawn-cancelled',
      msg: `cancelled the deferred spawn of "${id}": ${entry.detail}`,
      data: { roleId: id },
    });
  st.notices.owe({
    crossing: `closed:${sc.key}:${sc.allocationUsd}`,
    kind: KIND_BUDGET_CLOSED,
    scope: sc.key,
    recipients: sc.recipients,
    ...closureNotice(sc, sc.members, held),
  });
}

/** A role replaced while its scope is closed starts with an open mailbox: close it again at the next usage event. */
function recloseStragglers(running: RunningOrg, st: SectionBudgetState): void {
  for (const c of st.closed.values())
    for (const id of c.members) {
      const rt = running.agents.get(id);
      if (rt && !rt.mailbox.isClosed) {
        rt.mailbox.close('usd-budget');
        c.closedRoles.add(id);
      }
    }
}

/** Why a role is closed for the scope it belongs to, or undefined (budget-closure.ts `budgetClosureDetail`). */
export function sectionClosureDetail(running: RunningOrg, roleId: string): string | undefined {
  for (const c of running.sectionBudget?.closed.values() ?? [])
    if (c.members.has(roleId)) return c.detail;
  return undefined;
}

/** What to tell the closed role's task creator to do (budget-closure.ts `remedy`). */
export function sectionClosureRemedy(running: RunningOrg, roleId: string): string | undefined {
  for (const c of running.sectionBudget?.closed.values() ?? [])
    if (c.members.has(roleId)) return closureRemedy(c);
  return undefined;
}

/** The refusal of a new assignment to `assignee`, or undefined when its scope is open. */
export function closedAssignmentRefusal(running: RunningOrg, assignee: string): string | undefined {
  for (const c of running.sectionBudget?.closed.values() ?? [])
    if (c.members.has(assignee)) return assignmentRefusal(c, assignee);
  return undefined;
}

/** After a reload: reopen each closed scope that is no longer at its allocation (spend kept), re-word the holds of
 *  the ones still closed, then close any scope the new allocation is already under. Returns the roles that need
 *  their held tasks dispatched again. */
export function reopenSectionClosures(running: RunningOrg): string[] {
  const st = running.sectionBudget;
  if (!st) return [];
  const status = statusOf(running);
  const fresh = new Map((status ? scopesOf(running, status) : []).map((sc) => [sc.key, sc]));
  const touched: string[] = [];
  for (const [key, c] of [...st.closed]) {
    const sc = fresh.get(key);
    if (sc?.g.state === 'closed') {
      Object.assign(c, textOf(sc), { detail: closureDetail(sc) });
      for (const id of c.members) refreshHolds(running, id);
      continue;
    }
    st.closed.delete(key);
    const elsewhere = (id: string): ClosedScope | undefined =>
      [...st.closed.values()].find((o) => o.members.has(id));
    for (const [id, role] of c.pending) {
      const other = elsewhere(id);
      if (other) other.pending.set(id, role);
      else if (!running.agents.has(id)) (running.pendingRoles ??= new Map()).set(id, role);
      touched.push(id);
    }
    for (const id of c.closedRoles) {
      const other = elsewhere(id);
      if (other) {
        other.closedRoles.add(id);
        continue;
      }
      const rt = running.agents.get(id);
      if (!rt?.mailbox.isClosed || !isRecoverableCloseReason(rt.mailbox.closeReason)) continue;
      if (exhaustedDetail(rt.policy)) (running.budgetClosed ??= new Set()).add(id);
      else if (respawnFromCheckpoint(running, id)) touched.push(id);
    }
    running.bus.emit({
      type: 'audit',
      reason: 'section-budget-reopened',
      msg: `${scopeLabel(c)} reopened: its allocation is now ${sc ? usd(sc.allocationUsd) : 'unset'} (${usd(c.spentUsd)} spent so far)`,
      data: {
        scope: key,
        spentUsd: c.spentUsd,
        allocationUsd: sc?.allocationUsd ?? null,
        reopened: touched,
      },
    });
  }
  evaluateSectionBudgets(running); // a lowered allocation under the spend closes at once; a raised one can warn
  return touched;
}
