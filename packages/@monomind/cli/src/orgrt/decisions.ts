// packages/@monomind/cli/src/orgrt/decisions.ts
// Extracted from daemon.ts — decision gates, decision trace, and task DAG operations.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { decisionModelConfigured } from '../decision/jev.js';
import { suggestTaskSkills } from '../decision/picks.js';
import {
  checkTaskEvidence,
  declaresExpectExit,
  expectSuffix,
  type LocalHead,
  type TaskEvidence,
} from './completion-gate.js';
import { activeRoleCount, type OrgDaemon, type RunningOrg } from './daemon.js';
import { checkLoadoutSelection, taskTag } from './loadouts.js';
import { buildReviewPacket, capText, reviewDiff } from './review-packet.js';
import { resolveSessionScope } from './session-ledger.js';
import { roleSkillNames } from './skill-library.js';
import { isTerminalStatus, type OrgTask } from './task-dag.js';
import {
  DEFAULT_MAX_EVIDENCE_ATTEMPTS,
  type DecisionGate,
  type DecisionKind,
  ORG_DIR,
} from './types.js';

// ── Decision gates ──────────────────────────────────────────────────────

export function gatesPath(root: string, org: string): string {
  return join(root, ORG_DIR, org, 'gates.json');
}

export function readGates(root: string, org: string): { gates: DecisionGate[] } {
  try {
    return JSON.parse(readFileSync(gatesPath(root, org), 'utf8'));
  } catch {
    return { gates: [] };
  }
}

/** A RUNNING org's gates live in memory (loaded when it starts, written
 *  through on every change, flushed when it stops) and are never re-read from
 *  disk during the run: gates.json sits in a directory the org's own roles can
 *  write, so a role that rewrote it — directly, or by swapping the directory —
 *  could otherwise approve its own gate. A stopped org's gates are the file,
 *  which is how an offline resolution reaches the next run. */
export function gatesFor(daemon: OrgDaemon, org: string): { gates: DecisionGate[] } {
  const running = daemon.orgs.get(org);
  if (!running) return readGates(daemon.root, org);
  running.gates ??= readGates(daemon.root, org);
  return running.gates;
}

export function writeGates(root: string, org: string, data: { gates: DecisionGate[] }): void {
  const dest = gatesPath(root, org);
  mkdirSync(join(root, ORG_DIR, org), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, dest);
}

/** Serialize gate mutations per org (same pattern as withApprovalLock).
 *  createGate and resolveGate race on gates.json without this. */
function withGatesLock<T>(daemon: OrgDaemon, org: string, fn: () => Promise<T>): Promise<T> {
  const prev = daemon.gatesLocks.get(org) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  daemon.gatesLocks.set(
    org,
    next.catch(() => {
      /* slot stays usable for the next caller */
    }),
  );
  return next;
}

export async function createGate(
  daemon: OrgDaemon,
  org: string,
  role: string,
  name: string,
  description: string,
): Promise<string> {
  return withGatesLock(daemon, org, async () => {
    const running = daemon.orgs.get(org);
    const gateId = `gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const gate: DecisionGate = {
      id: gateId,
      name,
      description,
      roleId: role,
      status: 'pending',
      createdAt: Date.now(),
    };
    const data = gatesFor(daemon, org);
    data.gates.push(gate);
    writeGates(daemon.root, org, data);
    running?.bus.emit({ type: 'gate', from: role, data: { gateId, name, description } });
    return `Decision gate "${name}" created (id ${gateId}) — a human must approve or reject it before you proceed. End your turn and wait for the resolution.`;
  });
}

export async function resolveGate(
  daemon: OrgDaemon,
  org: string,
  gateId: string,
  approved: boolean,
  resolution?: string,
  resolvedBy?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withGatesLock(daemon, org, async () => {
    const data = gatesFor(daemon, org);
    const idx = data.gates.findIndex((g) => g.id === gateId);
    if (idx === -1) return { ok: false, error: `gate "${gateId}" not found for org "${org}"` };
    if (data.gates[idx].status !== 'pending')
      return { ok: false, error: `gate "${gateId}" already resolved (${data.gates[idx].status})` };

    data.gates[idx].status = approved ? 'approved' : 'rejected';
    data.gates[idx].resolvedAt = Date.now();
    data.gates[idx].resolvedBy = resolvedBy ?? 'human';
    data.gates[idx].resolution = resolution;
    writeGates(daemon.root, org, data);

    const running = daemon.orgs.get(org);
    const roleId = data.gates[idx].roleId;
    if (running) {
      running.bus.emit({
        type: 'gate',
        from: roleId,
        reason: approved ? 'gate-approved' : 'gate-rejected',
        data: { gateId, approved, resolution, resolvedBy: data.gates[idx].resolvedBy },
      });
      // M5: who decided.
      running.bus.emit({
        type: 'audit',
        reason: 'decision-resolved',
        from: roleId,
        data: {
          kind: 'gate',
          ref: gateId,
          resolver: data.gates[idx].resolvedBy,
          verdict: approved ? 'approved' : 'denied',
        },
      });
      const agent = running.agents.get(roleId);
      if (agent && !agent.mailbox.isClosed) {
        const verb = approved ? 'approved' : 'rejected';
        const detail =
          resolution ?? (approved ? 'approved — proceed' : 'rejected — do not proceed');
        agent.mailbox.push(`[gate ${verb}] "${data.gates[idx].name}": ${detail}`);
      }
    }
    return { ok: true };
  });
}

export function listGates(
  daemon: OrgDaemon,
  org: string,
  status?: 'pending' | 'approved' | 'rejected',
): DecisionGate[] {
  const data = gatesFor(daemon, org);
  return status ? data.gates.filter((g) => g.status === status) : data.gates;
}

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
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  // ADR-O001 D7: the boss SELECTS from the catalog; anything else is refused
  // before a task row exists, so no task can carry an unresolvable loadout.
  const refusal = checkLoadoutSelection(running.def, loadout);
  if (refusal) return JSON.stringify({ error: refusal });
  try {
    const task = running.taskDag.add(title, assignee, deps, loadout, brief);
    task.createdBy = role;
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
        const task = running.taskDag.add(s.title, s.assignee, depIds, s.loadout, s.brief);
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
    const promoted = running.taskDag.cancel(taskId, reason);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-cancelled',
      msg: `task ${taskId} cancelled${reason ? `: ${reason}` : ''}${promoted.length ? ` — ${promoted.map((t) => t.id).join(', ')} now ready` : ''}`,
      data: { taskId, reason, promoted: promoted.map((t) => t.id) },
    });
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
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  const untilMs = Date.parse(untilIso);
  if (Number.isNaN(untilMs))
    return JSON.stringify({ error: `"${untilIso}" is not a valid ISO date/time` });
  try {
    const task = running.taskDag.block(taskId, untilMs, reason);
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
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/** The workspace's current commit sha, or undefined when `cwd` is not inside
 *  a git repository (or git is unavailable). ADR-O001 D5's sha pin is only
 *  as good as this: it must come from the runtime, never from the agent. */
export function currentHeadSha(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Every local head of the repository `cwd` belongs to: each worktree's HEAD
 *  (the workspace's own first) and each local branch tip. Work often happens
 *  in a worktree other than the org workspace — a release branch, a per-task
 *  dev worktree — and evidence pinned to that work's current commit is as
 *  fresh as evidence pinned to the workspace's. Empty outside a git repo. */
export function localHeads(cwd: string): LocalHead[] {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const heads: LocalHead[] = [];
  try {
    let cur: LocalHead | undefined;
    for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
      if (line.startsWith('worktree ')) {
        cur = { sha: '', worktree: line.slice(9) };
        heads.push(cur);
      } else if (cur && line.startsWith('HEAD ')) cur.sha = line.slice(5);
      else if (cur && line.startsWith('branch '))
        cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
  } catch {
    return [];
  }
  try {
    for (const line of git([
      'for-each-ref',
      'refs/heads',
      '--format=%(objectname) %(refname:short)',
    ]).split('\n')) {
      const [sha, branch] = line.split(' ');
      if (sha && branch) heads.push({ sha, branch });
    }
  } catch {
    // worktree heads alone still answer the question
  }
  const own = currentHeadSha(cwd);
  const live = heads.filter((h) => h.sha);
  const ownIdx = live.findIndex((h) => h.sha === own && h.worktree);
  if (ownIdx > 0) live.unshift(...live.splice(ownIdx, 1));
  return live;
}

/** Whether `sha` names a commit in the workspace's repository. */
function isKnownCommit(cwd: string, sha: string): boolean {
  if (!/^[0-9a-f]+$/i.test(sha)) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Evidence's `worktree`, made comparable with `git worktree list` output:
 *  resolved against the workspace, symlinks followed when it exists. */
function resolveEvidenceWorktree(
  ev: TaskEvidence | undefined,
  base: string,
): TaskEvidence | undefined {
  if (!ev?.worktree) return ev;
  const abs = resolve(base, ev.worktree);
  return { ...ev, worktree: existsSync(abs) ? realpathSync(abs) : abs };
}

/** One line per acceptance command, appended to the task's stored result so
 *  `org_tasks` and the run history carry the commands and their exit codes —
 *  not just a prose claim that the work is done. */
function evidenceSummary(ev: TaskEvidence): string {
  const lines = ev.checks
    .map((c) => `  $ ${c.command} → exit ${c.exitCode}${expectSuffix(c)}`)
    .join('\n');
  return `evidence @ ${ev.headSha}:\n${lines}`;
}

export function dagCompleteTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  result?: string,
  evidence?: TaskEvidence,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  // ADR-O001 D5: refuse a close that carries no checkable proof. Only when
  // the org opted in (run_config.completion_evidence), and only for a task
  // that exists — an unknown id falls through to complete()'s own error.
  const task = running.taskDag.get(taskId);
  // #319: a task-scoped session (run_config.session_scope) is resumed PER TASK,
  // so a session resumed for a follow-up task still has the previous, already
  // closed task in its context and can close that id instead of the one it is
  // working. Nothing used to stop it: markRunning() is a no-op on a terminal
  // task and complete() has no terminal guard, so the close succeeded, the
  // creator got a second "[task:<closed id>] DONE", and the task actually in
  // flight stayed 'running' until a human noticed. Refuse it here — before any
  // evidence is recorded against the closed task — and name what is open.
  if (task && isTerminalStatus(task.status)) {
    const open = running.taskDag
      .all()
      .filter((t) => t.assignee === role && !isTerminalStatus(t.status));
    running.bus.emit({
      type: 'audit',
      from: role,
      reason: 'task-already-closed',
      msg: `task ${taskId} is already ${task.status} — close refused`,
      data: { taskId, status: task.status, open: open.map((t) => t.id) },
    });
    return JSON.stringify({
      error:
        `org_task_done refused: task ${taskId} is already ${task.status} ("${task.title}") — closing it again would notify its creator about work that was reported long ago. ` +
        (open.length
          ? `Your open task(s): ${open.map((t) => `${t.id} ("${t.title}")`).join(', ')}. Close the one this work is for, by its id.`
          : 'You have no open task — if this work belongs to a new one, ask for it to be created rather than re-closing a finished task.'),
    });
  }
  // ADR-O001 D6: keep the latest evidence the ASSIGNEE submitted, accepted or
  // not — it is what an artifact-only reviewer is shown. Another role's
  // evidence is not recorded: it would let a non-assignee plant the reviewer's
  // input.
  if (task && evidence && role === task.assignee) running.taskDag.recordEvidence(taskId, evidence);
  // Deliberative work has no oracle; demanding evidence would only invite a
  // fabricated exit code (ADR-O001, "What this does NOT apply to").
  const deliberative =
    running.def.roles.find((r) => r.id === task?.assignee)?.deliberative === true;
  if (task && running.def.run_config.completion_evidence && !deliberative) {
    const workspace = running.workdir ?? daemon.root;
    const pinned = resolveEvidenceWorktree(evidence, workspace);
    const refusal = checkTaskEvidence({
      required: true,
      evidence: pinned,
      headSha: currentHeadSha(workspace),
      heads: localHeads(workspace),
      isKnownCommit: (sha) => isKnownCommit(workspace, sha),
      ...(pinned?.worktree ? { worktreeExists: existsSync(pinned.worktree) } : {}),
      caller: role,
      assignee: task.assignee,
    });
    if (refusal) {
      // ADR-O001 D4: the correction loop is bounded. Only the assignee's own
      // failures count — a refusal aimed at a role that is not the assignee
      // says nothing about whether the assignee can produce evidence, and
      // must not spend its attempts. Neither does a call with no evidence
      // object at all: that is a formatting slip, not a failed proof — on the
      // release org's first run it cost 4 of 6 tasks an attempt.
      const counts = role === task.assignee && evidence !== undefined;
      const attempts = counts ? running.taskDag.recordEvidenceFailure(taskId) : 0;
      const cap = running.def.run_config.max_evidence_attempts ?? DEFAULT_MAX_EVIDENCE_ATTEMPTS;
      if (attempts >= cap) {
        // Escalate rather than hand it back a fourth time. "Escalate" is the
        // path this runtime already has for work a role cannot finish (the
        // crashed-worker handoff in daemon.ts): record the reason on the task,
        // raise a loud audit event next to D4's `no-progress` one, and put it
        // in the boss's mailbox to re-plan, split or drop. Failing the task
        // keeps the D4 liveness invariant — a non-terminal task with nothing
        // dispatched for it is exactly the silent stall D4 exists to remove.
        const why = `evidence gate failed ${attempts}x (cap ${cap}) — escalated to "${running.bossRoleId}": ${refusal}`;
        running.taskDag.fail(taskId, why);
        running.bus.emit({
          type: 'audit',
          from: role,
          reason: 'task-evidence-escalated',
          msg: `task ${taskId} failed the evidence gate ${attempts} times — escalated to "${running.bossRoleId}" instead of re-dispatching`,
          data: { taskId, assignee: task.assignee, attempts, cap, refusal },
        });
        queueDispatch(
          running,
          running.bossRoleId,
          `${taskTag(task)} ESCALATED — "${task.assignee}" failed the completion evidence gate ${attempts} times on "${task.title}", so it is marked failed and is NOT being re-dispatched. Last refusal: ${refusal}\nDecide what happens next: re-scope it into a new task, reassign it, or end the run honestly. Do not simply re-file the identical task for the same role.`,
        );
        return JSON.stringify({
          error: `${refusal}\n\nThat is ${attempts} failed evidence check(s) on this task (cap ${cap}). It is not coming back to you: it is recorded as failed and "${running.bossRoleId}" has been asked to decide what happens next. Stop retrying it.`,
          escalated: taskId,
          attempts,
        });
      }
      // Not a crash and not a dead end: the item goes back on the queue with
      // the reason attached, so the correction loop (D4) picks it up even if
      // this session dies before it can react to the tool result.
      running.taskDag.markRunning(taskId);
      running.taskDag.requeue(taskId);
      running.bus.emit({
        type: 'audit',
        from: role,
        reason: 'task-evidence-refused',
        msg: `task ${taskId} not closed — evidence refused`,
        data: { taskId, assignee: task.assignee, attempts, cap, refusal },
      });
      queueDispatch(
        running,
        task.assignee,
        `${taskTag(task)} NOT CLOSED — ${refusal}${attempts ? ` (attempt ${attempts} of ${cap}; after ${cap} this task is escalated instead of returned)` : evidence === undefined ? ' (no evidence was attached, so this did not count against your attempts)' : ''}`,
      );
      dispatchReadyTasks(daemon, org, running);
      return JSON.stringify({ error: refusal, requeued: taskId });
    }
  }
  const stored = evidence ? `${result ? `${result}\n\n` : ''}${evidenceSummary(evidence)}` : result;
  try {
    running.taskDag.markRunning(taskId);
    const promoted = running.taskDag.complete(taskId, stored);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-done',
      msg: `task ${taskId} completed${promoted.length ? ` — ${promoted.map((t) => t.id).join(', ')} now ready` : ''}`,
      data: { taskId, promoted: promoted.map((t) => t.id), evidence },
    });
    // A check accepted at a non-zero exit is the one place the gate takes the
    // role's word for what an exit code MEANS. Each one gets its own audit
    // event so they can be swept after the run without re-reading every task
    // — the 2.15.6 misuse was only found because a human read the log.
    for (const c of evidence?.checks ?? []) {
      if (!declaresExpectExit(c)) continue;
      running.bus.emit({
        type: 'audit',
        from: role,
        reason: 'evidence-expect-exit',
        msg: `task ${taskId} closed with \`${c.command}\` accepted at exit ${c.exitCode}${expectSuffix(c)}`,
        data: {
          taskId,
          role,
          command: c.command,
          expectExit: c.expectExit,
          expectReason: c.expectReason,
        },
      });
    }
    if (promoted.length > 0) dispatchReadyTasks(daemon, org, running);
    // run_config.notify_task_creator: a completion otherwise lives only on
    // the bus, and a creator waiting on it stays idle until the watchdog.
    // #319: the tag and the title come from the completed task itself, never
    // from the caller's session state — the guard above is what guarantees
    // that task is the one that just closed.
    const creator = task?.createdBy;
    if (task && running.def.run_config.notify_task_creator && creator && creator !== role) {
      const summary = result ? ` Result: ${capText(result, 1_500)}` : '';
      const ev = evidence ? `\n${evidenceSummary(evidence)}` : '';
      const next = promoted.length ? `\nNow ready: ${promoted.map((t) => t.id).join(', ')}.` : '';
      queueDispatch(
        running,
        creator,
        `[task:${task.id}] DONE — "${task.title}" was completed by "${role}".${summary}${ev}${next}`,
      );
    }
    return JSON.stringify({
      done: taskId,
      promoted: promoted.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
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
/** The dispatch message for a task. With a decision model configured and an
 *  assignee that has on-demand skills, it also names the ones that fit THIS
 *  task. That goes in the message, never the system prompt (ADR-O001 D7:
 *  per-task guidance is not cached). Otherwise it is the plain line, returned
 *  synchronously. The promise never rejects. */
export function dispatchLine(
  daemon: OrgDaemon,
  running: RunningOrg,
  task: OrgTask,
): string | Promise<string> {
  // The brief rides the dispatch itself so it arrives with the task however
  // late that is — a separate org_send can miss the coalescing window below.
  const base = `${taskTag(task)} ${task.title}${task.brief ? `\n\n${task.brief}` : ''}`;
  if (!decisionModelConfigured()) return base;
  const role = running.def?.roles.find((r) => r.id === task.assignee);
  if (!role) return base;
  const pinned = new Set(role.skills ?? []);
  const pool = roleSkillNames(role, daemon.root).filter((n) => !pinned.has(n));
  if (pool.length === 0) return base;
  return suggestTaskSkills(task.title, pool, daemon.root).then(
    (names) =>
      names.length
        ? `${base}\nSkills that fit this task (load with org_skill_load): ${names.join(', ')}`
        : base,
    () => base,
  );
}

export const DISPATCH_COALESCE_MS = 500;

/** Hold `line` for the assignee, merging it with anything else queued for the
 *  same coalescing window (further dispatches, and same-turn messages folded in
 *  by cross-org.ts's pushMessage). The recipient is resolved again at flush
 *  time so a role replaced during the window gets the message in its new
 *  mailbox rather than the retired one. */
function queueDispatch(
  running: RunningOrg,
  assignee: string,
  line: string | Promise<string>,
): void {
  if (!running.pendingDispatch) running.pendingDispatch = new Map();
  const open = running.pendingDispatch.get(assignee);
  if (open) {
    open.lines.push(line);
    return;
  }
  const entry = {
    lines: [line] as (string | Promise<string>)[],
    timer: undefined as unknown as ReturnType<typeof setTimeout>,
  };
  entry.timer = setTimeout(() => {
    if (entry.lines.every((l) => typeof l === 'string')) {
      running.pendingDispatch?.delete(assignee);
      deliverDispatch(running, assignee, entry.lines as string[]);
      return;
    }
    // A line is still resolving (per-task skill suggestion). Keep the entry
    // open so same-turn messages keep joining it (#275), and deliver once no
    // new line arrived while waiting.
    void (async () => {
      let lines: string[] = [];
      for (let seen = -1; seen !== entry.lines.length; ) {
        seen = entry.lines.length;
        lines = await Promise.all(entry.lines);
      }
      running.pendingDispatch?.delete(assignee);
      deliverDispatch(running, assignee, lines);
    })();
  }, DISPATCH_COALESCE_MS);
  entry.timer.unref?.();
  running.pendingDispatch.set(assignee, entry);
}

/** The recipient is resolved at delivery time so a role replaced during the
 *  window gets the message in its new mailbox rather than the retired one. */
function deliverDispatch(running: RunningOrg, assignee: string, lines: string[]): void {
  const mailbox = running.agents.get(assignee)?.mailbox;
  if (!mailbox || mailbox.isClosed) return;
  // ADR-O001 D3: in task scope a message is routed to the model session of
  // the task it names, so a batch naming several tasks has to stay apart.
  const role = running.def?.roles.find((r) => r.id === assignee);
  if (role && resolveSessionScope(role, running.def) === 'task') {
    for (const line of lines) mailbox.push(line);
    return;
  }
  mailbox.push(lines.join('\n\n'));
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
      queueDispatch(running, task.assignee, dispatchLine(daemon, running, task));
      running.bus.emit({
        type: 'status',
        from: 'dag',
        reason: 'task-dispatched',
        msg: `task ${task.id} dispatched to ${task.assignee}`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    } else if (agent) {
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
        daemon.scheduleConcurrencyDeferredSpawn(org, running, pending, (role) => {
          running.spawnRole?.(role);
          dispatchReadyTasks(daemon, org, running);
        });
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
        queueDispatch(running, task.assignee, dispatchLine(daemon, running, task));
        running.bus.emit({
          type: 'status',
          from: 'dag',
          reason: 'task-dispatched',
          msg: `task ${task.id} dispatched to ${task.assignee}`,
          data: { taskId: task.id, assignee: task.assignee },
        });
      } else {
        running.bus.emit({
          type: 'audit',
          from: 'dag',
          reason: 'dispatch-recipient-unavailable',
          msg: `task ${task.id} not dispatched — lazy spawn of "${task.assignee}" did not produce a live agent`,
          data: { taskId: task.id, assignee: task.assignee },
        });
      }
    } else {
      // No live agent and no pending role for this assignee — it doesn't
      // resolve to anything (typo at task-creation time, or the role was
      // removed from the org definition since). Leave the task 'ready'
      // instead of marking it 'running' with no owner: nothing else in this
      // codebase can detect a "running but no owner" task, so it would be
      // silently stuck forever with zero observability.
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

// ── Decision trace ──────────────────────────────────────────────────────

/** Record a structured decision trace for Rifft-style debugging */
export function recordDecision(
  daemon: OrgDaemon,
  org: string,
  role: string,
  decision: {
    type: 'tool' | 'handoff' | 'approval' | 'routing';
    /** #290: structured cause — required so every emitter populates it and no
     *  consumer ever has to pattern-match the prose in context/reasoning. */
    kind: DecisionKind;
    context: string;
    reasoning: string;
    alternatives?: Array<{ choice: string; score: number; reason: string }>;
    outcome: string;
  },
): void {
  const running = daemon.orgs.get(org);
  if (!running) return;

  running.bus.emit({
    type: 'audit',
    from: role,
    reason: 'decision-trace',
    data: {
      decisionType: decision.type,
      kind: decision.kind,
      context: decision.context,
      reasoning: decision.reasoning,
      alternatives: decision.alternatives,
      outcome: decision.outcome,
      ts: new Date().toISOString(),
    },
  });
}
