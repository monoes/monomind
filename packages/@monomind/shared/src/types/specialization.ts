/**
 * Agent Specialization Scoring Types (Task 39)
 *
 * Per-agent-per-task-type scoring with time-decay, enabling monobrain
 * to prefer historically successful agents for specific task types.
 */

export interface SpecializationScore {
  agentSlug: string;
  taskType: string;
  successCount: number;
  failureCount: number;
  totalCount: number;
  successRate: number;        // 0.0-1.0
  avgLatencyMs: number;
  avgQualityScore: number;    // 0.0-1.0
  lastUpdated: string;        // ISO 8601
  decayFactor: number;        // 0.0-1.0
  effectiveScore: number;     // successRate * decayFactor
}

export interface ScoreUpdate {
  agentSlug: string;
  taskType: string;
  success: boolean;
  latencyMs: number;
  qualityScore?: number;
}
