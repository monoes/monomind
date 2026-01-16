/**
 * Confidence-gated human input types.
 * @packageDocumentation
 */

/** When to request human input */
export type HumanInputMode = 'NEVER' | 'ALWAYS' | 'ON_LOW_CONFIDENCE';

/** Configuration for confidence gating */
export interface ConfidenceConfig {
  /** Score threshold (0-1). Below this triggers human input in ON_LOW_CONFIDENCE mode */
  threshold: number;
  /** When to request human input */
  mode: HumanInputMode;
  /** Timeout in ms for human responses */
  timeoutMs: number;
  /** In CI, abort instead of pausing when confidence is low */
  ciAbortOnLowConfidence: boolean;
}

/** Status of an input request */
export type InputRequestStatus = 'pending' | 'responded' | 'timed_out' | 'auto_approved';

/** A request for human input */
export interface InputRequest {
  requestId: string;
  agentId: string;
  taskId: string;
  agentOutput: string;
  confidenceScore: number;
  question: string;
  createdAt: string;
  expiresAt: string;
  status: InputRequestStatus;
  response?: string;
  respondedAt?: string;
}

/** Default confidence configuration */
export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  threshold: 0.7,
  mode: 'ON_LOW_CONFIDENCE',
  timeoutMs: 300_000, // 5 minutes
  ciAbortOnLowConfidence: false,
};
