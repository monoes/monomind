// packages/@monomind/cli/src/orgrt/decisions.ts
// Extracted from daemon.ts — decision gates, decision trace, and task DAG operations.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkTaskEvidence, type TaskEvidence } from './completion-gate.js';
import { activeRoleCount, type OrgDaemon, type RunningOrg } from './daemon.js';
import { resolveSessionScope } from './session-ledger.js';
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
    const data = readGates(daemon.root, org);
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
    const data = readGates(daemon.root, org);
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
  const data = readGates(daemon.root, org);
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
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  try {
    const task = running.taskDag.add(title, assignee, deps);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-created',
      msg: `task ${task.id} created: "${title}" → ${assignee}`,
      data: { taskId: task.id, assignee, deps, status: task.status },
    });
    if (task.status === 'ready') dispatchReadyTasks(daemon, org, running);
    return JSON.stringify(task);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export interface PlanTaskSpec {
  name: string;
  title: string;
  assignee: string;
  after?: string[];
}

export function dagPlanGraph(
  daemon: OrgDaemon,
  org: string,
  role: string,
  specs: PlanTaskSpec[],
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
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
        const task = running.taskDag.add(s.title, s.assignee, depIds);
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

/** One line per acceptance command, appended to the task's stored result so
 *  `org_tasks` and the run history carry the commands and their exit codes —
 *  not just a prose claim that the work is done. */
function evidenceSummary(ev: TaskEvidence): string {
  const lines = ev.checks.map((c) => `  $ ${c.command} → exit ${c.exitCode}`).join('\n');
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
  if (task && running.def.run_config.completion_evidence) {
    const refusal = checkTaskEvidence({
      required: true,
      evidence,
      headSha: currentHeadSha(running.workdir ?? daemon.root),
      caller: role,
      assignee: task.assignee,
    });
    if (refusal) {
      // ADR-O001 D4: the correction loop is bounded. Only the assignee's own
      // failures count — a refusal aimed at a role that is not the assignee
      // says nothing about whether the assignee can produce evidence, and
      // must not spend its attempts.
      const attempts = role === task.assignee ? running.taskDag.recordEvidenceFailure(taskId) : 0;
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
          `[task:${taskId}] ESCALATED — "${task.assignee}" failed the completion evidence gate ${attempts} times on "${task.title}", so it is marked failed and is NOT being re-dispatched. Last refusal: ${refusal}\nDecide what happens next: re-scope it into a new task, reassign it, or end the run honestly. Do not simply re-file the identical task for the same role.`,
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
        `[task:${taskId}] NOT CLOSED — ${refusal}${attempts ? ` (attempt ${attempts} of ${cap}; after ${cap} this task is escalated instead of returned)` : ''}`,
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
    if (promoted.length > 0) dispatchReadyTasks(daemon, org, running);
    return JSON.stringify({
      done: taskId,
      promoted: promoted.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
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
export const DISPATCH_COALESCE_MS = 500;

/** Hold `line` for the assignee, merging it with anything else queued for the
 *  same coalescing window (further dispatches, and same-turn messages folded in
 *  by cross-org.ts's pushMessage). The recipient is resolved again at flush
 *  time so a role replaced during the window gets the message in its new
 *  mailbox rather than the retired one. */
function queueDispatch(running: RunningOrg, assignee: string, line: string): void {
  if (!running.pendingDispatch) running.pendingDispatch = new Map();
  const open = running.pendingDispatch.get(assignee);
  if (open) {
    open.lines.push(line);
    return;
  }
  const entry = { lines: [line], timer: undefined as unknown as ReturnType<typeof setTimeout> };
  entry.timer = setTimeout(() => {
    running.pendingDispatch?.delete(assignee);
    const mailbox = running.agents.get(assignee)?.mailbox;
    if (!mailbox || mailbox.isClosed) return;
    // ADR-O001 D3: in task scope a message is routed to the model session of
    // the task it names, so a batch naming several tasks has to stay apart.
    const role = running.def?.roles.find((r) => r.id === assignee);
    if (role && resolveSessionScope(role, running.def) === 'task') {
      for (const line of entry.lines) mailbox.push(line);
      return;
    }
    mailbox.push(entry.lines.join('\n\n'));
  }, DISPATCH_COALESCE_MS);
  entry.timer.unref?.();
  running.pendingDispatch.set(assignee, entry);
}

export function dispatchReadyTasks(daemon: OrgDaemon, org: string, running: RunningOrg): void {
  if (!running.taskDag) return;
  for (const task of running.taskDag.ready()) {
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
      queueDispatch(running, task.assignee, `[task:${task.id}] ${task.title}`);
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
        queueDispatch(running, task.assignee, `[task:${task.id}] ${task.title}`);
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
