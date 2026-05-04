// Discovers monorepo workspace packages, detects undeclared workspaces,
// and parses tsconfig rootDir.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface WorkspaceInfo {
  name: string;
  rootPath: string;
  packageJson: Record<string, unknown>;
}

export interface WorkspaceDiagnostic {
  kind: 'undeclaredWorkspace' | 'missingPackageJson' | 'parseError';
  message: string;
  path: string;
}

export interface WorkspaceConfig {
  root: string;
  patterns: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function discoverWorkspaces(root: string): WorkspaceInfo[] {
  const pkgPath = join(root, 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg) return [];

  const patterns: string[] = [];
  if (Array.isArray(pkg['workspaces'])) {
    patterns.push(...(pkg['workspaces'] as string[]));
  } else if (typeof pkg['workspaces'] === 'object' && pkg['workspaces'] !== null) {
    const ws = pkg['workspaces'] as Record<string, unknown>;
    if (Array.isArray(ws['packages'])) patterns.push(...(ws['packages'] as string[]));
  }

  const results: WorkspaceInfo[] = [];
  for (const pattern of patterns) {
    const base = pattern.replace(/\/\*$/, '');
    const dir = resolve(root, base);
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const wsPkgPath = join(dir, entry.name, 'package.json');
        const wsPkg = readJson(wsPkgPath);
        if (!wsPkg) continue;
        results.push({
          name: (wsPkg['name'] as string | undefined) ?? entry.name,
          rootPath: resolve(dir, entry.name),
          packageJson: wsPkg,
        });
      }
    } catch { /* skip unreadable dirs */ }
  }
  return results;
}

export function findUndeclaredWorkspaces(
  root: string,
  declared: WorkspaceInfo[],
  ignores: string[] = [],
): WorkspaceDiagnostic[] {
  const declaredPaths = new Set(declared.map(w => resolve(w.rootPath)));
  const diagnostics: WorkspaceDiagnostic[] = [];
  const packagesDir = join(root, 'packages');

  if (!existsSync(packagesDir)) return diagnostics;

  try {
    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignores.includes(entry.name)) continue;
      const candidate = resolve(packagesDir, entry.name);
      if (declaredPaths.has(candidate)) continue;
      const hasPkg = existsSync(join(candidate, 'package.json'));
      if (hasPkg) {
        diagnostics.push({
          kind: 'undeclaredWorkspace',
          message: `Directory "${entry.name}" has package.json but is not in workspaces`,
          path: candidate,
        });
      }
    }
  } catch { /* skip */ }

  return diagnostics;
}

export function parseTsconfigRootDir(tsconfigPath: string): string | null {
  const json = readJson(tsconfigPath);
  if (!json) return null;
  const co = (json['compilerOptions'] as Record<string, unknown> | undefined);
  const rootDir = co?.['rootDir'];
  return typeof rootDir === 'string' ? rootDir : null;
}

// ── Round 10: enhanced undeclared workspace detection ─────────────────────────

export interface EnhancedWorkspaceDiagnostic extends WorkspaceDiagnostic {
  suggestion: string;
}

export function findUndeclaredWorkspacesEnhanced(
  root: string,
  declared: WorkspaceInfo[],
  ignores: string[] = [],
): EnhancedWorkspaceDiagnostic[] {
  const basic = findUndeclaredWorkspaces(root, declared, ignores);
  return basic.map(d => ({
    ...d,
    suggestion: `Add "${d.path.replace(root, '').replace(/^\//, '')}" to the workspaces array in package.json`,
  }));
}

export function validateWorkspaceDeclarations(
  declared: WorkspaceInfo[],
  root: string,
): WorkspaceDiagnostic[] {
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const ws of declared) {
    if (!ws.packageJson['name']) {
      diagnostics.push({ kind: 'missingPackageJson', message: `Workspace at "${ws.rootPath.replace(root, '')}" has no name field`, path: ws.rootPath });
    }
  }
  return diagnostics;
}
