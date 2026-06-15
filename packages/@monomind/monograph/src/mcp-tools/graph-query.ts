import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row['id'] as string,
    label: row['label'] as MonographNode['label'],
    name: row['name'] as string,
    normLabel: (row['norm_label'] as string) ?? '',
    filePath: row['file_path'] as string | undefined,
    startLine: row['start_line'] as number | undefined,
    endLine: row['end_line'] as number | undefined,
    communityId: row['community_id'] as number | undefined,
    isExported: (row['is_exported'] as number) === 1,
    language: row['language'] as string | undefined,
    properties: row['properties'] ? JSON.parse(row['properties'] as string) : undefined,
  };
}

export interface GraphQueryInput {
  query: string;
  mode?: 'bfs' | 'dfs';
  /** Direction of edge traversal. 'both' includes incoming edges (callers) and outgoing (callees). Default: 'out' */
  direction?: 'out' | 'in' | 'both';
  tokenBudget?: number;
  depth?: number;
}

export interface GraphQueryResult {
  nodes: MonographNode[];
  mode: 'bfs' | 'dfs';
  truncated: boolean;
  tokenEstimate: number;
}

function estimateTokens(nodes: MonographNode[]): number {
  return nodes.reduce((acc, n) => acc + n.name.length + (n.filePath?.length ?? 0) + 20, 0);
}

export function queryGraph(
  db: Database.Database,
  input: GraphQueryInput,
): GraphQueryResult {
  const mode = input.mode ?? 'bfs';
  const direction = input.direction ?? 'out';
  const tokenBudget = input.tokenBudget ?? 2000;
  const maxDepth = input.depth ?? 3;

  // Find seed nodes matching the query
  const seedRows = db.prepare(
    `SELECT * FROM nodes WHERE name LIKE ? OR label LIKE ? LIMIT 20`
  ).all(`%${input.query}%`, `%${input.query}%`) as Record<string, unknown>[];

  const seeds = seedRows.map(rowToNode);
  const visited = new Map<string, MonographNode>();
  const result: MonographNode[] = [];
  let tokenEstimate = 0;
  let truncated = false;

  for (const seed of seeds) {
    visited.set(seed.id, seed);
    result.push(seed);
    tokenEstimate += estimateTokens([seed]);
    if (tokenEstimate > tokenBudget) { truncated = true; break; }
  }

  if (!truncated) {
    // BFS or DFS expansion
    const frontier: Array<{ id: string; depth: number }> = seeds.map(s => ({ id: s.id, depth: 0 }));

    // Prepare edge traversal statements for each direction.
    // 'out' follows outgoing edges (what this node calls/imports/uses).
    // 'in' follows incoming edges (what calls/imports/uses this node).
    // 'both' follows both directions — needed for full context (callers + callees).
    const outEdgeStmt = db.prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20`
    );
    const inEdgeStmt = db.prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20`
    );
    const getNeighbors = (id: string): Record<string, unknown>[] => {
      if (direction === 'out') return outEdgeStmt.all(id) as Record<string, unknown>[];
      if (direction === 'in') return inEdgeStmt.all(id) as Record<string, unknown>[];
      // 'both': union of outgoing and incoming, deduplicated by id
      const outRows = outEdgeStmt.all(id) as Record<string, unknown>[];
      const inRows = inEdgeStmt.all(id) as Record<string, unknown>[];
      const seen = new Set(outRows.map(r => r['id'] as string));
      return [...outRows, ...inRows.filter(r => !seen.has(r['id'] as string))];
    };


    if (mode === 'bfs') {
      while (frontier.length > 0 && !truncated) {
        const { id, depth } = frontier.shift()!;
        if (depth >= maxDepth) continue;
        const neighbors = getNeighbors(id);
        for (const row of neighbors) {
          const node = rowToNode(row);
          if (visited.has(node.id)) continue;
          visited.set(node.id, node);
          result.push(node);
          tokenEstimate += estimateTokens([node]);
          if (tokenEstimate > tokenBudget) { truncated = true; break; }
          frontier.push({ id: node.id, depth: depth + 1 });
        }
      }
    } else {
      // DFS: use stack
      const stack = [...frontier].reverse();
      while (stack.length > 0 && !truncated) {
        const { id, depth } = stack.pop()!;
        if (depth >= maxDepth) continue;
        const neighbors = getNeighbors(id);
        for (let i = neighbors.length - 1; i >= 0; i--) {
          const node = rowToNode(neighbors[i]!);
          if (visited.has(node.id)) continue;
          visited.set(node.id, node);
          result.push(node);
          tokenEstimate += estimateTokens([node]);
          if (tokenEstimate > tokenBudget) { truncated = true; break; }
          stack.push({ id: node.id, depth: depth + 1 });
        }
      }
    }
  }

  return { nodes: result, mode, truncated, tokenEstimate };
}
