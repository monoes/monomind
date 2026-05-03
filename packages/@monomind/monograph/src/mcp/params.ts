// Typed parameter schemas for all MCP tool endpoints.

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
}

export interface AuditParams extends AnalyzeParams {
  gate?: AuditGate;
  productionOverride?: boolean;
  baselinePath?: string;
  deadCodeBaselinePath?: string;
  duplicationBaselinePath?: string;
  complexityBaselinePath?: string;
}

export interface FindDupesParams extends AnalyzeParams {
  mode?: 'default' | 'aggressive' | 'lenient';
  minLines?: number;
  minTokens?: number;
  groupBy?: 'owner' | 'directory' | 'package';
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
}

export interface TraceCloneParams {
  root: string;
  filePath: string;
  line: number;
}

export interface ProjectInfoParams {
  root: string;
  includeWorkspaces?: boolean;
}

export interface FeatureFlagsParams extends AnalyzeParams {
  sdkFilter?: string[];
  includeEnvVars?: boolean;
  includeSdkCalls?: boolean;
  includeConfigObjects?: boolean;
  crossReferenceDeadCode?: boolean;
}

export interface ListBoundariesParams extends AnalyzeParams {
  showEntryPoints?: boolean;
  showRules?: boolean;
  groupBy?: 'zone' | 'plugin';
}

export function isValidEmailMode(v: unknown): v is EmailModeParam {
  return v === 'full' || v === 'domain' || v === 'name';
}

export function isValidAuditGate(v: unknown): v is AuditGate {
  return v === 'new-only' || v === 'all';
}
