import { bidirectional } from 'graphology-shortest-path';
import { createHash } from 'crypto';
import type Graph from 'graphology';
import type Database from 'better-sqlite3';
import type { MonographDb } from '../storage/db.js';
import { loadGraphFromDb } from './loader.js';

/**
 * Deterministic 16-hex fingerprint for a finding.
 * Stable across runs: same ruleId + filePath + extraParts → same fingerprint.
 * Used for deduplication in baseline comparison and Linear/GitHub issue tracking.
 */
export function fingerprintFinding(ruleId: string, filePath: string, ...extraParts: string[]): string {
  return createHash('sha256')
    .update([ruleId, filePath, ...extraParts].join('\0'))
    .digest('hex')
    .slice(0, 16);
}

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

// ── Effective Blast Radius ────────────────────────────────────────────────────

export interface BlastRadiusOptions {
  /** Walk forward edges (what this node affects). Defaults to true. */
  forward?: boolean;
  /** Walk backward edges (what affects this node). Defaults to true. */
  backward?: boolean;
  /** Max hop depth. Defaults to 5. */
  maxDepth?: number;
  /** Only include nodes that also reference ALL of these node IDs. */
  mustReferenceAll?: string[];
  /** Exclude nodes that reference any of these node IDs. */
  excludeReferencing?: string[];
}

export interface BlastRadiusResult {
  nodeId: string;
  nodeName: string;
  nodeLabel: string;
  filePath: string | null;
  hops: number;
  direction: 'forward' | 'backward' | 'both';
  /** Edge relation types used to reach this node. */
  reachableVia: string[];
}

/**
 * Compute the bidirectional effective blast radius from a starting node.
 * Inspired by Logseq's effective-refs pattern — memoizes the transitive
 * reference set and supports include/exclude filtering.
 *
 * @param db - better-sqlite3 Database instance
 * @param startNodeId - ID of the node to start from
 * @param options - BFS options (forward, backward, maxDepth, filters)
 * @returns Array of reachable nodes sorted by hops ASC, name ASC
 */
export function effectiveBlastRadius(
  db: Database.Database,
  startNodeId: string,
  options: BlastRadiusOptions = {},
): BlastRadiusResult[] {
  const forward = options.forward ?? true;
  const backward = options.backward ?? true;
  const maxDepth = options.maxDepth ?? 5;
  const mustReferenceAll = options.mustReferenceAll ?? [];
  const excludeReferencing = options.excludeReferencing ?? [];

  // ── Step 1: Build adjacency maps ──────────────────────────────────────────
  type EdgeEntry = { id: string; relation: string };

  const forwardMap = new Map<string, EdgeEntry[]>();
  const backwardMap = new Map<string, EdgeEntry[]>();

  const allEdges = db.prepare(
    'SELECT source_id, target_id, relation FROM edges',
  ).all() as Array<{ source_id: string; target_id: string; relation: string }>;

  for (const edge of allEdges) {
    if (!forwardMap.has(edge.source_id)) forwardMap.set(edge.source_id, []);
    forwardMap.get(edge.source_id)!.push({ id: edge.target_id, relation: edge.relation });

    if (!backwardMap.has(edge.target_id)) backwardMap.set(edge.target_id, []);
    backwardMap.get(edge.target_id)!.push({ id: edge.source_id, relation: edge.relation });
  }

  // ── Step 2: BFS from startNodeId in both directions ───────────────────────
  // Track per-node: earliest direction it was reached and all relation types
  const visited = new Map<string, {
    hops: number;
    direction: 'forward' | 'backward' | 'both';
    relations: Set<string>;
  }>();

  interface QueueItem {
    id: string;
    hops: number;
    direction: 'forward' | 'backward';
    via: string[];
  }

  const queue: QueueItem[] = [];

  if (forward) queue.push({ id: startNodeId, hops: 0, direction: 'forward', via: [] });
  if (backward) queue.push({ id: startNodeId, hops: 0, direction: 'backward', via: [] });

  let qi = 0;
  while (qi < queue.length) {
    const { id, hops, direction, via } = queue[qi++];

    if (hops >= maxDepth) continue;

    const neighbors = direction === 'forward'
      ? (forwardMap.get(id) ?? [])
      : (backwardMap.get(id) ?? []);

    for (const neighbor of neighbors) {
      if (neighbor.id === startNodeId) continue;

      const existing = visited.get(neighbor.id);
      if (existing) {
        // Already visited — update direction to 'both' if reached from the other direction
        if (existing.direction !== direction && existing.direction !== 'both') {
          existing.direction = 'both';
        }
        existing.relations.add(neighbor.relation);
        // Do not re-enqueue — only enqueue if hops would decrease (not needed in BFS)
        continue;
      }

      const newVia = [...via, neighbor.relation];
      visited.set(neighbor.id, {
        hops: hops + 1,
        direction,
        relations: new Set(newVia),
      });
      queue.push({ id: neighbor.id, hops: hops + 1, direction, via: newVia });
    }
  }

  // ── Step 3: Resolve node details ─────────────────────────────────────────
  if (visited.size === 0) return [];

  const ids = [...visited.keys()];
  // SQLite has a bind-param limit; chunk if needed
  const chunkSize = 500;
  const nodeMap = new Map<string, { name: string; label: string; file_path: string | null }>();

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, name, label, file_path FROM nodes WHERE id IN (${placeholders})`,
    ).all(...chunk) as Array<{ id: string; name: string; label: string; file_path: string | null }>;
    for (const row of rows) {
      nodeMap.set(row.id, { name: row.name, label: row.label, file_path: row.file_path });
    }
  }

  // ── Step 4: Apply mustReferenceAll filter ─────────────────────────────────
  const checkEdgeExists = db.prepare(
    'SELECT COUNT(*) as c FROM edges WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)',
  );

  function hasEdge(a: string, b: string): boolean {
    const row = checkEdgeExists.get(a, b, b, a) as { c: number };
    return row.c > 0;
  }

  let candidateIds = ids;

  if (mustReferenceAll.length > 0) {
    candidateIds = candidateIds.filter((candidateId) =>
      mustReferenceAll.every((requiredId) => hasEdge(candidateId, requiredId)),
    );
  }

  // ── Step 5: Apply excludeReferencing filter ───────────────────────────────
  if (excludeReferencing.length > 0) {
    candidateIds = candidateIds.filter((candidateId) =>
      !excludeReferencing.some((excludedId) => hasEdge(candidateId, excludedId)),
    );
  }

  // ── Step 6: Assemble results ──────────────────────────────────────────────
  const results: BlastRadiusResult[] = [];

  for (const nodeId of candidateIds) {
    const meta = nodeMap.get(nodeId);
    if (!meta) continue; // node not in db (edge to deleted node)

    const entry = visited.get(nodeId)!;
    results.push({
      nodeId,
      nodeName: meta.name,
      nodeLabel: meta.label,
      filePath: meta.file_path,
      hops: entry.hops,
      direction: entry.direction,
      reachableVia: [...entry.relations],
    });
  }

  // Sort by hops ASC, then name ASC
  results.sort((a, b) => a.hops - b.hops || a.nodeName.localeCompare(b.nodeName));

  return results;
}
