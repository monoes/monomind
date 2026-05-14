/**
 * Builds a DAG from an array of tasks using their contextDeps.
 * Throws if any task references a dependency that doesn't exist.
 */
export function buildDAG(tasks) {
    const taskMap = new Map();
    const edges = new Map();
    const reverseEdges = new Map();
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
                throw new Error(`Task "${task.id}" depends on "${dep}" which does not exist in the task list`);
            }
            // dep → task (dep is upstream, task is downstream)
            edges.get(dep).add(task.id);
            reverseEdges.get(task.id).add(dep);
        }
    }
    return { tasks: taskMap, edges, reverseEdges };
}
/**
 * Detects cycles in the DAG using DFS.
 * Returns an array of cycles, where each cycle is an array of task IDs.
 */
export function detectCycles(dag) {
    const WHITE = 0; // unvisited
    const GRAY = 1; // in current DFS path
    const BLACK = 2; // fully processed
    const color = new Map();
    const parent = new Map();
    const cycles = [];
    for (const id of dag.tasks.keys()) {
        color.set(id, WHITE);
        parent.set(id, null);
    }
    // Iterative DFS to avoid call-stack overflow on deep linear DAGs
    function dfs(start) {
        const stack = [
            { u: start, neighbors: (dag.edges.get(start) ?? new Set()).values(), entered: false },
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
                const cycle = [v];
                let curr = frame.u;
                while (curr !== v) {
                    cycle.push(curr);
                    const next = parent.get(curr);
                    if (next == null)
                        break;
                    curr = next;
                }
                cycle.push(v);
                cycle.reverse();
                cycles.push(cycle);
            }
            else if (vColor === WHITE) {
                parent.set(v, frame.u);
                stack.push({ u: v, neighbors: (dag.edges.get(v) ?? new Set()).values(), entered: false });
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
export function topologicalSort(dag) {
    if (dag.tasks.size === 0)
        return [];
    // Compute in-degree for each node
    const inDegree = new Map();
    for (const id of dag.tasks.keys()) {
        inDegree.set(id, (dag.reverseEdges.get(id) ?? new Set()).size);
    }
    // Start with nodes that have no dependencies
    let currentLevel = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) {
            currentLevel.push(id);
        }
    }
    const levels = [];
    while (currentLevel.length > 0) {
        // Resolve current level tasks
        const levelTasks = currentLevel.map(id => dag.tasks.get(id));
        levels.push(levelTasks);
        const nextLevel = [];
        for (const id of currentLevel) {
            const dependents = dag.edges.get(id) ?? new Set();
            for (const dep of dependents) {
                const newDeg = inDegree.get(dep) - 1;
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
//# sourceMappingURL=dag-builder.js.map