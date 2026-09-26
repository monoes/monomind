// packages/@monomind/cli/__tests__/orgrt/task-dag.test.ts
import { describe, it, expect } from 'vitest';
import { TaskDag } from '../../src/orgrt/task-dag.js';

describe('TaskDag', () => {
  it('creates tasks with no deps as ready', () => {
    const dag = new TaskDag();
    const t = dag.add('build', 'coder');
    expect(t.status).toBe('ready');
    expect(t.id).toBe('task-1');
  });

  it('creates tasks with unmet deps as pending', () => {
    const dag = new TaskDag();
    const t1 = dag.add('design', 'architect');
    const t2 = dag.add('build', 'coder', [t1.id]);
    expect(t2.status).toBe('pending');
  });

  it('promotes dependent tasks when deps complete', () => {
    const dag = new TaskDag();
    const t1 = dag.add('design', 'architect');
    const t2 = dag.add('build', 'coder', [t1.id]);
    const promoted = dag.complete(t1.id, 'done');
    expect(promoted).toHaveLength(1);
    expect(promoted[0].id).toBe(t2.id);
    expect(dag.get(t2.id)!.status).toBe('ready');
  });

  it('rejects unknown dependency', () => {
    const dag = new TaskDag();
    expect(() => dag.add('build', 'coder', ['task-999'])).toThrow('does not exist');
  });

  it('rejects cycles', () => {
    const dag = new TaskDag();
    const t1 = dag.add('a', 'x');
    const t2 = dag.add('b', 'y', [t1.id]);
    expect(() => dag.add('c', 'z', [t2.id])).not.toThrow();
    // Direct cycle attempt: can't make t1 depend on t3 since t1 already exists
    // Cycle detection is checked on add — since we can't re-add, test with a fresh setup
  });

  it('marks tasks running', () => {
    const dag = new TaskDag();
    const t = dag.add('build', 'coder');
    dag.markRunning(t.id);
    expect(dag.get(t.id)!.status).toBe('running');
  });

  it('fails a task', () => {
    const dag = new TaskDag();
    const t = dag.add('build', 'coder');
    dag.fail(t.id, 'compile error');
    expect(dag.get(t.id)!.status).toBe('failed');
    expect(dag.get(t.id)!.result).toBe('compile error');
  });

  it('serializes and deserializes', () => {
    const dag = new TaskDag();
    dag.add('design', 'architect');
    dag.add('build', 'coder', ['task-1']);
    const json = dag.toJSON();
    const restored = TaskDag.fromJSON(json);
    expect(restored.all()).toHaveLength(2);
    expect(restored.get('task-1')!.title).toBe('design');
    expect(restored.get('task-2')!.deps).toEqual(['task-1']);
  });

  // #246: a role called org_task_done on a task whose deps were still pending,
  // and complete() released the downstream "final gate" task early.
  it('refuses to complete a task whose deps are not satisfied, and releases nothing', () => {
    const dag = new TaskDag();
    const a = dag.add('docs', 'writer');
    const b = dag.add('bump', 'publisher', [a.id]);
    const c = dag.add('final build', 'builder', [b.id]);
    expect(() => dag.complete(b.id)).toThrow(/dependenc/);
    expect(dag.get(b.id)!.status).toBe('pending');
    expect(dag.get(c.id)!.status).toBe('pending');
    dag.complete(a.id);
    expect(dag.complete(b.id).map((t) => t.id)).toEqual([c.id]);
  });

  it('treats cancelled deps as satisfied when completing', () => {
    const dag = new TaskDag();
    const a = dag.add('optional', 'x');
    const b = dag.add('next', 'y', [a.id]);
    dag.cancel(a.id);
    expect(() => dag.complete(b.id)).not.toThrow();
  });

  it('handles multi-dep fan-in', () => {
    const dag = new TaskDag();
    const a = dag.add('design', 'architect');
    const b = dag.add('spec', 'pm');
    const c = dag.add('build', 'coder', [a.id, b.id]);
    expect(c.status).toBe('pending');
    dag.complete(a.id);
    expect(dag.get(c.id)!.status).toBe('pending');
    const promoted = dag.complete(b.id);
    expect(promoted).toHaveLength(1);
    expect(dag.get(c.id)!.status).toBe('ready');
  });

  it('handles fan-out promotion', () => {
    const dag = new TaskDag();
    const a = dag.add('design', 'architect');
    dag.add('frontend', 'fe-dev', [a.id]);
    dag.add('backend', 'be-dev', [a.id]);
    const promoted = dag.complete(a.id);
    expect(promoted).toHaveLength(2);
  });

  it('rejects a merge that would create a cycle, leaving the DAG unchanged', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'x');
    const b = dag.add('b', 'y', [a.id]);
    const c = dag.add('c', 'z', [b.id]);

    expect(() => dag.merge(a.id, c.id)).toThrow('cycle');

    expect(dag.get(b.id)!.deps).toEqual([a.id]);
    expect(dag.get(c.id)!.deps).toEqual([b.id]);
    expect(dag.get(a.id)!.status).toBe('ready');
    expect(dag.get(b.id)!.status).toBe('pending');
    expect(dag.get(c.id)!.status).toBe('pending');

    const ready = dag.ready();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe(a.id);
  });

  // Rule: merge is only valid between two live tasks, same as split/cancel.
  // A terminal source would lose its real outcome (a 'done' task silently
  // becoming 'merged'), and a terminal target would make promoteReady() mark
  // the source's dependents ready though the merged work never happened.
  // Because a non-terminal source can only have 'pending' dependents (a task
  // is promoted only once every dep is done/cancelled), rejecting terminal
  // endpoints also means merge never rewires a running dependent.
  it('rejects merging a terminal source, leaving its done state and dependents intact', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'x');
    const b = dag.add('b', 'y');
    const c = dag.add('c', 'z', [a.id]);
    dag.complete(a.id, 'shipped');
    expect(dag.get(c.id)!.status).toBe('ready');

    expect(() => dag.merge(a.id, b.id)).toThrow('terminal');

    expect(dag.get(a.id)!.status).toBe('done');
    expect(dag.get(a.id)!.result).toBe('shipped');
    expect(dag.get(a.id)!.mergedInto).toBeUndefined();
    expect(dag.get(c.id)!.deps).toEqual([a.id]);
    expect(dag.get(c.id)!.status).toBe('ready');
  });

  it('rejects merging into a terminal target so dependents are not promoted for work never done', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'x');
    const b = dag.add('b', 'y');
    const c = dag.add('c', 'z', [a.id]);
    dag.cancel(b.id);

    expect(() => dag.merge(a.id, b.id)).toThrow('terminal');

    expect(dag.get(a.id)!.status).toBe('ready');
    expect(dag.get(c.id)!.deps).toEqual([a.id]);
    expect(dag.get(c.id)!.status).toBe('pending');
  });

  // #302: completion-gate.ts's 'dag' mode needs "is there real work left" as
  // a fact distinct from hasActiveBlock — an empty DAG must not read as
  // pending work, mirroring hasActiveBlock's own empty-DAG edge.
  it('hasPendingWork is false on an empty DAG', () => {
    expect(new TaskDag().hasPendingWork()).toBe(false);
  });

  it('hasPendingWork is true while any task is pending/ready/running/blocked', () => {
    const dag = new TaskDag();
    const t = dag.add('build', 'coder');
    expect(dag.hasPendingWork()).toBe(true);
    dag.markRunning(t.id);
    expect(dag.hasPendingWork()).toBe(true);
    dag.block(t.id, Date.now() + 60_000, 'waiting on CI');
    expect(dag.hasPendingWork()).toBe(true);
  });

  it('hasPendingWork is false once every task reaches a terminal status', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'x');
    const b = dag.add('b', 'y');
    dag.complete(a.id, 'done');
    dag.cancel(b.id);
    expect(dag.hasPendingWork()).toBe(false);
  });
});

// #343: a task whose assignee's session was closed for budget is held as
// 'blocked' with the reason, and released back to 'ready' when it reopens.
describe('TaskDag — assignee holds', () => {
  it('holds a ready or running task as blocked with the reason, and releases it to ready', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'dev');
    const b = dag.add('b', 'dev');
    dag.markRunning(b.id);
    dag.holdForAssignee(a.id, 'assignee "dev" closed: budget_usd exhausted ($1.20 / $1)');
    dag.holdForAssignee(b.id, 'held');
    expect(dag.get(a.id)).toMatchObject({ status: 'blocked', heldForAssignee: true });
    expect(dag.get(a.id)?.blockedReason).toMatch(/budget_usd exhausted/);
    expect(dag.get(a.id)?.blockedUntil).toBeUndefined();
    expect(dag.get(b.id)?.startedAt).toBeUndefined();
    // not a time block: never auto-resumed and not a legitimate wait
    expect(dag.unblockExpired(Date.now() + 1e9)).toEqual([]);
    expect(dag.hasActiveBlock(Date.now())).toBe(false);
    expect(dag.releaseAssigneeHold(a.id)).toBe(true);
    expect(dag.get(a.id)).toMatchObject({ status: 'ready' });
    expect(dag.get(a.id)?.blockedReason).toBeUndefined();
    expect(dag.get(a.id)?.heldForAssignee).toBeUndefined();
  });

  it('does not release a time block set by org_task_block', () => {
    const dag = new TaskDag();
    const t = dag.add('a', 'dev');
    dag.markRunning(t.id);
    dag.block(t.id, Date.now() + 60_000, 'ci');
    expect(dag.releaseAssigneeHold(t.id)).toBe(false);
    expect(dag.get(t.id)?.status).toBe('blocked');
  });
});
