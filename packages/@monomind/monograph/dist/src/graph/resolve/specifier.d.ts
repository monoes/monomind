import type { ResolveContext, ResolveResult } from './types.js';
export declare function isStyleFile(filePath: string): boolean;
export declare function isJsTsExtension(filePath: string): boolean;
export declare function isPlainCssFile(filePath: string): boolean;
export declare function isBareStyleSubpath(specifier: string): boolean;
export declare function pathAliasPatternMatches(pattern: string, specifier: string): boolean;
export declare function matchesNearestTsconfigPathAlias(root: string, fromFile: string, specifier: string): boolean;
export declare function nearestTsconfigPath(root: string, fromFile: string): string | null;
export declare function resolveSpecifier(ctx: ResolveContext, fromFile: string, specifier: string, fromStyle: boolean): ResolveResult;
//# sourceMappingURL=specifier.d.ts.map