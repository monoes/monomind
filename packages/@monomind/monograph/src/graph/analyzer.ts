import { bidirectional } from 'graphology-shortest-path';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import type Graph from 'graphology';
import type { MonographDb } from '../storage/db.js';
import { loadGraphFromDb } from './loader.js';

export function getShortestPath(
  db: MonographDb,
  sourceId: string,
  targetId: string,
  maxDepth = 6,
): string[] | null {
  const graph = loadGraphFromDb(db);
  if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) return null;
  try {
    const path = bidirectional(graph, sourceId, targetId);
    if (path && path.length <= maxDepth + 1) return path;
    return null;
  } catch {
    return null;
  }
}

/**
 * Computes betweenness centrality for all nodes in the graph.
 * Returns a Map from node id to centrality score (0–1 normalized).
 *
 * Betweenness centrality measures how often a node appears on the
 * shortest path between other node pairs. High-centrality nodes are
 * structural bridges — refactoring them has wide blast radius.
 */
export function getBetweennessCentrality(db: MonographDb): Map<string, number> {
  const graph = loadGraphFromDb(db);
  if (graph.order === 0) return new Map();
  const scores = betweennessCentrality(graph, { normalized: true });
  return new Map(Object.entries(scores));
}

export function getNodeDegrees(graph: Graph, nodeId: string): { in: number; out: number } {
  if (!graph.hasNode(nodeId)) return { in: 0, out: 0 };
  return {
    in: graph.inDegree ? graph.inDegree(nodeId) : 0,
    out: graph.outDegree ? graph.outDegree(nodeId) : 0,
  };
}
