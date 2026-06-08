export type EmailMode = 'raw' | 'handle' | 'hash';
export declare const DRIFT_MIN_FILE_AGE_DAYS = 30;
export declare const DRIFT_MAX_ORIGINAL_SHARE = 0.1;
export interface ContributorEntry {
    email: string;
    weightedCommits: number;
    totalCommits: number;
}
export interface OwnershipMetrics {
    busFactor: number;
    driftedHotspots: string[];
    contributorCount: number;
    botFilteredCount: number;
}
export declare function normalizeEmail(email: string, mode: EmailMode): string;
export declare function computeBusFactor(contributors: ContributorEntry[]): number;
export declare function detectDrift(filePath: string, contributors: ContributorEntry[], originalAuthor: string, fileAgeDays: number): boolean;
export declare function isBotEmail(email: string): boolean;
export declare function computeOwnershipMetrics(contributors: ContributorEntry[][], hotspotPaths: string[], originalAuthors: Map<string, string>, fileAgeDays: Map<string, number>): OwnershipMetrics;
export type ContributorIdentifierFormat = 'fullEmail' | 'domainEmail' | 'displayName';
/** Normalize a raw git author string to the specified identifier format. */
export declare function normalizeContributorId(raw: string, format: ContributorIdentifierFormat): string;
//# sourceMappingURL=ownership.d.ts.map