import type { ModuleNode } from '../graph/node-types.js';
import type { FallowUnusedExport } from '../results/fallow-results.js';
export interface UnusedExportsOptions {
    isEntryPoint?: (path: string) => boolean;
    ignorePaths?: string[];
    includeTypeOnlyExports?: boolean;
    maxDuplicates?: number;
}
export declare function findUnusedExports(modules: ModuleNode[], opts?: UnusedExportsOptions): FallowUnusedExport[];
export declare function findDuplicateExports(modules: ModuleNode[]): Array<{
    name: string;
    files: Array<{
        filePath: string;
        line: number;
        col: number;
    }>;
}>;
//# sourceMappingURL=unused-exports.d.ts.map