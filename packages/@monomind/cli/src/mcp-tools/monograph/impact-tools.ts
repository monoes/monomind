import { join, resolve, sep } from 'path';
import { existsSync, readdirSync } from 'fs';
import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, _isValidDb, text } from './shared.js';

// ── monograph_impact ──────────────────────────────────────────────────────────

export const monographImpactTool: MCPTool = {
  name: 'monograph_impact',
  description:
    'Blast radius analysis: finds all direct and transitive callers of a symbol and computes a risk score.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to analyze' },
      filePath: { type: 'string', description: 'Optional file path to disambiguate' },
      depth: { type: 'number', description: 'Max BFS depth (default 3, max 6)' },
    },
    required: ['name'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap name/filePath; enforce depth ≤ 6 as documented in the schema description.
      const MAX_IMPACT_NAME_LEN = 512;
      const MAX_IMPACT_PATH_LEN = 4 * 1024;
      const rawImpactName = input.name as string;
      const impactName =
        typeof rawImpactName === 'string' && rawImpactName.length > MAX_IMPACT_NAME_LEN
          ? rawImpactName.slice(0, MAX_IMPACT_NAME_LEN)
          : rawImpactName;
      const rawImpactPath = input.filePath as string | undefined;
      const impactPath =
        typeof rawImpactPath === 'string' && rawImpactPath.length > MAX_IMPACT_PATH_LEN
          ? rawImpactPath.slice(0, MAX_IMPACT_PATH_LEN)
          : rawImpactPath;
      const rawDepth = input.depth as number | undefined;
      const depth =
        rawDepth === undefined
          ? undefined
          : typeof rawDepth === 'number' && Number.isFinite(rawDepth) && rawDepth > 0
            ? Math.min(Math.floor(rawDepth), 6)
            : 3;
      const result = getMonographImpact(db, {
        name: impactName,
        filePath: impactPath,
        depth,
      });
      if (!result || !result.node) return text(`No symbol found: ${impactName}`);

      // Format impact as structured text for direct LLM consumption
      const root = result.node as any;
      const rootLoc = root.filePath
        ? root.startLine != null
          ? `${root.filePath}:${root.startLine}`
          : root.filePath
        : '';
      const lines: string[] = [
        `[${root.label ?? '?'}] ${root.name}  ${rootLoc}`,
        '',
        `Blast radius: ${result.affectedFiles?.length ?? 0} symbols affected`,
      ];

      if (result.riskScore != null) {
        const riskLabel =
          (result.riskScore as number) >= 0.8
            ? 'HIGH'
            : (result.riskScore as number) >= 0.5
              ? 'MEDIUM'
              : 'LOW';
        lines.push(`Risk score: ${(result.riskScore as number).toFixed(2)} (${riskLabel})`);
      }
      lines.push('');

      const affected = [
        ...((result.directCallers as any[]) ?? []),
        ...((result.transitiveCallers as Array<{ depth: number; nodes: any[] }>) ?? []).flatMap(
          (t) => t.nodes ?? [],
        ),
      ] as any[];
      if (affected.length > 0) {
        lines.push(`Affected callers (${affected.length}):`);
        for (const sym of affected.slice(0, 20)) {
          const fp = sym.filePath ?? sym.file_path ?? '';
          const ln = sym.startLine ?? sym.start_line;
          const symLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          const depth_marker = sym.depth != null ? ` [depth ${sym.depth}]` : '';
          lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${symLoc}${depth_marker}`);
        }
        if (affected.length > 20) lines.push(`  … ${affected.length - 20} more`);
      }

      return text(lines.join('\n').trim());
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_api_impact ──────────────────────────────────────────────────────

export const monographApiImpactTool: MCPTool = {
  name: 'monograph_api_impact',
  description:
    'Analyze the blast radius of an API route: finds the handler, performs forward BFS through CALLS edges, and computes a risk score.',
  inputSchema: {
    type: 'object',
    properties: {
      routePath: { type: 'string', description: 'Route path to analyze (e.g. /api/users)' },
      method: { type: 'string', description: 'Optional HTTP method filter: GET, POST, etc.' },
    },
    required: ['routePath'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographApiImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographApiImpact(db, {
        routePath: input.routePath as string,
        method: input.method as string | undefined,
      });
      if (!result.route)
        return text(
          `Route not found: ${input.routePath as string}. Run monograph_build or check the path.`,
        );
      const riskLabel =
        result.riskScore >= 0.7 ? 'HIGH' : result.riskScore >= 0.4 ? 'MEDIUM' : 'LOW';
      const lines: string[] = [
        `Route: ${result.route.method} ${result.route.path}  risk=${riskLabel} (${result.riskScore.toFixed(2)})`,
      ];
      if (result.handler) {
        const hLoc = result.handler.filePath
          ? result.handler.startLine != null
            ? `${result.handler.filePath}:${result.handler.startLine}`
            : result.handler.filePath
          : '';
        lines.push(`Handler: ${result.handler.name}${hLoc ? `  ${hLoc}` : ''}`);
      }
      if (result.callees.length > 0) {
        lines.push(`Callees (${result.callees.length}):`);
        for (const c of result.callees.slice(0, 15)) {
          const loc = c.node.filePath
            ? c.node.startLine != null
              ? `${c.node.filePath}:${c.node.startLine}`
              : c.node.filePath
            : '';
          lines.push(
            `  ${'  '.repeat(c.depth)}→ ${c.node.name} [${c.node.label}]${loc ? `  ${loc}` : ''}`,
          );
        }
        if (result.callees.length > 15) lines.push(`  … ${result.callees.length - 15} more`);
      }
      if (result.affectedProcesses.length > 0) {
        lines.push(`Affected processes: ${result.affectedProcesses.map((p) => p.name).join(', ')}`);
      }
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_dead_code ──────────────────────────────────────────────────────

export const monographDeadCodeTool: MCPTool = {
  name: 'monograph_dead_code',
  description:
    'Detect dead code: exported functions with zero inbound references, files with no importers, and stale dist build artifacts. Returns structured JSON with candidates grouped by category. Always verify candidates with grep before deleting.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
      categories: {
        type: 'array',
        items: { type: 'string', enum: ['dead-functions', 'orphan-files', 'stale-dist'] },
        description: 'Which categories to check (default: all three)',
      },
    },
  },
  handler: async (input) => {
    const { openDb } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const cats = (input.categories as string[] | undefined) ?? [
      'dead-functions',
      'orphan-files',
      'stale-dist',
    ];
    const result: Record<string, unknown> = {};

    const dbPath = getDbPath(repoPath);
    // openDb's fileMustExist option isn't in the currently-published
    // @monoes/monograph release this CLI depends on — check validity
    // ourselves so a missing DB doesn't get silently auto-created empty.
    if (!_isValidDb(dbPath)) {
      return text(
        JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }),
      );
    }
    let db: ReturnType<typeof openDb> | null = null;
    try {
      db = openDb(dbPath);
      // _isValidDb's size check can't distinguish a real index from an
      // empty-but-schema-migrated DB (better-sqlite3 auto-creates + migrates
      // on open, and other unguarded openDb() call sites in this file can
      // create exactly that as a side effect of an unrelated tool call before
      // monograph_build ever runs). Verify actual content post-open so this
      // reports "never built" instead of a misleading "0 dead functions found".
      const { count } = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as {
        count: number;
      };
      if (count === 0) {
        return text(
          JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }),
        );
      }
    } catch {
      return text(
        JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }),
      );
    }

    try {
      if (cats.includes('dead-functions')) {
        const { detectDeadCodeNodes } = await import('@monoes/monograph');
        const { readFileSync } = await import('fs');
        const nodes = detectDeadCodeNodes(db);
        // Filter out stale graph nodes: verify the function name actually appears in the source file
        // SEC-6: n.filePath is DB-sourced. A poisoned monograph.db could
        // ship `../../etc/passwd` and exfiltrate (or, with a malicious
        // `name`, probe for known strings). Resolve against repoPath and
        // refuse anything that escapes it.
        const repoRoot = resolve(repoPath);
        const verified = nodes.filter((n) => {
          if (!n.filePath) return false;
          const resolved = resolve(repoPath, n.filePath);
          if (!resolved.startsWith(repoRoot + sep) && resolved !== repoRoot) return false;
          try {
            const content = readFileSync(resolved, 'utf-8');
            return content.includes(n.name);
          } catch {
            return false;
          }
        });
        const staleCount = nodes.length - verified.length;
        result['dead-functions'] = {
          count: verified.length,
          candidates: verified.map((n) => ({
            name: n.name,
            location: n.filePath
              ? n.startLine
                ? `${n.filePath}:${n.startLine}`
                : n.filePath
              : null,
          })),
          ...(staleCount > 0
            ? {
                staleIndexEntries: staleCount,
                note: 'Some graph entries reference deleted functions. Rebuild the index with monograph_build to clean up.',
              }
            : {}),
        };
      }

      if (cats.includes('orphan-files')) {
        const rows = db
          .prepare(`
          SELECT n.name, n.file_path,
            (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id AND e.relation = 'IMPORTS') as imports_out,
            (SELECT COUNT(*) FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS') as imported_by
          FROM nodes n
          WHERE n.label = 'File'
            AND (SELECT COUNT(*) FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS') = 0
            AND n.file_path NOT LIKE '%/test/%'
            AND n.file_path NOT LIKE '%/tests/%'
            AND n.file_path NOT LIKE '%.test.%'
            AND n.file_path NOT LIKE '%__tests__%'
            AND n.file_path NOT LIKE '%/spec/%'
            AND n.file_path NOT LIKE '%.spec.%'
            AND n.file_path NOT LIKE '%/index.%'
            AND n.file_path NOT LIKE 'bin/%'
            AND n.file_path NOT LIKE 'scripts/%'
            AND n.file_path NOT LIKE '%/cli.ts'
            AND n.file_path NOT LIKE '%/cli.js'
            AND n.file_path NOT LIKE '%/main.ts'
            AND n.file_path NOT LIKE '%/main.js'
            AND n.file_path NOT LIKE '%/dist/%'
            AND n.file_path NOT LIKE '%node_modules%'
          ORDER BY n.file_path
        `)
          .all() as Array<{
          name: string;
          file_path: string;
          imports_out: number;
          imported_by: number;
        }>;

        const withOutbound = rows.filter((r: any) => r.imports_out > 0);
        const isolated = rows.filter((r: any) => r.imports_out === 0);

        result['orphan-files'] = {
          count: withOutbound.length,
          note: 'Files that import other modules but nothing imports them. May be lazy-loaded or dynamically imported — verify with grep.',
          candidates: withOutbound.map((r: any) => ({
            file: r.file_path,
            outboundImports: r.imports_out,
          })),
          ...(isolated.length > 0
            ? {
                isolated: {
                  count: isolated.length,
                  note: 'Files with zero edges in either direction — likely standalone scripts or entry points.',
                  files: isolated.map((r: any) => r.file_path),
                },
              }
            : {}),
        };
      }

      if (cats.includes('stale-dist')) {
        result['stale-dist'] = findStaleDist(repoPath);
      }

      return text(JSON.stringify(result, null, 2));
    } finally {
      db!.close();
    }
  },
};

function findStaleDist(repoPath: string): Record<string, unknown> {
  const distSrc = join(repoPath, 'dist', 'src');
  const src = join(repoPath, 'src');

  // Scan a single package for stale dist artifacts
  const scanPkg = (pkgPath: string, pkgName: string) => {
    const pkgDistSrc = join(pkgPath, 'dist', 'src');
    const pkgSrc = join(pkgPath, 'src');
    if (!existsSync(pkgDistSrc) || !existsSync(pkgSrc)) return null;

    const staleDirs: string[] = [];
    const staleFiles: string[] = [];
    let resourceForks = 0;

    try {
      const distDirs = readdirSync(pkgDistSrc, { withFileTypes: true }).filter(
        (d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('._'),
      );
      const srcDirs = new Set(
        readdirSync(pkgSrc, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => d.name),
      );
      for (const d of distDirs) {
        if (!srcDirs.has(d.name)) staleDirs.push(d.name);
      }
    } catch {
      /* skip */
    }

    try {
      const distFiles = readdirSync(pkgDistSrc).filter(
        (f) => f.endsWith('.js') && !f.startsWith('.') && !f.startsWith('._'),
      );
      for (const f of distFiles) {
        const tsName = f.replace(/\.js$/, '.ts');
        if (!existsSync(join(pkgSrc, tsName))) staleFiles.push(f);
      }
    } catch {
      /* skip */
    }

    // Count macOS resource fork files
    const countRF = (dir: string) => {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('._')) resourceForks++;
          else if (entry.isDirectory()) countRF(join(dir, entry.name));
        }
      } catch {
        /* skip */
      }
    };
    countRF(pkgDistSrc);

    if (staleDirs.length === 0 && staleFiles.length === 0 && resourceForks === 0) return null;
    return {
      package: pkgName,
      staleDirs,
      staleFiles,
      ...(resourceForks > 0 ? { macosResourceForks: resourceForks } : {}),
    };
  };

  // Single-package repo
  if (existsSync(distSrc) && existsSync(src)) {
    const finding = scanPkg(repoPath, '.');
    return {
      count: finding ? finding.staleDirs.length + finding.staleFiles.length : 0,
      note: 'Directories/files in dist/src/ with no corresponding source. Fix: rm -rf dist && npm run build.',
      ...(finding ? { findings: [finding] } : {}),
    };
  }

  // Monorepo: scan all packages
  const packagesDir = join(repoPath, 'packages');
  if (!existsSync(packagesDir)) return { count: 0, note: 'No dist/src or packages/ found' };

  const findings: Array<Record<string, unknown>> = [];
  try {
    for (const scope of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!scope.isDirectory()) continue;
      const scopeDir = join(packagesDir, scope.name);
      if (scope.name.startsWith('@')) {
        for (const pkg of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!pkg.isDirectory()) continue;
          const f = scanPkg(join(scopeDir, pkg.name), `${scope.name}/${pkg.name}`);
          if (f) findings.push(f);
        }
      } else {
        const f = scanPkg(scopeDir, scope.name);
        if (f) findings.push(f);
      }
    }
  } catch {
    /* skip */
  }

  return {
    count: findings.reduce(
      (s, f) =>
        s + ((f.staleDirs as string[])?.length ?? 0) + ((f.staleFiles as string[])?.length ?? 0),
      0,
    ),
    note: 'Directories/files in dist/src/ with no corresponding source. Fix: rm -rf dist && npm run build.',
    findings,
  };
}

// ── monograph_route_map ───────────────────────────────────────────────────────

export const monographRouteMapTool: MCPTool = {
  name: 'monograph_route_map',
  description:
    'List all HTTP routes in the codebase with their handler info. Supports filtering by URL prefix or HTTP method.',
  inputSchema: {
    type: 'object',
    properties: {
      prefix: {
        type: 'string',
        description: 'Filter routes whose path contains this prefix (e.g. /api)',
      },
      method: {
        type: 'string',
        description: 'Filter by HTTP method: GET, POST, PUT, DELETE, PATCH, ANY',
      },
      includeMiddleware: {
        type: 'boolean',
        description: 'Include middleware/use routes (default: false)',
      },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographRouteMap } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographRouteMap(db, {
        prefix: input.prefix as string | undefined,
        method: input.method as string | undefined,
        includeMiddleware: input.includeMiddleware as boolean | undefined,
      });
      if (result.routes.length === 0)
        return text('No routes found. Run monograph_build first or adjust your filters.');
      const lines = [`Routes (${result.total} total):`];
      for (const r of result.routes) {
        const loc = r.handlerFile
          ? r.handlerLine != null
            ? `${r.handlerFile}:${r.handlerLine}`
            : r.handlerFile
          : '';
        const mw =
          r.middlewareChain.length > 0 ? `  middleware: ${r.middlewareChain.join(' → ')}` : '';
        lines.push(
          `  ${r.method} ${r.path}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}${mw}`,
        );
      }
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_shape_check ─────────────────────────────────────────────────────

export const monographShapeCheckTool: MCPTool = {
  name: 'monograph_shape_check',
  description:
    'Validate API route response shapes: checks that handler return keys match consumer property accesses. Detects shape mismatches between producer and consumer.',
  inputSchema: {
    type: 'object',
    properties: {
      route: { type: 'string', description: 'Filter by route path substring (e.g. /api/users)' },
      file: { type: 'string', description: 'Filter by source file path substring' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getShapeCheck } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    const repoPath = getProjectCwd();
    try {
      const result = getShapeCheck(db, repoPath, {
        route: input.route as string | undefined,
        file: input.file as string | undefined,
      });
      // Render as structured text so LLMs can act on it directly without parsing JSON.
      const lines: string[] = [];
      lines.push(`Shape check: ${result.message}`);
      if (result.route) {
        const handlerLoc = result.route.handlerFile
          ? `  Handler: ${result.route.handlerName}  [${result.route.handlerFile}]`
          : `  Handler: ${result.route.handlerName}`;
        lines.push(`Route: ${result.route.method} ${result.route.path}`);
        lines.push(handlerLoc);
      }
      if (result.shape.returnedKeys.length > 0) {
        lines.push(`  Returned keys: ${result.shape.returnedKeys.join(', ')}`);
      }
      if (result.shape.accessedKeys.length > 0) {
        lines.push(`  Accessed keys: ${result.shape.accessedKeys.join(', ')}`);
      }
      if (result.shape.mismatches.length > 0) {
        lines.push(
          `  Mismatches (accessed but not returned): ${result.shape.mismatches.join(', ')}`,
        );
      }
      if (result.shape.extra.length > 0) {
        lines.push(`  Unused returned keys: ${result.shape.extra.join(', ')}`);
      }
      if (result.consumers.length > 0) {
        lines.push(`  Consumers (${result.consumers.length}):`);
        for (const c of result.consumers.slice(0, 10)) {
          lines.push(`    - ${c.name}  [${c.filePath}]`);
        }
        if (result.consumers.length > 10) {
          lines.push(`    … ${result.consumers.length - 10} more`);
        }
      }
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_rename ──────────────────────────────────────────────────────────

export const monographRenameTool: MCPTool = {
  name: 'monograph_rename',
  description:
    'Dry-run multi-file rename: finds all references to a symbol and shows before/after diffs without writing files.',
  inputSchema: {
    type: 'object',
    properties: {
      oldName: { type: 'string', description: 'Current symbol name' },
      newName: { type: 'string', description: 'New symbol name' },
      filePath: { type: 'string', description: 'Optional file path to disambiguate the symbol' },
      dryRun: {
        type: 'boolean',
        description: 'Always true — files are never modified (default: true)',
      },
    },
    required: ['oldName', 'newName'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographRename } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographRename(db, {
        oldName: input.oldName as string,
        newName: input.newName as string,
        filePath: input.filePath as string | undefined,
        dryRun: (input.dryRun as boolean | undefined) ?? true,
      });

      // Format as structured text for direct LLM navigation instead of raw JSON
      const rn = result as any;
      if (!rn) return text(`Symbol not found: ${input.oldName as string}`);
      const occurrences: any[] = rn.occurrences ?? rn.references ?? [];
      const lines: string[] = [
        `Rename: ${input.oldName as string} → ${input.newName as string}  (dry-run)`,
        `Occurrences: ${occurrences.length}`,
        '',
      ];
      for (const occ of occurrences.slice(0, 30)) {
        const fp = occ.filePath ?? occ.file_path ?? '';
        const ln = occ.line ?? occ.startLine ?? occ.start_line;
        const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
        lines.push(`  ${loc || occ}`);
      }
      if (occurrences.length > 30) lines.push(`  … ${occurrences.length - 30} more`);
      return text(lines.join('\n').trim());
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_tool_map ────────────────────────────────────────────────────────

export const monographToolMapTool: MCPTool = {
  name: 'monograph_tool_map',
  description:
    'List MCP/RPC tool definitions in the knowledge graph with handler associations. Shows which functions handle each tool.',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'Filter by tool name substring' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getToolMap } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const results = getToolMap(db, { tool: input.tool as string | undefined });
      if (results.length === 0) return text('No tools found. Run monograph_build first.');
      const lines = results.map((r) => {
        const loc = r.handlerFile
          ? r.handlerLine != null
            ? `${r.handlerFile}:${r.handlerLine}`
            : r.handlerFile
          : (r.filePath ?? '');
        return `${r.name}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}`;
      });
      return text(`Tools (${results.length}):\n${lines.join('\n')}`);
    } finally {
      closeDb(db);
    }
  },
};
