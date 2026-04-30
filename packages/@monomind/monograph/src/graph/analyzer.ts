import { bidirectional } from 'graphology-shortest-path';
import type Graph from 'graphology';
import type { MonographDb } from '../storage/db.js';
import type { GodNode } from '../types.js';
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

export function getNodeDegrees(graph: Graph, nodeId: string): { in: number; out: number } {
  if (!graph.hasNode(nodeId)) return { in: 0, out: 0 };
  return {
    in: graph.inDegree ? graph.inDegree(nodeId) : 0,
    out: graph.outDegree ? graph.outDegree(nodeId) : 0,
  };
}
