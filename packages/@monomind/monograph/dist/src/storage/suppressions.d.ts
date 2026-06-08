import type Database from 'better-sqlite3';
export interface Suppression {
    id: string;
    filePath: string;
    line: number;
    rule: string;
    addedAt: string;
    lastSeenAt?: string;
}
export interface StaleSuppression extends Suppression {
    reason: string;
}
export declare function addSuppression(db: Database.Database, filePath: string, line: number, rule: string): Suppression;
export declare function listSuppressions(db: Database.Database, filePath?: string, rule?: string): Suppression[];
export declare function removeSuppression(db: Database.Database, id: string): void;
export declare function isSuppressed(db: Database.Database, filePath: string, line: number, rule: string): Suppression | null;
export declare function findStaleSuppressions(db: Database.Database, activeFindings: Array<{
    filePath: string;
    rule: string;
}>): StaleSuppression[];
//# sourceMappingURL=suppressions.d.ts.map