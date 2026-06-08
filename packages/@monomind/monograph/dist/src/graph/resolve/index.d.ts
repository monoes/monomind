import type { ResolvedModule, DiscoveredFile, WorkspaceInfo, FileId } from './types.js';
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
    imports: Array<{
        specifier: string;
        isDynamic?: boolean;
        isTypeOnly?: boolean;
    }>;
    reExports: Array<{
        specifier: string;
        isTypeOnly?: boolean;
    }>;
    hasCjsExports?: boolean;
}
export declare function resolveAllImports(modules: ModuleInfo[], files: DiscoveredFile[], workspaces: WorkspaceInfo[], activePlugins: string[], pathAliases: Array<[string, string]>, scssIncludePaths: string[], root: string, extraConditions: string[]): ResolvedModule[];
export { extractPackageNameFromNodeModulesPath };
//# sourceMappingURL=index.d.ts.map