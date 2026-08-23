/**
 * Dynamic TaskDag tests — graph engineering playbook improvements #1.
 */

import { describe, expect, it } from 'vitest';
import { TaskDag } from '../../packages/@monomind/cli/src/orgrt/task-dag.js';

describe('TaskDag — existing behavior (regression guard)', () => {
  it('add creates a task that is ready when it has no deps', () => {
    const dag = new TaskDag();
    const t = dag.add('do thing', 'coder');
    expect(t.status).toBe('ready');
    expect(t.id).toBe('task-1');
  });

  it('add with deps keeps task pending until deps are done', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'tester', [a.id]);
    expect(b.status).toBe('pending');
    dag.complete(a.id);
    expect(dag.get(b.id)?.status).toBe('ready');
  });

  it('rejects unknown dependency at add time', () => {
    const dag = new TaskDag();
    expect(() => dag.add('x', 'coder', ['nope'])).toThrow(/does not exist/);
  });

  it('rejects a self-referencing dependency at add time', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'coder', [a.id]);
    expect(() => dag.add('c', 'coder', [b.id, 'c'])).toThrow(/does not exist/);
  });

  it('serializes and restores via toJSON / fromJSON', () => {
    const dag = new TaskDag();
    dag.add('a', 'coder');
    const json = dag.toJSON();
    const restored = TaskDag.fromJSON(json);
    expect(restored.all()).toHaveLength(1);
    expect(restored.get('task-1')?.title).toBe('a');
  });
});

describe('TaskDag.split — scope expansion', () => {
  it('marks the parent as "split" and creates children', () => {
    const dag = new TaskDag();
    const parent = dag.add('investigate bug', 'researcher');
    const children = dag.split(parent.id, [
      { title: 'repro', assignee: 'tester' },
      { title: 'root-cause', assignee: 'coder' },
    ]);
    expect(children).toHaveLength(2);
    expect(dag.get(parent.id)?.status).toBe('split');
    expect(children[0].splitFrom).toBe(parent.id);
    expect(children[1].splitFrom).toBe(parent.id);
  });

  it("children inherit the parent's deps so they become ready at the same gate", () => {
    const dag = new TaskDag();
    const prereq = dag.add('prereq', 'coder');
    const parent = dag.add('parent', 'researcher', [prereq.id]);
    expect(parent.status).toBe('pending');
    dag.complete(prereq.id);
    expect(dag.get(parent.id)?.status).toBe('ready');
    const children = dag.split(parent.id, [
      { title: 'child-a', assignee: 'tester' },
      { title: 'child-b', assignee: 'coder' },
    ]);
    for (const c of children) expect(c.status).toBe('ready');
  });

  it('rewrites downstream deps on the parent to depend on all children', () => {
    const dag = new TaskDag();
    const parent = dag.add('parent', 'researcher');
    const downstream = dag.add('downstream', 'coder', [parent.id]);
    const [c1, c2] = dag.split(parent.id, [
      { title: 'c1', assignee: 'tester' },
      { title: 'c2', assignee: 'coder' },
    ]);
    expect(downstream.deps).toContain(c1.id);
    expect(downstream.deps).toContain(c2.id);
    expect(downstream.deps).not.toContain(parent.id);
  });

  it('throws when the parent id does not exist', () => {
    const dag = new TaskDag();
    expect(() => dag.split('ghost', [{ title: 'x', assignee: 'coder' }])).toThrow(/not found/);
  });

  it('throws when the parent is already terminal', () => {
    const dag = new TaskDag();
    const t = dag.add('t', 'coder');
    dag.complete(t.id);
    expect(() => dag.split(t.id, [{ title: 'x', assignee: 'coder' }])).toThrow(/terminal/);
  });
});

describe('TaskDag.merge — early convergence', () => {
  it('marks the source as "merged" and records the target', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'coder');
    dag.merge(a.id, b.id);
    expect(dag.get(a.id)?.status).toBe('merged');
    expect(dag.get(a.id)?.mergedInto).toBe(b.id);
  });

  it('rewrites downstream deps on the source to point at the target', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'coder');
    const downstream = dag.add('downstream', 'tester', [a.id]);
    dag.merge(a.id, b.id);
    expect(downstream.deps).toContain(b.id);
    expect(downstream.deps).not.toContain(a.id);
  });

  it("target absorbs the source's deps (deduped, no self-dep)", () => {
    const dag = new TaskDag();
    const prereq = dag.add('prereq', 'coder');
    const a = dag.add('a', 'coder', [prereq.id]);
    const b = dag.add('b', 'coder');
    dag.merge(a.id, b.id);
    expect(dag.get(b.id)?.deps).toContain(prereq.id);
  });

  it('throws when source or target does not exist', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    expect(() => dag.merge(a.id, 'ghost')).toThrow(/not found/);
    expect(() => dag.merge('ghost', a.id)).toThrow(/not found/);
  });

  it('throws when merging a task into itself', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    expect(() => dag.merge(a.id, a.id)).toThrow(/into itself/);
  });
});

describe('TaskDag.cancel — evidence made it moot', () => {
  it('marks the task as "cancelled" with an optional reason', () => {
    const dag = new TaskDag();
    const t = dag.add('t', 'coder');
    dag.cancel(t.id, 'evidence showed it was unnecessary');
    expect(dag.get(t.id)?.status).toBe('cancelled');
    expect(dag.get(t.id)?.result).toBe('evidence showed it was unnecessary');
  });

  it('unblocks downstream tasks (cancelled satisfies deps like done)', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'tester', [a.id]);
    expect(b.status).toBe('pending');
    dag.cancel(a.id);
    expect(dag.get(b.id)?.status).toBe('ready');
  });

  it('throws when the task does not exist', () => {
    const dag = new TaskDag();
    expect(() => dag.cancel('ghost')).toThrow(/not found/);
  });

  it('throws when the task is already terminal', () => {
    const dag = new TaskDag();
    const t = dag.add('t', 'coder');
    dag.complete(t.id);
    expect(() => dag.cancel(t.id)).toThrow(/terminal/);
  });
});

describe('TaskDag — combined dynamic rewrites (the playbook scenarios)', () => {
  it('scenario: split a ready task, complete one child, downstream still blocked until all children done', () => {
    const dag = new TaskDag();
    const research = dag.add('research', 'researcher');
    const write = dag.add('write report', 'writer', [research.id]);
    const [repro, rootCause] = dag.split(research.id, [
      { title: 'gather repro', assignee: 'tester' },
      { title: 'find root cause', assignee: 'coder' },
    ]);
    expect(write.deps).toEqual(expect.arrayContaining([repro.id, rootCause.id]));
    dag.complete(repro.id);
    expect(dag.get(write.id)?.status).toBe('pending');
    dag.complete(rootCause.id);
    expect(dag.get(write.id)?.status).toBe('ready');
  });

  it('scenario: two parallel branches converge early via merge', () => {
    const dag = new TaskDag();
    const a = dag.add('approach-a', 'coder');
    const b = dag.add('approach-b', 'coder');
    const integrate = dag.add('integrate', 'lead', [a.id, b.id]);
    dag.complete(a.id);
    dag.merge(b.id, a.id);
    expect(dag.get(integrate.id)?.status).toBe('ready');
  });

  it('scenario: a planned task is cancelled before it starts, downstream proceeds', () => {
    const dag = new TaskDag();
    const setup = dag.add('setup env', 'devops');
    const legacy = dag.add('migrate legacy data', 'coder', [setup.id]);
    const ship = dag.add('ship', 'devops', [legacy.id]);
    dag.complete(setup.id);
    dag.cancel(legacy.id, 'no legacy data found');
    expect(dag.get(ship.id)?.status).toBe('ready');
  });
});

describe('TaskDag — JSON round-trip preserves dynamic metadata', () => {
  it('splitFrom, mergedInto, and cancelled status survive toJSON + fromJSON', () => {
    const dag = new TaskDag();
    const parent = dag.add('parent', 'researcher');
    const [child] = dag.split(parent.id, [{ title: 'child', assignee: 'coder' }]);
    const other = dag.add('other', 'coder');
    dag.merge(child.id, other.id);
    const t = dag.add('t', 'coder');
    dag.cancel(t.id, 'moot');

    const restored = TaskDag.fromJSON(dag.toJSON());
    expect(restored.get(parent.id)?.status).toBe('split');
    expect(restored.get(child.id)?.status).toBe('merged');
    expect(restored.get(child.id)?.mergedInto).toBe(other.id);
    expect(restored.get(child.id)?.splitFrom).toBe(parent.id);
    expect(restored.get(t.id)?.status).toBe('cancelled');
    expect(restored.get(t.id)?.result).toBe('moot');
  });
});
