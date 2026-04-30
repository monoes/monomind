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

// ── Output types ───────────────────────────────────────────────────────────────

export interface MonographApiImpactResult {
  route: { method: string; path: string; nodeId: string } | null;
  handler: MonographNode | null;
  callees: Array<{ depth: number; node: MonographNode }>;
  affectedProcesses: Array<{ id: string; name: string }>;
  riskScore: number;
}

// ── Forward BFS on CALLS edges ─────────────────────────────────────────────────

function forwardBfs(
  startId: string,
  db: Database.Database,
  maxDepth: number,
): Array<{ depth: number; nodeId: string }> {
  const visited = new Map<string, number>([[startId, 0]]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  const result: Array<{ depth: number; nodeId: string }> = [];

  const stmt = db.prepare(
    `SELECT target_id FROM edges WHERE source_id = ? AND relation = 'CALLS'`,
  );

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const callees = stmt.all(id) as Array<{ target_id: string }>;
    for (const { target_id } of callees) {
      if (!visited.has(target_id)) {
        visited.set(target_id, depth + 1);
        result.push({ depth: depth + 1, nodeId: target_id });
        queue.push({ id: target_id, depth: depth + 1 });
      }
    }
  }

  return result;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographApiImpact(
  db: Database.Database,
  input: { routePath: string; method?: string },
): MonographApiImpactResult {
  const MAX_DEPTH = 5;

  // 1. Find the Route node matching routePath
  const likePattern = '%' + input.routePath + '%';
  let routeRows = db
    .prepare("SELECT * FROM nodes WHERE label = 'Route' AND name LIKE ?")
    .all(likePattern) as Record<string, unknown>[];

  // If method provided, narrow down by method prefix
  if (input.method && routeRows.length > 0) {
    const methodUpper = input.method.toUpperCase();
    const filtered = routeRows.filter((row) => {
      const name = row.name as string;
      return name.startsWith(methodUpper + ' ');
    });
    // Only apply filter if it returns results; otherwise keep all matches
    if (filtered.length > 0) {
      routeRows = filtered;
    }
  }

  if (routeRows.length === 0) {
    return {
      route: null,
      handler: null,
      callees: [],
      affectedProcesses: [],
      riskScore: 0,
    };
  }

  const routeRow = routeRows[0];
  const routeNodeId = routeRow.id as string;
  const routeName = routeRow.name as string;

  // Parse method and path from name (format: "METHOD /path")
  const spaceIdx = routeName.indexOf(' ');
  const method = spaceIdx >= 0 ? routeName.slice(0, spaceIdx) : 'ANY';
  const path = spaceIdx >= 0 ? routeName.slice(spaceIdx + 1) : routeName;

  const route = { method, path, nodeId: routeNodeId };

  // 2. Find handler via HANDLES_ROUTE edge
  const handlerRow = db
    .prepare(
      `SELECT n.* FROM nodes n
       JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'HANDLES_ROUTE'
       LIMIT 1`,
    )
    .get(routeNodeId) as Record<string, unknown> | undefined;

  const handler = handlerRow ? rowToNode(handlerRow) : null;

  if (!handler) {
    return {
      route,
      handler: null,
      callees: [],
      affectedProcesses: [],
      riskScore: Math.log2(2),
    };
  }

  // 3. Forward BFS on CALLS edges from handler
  const bfsResults = forwardBfs(handler.id, db, MAX_DEPTH);

  // 4. Resolve node details for each callee
  const callees: Array<{ depth: number; node: MonographNode }> = [];
  for (const { depth, nodeId } of bfsResults) {
    const nodeRow = db
      .prepare('SELECT * FROM nodes WHERE id = ?')
      .get(nodeId) as Record<string, unknown> | undefined;
    if (nodeRow) {
      callees.push({ depth, node: rowToNode(nodeRow) });
    }
  }

  // 5. Find processes that include the handler or any callee via STEP_IN_PROCESS
  const allNodeIds = [handler.id, ...bfsResults.map((b) => b.nodeId)];
  const affectedProcesses: Array<{ id: string; name: string }> = [];

  if (allNodeIds.length > 0) {
    const placeholders = allNodeIds.map(() => '?').join(',');
    const processRows = db
      .prepare(
        `SELECT DISTINCT n.id, n.name FROM nodes n
         JOIN edges e ON n.id = e.source_id
         WHERE e.target_id IN (${placeholders}) AND e.relation = 'STEP_IN_PROCESS'`,
      )
      .all(...allNodeIds) as Array<{ id: string; name: string }>;
    affectedProcesses.push(...processRows);
  }

  // 6. Risk score: log2(callees.length + 2) capped at 10
  const riskScore = Math.min(Math.log2(callees.length + 2), 10);

  return {
    route,
    handler,
    callees,
    affectedProcesses,
    riskScore,
  };
}
