// packages/@monomind/cli/src/orgrt/decisions.ts
// Extracted from daemon.ts — decision gates, decision trace, and task DAG operations.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { type DecisionGate, ORG_DIR } from './types.js';

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
        data: { gateId, approved, resolution },
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

export function dagCompleteTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  result?: string,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  try {
    running.taskDag.markRunning(taskId);
    const promoted = running.taskDag.complete(taskId, result);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-done',
      msg: `task ${taskId} completed${promoted.length ? ` — ${promoted.map((t) => t.id).join(', ')} now ready` : ''}`,
      data: { taskId, promoted: promoted.map((t) => t.id) },
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

export function dispatchReadyTasks(_daemon: OrgDaemon, _org: string, running: RunningOrg): void {
  if (!running.taskDag) return;
  for (const task of running.taskDag.ready()) {
    running.taskDag.markRunning(task.id);
    const agent = running.agents.get(task.assignee);
    if (agent) {
      agent.mailbox.push(`[task:${task.id}] ${task.title}`);
    } else if (running.pendingRoles?.has(task.assignee)) {
      const pending = running.pendingRoles.get(task.assignee)!;
      running.pendingRoles.delete(task.assignee);
      running.spawnRole?.(pending);
      setTimeout(() => {
        const spawned = running.agents.get(task.assignee);
        if (spawned) spawned.mailbox.push(`[task:${task.id}] ${task.title}`);
      }, 500);
    }
    running.bus.emit({
      type: 'status',
      from: 'dag',
      reason: 'task-dispatched',
      msg: `task ${task.id} dispatched to ${task.assignee}`,
      data: { taskId: task.id, assignee: task.assignee },
    });
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
      context: decision.context,
      reasoning: decision.reasoning,
      alternatives: decision.alternatives,
      outcome: decision.outcome,
      ts: new Date().toISOString(),
    },
  });
}
