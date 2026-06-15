import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import {
  extractHandlerReturnKeys,
  extractAccessedKeys,
  compareShapes,
  type RouteShape,
} from '../analysis/shape-extractor.js';

// ── Output types ───────────────────────────────────────────────────────────────

export interface ShapeCheckResult {
  route: {
    path: string;
    method: string;
    handlerName: string;
    handlerFile: string;
  } | null;
  shape: RouteShape;
  consumers: { name: string; filePath: string }[];
  message: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 1_048_576; // 1 MiB guard

function safeReadFile(absPath: string): string {
  try {
    const st = statSync(absPath);
    if (st.size > MAX_FILE_BYTES) return '';
    return readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }
}

// ── Implementation ─────────────────────────────────────────────────────────────

/**
 * Check whether the JSON shape returned by a route handler matches what its
 * consumers actually access.
 *
 * @param db        - Open monograph SQLite database
 * @param repoPath  - Absolute path to repository root (used to resolve file_path)
 * @param options   - `route` searches by route name/path substring;
 *                    `file` searches by exact file_path of the Route node
 */
export function getShapeCheck(
  db: Database.Database,
  repoPath: string,
  options: { route?: string; file?: string },
): ShapeCheckResult {
  const UNKNOWN_SHAPE: RouteShape = {
    returnedKeys: [],
    accessedKeys: [],
    mismatches: [],
    extra: [],
    status: 'UNKNOWN',
  };

  // 1. Find the Route node
  let routeRow: Record<string, unknown> | undefined;

  if (options.file) {
    routeRow = db
      .prepare("SELECT * FROM nodes WHERE label = 'Route' AND file_path = ? LIMIT 1")
      .get(options.file) as Record<string, unknown> | undefined;
  } else if (options.route) {
    // Search by name substring (name is like "GET /api/users") using SQL LIKE to avoid full scan
    // The route path follows the first space, so we match anywhere after it via a LIKE pattern.
    const likeTerm = `% ${options.route.toLowerCase()}%`;
    routeRow = db
      .prepare("SELECT * FROM nodes WHERE label = 'Route' AND lower(name) LIKE ? LIMIT 1")
      .get(likeTerm) as Record<string, unknown> | undefined;

    // Fallback: match anywhere in the name (e.g. no space prefix)
    if (!routeRow) {
      routeRow = db
        .prepare("SELECT * FROM nodes WHERE label = 'Route' AND lower(name) LIKE ? LIMIT 1")
        .get(`%${options.route.toLowerCase()}%`) as Record<string, unknown> | undefined;
    }
  }

  if (!routeRow) {
    return {
      route: null,
      shape: UNKNOWN_SHAPE,
      consumers: [],
      message: 'Route not found',
    };
  }

  const routeId = routeRow.id as string;
  const routeName = routeRow.name as string;
  const spaceIdx = routeName.indexOf(' ');
  const method = spaceIdx >= 0 ? routeName.slice(0, spaceIdx) : 'ANY';
  const routePath = spaceIdx >= 0 ? routeName.slice(spaceIdx + 1) : routeName;

  // 2. Follow HANDLES_ROUTE edge to find the handler function node
  const handlerRow = db
    .prepare(
      `SELECT n.id, n.name, n.file_path FROM nodes n
       JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'HANDLES_ROUTE'
       LIMIT 1`,
    )
    .get(routeId) as { id: string; name: string; file_path: string | null } | undefined;

  if (!handlerRow || !handlerRow.file_path) {
    return {
      route: {
        path: routePath,
        method,
        handlerName: handlerRow?.name ?? '',
        handlerFile: handlerRow?.file_path ?? '',
      },
      shape: UNKNOWN_SHAPE,
      consumers: [],
      message: 'Handler not found or has no source file',
    };
  }

  // 3. Read handler source and extract return keys
  const handlerAbsPath = join(repoPath, handlerRow.file_path);
  const handlerSource = safeReadFile(handlerAbsPath);
  const returnedKeys = extractHandlerReturnKeys(handlerSource);

  // 4. Find consumers: functions that CALLS or FETCHES the handler node,
  //    or that FETCHES the Route node directly
  const consumerRows = db
    .prepare(
      `SELECT DISTINCT n.id, n.name, n.file_path FROM nodes n
       JOIN edges e ON n.id = e.source_id
       WHERE (
         (e.target_id = ? AND (e.relation = 'CALLS' OR e.relation = 'FETCHES'))
         OR
         (e.target_id = ? AND e.relation = 'FETCHES')
       )
       AND n.file_path IS NOT NULL`,
    )
    .all(handlerRow.id, routeId) as { id: string; name: string; file_path: string }[];

  // 5. Extract accessed keys from each consumer's source
  const allAccessedKeys = new Set<string>();

  for (const consumer of consumerRows) {
    const consumerAbsPath = join(repoPath, consumer.file_path);
    const consumerSource = safeReadFile(consumerAbsPath);
    const accessed = extractAccessedKeys(consumerSource);
    for (const k of accessed) allAccessedKeys.add(k);
  }

  // 6. Compare shapes
  const accessedKeys = Array.from(allAccessedKeys).sort();
  const shape = compareShapes(returnedKeys, accessedKeys);

  const consumers = consumerRows.map((c) => ({
    name: c.name,
    filePath: c.file_path,
  }));

  const statusMsg =
    shape.status === 'MATCH'
      ? 'Shape matches: all accessed keys are returned by handler'
      : shape.status === 'MISMATCH'
        ? `Shape mismatch: ${shape.mismatches.join(', ')} accessed but not returned`
        : 'Shape unknown: insufficient source information';

  return {
    route: {
      path: routePath,
      method,
      handlerName: handlerRow.name,
      handlerFile: handlerRow.file_path,
    },
    shape,
    consumers,
    message: statusMsg,
  };
}
