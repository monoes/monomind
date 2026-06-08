import type { ResolveContext, ResolvedImport } from './types.js';
export interface RequireCallInfo {
    specifier: string;
    span?: {
        start: number;
        end: number;
    };
}
export declare function resolveRequireImports(ctx: ResolveContext, filePath: string, requireCalls: RequireCallInfo[]): ResolvedImport[];
//# sourceMappingURL=require-imports.d.ts.map