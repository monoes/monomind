import type { MonographDb } from '../storage/db.js';
export interface ClonePair {
    fileA: string;
    fileB: string;
    similarity: number;
    cloneType: 'exact' | 'renamed' | 'structural';
    tokenCount: number;
}
export interface CloneDetectionResult {
    pairs: ClonePair[];
    totalFiles: number;
    cloneRatio: number;
}
export declare function detectClones(db: MonographDb, minSimilarity?: number, minTokens?: number): CloneDetectionResult;
//# sourceMappingURL=clone-detector.d.ts.map