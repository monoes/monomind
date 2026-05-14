import type { DAG, DAGTask, DAGLevel } from './dag-types.js';
/**
 * Builds a DAG from an array of tasks using their contextDeps.
 * Throws if any task references a dependency that doesn't exist.
 */
export declare function buildDAG(tasks: DAGTask[]): DAG;
/**
 * Detects cycles in the DAG using DFS.
 * Returns an array of cycles, where each cycle is an array of task IDs.
 */
export declare function detectCycles(dag: DAG): string[][];
/**
 * Performs topological sort using Kahn's algorithm.
 * Returns levels (arrays of tasks that can execute in parallel).
 */
export declare function topologicalSort(dag: DAG): DAGLevel[];
//# sourceMappingURL=dag-builder.d.ts.map