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
export function resolveAllImports(modules, files, workspaces, activePlugins, pathAliases, scssIncludePaths, root, extraConditions) {
    const pathToId = new Map(files.map(f => [f.path, f.fileId]));
    const rawPathToId = new Map(files.filter(f => f.canonicalPath).map(f => [f.canonicalPath, f.fileId]));
    const workspaceRoots = new Map(workspaces.filter(w => w.name).map(w => [w.name, w.root]));
    const ctx = {
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
//# sourceMappingURL=index.js.map