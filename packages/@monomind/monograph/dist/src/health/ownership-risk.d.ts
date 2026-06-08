export interface ContributorRecord {
    email: string;
    commits: number;
    lastCommit: string;
}
export interface OwnershipRisk {
    busFactor: number;
    contributorCount: number;
    topContributor?: string;
    topContributorShare: number;
    isDrifted: boolean;
    isStale: boolean;
    staleDays: number;
}
export declare const BOT_PATTERNS: RegExp[];
export declare function isBot(email: string, name?: string): boolean;
export declare function computeBusFactor(contributors: ContributorRecord[]): number;
export declare function computeOwnershipRisk(contributors: ContributorRecord[], referenceDate?: string): OwnershipRisk;
//# sourceMappingURL=ownership-risk.d.ts.map