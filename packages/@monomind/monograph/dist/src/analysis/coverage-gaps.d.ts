import type { MonographDb } from '../storage/db.js';
export interface UntestedFile {
    nodeId: string;
    filePath: string;
    reachabilityRole: string;
    inDegree: number;
    reason: string;
}
export interface UntestedExport {
    nodeId: string;
    name: string;
    filePath: string | null;
    exportType: string;
}
export interface CoverageGapsResult {
    untestedFiles: UntestedFile[];
    untestedExports: UntestedExport[];
    fileCoveragePct: number;
    exportCoveragePct: number;
    summary: string;
}
export declare function computeCoverageGaps(db: MonographDb): CoverageGapsResult;
//# sourceMappingURL=coverage-gaps.d.ts.map