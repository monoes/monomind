import type { ResolveContext, ResolveResult, FileId, DynamicImportPattern } from './types.js';
export declare function trySourceFallback(canonical: string, pathToId: Map<string, FileId>): FileId | null;
export declare function tryPnpmWorkspaceFallback(canonical: string, pathToId: Map<string, FileId>, workspaceRoots: Map<string, string>): FileId | null;
export declare function tryWorkspacePackageFallback(ctx: ResolveContext, specifier: string): ResolveResult | null;
export declare function makeGlobFromPattern(pattern: DynamicImportPattern): string;
export declare function tryScssIncludePathFallback(ctx: ResolveContext, _fromFile: string, specifier: string, fromStyle: boolean): ResolveResult | null;
//# sourceMappingURL=fallbacks.d.ts.map