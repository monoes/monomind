import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';

export interface WorkspacePackage {
  name: string;
  path: string;
}

export interface ImportResolverOutput {
  workspacePackages: WorkspacePackage[];
  resolvedCount: number;
}

function globWorkspacePattern(repoPath: string, pattern: string): string[] {
  if (!pattern.includes('*')) {
    return [join(repoPath, pattern)];
  }
  const [base] = pattern.split('/*');
  const baseDir = join(repoPath, base ?? '');
  // Skip existsSync — readdirSync will throw ENOENT which the catch already handles.
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(baseDir, d.name));
  } catch {
    return [];
  }
}

export function detectWorkspacePackages(repoPath: string): WorkspacePackage[] {
  const pkgPath = join(repoPath, 'package.json');
  let workspaceGlobs: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) workspaceGlobs = ws;
    else if (ws && Array.isArray(ws.packages)) workspaceGlobs = ws.packages;
  } catch {
    return [];
  }

  const result: WorkspacePackage[] = [];
  for (const glob of workspaceGlobs) {
    const dirs = globWorkspacePattern(repoPath, glob);
    for (const dir of dirs) {
      const subPkgPath = join(dir, 'package.json');
      try {
        // existsSync guard removed — readFileSync throws ENOENT which the catch handles.
        const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf8'));
        if (subPkg.name) {
          result.push({ name: subPkg.name, path: resolve(dir) });
        }
      } catch { /* skip */ }
    }
  }

  return result;
}

export function resolveWorkspaceImport(
  importSpecifier: string,
  packages: WorkspacePackage[],
): string | null {
  for (const pkg of packages) {
    if (importSpecifier === pkg.name || importSpecifier.startsWith(pkg.name + '/')) {
      return pkg.path;
    }
  }
  return null;
}

/**
 * Build a Map<packageName, packagePath> index from a WorkspacePackage array.
 * Use this when resolveWorkspaceImport will be called many times (e.g. per import
 * statement across a whole repo) to reduce resolution cost from O(N*I) to O(N+I).
 */
export function buildPackageIndex(packages: WorkspacePackage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const pkg of packages) {
    index.set(pkg.name, pkg.path);
  }
  return index;
}

/**
 * O(1) workspace import resolution using a pre-built package index.
 * Falls back to prefix scan only for sub-path imports (e.g. `pkg/subpath`).
 */
export function resolveWorkspaceImportFromIndex(
  importSpecifier: string,
  index: Map<string, string>,
): string | null {
  // Exact match: O(1)
  const exact = index.get(importSpecifier);
  if (exact !== undefined) return exact;
  // Sub-path import: find the matching package name prefix
  const slash = importSpecifier.indexOf('/', importSpecifier.startsWith('@') ? importSpecifier.indexOf('/') + 1 : 0);
  if (slash !== -1) {
    const pkgName = importSpecifier.slice(0, slash);
    const path = index.get(pkgName);
    if (path !== undefined) return path;
  }
  return null;
}

export const importResolverPhase: PipelinePhase<ImportResolverOutput> = {
  name: 'import-resolver',
  deps: ['cross-file'],
  async execute(ctx: PipelineContext): Promise<ImportResolverOutput> {
    const workspacePackages = detectWorkspacePackages(ctx.repoPath);
    return { workspacePackages, resolvedCount: 0 };
  },
};
