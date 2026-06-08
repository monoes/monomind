import type { MonographDb } from '../storage/db.js';
export interface CodeClimateIssue {
    type: 'issue';
    check_name: string;
    description: string;
    categories: string[];
    fingerprint: string;
    severity: 'blocker' | 'critical' | 'major' | 'minor' | 'info';
    location: {
        path: string;
        lines: {
            begin: number;
            end?: number;
        };
    };
}
/**
 * Export CodeClimate-compatible issue list from the monograph DB.
 * Returns a JSON-serialisable array of issues.
 */
export declare function exportCodeClimate(db: MonographDb, repoRoot?: string): CodeClimateIssue[];
export interface CodeClimateHealthIssue extends CodeClimateIssue {
    categories: ['Complexity'];
}
export interface CodeClimateDuplicationIssue extends CodeClimateIssue {
    categories: ['Duplication'];
}
export interface HealthFindingInput {
    filePath: string;
    functionName: string;
    startLine: number;
    endLine: number;
    severity: 'major' | 'minor' | 'critical' | 'info';
    crapScore: number;
    cyclomatic: number;
}
export interface DuplicationFindingInput {
    filePath: string;
    startLine: number;
    endLine: number;
    groupId: number;
    duplicatedLines: number;
}
export declare function exportHealthCodeClimate(findings: HealthFindingInput[]): CodeClimateIssue[];
export declare function exportDuplicationCodeClimate(findings: DuplicationFindingInput[]): CodeClimateIssue[];
//# sourceMappingURL=codeclimate.d.ts.map