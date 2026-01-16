/**
 * Procedural Memory Types
 *
 * Types for learning from successful agent executions.
 * Part of Task 45 — Procedural Memory.
 */

/** Outcome of a single tool action */
export type ActionOutcome = 'success' | 'failure' | 'partial';

/** A single recorded action within an agent run */
export interface ActionRecord {
  recordId: string;
  runId: string;
  agentId: string;
  agentSlug: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
  outcome: ActionOutcome;
  durationMs: number;
  qualityScore?: number;
  timestamp: string;
}

/** Configuration for extracting learned skills from action records */
export interface ExtractionConfig {
  /** Minimum number of successful occurrences before extraction (default 3) */
  minSuccessCount: number;
  /** Minimum average quality score threshold (default 0.75) */
  minAvgQualityScore: number;
  /** Maximum actions in a sequence (default 12) */
  maxSequenceLength: number;
  /** How far back to look in days (default 30) */
  lookbackDays: number;
  /** Minimum similarity for grouping sequences (default 0.85) */
  minSimilarityForGrouping: number;
}

/** Default extraction configuration */
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  minSuccessCount: 3,
  minAvgQualityScore: 0.75,
  maxSequenceLength: 12,
  lookbackDays: 30,
  minSimilarityForGrouping: 0.85,
};

/** Trigger condition for a learned skill */
export interface SkillTrigger {
  pattern: string;
  mode: 'exact' | 'semantic';
  minConfidence: number;
}

/** A learned skill extracted from repeated successful executions */
export interface LearnedSkill {
  skillId: string;
  name: string;
  agentSlug: string;
  trigger: SkillTrigger;
  actionSequence: ActionRecord[];
  successCount: number;
  avgQualityScore: number;
  sourceRunIds: string[];
  createdAt: string;
  lastUpdatedAt: string;
  version: number;
}

/** A group of similar action sequences discovered by the extractor */
export interface ActionSequenceGroup {
  agentSlug: string;
  fingerprint: string;
  sequences: ActionRecord[][];
  successCount: number;
  avgQualityScore: number;
  runIds: string[];
}
