/**
 * ForgettingCurveWorker — Applies Ebbinghaus-style exponential decay to memory
 * importance scores and schedules spaced-repetition replay for entries falling
 * below the replay threshold.
 *
 * Formula: decayedScore = importanceScore × exp(−decayRate × Δt_hours)
 *
 * No schema changes required — uses existing `importanceScore` and
 * `lastAccessedAt` fields on MemoryEntry (PersistedWorkerState).
 *
 * Source: FOREVER paper (newinnovation.md §2.6), Ebbinghaus forgetting curve.
 *
 * @module v1/hooks/workers/forgetting-curve-worker
 */

export interface ForgettingCurveEntry {
  id: string;
  /** Current importance score (0–1) */
  importanceScore: number;
  /** Unix ms timestamp of last access */
  lastAccessedAt: number;
  /** Optional: namespace or category label */
  namespace?: string;
}

export interface ForgettingCurveResult {
  /** Entries whose decayed score fell below `replayThreshold` — schedule for replay */
  scheduledForReplay: Array<{
    id: string;
    originalScore: number;
    decayedScore: number;
    hoursSinceAccess: number;
    namespace?: string;
  }>;
  /** Entries whose score is still healthy */
  healthy: Array<{
    id: string;
    decayedScore: number;
  }>;
  processedCount: number;
  replayCount: number;
  durationMs: number;
}

export interface ForgettingCurveConfig {
  /**
   * Per-hour exponential decay rate (λ).
   * Matches the LearningBridge default of −0.005/hour.
   */
  decayRate?: number;
  /**
   * Entries with decayedScore below this are flagged for spaced-repetition replay.
   * Default: 0.3 (30% of original importance).
   */
  replayThreshold?: number;
  /**
   * Cap how many entries are scheduled per run (prevents runaway replay queues).
   * Default: 50.
   */
  maxReplayPerRun?: number;
}

const DEFAULTS: Required<ForgettingCurveConfig> = {
  decayRate: 0.005,       // matches LearningBridge default
  replayThreshold: 0.3,
  maxReplayPerRun: 50,
};

/**
 * ForgettingCurveWorker — stateless, background-safe decay scheduler.
 *
 * Call site: hook into the `ultralearn` / `consolidate` background worker
 * pipeline. The worker pulls MemoryEntry rows with their `importanceScore`
 * and `lastAccessedAt`, computes decayed scores, and returns the replay list
 * for the caller to re-surface (e.g. inject into `agentdb_pattern-store`).
 */
export class ForgettingCurveWorker {
  readonly name = 'forgetting-curve' as const;
  readonly priority = 'low' as const;

  private readonly config: Required<ForgettingCurveConfig>;

  constructor(config: ForgettingCurveConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  async execute(context: {
    entries: ForgettingCurveEntry[];
    nowMs?: number;
  }): Promise<ForgettingCurveResult> {
    const start = Date.now();
    const now = context.nowMs ?? Date.now();
    const { decayRate, replayThreshold, maxReplayPerRun } = this.config;

    const scheduledForReplay: ForgettingCurveResult['scheduledForReplay'] = [];
    const healthy: ForgettingCurveResult['healthy'] = [];

    for (const entry of context.entries) {
      const deltaMs = Math.max(0, now - entry.lastAccessedAt);
      const deltaHours = deltaMs / 3_600_000;
      const decayedScore = entry.importanceScore * Math.exp(-decayRate * deltaHours);

      if (decayedScore < replayThreshold && scheduledForReplay.length < maxReplayPerRun) {
        scheduledForReplay.push({
          id: entry.id,
          originalScore: entry.importanceScore,
          decayedScore,
          hoursSinceAccess: deltaHours,
          namespace: entry.namespace,
        });
      } else {
        healthy.push({ id: entry.id, decayedScore });
      }
    }

    // Sort replay list: lowest score first (most urgent)
    scheduledForReplay.sort((a, b) => a.decayedScore - b.decayedScore);

    return {
      scheduledForReplay,
      healthy,
      processedCount: context.entries.length,
      replayCount: scheduledForReplay.length,
      durationMs: Date.now() - start,
    };
  }
}
