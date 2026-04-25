/**
 * Per-Agent Termination Conditions (Task 35)
 *
 * Types and defaults for agent termination policies, events, and reasons.
 */

/** Policy that defines when an agent should be terminated. */
export interface TerminationPolicy {
  maxTurns?: number;
  maxCostUsd?: number;
  timeoutMs?: number;
  stopOnPhrases?: string[];
  maxRetries?: number;
}

/** Reason an agent was terminated. */
export type TerminationReason =
  | 'max_turns_exceeded'
  | 'max_cost_exceeded'
  | 'timeout'
  | 'stop_phrase_matched'
  | 'max_retries_exceeded'
  | 'manual_halt'
  | 'task_complete';

/** Event emitted when an agent is terminated. */
export interface TerminationEvent {
  eventId: string;
  agentId: string;
  agentSlug: string;
  reason: TerminationReason;
  triggeredValue: number | string;
  swarmId?: string;
  terminatedAt: Date;
  cascadeHalt: boolean;
}

/** Sensible defaults applied when policy fields are omitted. */
export const DEFAULT_TERMINATION_POLICY: Required<TerminationPolicy> = {
  maxTurns: 50,
  maxCostUsd: 1.0,
  timeoutMs: 300_000,
  stopOnPhrases: ['TASK_COMPLETE', 'CANNOT_PROCEED', 'ESCALATE_TO_HUMAN'],
  maxRetries: 3,
};
