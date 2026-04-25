import type { DAG, DAGTask, DAGLevel } from './dag-types.js';

/**
 * Builds a DAG from an array of tasks using their contextDeps.
 * Throws if any task references a dependency that doesn't exist.
 */
export function buildDAG(tasks: DAGTask[]): DAG {
  const taskMap = new Map<string, DAGTask>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  // Register all tasks
  for (const task of tasks) {
    taskMap.set(task.id, task);
    edges.set(task.id, new Set());
    reverseEdges.set(task.id, new Set());
  }

  // Build edges from contextDeps
  for (const task of tasks) {
    const deps = task.contextDeps ?? [];
    for (const dep of deps) {
      if (!taskMap.has(dep)) {
        throw new Error(
          `Task "${task.id}" depends on "${dep}" which does not exist in the task list`
        );
      }
      // dep → task (dep is upstream, task is downstream)
      edges.get(dep)!.add(task.id);
      reverseEdges.get(task.id)!.add(dep);
    }
  }

  return { tasks: taskMap, edges, reverseEdges };
}

/**
 * Detects cycles in the DAG using DFS.
 * Returns an array of cycles, where each cycle is an array of task IDs.
 */
export function detectCycles(dag: DAG): string[][] {
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const id of dag.tasks.keys()) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);
    const neighbors = dag.edges.get(u) ?? new Set<string>();

    for (const v of neighbors) {
      if (color.get(v) === GRAY) {
        // Found a cycle — reconstruct it
        const cycle: string[] = [v];
        let curr = u;
        while (curr !== v) {
          cycle.push(curr);
          curr = parent.get(curr)!;
        }
        cycle.push(v);
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }

    color.set(u, BLACK);
  }

  for (const id of dag.tasks.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

/**
 * Performs topological sort using Kahn's algorithm.
 * Returns levels (arrays of tasks that can execute in parallel).
 */
export function topologicalSort(dag: DAG): DAGLevel[] {
  if (dag.tasks.size === 0) return [];

  // Compute in-degree for each node
  const inDegree = new Map<string, number>();
  for (const id of dag.tasks.keys()) {
    inDegree.set(id, (dag.reverseEdges.get(id) ?? new Set()).size);
  }

  // Start with nodes that have no dependencies
  let currentLevel: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      currentLevel.push(id);
    }
  }

  const levels: DAGLevel[] = [];

  while (currentLevel.length > 0) {
    // Resolve current level tasks
    const levelTasks: DAGTask[] = currentLevel.map(id => dag.tasks.get(id)!);
    levels.push(levelTasks);

    const nextLevel: string[] = [];

    for (const id of currentLevel) {
      const dependents = dag.edges.get(id) ?? new Set<string>();
      for (const dep of dependents) {
        const newDeg = inDegree.get(dep)! - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          nextLevel.push(dep);
        }
      }
    }

    currentLevel = nextLevel;
  }

  return levels;
}
