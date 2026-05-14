/**
 * Agent Version Diff Utility (Task 29)
 *
 * Computes a simple unified-style diff between two content strings.
 */
export interface LineDiffResult {
    additions: number;
    deletions: number;
    hunks: string;
}
/**
 * Compute a unified diff between two content strings.
 *
 * Uses a simple line-by-line LCS-based approach to produce
 * addition/deletion counts and a unified-style hunk string.
 */
export declare function computeUnifiedDiff(oldContent: string, newContent: string): LineDiffResult;
//# sourceMappingURL=version-diff.d.ts.map