/**
 * Planning step types for mandatory agent planning before execution.
 * @packageDocumentation
 */

/** Supported output formats for agent plans. */
export type PlanFormat = 'markdown' | 'json' | 'numbered-list';

/** Configuration for the planning step. */
export interface PlanningConfig {
  /** Whether the planning step is enabled. */
  enabled: boolean;
  /** Output format for the plan. */
  format: PlanFormat;
  /** Approximate max token budget for the plan (chars / 4). */
  maxPlanTokens: number;
  /** Whether the plan must be approved before execution proceeds. */
  requireApproval: boolean;
  /** Whether to persist plans to disk via PlanStore. */
  persistPlan: boolean;
}

/** Default planning configuration. */
export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  enabled: false,
  format: 'markdown',
  maxPlanTokens: 500,
  requireApproval: false,
  persistPlan: true,
};

/** A plan produced by an agent before execution. */
export interface AgentPlan {
  /** Unique identifier for this plan. */
  planId: string;
  /** Slug of the agent that produced the plan. */
  agentSlug: string;
  /** The original task description the plan addresses. */
  taskDescription: string;
  /** The raw plan text. */
  plan: string;
  /** Format the plan was produced in. */
  format: PlanFormat;
  /** Agent's self-assessed confidence (0-1). */
  confidence?: number;
  /** Number of steps the agent estimated. */
  estimatedSteps: number;
  /** When the plan was created. */
  createdAt: Date;
  /** Whether the plan has been approved (relevant when requireApproval is true). */
  approved?: boolean;
}
