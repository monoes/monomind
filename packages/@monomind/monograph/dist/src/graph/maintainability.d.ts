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
//# sourceMappingURL=maintainability.d.ts.map