/**
 * Eval Dataset Types (Task 33)
 * Types for automated eval dataset generation from production traces.
 */

export interface EvalTrace {
  traceId: string;
  agentSlug: string;
  agentVersion: string;
  taskDescription: string;
  taskInput: string;
  agentOutput: string;
  retryCount: number;
  qualityScore?: number;
  outcome: 'success' | 'failure' | 'timeout';
  latencyMs: number;
  tokenCount?: number;
  costUsd?: number;
  capturedAt: string;
  reviewStatus: 'pending' | 'approved' | 'corrected' | 'rejected';
  correctedOutput?: string;
  tags: string[];
}

export interface EvalDatasetEntry {
  entryId: string;
  datasetId: string;
  traceId: string;
  addedAt: string;
}

export interface EvalDataset {
  datasetId: string;
  name: string;
  description: string;
  agentSlugs: string[];
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  baselineRunId?: string;
}

export interface RegressionDetail {
  traceId: string;
  agentSlug: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

export interface EvalRunResult {
  runId: string;
  datasetId: string;
  runAt: string;
  agentVersion: string;
  entriesTested: number;
  passCount: number;
  failCount: number;
  avgQualityScore: number;
  avgLatencyMs: number;
  regressionDetected: boolean;
  regressionDetails: RegressionDetail[];
}
