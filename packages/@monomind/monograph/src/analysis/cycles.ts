import type { MonographDb } from '../storage/db.js';

export interface DependencyCycle {
  files: string[];         // file paths forming the cycle, in order
  length: number;
  isCrossCommunity: boolean;  // true if files span multiple communities
  edgeRelations: string[];    // relations used in the cycle edges
}

export interface CycleDetectionResult {
  cycles: DependencyCycle[];
  totalCycles: number;
  filesInCycles: number;
  longestCycle: number;
  crossCommunityCycles: number;
}

interface NodeRow {
  id: string;
  file_path: string | null;
  community_id: number | null;
}

interface EdgeRow {
  source_id: string;
  target_id: string;
  relation: string;
}

/**
 * Iterative Tarjan's SCC algorithm to avoid stack overflow on large graphs.
 * Returns arrays of node IDs, each array is one SCC.
 */
function tarjanSCC(adjacency: Map<string, string[]>, nodes: string[]): string[][] {
  const index: Map<string, number> = new Map();
  const lowlink: Map<string, number> = new Map();
  const onStack: Set<string> = new Set();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  // Iterative DFS using explicit call stack
  for (const startNode of nodes) {
    if (index.has(startNode)) continue;

    // Each frame: [nodeId, neighborIndex, parent]
    type Frame = { node: string; neighborIdx: number };
    const callStack: Frame[] = [{ node: startNode, neighborIdx: 0 }];

    index.set(startNode, counter);
    lowlink.set(startNode, counter);
    counter++;
    stack.push(startNode);
    onStack.add(startNode);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const { node } = frame;
      const neighbors = adjacency.get(node) ?? [];

      if (frame.neighborIdx < neighbors.length) {
        const neighbor = neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        if (!index.has(neighbor)) {
          index.set(neighbor, counter);
          lowlink.set(neighbor, counter);
          counter++;
          stack.push(neighbor);
          onStack.add(neighbor);
          callStack.push({ node: neighbor, neighborIdx: 0 });
        } else if (onStack.has(neighbor)) {
          const curLow = lowlink.get(node)!;
          const neighborIdx = index.get(neighbor)!;
          if (neighborIdx < curLow) {
            lowlink.set(node, neighborIdx);
          }
        }
      } else {
        // Done with this node — pop and propagate lowlink to parent
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1].node;
          const parentLow = lowlink.get(parent)!;
          const nodeLow = lowlink.get(node)!;
          if (nodeLow < parentLow) {
            lowlink.set(parent, nodeLow);
          }
        }

        // If this is an SCC root, pop the stack
        if (lowlink.get(node) === index.get(node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== node);
          sccs.push(scc);
        }
      }
    }
  }

  return sccs;
}

/**
 * Enumerate elementary cycles within a given SCC using DFS.
 * Caps at maxCycles to avoid exponential blowup.
 */
function findCyclesInSCC(
  scc: string[],
  adjacency: Map<string, string[]>,
  maxCycles: number
): string[][] {
  const sccSet = new Set(scc);
  const cycles: string[][] = [];
  const seen = new Set<string>();

  for (const startNode of scc) {
    if (cycles.length >= maxCycles) break;

    const path: string[] = [startNode];
    const onPath = new Set<string>([startNode]);

    const dfs = (node: string): void => {
      if (cycles.length >= maxCycles) return;
      const neighbors = adjacency.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!sccSet.has(neighbor)) continue;
        if (neighbor === startNode && path.length > 1) {
          // Found a cycle — normalize via smallest-index-first rotation
          const canonical = canonicalRotation([...path]);
          const key = canonical.join('\0');
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push([...path, startNode]);
          }
        } else if (!onPath.has(neighbor)) {
          path.push(neighbor);
          onPath.add(neighbor);
          dfs(neighbor);
          path.pop();
          onPath.delete(neighbor);
        }
      }
    };

    dfs(startNode);
  }

  return cycles;
}

function canonicalRotation(cycle: string[]): string[] {
  // Find index of lexicographically smallest element
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

export function detectCycles(db: MonographDb): CycleDetectionResult {
  // Load all File nodes
  const nodeRows = db.prepare(
    `SELECT id, file_path, community_id FROM nodes WHERE label = 'File'`
  ).all() as NodeRow[];

  const nodeMap = new Map<string, NodeRow>();
  for (const row of nodeRows) {
    nodeMap.set(row.id, row);
  }

  // Load all IMPORTS and RE_EXPORTS edges between File nodes
  const edgeRows = db.prepare(
    `SELECT e.source_id, e.target_id, e.relation
     FROM edges e
     WHERE e.relation IN ('IMPORTS', 'RE_EXPORTS')
       AND e.source_id IN (SELECT id FROM nodes WHERE label = 'File')
       AND e.target_id IN (SELECT id FROM nodes WHERE label = 'File')`
  ).all() as EdgeRow[];

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  const edgeRelationMap = new Map<string, string>(); // "src\0tgt" -> relation

  for (const row of nodeRows) {
    adjacency.set(row.id, []);
  }

  for (const edge of edgeRows) {
    const neighbors = adjacency.get(edge.source_id);
    if (neighbors) {
      neighbors.push(edge.target_id);
    }
    edgeRelationMap.set(`${edge.source_id}\0${edge.target_id}`, edge.relation);
  }

  // Run Tarjan's SCC
  const nodeIds = nodeRows.map(n => n.id);
  const sccs = tarjanSCC(adjacency, nodeIds);

  // Only SCCs with size > 1 are actual cycles
  const cycleSCCs = sccs.filter(scc => scc.length > 1);

  const cycles: DependencyCycle[] = [];
  const filesInCyclesSet = new Set<string>();

  for (const scc of cycleSCCs) {
    const elementaryCycles = findCyclesInSCC(scc, adjacency, 20);
    for (const cyclePath of elementaryCycles) {
      // cyclePath is [...nodes, startNode] — last element = first
      const cycleNodes = cyclePath.slice(0, -1);

      for (const nodeId of cycleNodes) {
        filesInCyclesSet.add(nodeId);
      }

      // Collect file paths
      const files = cycleNodes.map(id => nodeMap.get(id)?.file_path ?? id);

      // isCrossCommunity: any two nodes with different community_id
      const communityIds = cycleNodes
        .map(id => nodeMap.get(id)?.community_id)
        .filter((c): c is number => c !== null && c !== undefined);
      const uniqueCommunities = new Set(communityIds);
      const isCrossCommunity = uniqueCommunities.size > 1;

      // Collect edge relations used in this cycle
      const edgeRelations: string[] = [];
      for (let i = 0; i < cyclePath.length - 1; i++) {
        const key = `${cyclePath[i]}\0${cyclePath[i + 1]}`;
        const rel = edgeRelationMap.get(key);
        if (rel && !edgeRelations.includes(rel)) {
          edgeRelations.push(rel);
        }
      }

      cycles.push({
        files,
        length: cycleNodes.length,
        isCrossCommunity,
        edgeRelations,
      });
    }
  }

  // Sort by length ascending
  cycles.sort((a, b) => a.length - b.length);

  const longestCycle = cycles.length > 0 ? Math.max(...cycles.map(c => c.length)) : 0;
  const crossCommunityCycles = cycles.filter(c => c.isCrossCommunity).length;

  return {
    cycles,
    totalCycles: cycles.length,
    filesInCycles: filesInCyclesSet.size,
    longestCycle,
    crossCommunityCycles,
  };
}
