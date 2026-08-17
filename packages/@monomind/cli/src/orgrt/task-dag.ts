// packages/@monomind/cli/src/orgrt/task-dag.ts

export type OrgTaskStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'split' | 'merged' | 'cancelled';

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

  add(title: string, assignee: string, deps: string[] = []): OrgTask {
    const id = `task-${++this.counter}`;
    for (const d of deps) {
      if (!this.tasks.has(d)) throw new Error(`dependency "${d}" does not exist`);
    }
    const task: OrgTask = { id, title, assignee, deps, status: 'pending', createdAt: Date.now() };
    this.tasks.set(id, task);
    if (this.hasCycle()) {
      this.tasks.delete(id);
      throw new Error(`adding "${id}" would create a cycle`);
    }
    if (deps.length === 0 || deps.every(d => SATISFIED.has(this.tasks.get(d)!.status))) {
      task.status = 'ready';
    }
    return task;
  }

  complete(id: string, result?: string): OrgTask[] {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    t.status = 'done';
    t.result = result;
    t.completedAt = Date.now();
    return this.promoteReady();
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

  /** Mark a task as waiting on a real-world time, not on other tasks. Only
   *  valid from 'running' (a role already working it discovers it can't
   *  proceed further right now) — a 'ready'/'pending' task should just stay
   *  that way until its deps clear. */
  block(id: string, untilMs: number, reason?: string): OrgTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`task "${id}" not found`);
    if (t.status !== 'running') throw new Error(`task "${id}" must be 'running' to block (is '${t.status}')`);
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

  /** True if any task is blocked on a real-world time still in the future —
   *  the watchdog's signal to skip nudging (same treatment as a pending gate). */
  hasActiveBlock(now: number): boolean {
    for (const t of this.tasks.values()) {
      if (t.status === 'blocked' && (t.blockedUntil ?? 0) > now) return true;
    }
    return false;
  }

  split(parentId: string, children: SplitChild[]): OrgTask[] {
    const parent = this.tasks.get(parentId);
    if (!parent) throw new Error(`task "${parentId}" not found`);
    if (TERMINAL.has(parent.status)) throw new Error(`task "${parentId}" is terminal (${parent.status})`);
    if (children.length === 0) throw new Error('split requires at least one child');

    const parentDeps = [...parent.deps];
    const parentSatisfied = parentDeps.length === 0 || parentDeps.every(d => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'));
    const created: OrgTask[] = [];
    const childIds: string[] = [];
    for (const c of children) {
      const id = `task-${++this.counter}`;
      const child: OrgTask = {
        id, title: c.title, assignee: c.assignee,
        deps: [...parentDeps],
        status: parentSatisfied ? 'ready' : 'pending',
        createdAt: Date.now(),
        splitFrom: parentId,
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
        t.deps = t.deps.filter(d => d !== parentId);
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

    source.status = 'merged';
    source.mergedInto = targetId;
    source.completedAt = Date.now();

    for (const d of source.deps) {
      if (d !== targetId && !target.deps.includes(d)) target.deps.push(d);
    }

    for (const t of this.tasks.values()) {
      if (t.id === sourceId || t.id === targetId) continue;
      if (t.deps.includes(sourceId)) {
        t.deps = t.deps.filter(d => d !== sourceId);
        if (!t.deps.includes(targetId)) t.deps.push(targetId);
      }
    }

    if (target.status === 'pending' && target.deps.every(d => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'))) {
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
    return [...this.tasks.values()].filter(t => t.status === 'ready');
  }

  get(id: string): OrgTask | undefined { return this.tasks.get(id); }

  all(): OrgTask[] { return [...this.tasks.values()]; }

  toJSON(): OrgTask[] { return this.all(); }

  static fromJSON(data: OrgTask[]): TaskDag {
    const dag = new TaskDag();
    for (const t of data) {
      dag.tasks.set(t.id, { ...t });
      const num = parseInt(t.id.replace('task-', ''), 10);
      if (!isNaN(num) && num > dag.counter) dag.counter = num;
    }
    return dag;
  }

  private promoteReady(): OrgTask[] {
    const promoted: OrgTask[] = [];
    for (const t of this.tasks.values()) {
      if (t.status !== 'pending') continue;
      if (t.deps.every(d => SATISFIED.has(this.tasks.get(d)?.status ?? 'pending'))) {
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
      if (t) for (const d of t.deps) { if (dfs(d)) return true; }
      stack.delete(id);
      return false;
    };
    for (const id of this.tasks.keys()) { if (dfs(id)) return true; }
    return false;
  }
}
