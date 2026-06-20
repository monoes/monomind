import type { MonographDb } from '../storage/db.js';
import type { AnnotatedFinding } from '../types.js';
export interface CrossReferenceFinding extends AnnotatedFinding {
    crossRefType: 'dead+duplicate';
    nodeIds: string[];
    description: string;
}
export interface CrossReferenceReport {
    findings: CrossReferenceFinding[];
    deadCount: number;
    duplicateCount: number;
    crossCount: number;
}
/**
 * Cross-reference unreachable files with duplicated files.
 * Files that are BOTH dead code AND structurally duplicated are
 * the highest-confidence safe-delete candidates.
 *
 * @param db - monograph database
 */
export declare function crossReferenceDuplicatesAndDeadCode(db: MonographDb): CrossReferenceReport;
/**
 * Format a CrossReferenceReport as structured text for LLM consumption.
 */
export declare function formatCrossReferenceReport(report: CrossReferenceReport): string;
//# sourceMappingURL=cross-reference.d.ts.map