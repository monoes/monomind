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

  // Iterative DFS to avoid call-stack overflow on deep linear DAGs
  function dfs(start: string): void {
    // Stack entries: [nodeId, iterator-over-neighbors, neighborsDone?]
    // We use a frame-based approach mirroring the recursive version.
    type Frame = { u: string; neighbors: Iterator<string>; entered: boolean };
    const stack: Frame[] = [
      { u: start, neighbors: (dag.edges.get(start) ?? new Set<string>()).values(), entered: false },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      if (!frame.entered) {
        frame.entered = true;
        color.set(frame.u, GRAY);
      }

      const { value: v, done } = frame.neighbors.next();
      if (done) {
        color.set(frame.u, BLACK);
        stack.pop();
        continue;
      }

      const vColor = color.get(v);
      if (vColor === GRAY) {
        // Found a cycle — reconstruct it
        const cycle: string[] = [v];
        let curr = frame.u;
        while (curr !== v) {
          cycle.push(curr);
          const next = parent.get(curr);
          if (next == null) break;
          curr = next;
        }
        cycle.push(v);
        cycle.reverse();
        cycles.push(cycle);
      } else if (vColor === WHITE) {
        parent.set(v, frame.u);
        stack.push({ u: v, neighbors: (dag.edges.get(v) ?? new Set<string>()).values(), entered: false });
      }
    }
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
