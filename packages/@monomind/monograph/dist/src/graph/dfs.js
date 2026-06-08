export function dfsTraversal(startId, adjacency, visitor, options = {}) {
    if (!adjacency.has(startId))
        return;
    const { maxDepth = Infinity } = options;
    const visited = new Set();
    const stack = [{ id: startId, depth: 0 }];
    while (stack.length > 0) {
        const { id, depth } = stack.pop();
        if (visited.has(id))
            continue;
        visited.add(id);
        visitor({ id, depth });
        if (depth < maxDepth) {
            const neighbors = adjacency.get(id) ?? [];
            // Push in reverse order so left-most neighbor is processed first (DFS left-to-right order)
            for (let i = neighbors.length - 1; i >= 0; i--) {
                const neighbor = neighbors[i];
                if (!visited.has(neighbor)) {
                    stack.push({ id: neighbor, depth: depth + 1 });
                }
            }
        }
    }
}
//# sourceMappingURL=dfs.js.map