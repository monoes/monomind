import type { MonographDb } from '../storage/db.js';
export interface DuplicateExportLocation {
    nodeId: string;
    filePath: string | null;
    startLine: number | null;
    label: string;
}
export interface DuplicateExportGroup {
    exportName: string;
    locations: DuplicateExportLocation[];
    count: number;
}
export interface DuplicateExportsResult {
    groups: DuplicateExportGroup[];
    totalDuplicates: number;
    affectedFiles: number;
}
export declare function detectDuplicateExports(db: MonographDb): DuplicateExportsResult;
/** Format DuplicateExportsResult as structured text with file:line hints for LLM navigation. */
export declare function formatDuplicateExports(result: DuplicateExportsResult): string;
//# sourceMappingURL=duplicate-exports.d.ts.map