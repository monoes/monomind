import type { MonographDb } from '../storage/db.js';

/**
 * Find all strongly connected components (SCCs) with more than 1 node,
 * or self-loops, and return them as cycle node lists.
 *
 * Uses Kosaraju's algorithm to find SCCs. Each SCC with size > 1 represents
 * a cycle. Self-loops (node -> itself) are also detected separately.
 *
 * @param db - The MonographDb instance
 * @returns Array of cycles; each cycle is an array of node ids participating in it.
 */
export function findCycles(db: MonographDb): string[][] {
  const nodeRows = db.prepare('SELECT id FROM nodes').all() as { id: string }[];
  const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all() as {
    source_id: string;
    target_id: string;
  }[];

  if (nodeRows.length === 0) return [];

  const nodes = nodeRows.map(r => r.id);
  const nodeSet = new Set(nodes);

  // Build adjacency list and reverse adjacency list
  const adj = new Map<string, string[]>();
  const radj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n, []);
    radj.set(n, []);
  }

  const selfLoops = new Set<string>();

  for (const { source_id: src, target_id: tgt } of edgeRows) {
    if (!nodeSet.has(src) || !nodeSet.has(tgt)) continue;
    if (src === tgt) {
      selfLoops.add(src);
      continue;
    }
    adj.get(src)!.push(tgt);
    radj.get(tgt)!.push(src);
  }

  // Kosaraju's algorithm — pass 1: DFS on original graph, build finish order
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  function dfs1(node: string): void {
    visited.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) dfs1(neighbor);
    }
    finishOrder.push(node);
  }

  for (const node of nodes) {
    if (!visited.has(node)) dfs1(node);
  }

  // Kosaraju's algorithm — pass 2: DFS on reverse graph in reverse finish order
  const assigned = new Set<string>();
  const sccs: string[][] = [];

  function dfs2(node: string, component: string[]): void {
    assigned.add(node);
    component.push(node);
    for (const neighbor of radj.get(node) ?? []) {
      if (!assigned.has(neighbor)) dfs2(neighbor, component);
    }
  }

  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const node = finishOrder[i];
    if (!assigned.has(node)) {
      const component: string[] = [];
      dfs2(node, component);
      if (component.length > 1) {
        sccs.push(component);
      }
    }
  }

  // Add self-loops as single-element cycles
  for (const node of selfLoops) {
    sccs.push([node]);
  }

  return sccs;
}
