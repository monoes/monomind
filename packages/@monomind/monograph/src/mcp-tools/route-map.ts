import type Database from 'better-sqlite3';

// ── Output types ───────────────────────────────────────────────────────────────

export interface RouteMapEntry {
  method: string;
  path: string;
  handlerName: string | null;
  handlerFile: string | null;
  handlerLine: number | null;
  routeNodeId: string;
}

export interface MonographRouteMapResult {
  routes: RouteMapEntry[];
  total: number;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographRouteMap(
  db: Database.Database,
  input: { prefix?: string; method?: string; includeMiddleware?: boolean },
): MonographRouteMapResult {
  // 1. Query all Route nodes
  let routeRows = db
    .prepare("SELECT * FROM nodes WHERE label = 'Route'")
    .all() as Record<string, unknown>[];

  // 2. Apply prefix filter
  if (input.prefix) {
    const prefix = input.prefix;
    routeRows = routeRows.filter((row) => {
      const name = row.name as string;
      // name is like "GET /api/users" — find the path part
      const spaceIdx = name.indexOf(' ');
      const path = spaceIdx >= 0 ? name.slice(spaceIdx + 1) : name;
      return path.includes(prefix);
    });
  }

  // 3. Apply method filter
  if (input.method) {
    const methodUpper = input.method.toUpperCase();
    routeRows = routeRows.filter((row) => {
      const name = row.name as string;
      return name.startsWith(methodUpper + ' ') || name.startsWith('ANY ');
    });
  }

  // 4. For each route, find handler via HANDLES_ROUTE edge
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

    return {
      method,
      path,
      handlerName: handlerRow?.name ?? null,
      handlerFile: handlerRow?.file_path ?? null,
      handlerLine: handlerRow?.start_line ?? null,
      routeNodeId,
    };
  });

  return { routes, total: routes.length };
}
