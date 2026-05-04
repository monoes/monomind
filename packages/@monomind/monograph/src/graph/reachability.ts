import { ModuleNode, ModuleNodeFlags, setFlag } from './node-types.js';

export interface ReachabilityOptions {
  runtimeEntries?: Set<number>;
  testEntries?: Set<number>;
}

function bfsReachable(
  nodes: Map<number, ModuleNode>,
  edges: Map<number, number[]>,
  entryPoints: number[],
): Set<number> {
  const visited = new Set<number>();
  const queue: number[] = [];

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

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

export function markReachable(
  nodes: Map<number, ModuleNode>,
  edges: Map<number, number[]>,
  entryPoints: number[],
  opts?: ReachabilityOptions,
): void {
  const entrySet = new Set(entryPoints);
  const visited = bfsReachable(nodes, edges, entryPoints);

  const runtimeEntries = opts?.runtimeEntries;
  const testEntries = opts?.testEntries;

  const runtimeSame = runtimeEntries === undefined || setsEqual(runtimeEntries, entrySet);
  const runtimeVisited = runtimeSame
    ? null
    : bfsReachable(nodes, edges, [...(runtimeEntries ?? [])]);

  const testVisited =
    !testEntries || testEntries.size === 0
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

export function collectReachable(nodes: Map<number, ModuleNode>): Set<number> {
  const result = new Set<number>();
  for (const [id, node] of nodes) {
    if ((node.flags & ModuleNodeFlags.REACHABLE) !== 0) {
      result.add(id);
    }
  }
  return result;
}

export function collectUnreachable(
  nodes: Map<number, ModuleNode>,
  allFileIds: number[],
): number[] {
  return allFileIds.filter(id => {
    const node = nodes.get(id);
    return !node || (node.flags & ModuleNodeFlags.REACHABLE) === 0;
  });
}
