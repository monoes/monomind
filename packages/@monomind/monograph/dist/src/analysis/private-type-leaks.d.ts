import type { MonographDb } from '../storage/db.js';
export interface PrivateTypeLeak {
    exportNodeId: string;
    exportName: string;
    exportFilePath: string | null;
    exportStartLine: number | null;
    leakedTypeNodeId: string;
    leakedTypeName: string;
    leakedTypeFilePath: string | null;
    leakedTypeStartLine: number | null;
    reason: string;
}
export interface PrivateTypeLeaksResult {
    leaks: PrivateTypeLeak[];
    totalLeaks: number;
    affectedExports: number;
}
export declare function detectPrivateTypeLeaks(db: MonographDb): PrivateTypeLeaksResult;
/** Format PrivateTypeLeaksResult as structured text with file:line hints for LLM navigation. */
export declare function formatPrivateTypeLeaks(result: PrivateTypeLeaksResult): string;
//# sourceMappingURL=private-type-leaks.d.ts.map