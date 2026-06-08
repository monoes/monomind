import type Database from 'better-sqlite3';
export interface MonographDetectChangesResult {
    changedFiles: string[];
    affectedSymbols: Array<{
        name: string;
        filePath: string;
        label: string;
    }>;
    affectedProcesses: Array<{
        id: string;
        name: string;
    }>;
    error?: string;
}
export declare function detectMonographChanges(db: Database.Database, input: {
    baseBranch?: string;
    includeTests?: boolean;
}, repoPath: string): MonographDetectChangesResult;
//# sourceMappingURL=detect-changes.d.ts.map