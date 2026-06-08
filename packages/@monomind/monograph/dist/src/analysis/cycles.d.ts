import type { MonographDb } from '../storage/db.js';
export interface DependencyCycle {
    files: string[];
    length: number;
    isCrossCommunity: boolean;
    edgeRelations: string[];
}
export interface CycleDetectionResult {
    cycles: DependencyCycle[];
    totalCycles: number;
    filesInCycles: number;
    longestCycle: number;
    crossCommunityCycles: number;
}
export declare function detectCycles(db: MonographDb): CycleDetectionResult;
//# sourceMappingURL=cycles.d.ts.map