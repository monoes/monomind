import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

// ── Row → MonographNode mapper ─────────────────────────────────────────────────

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row.id as string,
    label: row.label as MonographNode['label'],
    name: row.name as string,
    normLabel: row.norm_label as string,
    filePath: row.file_path as string | undefined,
    startLine: row.start_line as number | undefined,
    endLine: row.end_line as number | undefined,
    communityId: row.community_id as number | undefined,
    isExported: (row.is_exported as number) === 1,
    language: row.language as string | undefined,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
  };
}

// ── Risk level ─────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export function computeRiskLevel(riskScore: number): RiskLevel {
  if (riskScore > 0.75) return 'CRITICAL';
  if (riskScore > 0.5) return 'HIGH';
  if (riskScore > 0.25) return 'MEDIUM';
  return 'LOW';
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface ImpactOptions {
  minConfidenceScore?: number;
  relationTypes?: string[];
  maxDepth?: number;
}

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographImpactResult {
  node: MonographNode | null;
  directCallers: MonographNode[];
  transitiveCallers: Array<{ depth: number; nodes: MonographNode[] }>;
  affectedFiles: string[];
  riskScore: number;
  riskLevel: RiskLevel;
}

// ── Reverse BFS on CALLS edges ────────────────────────────────────────────────

function reverseBfs(
  startNodeId: string,
  db: Database.Database,
  maxDepth: number,
  options: ImpactOptions = {},
): Map<string, number> {
  const visited = new Map<string, number>([[startNodeId, 0]]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  const relations = options.relationTypes ?? ['CALLS'];
  const placeholders = relations.map(() => '?').join(',');
  const baseQuery = `SELECT source_id FROM edges WHERE target_id = ? AND relation IN (${placeholders})`;
  const query = options.minConfidenceScore !== undefined
    ? `${baseQuery} AND confidence_score >= ?`
    : baseQuery;

  const stmt = db.prepare(query);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const params: unknown[] = [id, ...relations];
    if (options.minConfidenceScore !== undefined) {
      params.push(options.minConfidenceScore);
    }
    const callers = stmt.all(...params) as Array<{ source_id: string }>;
    for (const { source_id } of callers) {
      if (!visited.has(source_id)) {
        visited.set(source_id, depth + 1);
        queue.push({ id: source_id, depth: depth + 1 });
      }
    }
  }

  return visited;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographImpact(
  db: Database.Database,
  input: { name: string; filePath?: string; depth?: number },
): MonographImpactResult {
  const maxDepth = Math.min(input.depth ?? 3, 6);

  // Find the node
  let nodeRow: Record<string, unknown> | undefined;
  if (input.filePath) {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? AND file_path = ? LIMIT 1')
      .get(input.name, input.filePath) as Record<string, unknown> | undefined;
  } else {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
      .get(input.name) as Record<string, unknown> | undefined;
  }

  if (!nodeRow) {
    return { node: null, directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0, riskLevel: 'LOW' };
  }

  const node = rowToNode(nodeRow);
  const nodeId = node.id;

  // Reverse BFS to find all callers (depth 0 = start node)
  const visited = reverseBfs(nodeId, db, maxDepth, {});
  return { node, ...extractCallerResult(db, nodeId, visited) };
}

// ── Shared helper: fetch nodes by IDs in a single query ───────────────────────

function getNodesByIds(db: Database.Database, ids: string[]): MonographNode[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
    .all(...ids) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

// ── Shared helper: turn a visited map into structured caller lists ─────────────

function extractCallerResult(
  db: Database.Database,
  startNodeId: string,
  visited: Map<string, number>,
): Omit<MonographImpactResult, 'node'> {
  const directCallerIds: string[] = [];
  const byDepth = new Map<number, string[]>();

  for (const [id, depth] of visited.entries()) {
    if (id === startNodeId) continue;
    if (depth === 1) {
      directCallerIds.push(id);
    } else {
      const existing = byDepth.get(depth) ?? [];
      existing.push(id);
      byDepth.set(depth, existing);
    }
  }

  const directCallers = getNodesByIds(db, directCallerIds);

  const transitiveCallers: Array<{ depth: number; nodes: MonographNode[] }> = [];
  const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const depth of sortedDepths) {
    transitiveCallers.push({ depth, nodes: getNodesByIds(db, byDepth.get(depth)!) });
  }

  const allAffectedNodes = [...directCallers, ...transitiveCallers.flatMap(t => t.nodes)];
  const affectedFiles = [...new Set(
    allAffectedNodes.map(n => n.filePath).filter((p): p is string => p != null),
  )];

  const totalCallerCount = visited.size - 1; // exclude start node
  const rawScore = Math.min(Math.log2(totalCallerCount + 1), 10);
  const riskScore = rawScore / 10;

  return { directCallers, transitiveCallers, affectedFiles, riskScore, riskLevel: computeRiskLevel(riskScore) };
}

// ── id-based impact with filtering options ────────────────────────────────────

export async function monographImpact(
  db: Database.Database,
  nodeId: string,
  options: ImpactOptions = {},
): Promise<MonographImpactResult> {
  const maxDepth = Math.min(options.maxDepth ?? 3, 6);

  const nodeRow = db
    .prepare('SELECT * FROM nodes WHERE id = ? LIMIT 1')
    .get(nodeId) as Record<string, unknown> | undefined;

  if (!nodeRow) {
    return { node: null, directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0, riskLevel: 'LOW' };
  }

  const node = rowToNode(nodeRow);
  const visited = reverseBfs(nodeId, db, maxDepth, options);
  return { node, ...extractCallerResult(db, nodeId, visited) };
}
