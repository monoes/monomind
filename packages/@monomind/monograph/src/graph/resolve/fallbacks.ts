import * as path from 'node:path';
import type { ResolveContext, ResolveResult, FileId, DynamicImportPattern, DiscoveredFile } from './types.js';
import { OUTPUT_DIRS } from './types.js';
import { extractPackageNameFromNodeModulesPath } from './path-info.js';

export function trySourceFallback(canonical: string, pathToId: Map<string, FileId>): FileId | null {
  const normalized = canonical.replace(/\\/g, '/');
  for (const outDir of OUTPUT_DIRS) {
    const pattern = `/${outDir}/`;
    if (normalized.includes(pattern)) {
      const sourcePath = normalized.replace(pattern, '/src/');
      const id = pathToId.get(sourcePath);
      if (id !== undefined) return id;
    }
  }
  return null;
}

export function tryPnpmWorkspaceFallback(
  canonical: string,
  pathToId: Map<string, FileId>,
  workspaceRoots: Map<string, string>,
): FileId | null {
  const normalized = canonical.replace(/\\/g, '/');
  const pnpmStore = 'node_modules/.pnpm/';
  const idx = normalized.indexOf(pnpmStore);
  if (idx === -1) return null;
  const afterStore = normalized.slice(idx + pnpmStore.length);
  const nodeModulesIdx = afterStore.indexOf('/node_modules/');
  if (nodeModulesIdx === -1) return null;
  const subpath = afterStore.slice(nodeModulesIdx + '/node_modules/'.length);
  for (const [, wsRoot] of workspaceRoots) {
    const candidate = path.join(wsRoot, 'node_modules', subpath);
    const id = pathToId.get(candidate);
    if (id !== undefined) return id;
  }
  return null;
}

export function tryWorkspacePackageFallback(
  ctx: ResolveContext,
  specifier: string,
): ResolveResult | null {
  for (const [pkgName, wsRoot] of ctx.workspaceRoots) {
    if (specifier === pkgName || specifier.startsWith(pkgName + '/')) {
      const subpath = specifier.slice(pkgName.length);
      const candidate = path.join(wsRoot, subpath || 'index');
      const id = ctx.pathToId.get(candidate);
      if (id !== undefined) return { kind: 'InternalModule', fileId: id };
    }
  }
  return null;
}

export function makeGlobFromPattern(pattern: DynamicImportPattern): string {
  return pattern.pattern
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/\+/g, '*')
    .replace(/\(\?:[^)]+\)/g, '*');
}

export function tryScssIncludePathFallback(
  ctx: ResolveContext,
  _fromFile: string,
  specifier: string,
  fromStyle: boolean,
): ResolveResult | null {
  if (!fromStyle) return null;
  for (const includePath of ctx.scssIncludePaths) {
    const candidate = path.join(includePath, specifier);
    const id = ctx.pathToId.get(candidate);
    if (id !== undefined) return { kind: 'InternalModule', fileId: id };
    for (const ext of ['.scss', '.sass', '.css']) {
      const withExt = ctx.pathToId.get(candidate + ext);
      if (withExt !== undefined) return { kind: 'InternalModule', fileId: withExt };
    }
  }
  return null;
}
