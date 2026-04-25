import Graph from 'graphology';
import type { ExtractionResult } from './types.js';

/**
 * Build a graphology Graph from extracted nodes and edges.
 * Deduplicates nodes by id, merges parallel edges with higher weight.
 */
export function buildGraph(extraction: ExtractionResult): Graph {
  const graph = new Graph({ type: 'directed', multi: false });

  // Add all nodes — merge attributes if already present (dedup by id)
  for (const node of extraction.nodes) {
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, { ...node });
    } else {
      graph.mergeNodeAttributes(node.id, { ...node });
    }
  }

  // Add edges — skip self-loops, auto-stub missing endpoints
  for (const edge of extraction.edges) {
    if (edge.source === edge.target) continue;

    // Create stub nodes for referenced endpoints not in the extraction
    if (!graph.hasNode(edge.source)) {
      graph.addNode(edge.source, {
        id: edge.source,
        label: edge.source,
        fileType: 'unknown',
        sourceFile: '',
      });
    }
    if (!graph.hasNode(edge.target)) {
      graph.addNode(edge.target, {
        id: edge.target,
        label: edge.target,
        fileType: 'unknown',
        sourceFile: '',
      });
    }

    try {
      graph.addEdge(edge.source, edge.target, {
        relation: edge.relation,
        confidence: edge.confidence,
        confidenceScore: edge.confidenceScore,
        weight: edge.weight ?? 1,
        sourceFile: edge.sourceFile,
        sourceLocation: edge.sourceLocation,
      });
    } catch {
      // Edge already exists — bump its weight
      const existing = graph.edge(edge.source, edge.target);
      if (existing) {
        const prev = (graph.getEdgeAttribute(existing, 'weight') as number) ?? 1;
        graph.setEdgeAttribute(existing, 'weight', prev + 1);
      }
    }
  }

  return graph;
}
