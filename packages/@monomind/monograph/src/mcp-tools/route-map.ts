import { readFileSync, statSync } from 'fs';
import type Database from 'better-sqlite3';
import { extractMiddlewareChain } from '../pipeline/phases/middleware-extractor.js';

// ── Output types ───────────────────────────────────────────────────────────────

export interface RouteMapEntry {
  method: string;
  path: string;
  handlerName: string | null;
  handlerFile: string | null;
  handlerLine: number | null;
  routeNodeId: string;
  middlewareChain: string[];
}

export interface MonographRouteMapResult {
  routes: RouteMapEntry[];
  total: number;
}

const MAX_FILE_BYTES = 1_048_576; // 1 MiB guard for middleware source reads

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographRouteMap(
  db: Database.Database,
  input: { prefix?: string; method?: string; includeMiddleware?: boolean; repoPath?: string },
): MonographRouteMapResult {
  // 1. Build SQL-level filters to avoid loading the whole Route table into JS
  const conditions: string[] = ["label = 'Route'"];
  const params: unknown[] = [];

  if (input.prefix) {
    // Route name format: "METHOD /path" — prefix applies to path portion after first space
    conditions.push("name LIKE ?");
    params.push(`% ${input.prefix}%`);
  }

  if (input.method) {
    const methodUpper = input.method.toUpperCase();
    conditions.push("(name LIKE ? OR name LIKE ?)");
    params.push(`${methodUpper} %`, 'ANY %');
  }

  const sql = `SELECT * FROM nodes WHERE ${conditions.join(' AND ')}`;
  const routeRows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  // 2. For each route, find handler via HANDLES_ROUTE edge (prepared once)
  const handlerStmt = db.prepare(
    `SELECT n.name, n.file_path, n.start_line FROM nodes n
     JOIN edges e ON n.id = e.target_id
     WHERE e.source_id = ? AND e.relation = 'HANDLES_ROUTE'
     LIMIT 1`,
  );

  const routes: RouteMapEntry[] = routeRows.map((row) => {
    const routeNodeId = row.id as string;
    const name = row.name as string;

    // Parse method and path from name (format: "METHOD /path")
    const spaceIdx = name.indexOf(' ');
    const method = spaceIdx >= 0 ? name.slice(0, spaceIdx) : 'ANY';
    const path = spaceIdx >= 0 ? name.slice(spaceIdx + 1) : name;

    // Look up handler
    const handlerRow = handlerStmt.get(routeNodeId) as
      | { name: string; file_path: string | null; start_line: number | null }
      | undefined;

    // Detect middleware chain at query time when requested
    let middlewareChain: string[] = [];
    if (input.includeMiddleware && input.repoPath && handlerRow?.name && handlerRow?.file_path) {
      try {
        const absPath = `${input.repoPath}/${handlerRow.file_path}`;
        const st = statSync(absPath);
        if (st.size <= MAX_FILE_BYTES) {
          const source = readFileSync(absPath, 'utf-8');
          middlewareChain = extractMiddlewareChain(source, handlerRow.name).middlewareNames;
        }
      } catch {
        // File not found, unreadable, or too large — leave middlewareChain as []
      }
    }

    return {
      method,
      path,
      handlerName: handlerRow?.name ?? null,
      handlerFile: handlerRow?.file_path ?? null,
      handlerLine: handlerRow?.start_line ?? null,
      routeNodeId,
      middlewareChain,
    };
  });

  return { routes, total: routes.length };
}
