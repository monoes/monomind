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

function reverseBfs(startNodeId: string, db: Database.Database, maxDepth: number): Map<string, number> {
  const visited = new Map<string, number>([[startNodeId, 0]]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  const stmt = db.prepare(
    `SELECT source_id FROM edges WHERE target_id = ? AND relation = 'CALLS'`,
  );

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const callers = stmt.all(id) as Array<{ source_id: string }>;
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
  const visited = reverseBfs(nodeId, db, maxDepth);

  // Separate direct callers (depth 1) from transitive (depth 2+)
  const directCallerIds: string[] = [];
  const byDepth = new Map<number, string[]>();

  for (const [id, depth] of visited.entries()) {
    if (id === nodeId) continue;
    if (depth === 1) {
      directCallerIds.push(id);
    } else {
      const existing = byDepth.get(depth) ?? [];
      existing.push(id);
      byDepth.set(depth, existing);
    }
  }

  // Fetch node details for direct callers
  const getNodesByIds = (ids: string[]): MonographNode[] => {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
      .all(...ids) as Record<string, unknown>[];
    return rows.map(rowToNode);
  };

  const directCallers = getNodesByIds(directCallerIds);

  const transitiveCallers: Array<{ depth: number; nodes: MonographNode[] }> = [];
  const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const depth of sortedDepths) {
    const ids = byDepth.get(depth)!;
    transitiveCallers.push({ depth, nodes: getNodesByIds(ids) });
  }

  // Collect unique affected file paths (excluding start node)
  const allAffectedNodes = [...directCallers, ...transitiveCallers.flatMap(t => t.nodes)];
  const affectedFiles = [...new Set(
    allAffectedNodes
      .map(n => n.filePath)
      .filter((p): p is string => p != null),
  )];

  // Risk score: log2(totalCallerCount + 1) normalized to [0, 1] (max log2(11) ≈ 3.46, capped at 10, /10)
  const totalCallerCount = visited.size - 1; // exclude start node
  const rawScore = Math.min(Math.log2(totalCallerCount + 1), 10);
  const riskScore = rawScore / 10;

  return { node, directCallers, transitiveCallers, affectedFiles, riskScore, riskLevel: computeRiskLevel(riskScore) };
}
