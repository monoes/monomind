export type EmailModeParam = 'full' | 'domain' | 'name';
export type AuditGate = 'new-only' | 'all';
export interface AnalyzeParams {
    root: string;
    configPath?: string;
    changedSince?: string;
    workspaceFilter?: string[];
    threads?: number;
}
export interface HealthParams extends AnalyzeParams {
    minScore?: number;
    groupBy?: 'owner' | 'directory' | 'package' | 'section';
    minInvocationsHot?: number;
    minObservationVolume?: number;
    lowTrafficThreshold?: number;
    emailMode?: EmailModeParam;
    withRuntimeCoverage?: boolean;
}
export interface CheckRuntimeCoverageParams {
    root: string;
    environment?: string;
    period?: string;
    commitSha?: string;
    minInvocationsHot?: number;
    lowTrafficThreshold?: number;
    reporter?: string;
    minConfidence?: number;
}
export interface AuditParams extends AnalyzeParams {
    gate?: AuditGate;
    productionOverride?: boolean;
    baselinePath?: string;
    deadCodeBaselinePath?: string;
    duplicationBaselinePath?: string;
    complexityBaselinePath?: string;
    reporter?: string;
}
export interface FindDupesParams extends AnalyzeParams {
    mode?: 'default' | 'aggressive' | 'lenient';
    minLines?: number;
    minTokens?: number;
    groupBy?: 'owner' | 'directory' | 'package' | 'section';
}
export interface TraceExportParams {
    root: string;
    filePath: string;
    exportName: string;
}
export interface TraceFileParams {
    root: string;
    filePath: string;
}
export interface TraceDependencyParams {
    root: string;
    packageName: string;
    from?: string;
    to?: string;
}
export interface TraceCloneParams {
    root: string;
    filePath: string;
    line: number;
    groupId?: string;
}
export interface ProjectInfoParams {
    root: string;
    includeWorkspaces?: boolean;
    reporter?: string;
}
export interface FeatureFlagsParams extends AnalyzeParams {
    sdkFilter?: string[];
    includeEnvVars?: boolean;
    includeSdkCalls?: boolean;
    includeConfigObjects?: boolean;
    crossReferenceDeadCode?: boolean;
    reporter?: string;
}
export interface ListBoundariesParams extends AnalyzeParams {
    showEntryPoints?: boolean;
    showRules?: boolean;
    groupBy?: 'zone' | 'plugin';
    reporter?: string;
}
export declare function isValidEmailMode(v: unknown): v is EmailModeParam;
export declare function isValidAuditGate(v: unknown): v is AuditGate;
export interface CheckChangedMcpParams {
    root: string;
    gitRef?: string;
    filters?: string[];
    workspace?: string;
    includeEntryFiles?: boolean;
}
export interface FixMcpParams {
    root: string;
    apply?: boolean;
    filterUnused?: boolean;
    filterDeps?: boolean;
}
export interface ExplainMcpParams {
    ruleId: string;
    verbose?: boolean;
}
export declare function isValidFixMode(mode: unknown): mode is 'preview' | 'apply';
export interface ExtendedAnalyzeParams extends AnalyzeParams {
    production?: boolean;
    workspace?: string;
    issueTypes?: string[];
    boundaryViolations?: boolean;
    baseline?: string;
    saveBaseline?: boolean;
    failOnRegression?: boolean;
    tolerance?: number;
    groupBy?: 'owner' | 'directory' | 'package' | 'section';
    file?: string;
    includeEntryExports?: boolean;
    entryPatterns?: string[];
    tsconfig?: string;
    reporter?: string;
    noGitignore?: boolean;
}
export interface ExtendedHealthParams extends HealthParams {
    maxCyclomatic?: number;
    maxCognitive?: number;
    maxCrap?: number;
    complexityThreshold?: number;
    crapThreshold?: number;
    reporter?: string;
    includeHotspots?: boolean;
    coverageFile?: string;
    top?: number;
    sort?: 'crap' | 'cyclomatic' | 'cognitive' | 'mi';
    complexity?: boolean;
    fileScores?: boolean;
    hotspots?: boolean;
    ownership?: boolean;
    ownershipEmailMode?: 'fullEmail' | 'domainEmail' | 'displayName';
    targets?: boolean;
    coverageGaps?: boolean;
    score?: boolean;
    minScore?: number;
    minSeverity?: 'moderate' | 'high' | 'critical';
    since?: string;
    minCommits?: number;
    saveSnapshot?: boolean;
    trend?: boolean;
    summary?: boolean;
    coverage?: string;
    coverageRoot?: string;
    groupBy?: 'owner' | 'directory' | 'package' | 'section';
}
export interface ExtendedFindDupesParams extends FindDupesParams {
    threshold?: number;
    skipLocal?: boolean;
    crossLanguage?: boolean;
    ignoreImports?: boolean;
    explainSkipped?: boolean;
    top?: number;
    baseline?: string;
    saveBaseline?: boolean;
    changedSince?: string;
    groupBy?: 'owner' | 'directory' | 'package' | 'section';
    reporter?: string;
}
export interface GetHotPathsMcpParams {
    root: string;
    minRequestsPerDay?: number;
    limit?: number;
}
export interface GetBlastRadiusMcpParams {
    root: string;
    filePath: string;
    limit?: number;
}
export interface GetImportanceMcpParams {
    root: string;
    limit?: number;
    minScore?: number;
}
export interface GetCleanupCandidatesMcpParams {
    root: string;
    maxCoveragePct?: number;
    limit?: number;
}
//# sourceMappingURL=params.d.ts.map