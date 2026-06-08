import { ModuleNodeFlags, setFlag } from './node-types.js';
function bfsReachable(nodes, edges, entryPoints) {
    const visited = new Set();
    const queue = [];
    for (const ep of entryPoints) {
        if (nodes.has(ep) && !visited.has(ep)) {
            visited.add(ep);
            queue.push(ep);
        }
    }
    let i = 0;
    while (i < queue.length) {
        const current = queue[i++];
        const neighbors = edges.get(current) ?? [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor) && nodes.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return visited;
}
function setsEqual(a, b) {
    if (a.size !== b.size)
        return false;
    for (const v of a) {
        if (!b.has(v))
            return false;
    }
    return true;
}
export function markReachable(nodes, edges, entryPoints, opts) {
    const entrySet = new Set(entryPoints);
    const visited = bfsReachable(nodes, edges, entryPoints);
    const runtimeEntries = opts?.runtimeEntries;
    const testEntries = opts?.testEntries;
    const runtimeSame = runtimeEntries === undefined || setsEqual(runtimeEntries, entrySet);
    const runtimeVisited = runtimeSame
        ? null
        : bfsReachable(nodes, edges, [...(runtimeEntries ?? [])]);
    const testVisited = !testEntries || testEntries.size === 0
        ? null
        : bfsReachable(nodes, edges, [...testEntries]);
    for (const [id, node] of nodes) {
        if (visited.has(id)) {
            setFlag(node, ModuleNodeFlags.REACHABLE);
        }
        if (runtimeVisited ? runtimeVisited.has(id) : visited.has(id)) {
            setFlag(node, ModuleNodeFlags.RUNTIME_REACHABLE);
        }
        if (testVisited?.has(id)) {
            setFlag(node, ModuleNodeFlags.TEST_REACHABLE);
        }
    }
}
export function collectReachable(nodes) {
    const result = new Set();
    for (const [id, node] of nodes) {
        if ((node.flags & ModuleNodeFlags.REACHABLE) !== 0) {
            result.add(id);
        }
    }
    return result;
}
export function collectUnreachable(nodes, allFileIds) {
    return allFileIds.filter(id => {
        const node = nodes.get(id);
        return !node || (node.flags & ModuleNodeFlags.REACHABLE) === 0;
    });
}
//# sourceMappingURL=reachability.js.map