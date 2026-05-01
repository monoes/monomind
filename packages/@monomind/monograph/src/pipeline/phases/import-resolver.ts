import { existsSync, readFileSync, readdirSync } from 'fs';
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
  if (!existsSync(baseDir)) return [];
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
  if (!existsSync(pkgPath)) return [];

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
      if (!existsSync(subPkgPath)) continue;
      try {
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

export const importResolverPhase: PipelinePhase<ImportResolverOutput> = {
  name: 'import-resolver',
  deps: ['cross-file'],
  async execute(ctx: PipelineContext): Promise<ImportResolverOutput> {
    const workspacePackages = detectWorkspacePackages(ctx.repoPath);
    return { workspacePackages, resolvedCount: 0 };
  },
};
