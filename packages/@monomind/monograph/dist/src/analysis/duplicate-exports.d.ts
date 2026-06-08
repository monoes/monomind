import type { MonographDb } from '../storage/db.js';
export interface DuplicateExportGroup {
    exportName: string;
    locations: Array<{
        nodeId: string;
        filePath: string | null;
        label: string;
    }>;
    count: number;
}
export interface DuplicateExportsResult {
    groups: DuplicateExportGroup[];
    totalDuplicates: number;
    affectedFiles: number;
}
export declare function detectDuplicateExports(db: MonographDb): DuplicateExportsResult;
//# sourceMappingURL=duplicate-exports.d.ts.map