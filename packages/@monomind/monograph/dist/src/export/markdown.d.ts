import type { MonographDb } from '../storage/db.js';
export interface MarkdownReportOptions {
    groupByOwner?: boolean;
    repoRoot?: string;
    title?: string;
}
/**
 * Generate a human-readable Markdown report from the monograph graph DB.
 */
export declare function exportMarkdown(db: MonographDb, options?: MarkdownReportOptions): string;
export interface MarkdownHealthFinding {
    filePath: string;
    functionName: string;
    startLine: number;
    cyclomatic: number;
    cognitive: number;
    crapScore: number;
    severity: string;
}
export interface MarkdownDuplicationGroup {
    groupId: number;
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
    duplicatedLines: number;
}
export declare function exportHealthMarkdown(findings: MarkdownHealthFinding[], title?: string): string;
export declare function exportDuplicationMarkdown(groups: MarkdownDuplicationGroup[], title?: string): string;
//# sourceMappingURL=markdown.d.ts.map