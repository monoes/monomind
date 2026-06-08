import type { MonographDb } from '../storage/db.js';
export interface StalenessReport {
    isStale: boolean;
    indexedAt: string | null;
    indexedCommit: string | null;
    currentCommit: string | null;
    changedSince: string[];
    staleSince: string | null;
}
export declare function checkStaleness(db: MonographDb, repoPath: string): StalenessReport;
//# sourceMappingURL=git-staleness.d.ts.map