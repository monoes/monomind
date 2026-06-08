import type Database from 'better-sqlite3';
export interface CheckUpdateOptions {
    maxAgeMs?: number;
}
export interface CheckUpdateResult {
    needsUpdate: boolean;
    indexedAt: string | null;
    ageMs: number;
    reason: string;
}
export declare function checkUpdate(db: Database.Database, options?: CheckUpdateOptions): CheckUpdateResult;
//# sourceMappingURL=check-update.d.ts.map