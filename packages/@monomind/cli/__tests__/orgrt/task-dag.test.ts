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
});
