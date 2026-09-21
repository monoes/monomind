// packages/@monomind/cli/src/orgrt/task-dag.ts

import type { TaskEvidence } from './completion-gate.js';
import { capText, EVIDENCE_OUTPUT_CAP } from './review-packet.js';

export type OrgTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'split'
  | 'merged'
  | 'cancelled';

export interface OrgTask {
  id: string;
  title: string;
  assignee: string;
  deps: string[];
  status: OrgTaskStatus;
  result?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  splitFrom?: string;
  mergedInto?: string;
  /** Set when status is 'blocked': the task can't proceed until this real-world
   *  time (e.g. waiting on a scheduled external process — a CI run, a soak
   *  test, a human-set deadline). Distinct from a dependency block (deps not
   *  yet done): this is an explicit "nothing to do until <time>" signal a role
   *  gives when genuinely no other task is dispatchable. The idle watchdog
   *  treats an active block the same as a pending decision gate — legitimate
   *  waiting, not silence to nudge about. */
  blockedUntil?: number;
  blockedReason?: string;
  /** ADR-O001 D4: how many times the assignee has failed the completion
   *  evidence gate on THIS task since it was last accepted. It lives on the
   *  task row, so it rides the checkpoint (`toJSON`/`fromJSON`) like every
   *  other piece of task state — a counter held only in daemon memory would
   *  reset on every crash or resume and the cap would bound nothing.
   *  Cleared by `complete()`; see `recordEvidenceFailure`. */
  evidenceFailures?: number;
  /** ADR-O001 D7: the loadout the boss selected for this task. Set once at
   *  creation and never re-selected: every dispatch and re-dispatch (evidence
   *  refusal, checkpoint requeue, block expiry) reads it from here, so a retry
   *  is the same attempt again rather than a re-roll. Rides the checkpoint
   *  with the rest of the row. Absent when none was selected. */
  loadout?: string;
  /** ADR-O001 D6: the most recent evidence the assignee submitted with
   *  org_task_done, accepted or refused — what an artifact-only reviewer is
   *  shown. Only the latest: earlier rounds are exactly what D6 withholds.
   *  Outputs are capped so the row stays small on the checkpoint. */
  lastEvidence?: TaskEvidence;
}

export interface SplitChild {
  title: string;
  assignee: string;
}

const TERMINAL = new Set<OrgTaskStatus>(['done', 'failed', 'split', 'merged', 'cancelled']);
const SATISFIED = new Set<OrgTaskStatus>(['done', 'cancelled']);

export class TaskDag {
  private tasks = new Map<string, OrgTask>();
  private counter = 0;

  add(title: string, assignee: string, deps: string[] = [], loadout?: string): OrgTask {
    const id = `task-${++this.counter}`;
    for (const d of deps) {
      if (!this.tasks.has(d)) throw new Error(`dependency "${d}" does not exist`);
    }
    const task: OrgTask = {
      id,
      title,
      assignee,
      deps,
      status: 'pending',
      createdAt: Date.now(),
      ...(loadout ? { loadout } : {}),
    };
    this.tasks.set(id, task);
    if (this.hasCycle()) {
      this.tasks.delete(id);
      throw new Error(`adding "${id}" would create a cycle`);
    }
    if (
      deps.length === 0 ||
      deps.every((d) => {
        const dependency = this.tasks.get(d);
        return dependency !== undefined && SATISFIED.has(dependency.status);
      })
    ) {
      task.status = 'ready';
    }
    return task;
  }

  complete(id: string, result?: string): OrgTask[] {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    // Completing a task early would promote its dependents before the work
    // they depend on exists (#246).
    const unmet = t.deps.filter((d) => {
      const dep = this.tasks.get(d);
      return dep === undefined || !SATISFIED.has(dep.status);
    });
    if (unmet.length > 0)
      throw new Error(
        `task "${id}" cannot be completed: dependencies not done (${unmet.join(', ')})`,
      );
    t.status = 'done';
    t.result = result;
    t.completedAt = Date.now();
    // The count means "consecutive failures since the last accepted close",
    // so a task that failed the gate twice and then passed is not left one
    // failure away from escalation forever.
    t.evidenceFailures = undefined;
    return this.promoteReady();
  }

  /** ADR-O001 D4: record one failed completion-evidence check against a task
   *  and return its running total. Per task on purpose — a cap counted
   *  org-wide would escalate a healthy task because unrelated ones failed. */
  recordEvidence(id: string, ev: TaskEvidence): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.lastEvidence = {
      headSha: ev.headSha,
      checks: ev.checks.map((c) => ({
        command: c.command,
        exitCode: c.exitCode,
        ...(c.output !== undefined ? { output: capText(c.output, EVIDENCE_OUTPUT_CAP) } : {}),
      })),
    };
  }

  recordEvidenceFailure(id: string): number {
    const t = this.tasks.get(id);
    if (!t) return 0;
    t.evidenceFailures = (t.evidenceFailures ?? 0) + 1;
    return t.evidenceFailures;
  }

  fail(id: string, reason?: string): void {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    t.status = 'failed';
    t.result = reason;
    t.completedAt = Date.now();
  }

  markRunning(id: string): void {
    const t = this.tasks.get(id);
    if (t && t.status === 'ready') {
      t.status = 'running';
      t.startedAt = Date.now();
    }
  }

  /** Put a 'running' task back to 'ready' so dispatchReadyTasks re-sends it.
   *  Used on checkpoint resume for tasks whose assignee's session was not
   *  resumed: the "[task:…]" message was consumed by a session that no longer
   *  exists, so nothing would ever pick the task up again otherwise. */
  requeue(id: string): void {
    const t = this.tasks.get(id);
    if (t && t.status === 'running') {
      t.status = 'ready';
      t.startedAt = undefined;
    }
  }

  /** Mark a task as waiting on a real-world time, not on other tasks. Only
   *  valid from 'running' (a role already working it discovers it can't
   *  proceed further right now) — a 'ready'/'pending' task should just stay
   *  that way until its deps clear. */
  block(id: string, untilMs: number, reason?: string): OrgTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    if (t.status !== 'running')
      throw new Error(`task "${id}" must be 'running' to block (is '${t.status}')`);
    if (untilMs <= Date.now()) throw new Error(`blockedUntil must be in the future`);
    t.status = 'blocked';
    t.blockedUntil = untilMs;
    t.blockedReason = reason;
    return t;
  }

  /** Transition every task whose block has expired back to 'running', so its
   *  assignee gets nudged that it's time to resume. Called by the idle
   *  watchdog on every tick — cheap no-op when nothing has expired. */
  unblockExpired(now: number): OrgTask[] {
    const unblocked: OrgTask[] = [];
    for (const t of this.tasks.values()) {
      if (t.status === 'blocked' && (t.blockedUntil ?? Infinity) <= now) {
        t.status = 'running';
        t.blockedUntil = undefined;
        t.blockedReason = undefined;
        unblocked.push(t);
      }
    }
    return unblocked;
  }

  /** True if there is genuinely nothing else dispatchable right now — every
   *  non-terminal task is blocked on a real-world time still in the future.
   *  This is the watchdog's signal to skip nudging (same treatment as a
   *  pending gate). Scoped to the whole DAG rather than a single task on
   *  purpose: if ANY task is pending/ready/running, or blocked with a time
   *  that's already passed (should have auto-resumed), there is real
   *  outstanding work and nudging is still meaningful — a single long-lived
   *  block on one task (e.g. a feature deferred for weeks) must not silence
   *  the watchdog for the entire org while other roles sit genuinely idle. */
  hasActiveBlock(now: number): boolean {
    return this.activeBlockUntil(now) !== null;
  }

  /** When `hasActiveBlock` next goes false: the EARLIEST active block expiry
   *  (at that moment `unblockExpired` resumes that task, so there is
   *  dispatchable work again), or null if nothing is blocking.
   *
   *  ADR-O001 D4 — the idle watchdog records a deadline on every hold, and a
   *  time-blocked task already has a real one: the time the asker named. It
   *  gets that, not an arbitrary timeout, so a block legitimately set hours
   *  out is not nudged about in the meantime. */
  activeBlockUntil(now: number): number | null {
    let earliest: number | null = null;
    for (const t of this.tasks.values()) {
      if (TERMINAL.has(t.status)) continue;
      const until = t.blockedUntil ?? 0;
      if (t.status === 'blocked' && until > now) {
        if (earliest === null || until < earliest) earliest = until;
        continue;
      }
      return null;
    }
    return earliest;
  }

  split(parentId: string, children: SplitChild[]): OrgTask[] {
    const parent = this.tasks.get(parentId);
    if (!parent) throw new Error(`task "${parentId}" not found`);
    if (TERMINAL.has(parent.status))
      throw new Error(`task "${parentId}" is terminal (${parent.status})`);
    if (children.length === 0) throw new Error('split requires at least one child');

    const parentDeps = [...parent.deps];
    const parentSatisfied =
      parentDeps.length === 0 ||
      parentDeps.every((d) => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'));
    const created: OrgTask[] = [];
    const childIds: string[] = [];
    for (const c of children) {
      const id = `task-${++this.counter}`;
      const child: OrgTask = {
        id,
        title: c.title,
        assignee: c.assignee,
        deps: [...parentDeps],
        status: parentSatisfied ? 'ready' : 'pending',
        createdAt: Date.now(),
        splitFrom: parentId,
        // D7: a split is the same work in smaller pieces — same loadout.
        ...(parent.loadout ? { loadout: parent.loadout } : {}),
      };
      this.tasks.set(id, child);
      created.push(child);
      childIds.push(id);
    }

    parent.status = 'split';
    parent.completedAt = Date.now();

    for (const t of this.tasks.values()) {
      if (t.id === parentId) continue;
      if (t.deps.includes(parentId)) {
        t.deps = t.deps.filter((d) => d !== parentId);
        for (const cid of childIds) {
          if (!t.deps.includes(cid)) t.deps.push(cid);
        }
      }
    }

    if (this.hasCycle()) {
      for (const c of created) this.tasks.delete(c.id);
      parent.status = parentSatisfied ? 'ready' : 'pending';
      parent.completedAt = undefined;
      throw new Error(`splitting "${parentId}" would create a cycle`);
    }

    return created;
  }

  merge(sourceId: string, targetId: string): OrgTask {
    const source = this.tasks.get(sourceId);
    const target = this.tasks.get(targetId);
    if (!source) throw new Error(`task "${sourceId}" not found`);
    if (!target) throw new Error(`task "${targetId}" not found`);
    if (sourceId === targetId) throw new Error(`cannot merge a task into itself`);
    // Same guard as split/cancel: a terminal source would lose its real outcome,
    // and any terminal target other than 'done' would let promoteReady() release
    // the source's dependents for work that never actually happened — including
    // a cancelled target, since cancelled means the work was abandoned, not
    // completed. A 'done' target is the one terminal state that represents real,
    // accepted work, so it's a legitimate merge target.
    if (TERMINAL.has(source.status))
      throw new Error(`task "${sourceId}" is terminal (${source.status})`);
    if (TERMINAL.has(target.status) && target.status !== 'done')
      throw new Error(`task "${targetId}" is terminal (${target.status})`);

    const sourceStatus = source.status;
    const sourceMergedInto = source.mergedInto;
    const sourceCompletedAt = source.completedAt;
    const targetStatus = target.status;
    const targetDeps = [...target.deps];
    const otherDeps = new Map<string, string[]>();

    source.status = 'merged';
    source.mergedInto = targetId;
    source.completedAt = Date.now();

    for (const d of source.deps) {
      if (d !== targetId && !target.deps.includes(d)) target.deps.push(d);
    }

    for (const t of this.tasks.values()) {
      if (t.id === sourceId || t.id === targetId) continue;
      if (t.deps.includes(sourceId)) {
        otherDeps.set(t.id, [...t.deps]);
        t.deps = t.deps.filter((d) => d !== sourceId);
        if (!t.deps.includes(targetId)) t.deps.push(targetId);
      }
    }

    if (this.hasCycle()) {
      source.status = sourceStatus;
      source.mergedInto = sourceMergedInto;
      source.completedAt = sourceCompletedAt;
      target.status = targetStatus;
      target.deps = targetDeps;
      for (const [id, deps] of otherDeps) {
        const t = this.tasks.get(id);
        if (t) t.deps = deps;
      }
      throw new Error(`merging "${sourceId}" into "${targetId}" would create a cycle`);
    }

    if (
      target.status === 'pending' &&
      target.deps.every((d) => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'))
    ) {
      target.status = 'ready';
    }
    this.promoteReady();

    return target;
  }

  cancel(id: string, reason?: string): OrgTask[] {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    if (TERMINAL.has(t.status)) throw new Error(`task "${id}" is terminal (${t.status})`);
    t.status = 'cancelled';
    t.result = reason;
    t.completedAt = Date.now();
    return this.promoteReady();
  }

  ready(): OrgTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'ready');
  }

  /** #302: true if any task has not reached a terminal status. Paired with
   *  `hasActiveBlock` at call sites, never used alone to mean "nothing left
   *  to do" — an empty DAG also returns false here, same as
   *  `hasActiveBlock`'s own empty-DAG edge (see its doc comment), so the
   *  caller must not read a `false` in isolation as "the goal is achieved". */
  hasPendingWork(): boolean {
    return this.pendingTaskCount() > 0;
  }

  /** #302: how many tasks have not reached a terminal status — the count a
   *  truth-gated stop record (`daemon.ts`'s `finishStop`) attaches to an
   *  automated stop, so "the run ended with N tasks still outstanding" is a
   *  fact in the record, not just a boolean. */
  pendingTaskCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (!TERMINAL.has(t.status)) n++;
    return n;
  }

  get(id: string): OrgTask | undefined {
    return this.tasks.get(id);
  }

  all(): OrgTask[] {
    return [...this.tasks.values()];
  }

  toJSON(): OrgTask[] {
    return this.all();
  }

  static fromJSON(data: OrgTask[]): TaskDag {
    const dag = new TaskDag();
    for (const t of data) {
      dag.tasks.set(t.id, { ...t });
      const num = parseInt(t.id.replace('task-', ''), 10);
      if (!Number.isNaN(num) && num > dag.counter) dag.counter = num;
    }
    return dag;
  }

  private promoteReady(): OrgTask[] {
    const promoted: OrgTask[] = [];
    for (const t of this.tasks.values()) {
      if (t.status !== 'pending') continue;
      if (t.deps.every((d) => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'))) {
        t.status = 'ready';
        promoted.push(t);
      }
    }
    return promoted;
  }

  private hasCycle(): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const dfs = (id: string): boolean => {
      if (stack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      stack.add(id);
      const t = this.tasks.get(id);
      if (t)
        for (const d of t.deps) {
          if (dfs(d)) return true;
        }
      stack.delete(id);
      return false;
    };
    for (const id of this.tasks.keys()) {
      if (dfs(id)) return true;
    }
    return false;
  }
}
