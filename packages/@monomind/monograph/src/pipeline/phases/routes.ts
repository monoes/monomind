import { readFileSync, statSync } from 'fs';
import { extname } from 'path';
import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// Next.js pages dir (classic router)
const PAGES_RE = /^pages\//;
// Next.js app router route files
const APP_ROUTE_RE = /^app\/(.*\/)?route\.(ts|tsx|js|jsx)$/;

// Express/Fastify route methods
const EXPRESS_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'use'] as const;
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';

// ── Output types ──────────────────────────────────────────────────────────────

export interface RouteEntry {
  method: string;
  path: string;
  handlerNodeId?: string;
  filePath: string;
  routeNodeId: string;
  middlewareChain: string[];
}

export interface RoutesOutput {
  routeRegistry: RouteEntry[];
}

// ── Phase ─────────────────────────────────────────────────────────────────────

export const routesPhase: PipelinePhase<RoutesOutput> = {
  name: 'routes',
  deps: ['parse', 'structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const routeRegistry: RouteEntry[] = [];
    const routeNodes: MonographNode[] = [];
    const handlesEdges: MonographEdge[] = [];

    for (const fileNode of fileNodes) {
      const relPath = fileNode.filePath ?? '';
      const ext = extname(relPath).toLowerCase();

      if (!CODE_EXTENSIONS.has(ext)) continue;

      // ── 1. Next.js file-based routing ──────────────────────────────────────
      const isNextPages = PAGES_RE.test(relPath);
      const isNextAppRoute = APP_ROUTE_RE.test(relPath);

      if (isNextPages || isNextAppRoute) {
        const routePath = isNextPages
          ? pagesPathToRoute(relPath)
          : appPathToRoute(relPath);
        const method = 'ANY';
        const routeNodeId = makeId('route', method, routePath, relPath);
        const name = `${method} ${routePath}`;

        const routeNode: MonographNode = {
          id: routeNodeId,
          label: 'Route',
          name,
          normLabel: toNormLabel(name),
          filePath: relPath,
          startLine: 0,
          endLine: 0,
          isExported: false,
          language: langFromExt(ext),
        };
        routeNodes.push(routeNode);

        const entry: RouteEntry = { method, path: routePath, filePath: relPath, routeNodeId, middlewareChain: [] };

        if (ctx.db) {
          const source = safeReadSource(`${ctx.repoPath}/${relPath}`, ctx.options.maxFileSizeBytes);
          if (source) {
            const handlerName = extractDefaultExportName(source);
            if (handlerName) {
              const row = ctx.db
                .prepare(`SELECT id FROM nodes WHERE name = ? AND file_path = ?`)
                .get(handlerName, relPath) as { id: string } | undefined;
              if (row) {
                const edgeId = makeId(routeNodeId, row.id, 'handles_route');
                handlesEdges.push({
                  id: edgeId,
                  sourceId: routeNodeId,
                  targetId: row.id,
                  relation: 'HANDLES_ROUTE',
                  confidence: 'EXTRACTED',
                  confidenceScore: 0.9,
                });
                entry.handlerNodeId = row.id;
              }
            }
          }
        }

        routeRegistry.push(entry);
        continue;
      }

      // ── 2. Express / Fastify app.METHOD() style ────────────────────────────
      const source = safeReadSource(`${ctx.repoPath}/${relPath}`, ctx.options.maxFileSizeBytes);
      if (!source) continue;

      const expressEntries = extractExpressRoutes(source, relPath, ext);
      for (const e of expressEntries) {
        const routeNodeId = makeId('route', e.method, e.path, relPath);
        const name = `${e.method} ${e.path}`;
        const routeNode: MonographNode = {
          id: routeNodeId,
          label: 'Route',
          name,
          normLabel: toNormLabel(name),
          filePath: relPath,
          startLine: 0,
          endLine: 0,
          isExported: false,
          language: langFromExt(ext),
        };
        routeNodes.push(routeNode);

        const entry: RouteEntry = { method: e.method, path: e.path, filePath: relPath, routeNodeId, middlewareChain: [] };

        if (ctx.db && e.handlerName) {
          const row = ctx.db
            .prepare(`SELECT id FROM nodes WHERE name = ? AND file_path = ?`)
            .get(e.handlerName, relPath) as { id: string } | undefined;
          if (row) {
            const edgeId = makeId(routeNodeId, row.id, 'handles_route');
            handlesEdges.push({
              id: edgeId,
              sourceId: routeNodeId,
              targetId: row.id,
              relation: 'HANDLES_ROUTE',
              confidence: 'EXTRACTED',
              confidenceScore: 0.9,
            });
            entry.handlerNodeId = row.id;
          }
        }

        routeRegistry.push(entry);
      }

      // ── 3. NestJS / TypeScript decorator routing ───────────────────────────
      const nestEntries = extractNestRoutes(source, relPath, ext);
      for (const e of nestEntries) {
        const routeNodeId = makeId('route', e.method, e.path, relPath);
        const name = `${e.method} ${e.path}`;
        const routeNode: MonographNode = {
          id: routeNodeId,
          label: 'Route',
          name,
          normLabel: toNormLabel(name),
          filePath: relPath,
          startLine: 0,
          endLine: 0,
          isExported: false,
          language: langFromExt(ext),
        };
        routeNodes.push(routeNode);

        const entry: RouteEntry = { method: e.method, path: e.path, filePath: relPath, routeNodeId, middlewareChain: [] };

        if (ctx.db && e.handlerName) {
          const row = ctx.db
            .prepare(`SELECT id FROM nodes WHERE name = ? AND file_path = ?`)
            .get(e.handlerName, relPath) as { id: string } | undefined;
          if (row) {
            const edgeId = makeId(routeNodeId, row.id, 'handles_route');
            handlesEdges.push({
              id: edgeId,
              sourceId: routeNodeId,
              targetId: row.id,
              relation: 'HANDLES_ROUTE',
              confidence: 'EXTRACTED',
              confidenceScore: 0.9,
            });
            entry.handlerNodeId = row.id;
          }
        }

        routeRegistry.push(entry);
      }
    }

    if (ctx.db) {
      insertNodes(ctx.db, routeNodes);
      insertEdges(ctx.db, handlesEdges);
    }

    return { routeRegistry };
  },
};

// ── Path conversion helpers ───────────────────────────────────────────────────

/**
 * Convert a pages/... file path to an HTTP route path.
 * examples:
 *   pages/index.ts         → /
 *   pages/about.ts         → /about
 *   pages/api/users.ts     → /api/users
 *   pages/api/users/[id].ts → /api/users/:id
 *   pages/[[...slug]].ts   → *
 */
export function pagesPathToRoute(relPath: string): string {
  // strip leading 'pages/' and extension
  let path = relPath.replace(/^pages\//, '').replace(/\.(tsx?|jsx?)$/, '');
  // Remove trailing /index
  path = path.replace(/(^|\/)index$/, '');
  // catch-all: [[...param]] or [...param]
  path = path.replace(/\[\[\.\.\.(\w+)\]\]/g, '*');
  path = path.replace(/\[\.\.\.(\w+)\]/g, '*');
  // dynamic segments: [param]
  path = path.replace(/\[(\w+)\]/g, ':$1');
  // strip trailing slash that might result from above
  path = path.replace(/\/$/, '');
  return path ? `/${path}` : '/';
}

/**
 * Convert an app/.../route.ts path to an HTTP route path.
 * examples:
 *   app/route.ts               → /
 *   app/users/route.ts         → /users
 *   app/users/[id]/route.ts    → /users/:id
 */
export function appPathToRoute(relPath: string): string {
  // strip leading 'app/' and trailing '/route.<ext>' or 'route.<ext>'
  let path = relPath
    .replace(/^app\//, '')
    .replace(/\/route\.(tsx?|jsx?)$/, '')
    .replace(/^route\.(tsx?|jsx?)$/, '');
  // catch-all
  path = path.replace(/\[\[\.\.\.(\w+)\]\]/g, '*');
  path = path.replace(/\[\.\.\.(\w+)\]/g, '*');
  // dynamic segments
  path = path.replace(/\[(\w+)\]/g, ':$1');
  path = path.replace(/\/$/, '');
  return path ? `/${path}` : '/';
}

// ── Extract default export name ───────────────────────────────────────────────

/** Returns the exported identifier from `export default function X` or `export default X` */
export function extractDefaultExportName(source: string): string | undefined {
  // export default function handler or export default async function handler
  const fnMatch = source.match(/export\s+default\s+(?:async\s+)?function\s+(\w+)/);
  if (fnMatch) return fnMatch[1];
  // export default identifier (not an object literal or class expression)
  const idMatch = source.match(/export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[;\n]/);
  if (idMatch) return idMatch[1];
  return undefined;
}

// ── Express route extraction ──────────────────────────────────────────────────

interface DetectedRoute {
  method: string;
  path: string;
  handlerName?: string;
}

const EXPRESS_ROUTE_RE =
  /(?:app|router|server)\s*\.\s*(get|post|put|delete|patch|use)\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([A-Za-z_$][A-Za-z0-9_$]*))?/gi;

export function extractExpressRoutes(source: string, _filePath: string, _ext: string): DetectedRoute[] {
  const results: DetectedRoute[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(EXPRESS_ROUTE_RE.source, 'gi');
  while ((match = re.exec(source)) !== null) {
    const httpMethod = match[1].toUpperCase() as HttpMethod;
    const routePath = match[2];
    const handlerName = match[3];
    results.push({ method: httpMethod, path: routePath, handlerName });
  }
  return results;
}

// ── NestJS decorator extraction ───────────────────────────────────────────────

const CONTROLLER_RE = /@Controller\(\s*['"]([^'"]*)['"]\s*\)/g;
// Method-level decorators and the following method name
const NEST_METHOD_RE =
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]*)['"]\s*\)\s*(?:[\w\s,():?<>[\]|&.]+?\s+)?(\w+)\s*\(/gis;

export function extractNestRoutes(source: string, _filePath: string, _ext: string): DetectedRoute[] {
  // Find controller prefix (use first @Controller decorator found)
  let controllerPrefix = '';
  const ctrlMatch = CONTROLLER_RE.exec(source);
  if (ctrlMatch) {
    controllerPrefix = ctrlMatch[1].replace(/\/$/, '');
  }
  // Reset lastIndex
  CONTROLLER_RE.lastIndex = 0;

  const results: DetectedRoute[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(NEST_METHOD_RE.source, 'gis');
  while ((match = re.exec(source)) !== null) {
    const httpMethod = match[1].toUpperCase();
    const methodPath = match[2].replace(/^\//, '');
    const handlerName = match[3];
    const full = controllerPrefix
      ? `/${controllerPrefix}/${methodPath}`.replace(/\/+/g, '/')
      : `/${methodPath}`;
    results.push({ method: httpMethod, path: full, handlerName });
  }
  return results;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeReadSource(absPath: string, maxBytes: number): string | undefined {
  try {
    const stat = statSync(absPath);
    if (stat.size > maxBytes) return undefined;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function langFromExt(ext: string): string {
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  return 'unknown';
}
