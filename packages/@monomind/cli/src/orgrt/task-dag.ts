// packages/@monomind/cli/src/orgrt/task-dag.ts

export interface OrgTask {
  id: string;
  title: string;
  assignee: string;
  deps: string[];
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed';
  result?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

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
    if (deps.length === 0 || deps.every(d => this.tasks.get(d)!.status === 'done')) {
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
      if (t.deps.every(d => this.tasks.get(d)?.status === 'done')) {
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
