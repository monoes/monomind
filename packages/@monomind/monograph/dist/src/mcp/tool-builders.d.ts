import type { ExtendedAnalyzeParams, ExtendedHealthParams, AuditParams, ExtendedFindDupesParams, TraceExportParams, TraceFileParams, TraceDependencyParams, TraceCloneParams, ProjectInfoParams, FeatureFlagsParams, ListBoundariesParams, CheckRuntimeCoverageParams } from './params.js';
type AnalyzeParams = ExtendedAnalyzeParams;
type HealthParams = ExtendedHealthParams;
type FindDupesParams = ExtendedFindDupesParams;
export interface CheckChangedParams {
    root: string;
    gitRef?: string;
    filters?: string[];
    workspace?: string;
    includeEntryFiles?: boolean;
}
export interface FixParams {
    root: string;
    apply?: boolean;
    filterUnused?: boolean;
    filterDeps?: boolean;
}
export interface ExplainParams {
    ruleId: string;
    verbose?: boolean;
}
export declare function buildAnalyzeArgs(p: AnalyzeParams): string[];
export declare function buildHealthArgs(p: HealthParams): string[];
export declare function buildAuditArgs(p: AuditParams): string[];
export declare function buildFindDupesArgs(p: FindDupesParams): string[];
export declare function buildTraceExportArgs(p: TraceExportParams): string[];
export declare function buildTraceFileArgs(p: TraceFileParams): string[];
export declare function buildTraceDependencyArgs(p: TraceDependencyParams): string[];
export declare function buildTraceCloneArgs(p: TraceCloneParams): string[];
export declare function buildProjectInfoArgs(p: ProjectInfoParams): string[];
export declare function buildFeatureFlagsArgs(p: FeatureFlagsParams): string[];
export declare function buildListBoundariesArgs(p: ListBoundariesParams): string[];
export declare function buildCheckRuntimeCoverageArgs(p: CheckRuntimeCoverageParams): string[];
export declare function buildCheckChangedArgs(p: CheckChangedParams): string[];
export declare function buildFixPreviewArgs(p: FixParams): string[];
export declare function buildFixApplyArgs(p: FixParams): string[];
export declare function buildExplainArgs(p: ExplainParams): string[];
export interface GetHotPathsParams {
    root: string;
    minRequestsPerDay?: number;
    limit?: number;
}
export interface GetBlastRadiusParams {
    root: string;
    filePath: string;
    limit?: number;
}
export interface GetImportanceParams {
    root: string;
    limit?: number;
    minScore?: number;
}
export interface GetCleanupCandidatesParams {
    root: string;
    maxCoveragePct?: number;
    limit?: number;
}
export declare function buildGetHotPathsArgs(p: GetHotPathsParams): string[];
export declare function buildGetBlastRadiusArgs(p: GetBlastRadiusParams): string[];
export declare function buildGetImportanceArgs(p: GetImportanceParams): string[];
export declare function buildGetCleanupCandidatesArgs(p: GetCleanupCandidatesParams): string[];
export {};
//# sourceMappingURL=tool-builders.d.ts.map