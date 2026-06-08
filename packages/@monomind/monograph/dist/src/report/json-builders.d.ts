export interface HealthActionOptions {
    includeRecommendedActions: boolean;
    includePerFileFindings: boolean;
}
export declare const DEFAULT_HEALTH_ACTION_OPTIONS: HealthActionOptions;
export interface GroupedHealthResult {
    owner: string;
    fileCount: number;
    averageScore: number;
    findings: unknown[];
}
export interface GroupedDuplicationResult {
    owner: string;
    duplicatedLines: number;
    instances: number;
    filePaths: string[];
}
export interface BaselineDelta {
    metric: string;
    baseline: number;
    current: number;
    delta: number;
    deltaSign: '+' | '-' | '=';
}
export declare function buildGroupedHealthJson(groups: GroupedHealthResult[], opts?: HealthActionOptions): string;
export declare function buildGroupedDuplicationJson(groups: GroupedDuplicationResult[]): string;
export declare function buildBaselineDeltasJson(current: Record<string, number>, baseline: Record<string, number>): string;
//# sourceMappingURL=json-builders.d.ts.map