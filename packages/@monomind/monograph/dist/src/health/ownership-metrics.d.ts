export type ContributorIdentifierFormat = 'raw' | 'handle' | 'hash';
export interface ContributorEntry {
    identifier: string;
    format: ContributorIdentifierFormat;
    share: number;
    staleDays: number;
    commits: number;
}
export interface OwnershipMetrics {
    busFactor: number;
    contributorCount: number;
    topContributor: ContributorEntry;
    recentContributors: ContributorEntry[];
    suggestedReviewers: ContributorEntry[];
    declaredOwner?: string;
    unowned?: boolean;
    drift: boolean;
    driftReason?: string;
}
export interface HotspotSummary {
    since: string;
    minCommits: number;
    filesAnalyzed: number;
    filesExcluded: number;
    shallowClone: boolean;
}
export declare function computeBusFactor(contributors: ContributorEntry[]): number;
export declare function filterSuggestedReviewers(contributors: ContributorEntry[], topContributor: ContributorEntry, maxStaleDays?: number): ContributorEntry[];
export declare function formatOwnershipMetrics(m: OwnershipMetrics): string;
//# sourceMappingURL=ownership-metrics.d.ts.map