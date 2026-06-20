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
    startLine: number | null;
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
/** Format CoverageGapsResult as structured text with file:line hints for LLM navigation. */
export declare function formatCoverageGaps(result: CoverageGapsResult, topN?: number): string;
//# sourceMappingURL=coverage-gaps.d.ts.map