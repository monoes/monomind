import type { MonographDb } from '../storage/db.js';
export interface MaintainabilityResult {
    nodeId: string;
    name: string;
    filePath: string | null;
    mi: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    halsteadVolume: number;
    linesOfCode: number;
}
export interface MaintainabilityReport {
    results: MaintainabilityResult[];
    averageMi: number;
    lowMiCount: number;
    criticalCount: number;
}
export declare function computeMaintainabilityIndex(db: MonographDb): MaintainabilityReport;
/**
 * Format a MaintainabilityReport as structured text with file:line hints for LLM navigation.
 *
 * @param report - MaintainabilityReport from computeMaintainabilityIndex()
 * @param topN - number of worst files to list (default 10)
 * @returns structured text suitable for LLM consumption
 */
export declare function formatMaintainability(report: MaintainabilityReport, topN?: number): string;
//# sourceMappingURL=maintainability.d.ts.map