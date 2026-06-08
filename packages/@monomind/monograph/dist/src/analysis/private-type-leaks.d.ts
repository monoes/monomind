import type { MonographDb } from '../storage/db.js';
export interface PrivateTypeLeak {
    exportNodeId: string;
    exportName: string;
    exportFilePath: string | null;
    leakedTypeNodeId: string;
    leakedTypeName: string;
    leakedTypeFilePath: string | null;
    reason: string;
}
export interface PrivateTypeLeaksResult {
    leaks: PrivateTypeLeak[];
    totalLeaks: number;
    affectedExports: number;
}
export declare function detectPrivateTypeLeaks(db: MonographDb): PrivateTypeLeaksResult;
//# sourceMappingURL=private-type-leaks.d.ts.map