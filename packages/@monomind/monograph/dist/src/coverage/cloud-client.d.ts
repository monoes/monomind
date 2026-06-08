export type CloudRuntimeRiskBand = 'hot' | 'warm' | 'cold' | 'unknown';
export type CloudTrackingState = 'tracked' | 'untracked' | 'partial';
export type CloudRuntimeWarning = 'low_traffic' | 'short_window' | 'partial_coverage';
export interface CloudRuntimeBlastRadiusEntry {
    callerName: string;
    callerFile: string;
    callerLine: number;
    trafficWeight: number;
}
export interface CloudRuntimeImportanceEntry {
    name: string;
    filePath: string;
    importanceScore: number;
}
export interface CloudRuntimeFunction {
    name: string;
    filePath: string;
    startLine: number;
    hitCount: number;
    riskBand: CloudRuntimeRiskBand;
    importanceScore: number;
    blastRadius: CloudRuntimeBlastRadiusEntry[];
}
export interface CloudRuntimeSummary {
    totalFunctions: number;
    hotFunctions: number;
    coldFunctions: number;
    unknownFunctions: number;
    observationWindowDays: number;
    trackingState: CloudTrackingState;
    warnings: CloudRuntimeWarning[];
}
export interface CloudRuntimeContext {
    projectId: string;
    environment: string;
    commitSha?: string;
    period: string;
    summary: CloudRuntimeSummary;
    functions: CloudRuntimeFunction[];
    importanceEntries: CloudRuntimeImportanceEntry[];
}
export type CloudErrorKind = 'AuthError' | 'TierRequired' | 'NetworkError' | 'ValidationError' | 'NotFound' | 'RateLimited';
export interface CloudError {
    kind: CloudErrorKind;
    message: string;
    exitCode: number;
}
export interface CloudRequest {
    projectId: string;
    environment?: string;
    commitSha?: string;
    period?: string;
    apiKey?: string;
    apiBase?: string;
}
/** Build the URL for a cloud runtime context request. */
export declare function buildCloudRequestUrl(base: string, req: CloudRequest): string;
/** Fetch runtime coverage context from the cloud API (stub — real impl requires HTTP client). */
export declare function fetchRuntimeContext(req: CloudRequest): Promise<CloudRuntimeContext | CloudError>;
export declare function isCloudError(v: CloudRuntimeContext | CloudError): v is CloudError;
//# sourceMappingURL=cloud-client.d.ts.map