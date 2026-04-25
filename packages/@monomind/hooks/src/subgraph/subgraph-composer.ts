/**
 * SubGraphComposer — Validates and composes subgraphs into topologies (Task 48)
 */

import type { CompiledSubGraph, ComposedTopology, Edge } from './types.js';

/**
 * Validate that sequential key contracts are satisfied.
 *
 * For each consecutive pair, upstream outputKeys must include all downstream inputKeys.
 * The first subgraph's inputKeys are not validated (they come from the parent context).
 */
export function validateKeyContracts(subGraphs: CompiledSubGraph[]): void {
  for (let i = 1; i < subGraphs.length; i++) {
    const upstream = subGraphs[i - 1];
    const downstream = subGraphs[i];

    for (const key of downstream.inputKeys) {
      if (!upstream.outputKeys.includes(key)) {
        throw new Error(
          `Key contract violation: subgraph "${downstream.subGraphId}" requires input key "${key}" ` +
          `but upstream subgraph "${upstream.subGraphId}" does not provide it in outputKeys`,
        );
      }
    }
  }
}

/**
 * Compose multiple compiled subgraphs into a ComposedTopology.
 *
 * - Sequential: generates connection edges between consecutive subgraphs and validates key contracts.
 * - Parallel: no connection edges.
 * - Minimum 2 subgraphs required.
 */
export function compose(
  subGraphs: CompiledSubGraph[],
  topology: 'sequential' | 'parallel' | 'conditional',
  stateMergeStrategy: string,
): ComposedTopology {
  if (subGraphs.length < 2) {
    throw new Error('At least 2 subgraphs are required to compose a topology');
  }

  let connectionEdges: Edge[] = [];

  if (topology === 'sequential') {
    validateKeyContracts(subGraphs);

    connectionEdges = [];
    for (let i = 0; i < subGraphs.length - 1; i++) {
      connectionEdges.push({
        id: `conn-${i}`,
        sourceNodeId: subGraphs[i].subGraphId,
        targetNodeId: subGraphs[i + 1].subGraphId,
        type: 'sequential',
      });
    }
  }

  return {
    topologyId: `topo-${Date.now()}`,
    subGraphs,
    connectionEdges,
    topology,
    stateMergeStrategy,
    composedAt: new Date().toISOString(),
  };
}
