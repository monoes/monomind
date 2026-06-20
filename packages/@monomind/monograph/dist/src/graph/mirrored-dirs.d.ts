import type { MonographDb } from '../storage/db.js';
import type { CloneFamily } from '../graph/clone-families.js';
export interface MirroredDirPair {
    dirA: string;
    dirB: string;
    similarity: number;
    sharedFileNames: string[];
    uniqueToA: number;
    uniqueToB: number;
}
export interface MirroredDirsReport {
    pairs: MirroredDirPair[];
    totalDirsAnalyzed: number;
}
/**
 * Detect directory subtrees that are structural mirrors of each other.
 * Uses Jaccard similarity of file basenames within each directory.
 *
 * @param db - monograph database
 * @param minSimilarity - minimum Jaccard similarity threshold (default 0.7)
 */
export declare function detectMirroredDirs(db: MonographDb, minSimilarity?: number): MirroredDirsReport;
export interface MirroredDirResult {
    mirrored: MirroredDirPair[];
    remaining: CloneFamily[];
}
export declare function detectMirroredFamilies(families: CloneFamily[], root: string): MirroredDirResult;
/**
 * Format a MirroredDirsReport as structured text for LLM consumption.
 */
export declare function formatMirroredDirs(report: MirroredDirsReport): string;
//# sourceMappingURL=mirrored-dirs.d.ts.map