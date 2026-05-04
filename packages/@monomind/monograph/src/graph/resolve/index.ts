import type { ResolveContext, ResolvedModule, DiscoveredFile, WorkspaceInfo, FileId } from './types.js';
import { makeResolvedModule } from './types.js';
import { resolveStaticImports } from './static-imports.js';
import { resolveReExports } from './re-exports.js';
import { applySpecifierUpgrades } from './upgrades.js';
import { extractPackageNameFromNodeModulesPath } from './path-info.js';

export * from './types.js';
export * from './path-info.js';
export * from './specifier.js';
export * from './static-imports.js';
export * from './require-imports.js';
export * from './re-exports.js';
export * from './fallbacks.js';
export * from './react-native.js';
export * from './upgrades.js';

export interface ModuleInfo {
  fileId: FileId;
  path: string;
  imports: Array<{ specifier: string; isDynamic?: boolean; isTypeOnly?: boolean }>;
  reExports: Array<{ specifier: string; isTypeOnly?: boolean }>;
  hasCjsExports?: boolean;
}

export function resolveAllImports(
  modules: ModuleInfo[],
  files: DiscoveredFile[],
  workspaces: WorkspaceInfo[],
  activePlugins: string[],
  pathAliases: Array<[string, string]>,
  scssIncludePaths: string[],
  root: string,
  extraConditions: string[],
): ResolvedModule[] {
  const pathToId = new Map<string, FileId>(files.map(f => [f.path, f.fileId]));
  const rawPathToId = new Map<string, FileId>(
    files.filter(f => f.canonicalPath).map(f => [f.canonicalPath!, f.fileId])
  );
  const workspaceRoots = new Map<string, string>(
    workspaces.filter(w => w.name).map(w => [w.name!, w.root])
  );

  const ctx: ResolveContext = {
    pathToId,
    rawPathToId,
    workspaceRoots,
    pathAliases,
    scssIncludePaths,
    root,
    tsconfigWarned: new Set(),
    activePlugins,
    extraConditions,
  };

  const resolved = modules.map(mod => {
    const rm = makeResolvedModule(mod.fileId, mod.path);
    rm.resolvedImports = resolveStaticImports(ctx, mod.path, mod.imports);
    rm.resolvedReExports = resolveReExports(ctx, mod.path, mod.reExports);
    rm.hasCjsExports = mod.hasCjsExports ?? false;
    return rm;
  });

  applySpecifierUpgrades(resolved);
  return resolved;
}

export { extractPackageNameFromNodeModulesPath };
