import { describe, it, expect } from 'vitest';

import { buildDAG, detectCycles, topologicalSort } from '../../packages/@monomind/cli/src/workflow/dag-builder.js';
import type { DAGTask } from '../../packages/@monomind/cli/src/workflow/dag-types.js';

describe('DAG Builder', () => {
  it('builds DAG from tasks with no deps', () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester' },
    ];
    const dag = buildDAG(tasks);
    expect(dag.tasks.size).toBe(2);
  });

  it('builds correct edges from contextDeps', () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const dag = buildDAG(tasks);
    expect(dag.edges.get('a')?.has('b')).toBe(true);
    expect(dag.reverseEdges.get('b')?.has('a')).toBe(true);
  });

  it('throws on missing dependency', () => {
    const tasks: DAGTask[] = [
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['nonexistent'] },
    ];
    expect(() => buildDAG(tasks)).toThrow('nonexistent');
  });

  it('detects cycles', () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder', contextDeps: ['b'] },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const dag = buildDAG(tasks);
    const cycles = detectCycles(dag);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('returns empty cycles for acyclic graph', () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const dag = buildDAG(tasks);
    expect(detectCycles(dag)).toHaveLength(0);
  });

  it('topologicalSort returns correct levels', () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
      { id: 'c', description: 'C', agentSlug: 'reviewer', contextDeps: ['a'] },
      { id: 'd', description: 'D', agentSlug: 'deployer', contextDeps: ['b', 'c'] },
    ];
    const dag = buildDAG(tasks);
    const levels = topologicalSort(dag);
    expect(levels[0].map(t => t.id)).toContain('a');
    expect(levels[1].map(t => t.id).sort()).toEqual(['b', 'c']);
    expect(levels[2].map(t => t.id)).toContain('d');
  });

  it('handles empty task list', () => {
    const dag = buildDAG([]);
    expect(topologicalSort(dag)).toHaveLength(0);
  });
});
