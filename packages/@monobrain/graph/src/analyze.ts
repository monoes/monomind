import type Graph from 'graphology';
import type { GodNode, SurpriseEdge, GraphAnalysis, GraphStats, Confidence } from './types.js';

/**
 * Find the most connected nodes (god nodes) — core abstractions of the codebase.
 * Sorted by total degree (in + out), descending.
 */
export function godNodes(graph: Graph, topN = 15): GodNode[] {
  const nodes: GodNode[] = [];

  graph.forEachNode((id, attrs) => {
    nodes.push({
      id,
      label: (attrs.label as string) || id,
      degree: graph.degree(id),
      community: attrs.community as number | undefined,
      sourceFile: (attrs.sourceFile as string) || '',
      neighbors: graph
        .neighbors(id)
        .slice(0, 8)
        .map((n) => (graph.getNodeAttribute(n, 'label') as string) || n),
    });
  });

  return nodes.sort((a, b) => b.degree - a.degree).slice(0, topN);
}

/**
 * Find surprising cross-community connections.
 * An edge is surprising when its endpoints belong to different communities.
 * Scored by the product of their degrees — high degree on both sides = high surprise.
 */
export function surprisingConnections(graph: Graph, topN = 20): SurpriseEdge[] {
  const surprises: SurpriseEdge[] = [];

  graph.forEachEdge((_, attrs, source, target) => {
    const cu = graph.getNodeAttribute(source, 'community') as number | undefined;
    const cv = graph.getNodeAttribute(target, 'community') as number | undefined;

    if (cu !== undefined && cv !== undefined && cu !== cv) {
      surprises.push({
        from: (graph.getNodeAttribute(source, 'label') as string) || source,
        fromCommunity: cu,
        fromFile: (graph.getNodeAttribute(source, 'sourceFile') as string) || '',
        to: (graph.getNodeAttribute(target, 'label') as string) || target,
        toCommunity: cv,
        toFile: (graph.getNodeAttribute(target, 'sourceFile') as string) || '',
        relation: (attrs.relation as string) || '',
        confidence: (attrs.confidence as Confidence) ?? 'AMBIGUOUS',
        score: graph.degree(source) * graph.degree(target),
      });
    }
  });

  return surprises.sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Compute high-level graph statistics.
 */
export function graphStats(graph: Graph, graphPath?: string): GraphStats {
  const confidence: Record<string, number> = {};
  const relations: Record<string, number> = {};
  const fileTypes: Record<string, number> = {};
  const commSet = new Set<number>();

  graph.forEachEdge((_, attrs) => {
    const c = (attrs.confidence as string) || 'UNKNOWN';
    confidence[c] = (confidence[c] ?? 0) + 1;

    const r = (attrs.relation as string) || 'unknown';
    relations[r] = (relations[r] ?? 0) + 1;
  });

  graph.forEachNode((_, attrs) => {
    const ft = (attrs.fileType as string) || 'unknown';
    fileTypes[ft] = (fileTypes[ft] ?? 0) + 1;

    const c = attrs.community as number | undefined;
    if (c !== undefined) commSet.add(c);
  });

  const topRelations = Object.fromEntries(
    Object.entries(relations)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10),
  );

  return {
    nodes: graph.order,
    edges: graph.size,
    communities: commSet.size,
    confidence: confidence as Record<Confidence, number>,
    fileTypes,
    topRelations,
    isDirected: graph.type === 'directed',
    graphPath,
  };
}

/**
 * Build a complete GraphAnalysis object from an annotated graph.
 * Assumes community detection has already been run (nodes have `community` attribute).
 */
export function buildAnalysis(graph: Graph, graphPath?: string): GraphAnalysis {
  // Reconstruct communities map from node attributes
  const communities: Record<number, string[]> = {};
  graph.forEachNode((id, attrs) => {
    const c = attrs.community as number | undefined;
    if (c !== undefined) {
      if (!communities[c]) communities[c] = [];
      communities[c].push(id);
    }
  });

  return {
    godNodes: godNodes(graph),
    surprises: surprisingConnections(graph),
    communities,
    stats: graphStats(graph, graphPath),
  };
}
