import type { MonographDb } from '../storage/db.js';
export type ChurnTrend = 'accelerating' | 'stable' | 'declining';
export interface AuthorStats {
    author: string;
    commitCount: number;
    filesOwned: number;
    recentCommits: number;
    churnTrend: ChurnTrend;
    isBot: boolean;
}
export interface AuthorAnalyticsReport {
    authors: AuthorStats[];
    topOwners: AuthorStats[];
    botAuthors: string[];
    unownedFiles: number;
}
export declare function computeAuthorAnalytics(repoPath: string, db: MonographDb): AuthorAnalyticsReport;
/** Format AuthorAnalyticsReport as structured text for LLM navigation. */
export declare function formatAuthorAnalytics(report: AuthorAnalyticsReport): string;
//# sourceMappingURL=author-analytics.d.ts.map