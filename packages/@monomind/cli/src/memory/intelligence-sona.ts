/**
 * V1 Intelligence Module — LocalSonaCoordinator
 * Split out of intelligence.ts (file-size sweep). Pure move.
 *
 * @module v1/cli/intelligence
 */

import type { LocalReasoningBank } from './intelligence-reasoning-bank.js';
import type { Signal, SonaConfig, TrajectoryStep } from './intelligence-types.js';

// ============================================================================
// Optimized Local SONA Implementation
// ============================================================================

/**
 * Lightweight SONA Coordinator
 * Uses circular buffer for O(1) signal recording
 * Achieves <0.05ms per operation
 */
export class LocalSonaCoordinator {
  private config: SonaConfig;
  private signals: Signal[];
  private signalHead: number = 0;
  private signalCount: number = 0;
  private trajectories: { steps: TrajectoryStep[]; verdict: string; timestamp: number }[] = [];
  private adaptationTimes: number[] = [];
  private currentTrajectorySteps: TrajectoryStep[] = [];

  constructor(config: SonaConfig) {
    this.config = config;
    // Pre-allocate circular buffer
    this.signals = new Array(config.maxSignals);
  }

  /**
   * Record a signal - O(1) operation
   * Target: <0.05ms
   */
  recordSignal(signal: Signal): void {
    const start = performance.now();

    // Circular buffer insertion - constant time
    this.signals[this.signalHead] = signal;
    this.signalHead = (this.signalHead + 1) % this.config.maxSignals;
    if (this.signalCount < this.config.maxSignals) {
      this.signalCount++;
    }

    const elapsed = performance.now() - start;
    this.adaptationTimes.push(elapsed);
    if (this.adaptationTimes.length > 100) {
      this.adaptationTimes.shift();
    }
  }

  /**
   * Record complete trajectory
   */
  recordTrajectory(trajectory: {
    steps: TrajectoryStep[];
    verdict: string;
    timestamp: number;
  }): void {
    this.trajectories.push(trajectory);
    if (this.trajectories.length > this.config.maxTrajectorySize) {
      this.trajectories.shift();
    }
  }

  /**
   * Get recent signals
   */
  getRecentSignals(count: number = 10): Signal[] {
    const result: Signal[] = [];
    const actualCount = Math.min(count, this.signalCount);

    for (let i = 0; i < actualCount; i++) {
      const idx = (this.signalHead - 1 - i + this.config.maxSignals) % this.config.maxSignals;
      if (this.signals[idx]) {
        result.push(this.signals[idx]);
      }
    }

    return result;
  }

  /**
   * Get average adaptation time
   */
  getAvgAdaptationTime(): number {
    if (this.adaptationTimes.length === 0) return 0;
    return this.adaptationTimes.reduce((a, b) => a + b, 0) / this.adaptationTimes.length;
  }

  /**
   * Add a step to the current in-progress trajectory
   */
  addTrajectoryStep(step: TrajectoryStep): void {
    this.currentTrajectorySteps.push(step);
    // Prevent unbounded growth
    if (this.currentTrajectorySteps.length > this.config.maxTrajectorySize) {
      this.currentTrajectorySteps.shift();
    }
  }

  /**
   * End the current trajectory with a verdict and apply confidence updates.
   * Reward mapping: success=1.0, partial=0.5, failure=-0.5
   *
   * For successful/partial trajectories, boosts confidence of similar patterns
   * in the ReasoningBank. For failures, reduces confidence scores.
   */
  async endTrajectory(
    verdict: 'success' | 'failure' | 'partial',
    bank: LocalReasoningBank,
  ): Promise<{ reward: number; patternsUpdated: number }> {
    const rewardMap: Record<string, number> = {
      success: 1.0,
      partial: 0.5,
      failure: -0.5,
    };
    const reward = rewardMap[verdict] ?? 0;

    // Record the completed trajectory
    const completedTrajectory = {
      steps: [...this.currentTrajectorySteps],
      verdict,
      timestamp: Date.now(),
    };
    this.recordTrajectory(completedTrajectory);

    // Update pattern confidences based on reward
    let patternsUpdated = 0;

    for (const step of this.currentTrajectorySteps) {
      if (!step.embedding || step.embedding.length === 0) continue;

      // Find patterns similar to this trajectory step
      const similar = bank.findSimilar(step.embedding, {
        k: 3,
        threshold: 0.3,
      });

      for (const match of similar) {
        const pattern = bank.get(match.id);
        if (!pattern) continue;

        // Adjust confidence: positive reward boosts, negative reduces
        const delta = reward * 0.1; // small step per update
        const newConfidence = Math.max(0.0, Math.min(1.0, pattern.confidence + delta));
        pattern.confidence = newConfidence;
        pattern.usageCount++;
        pattern.lastUsedAt = Date.now();
        patternsUpdated++;
      }
    }

    // Clear current trajectory
    this.currentTrajectorySteps = [];

    return { reward, patternsUpdated };
  }

  /**
   * Distill learning from recent successful trajectories.
   * Applies incremental confidence updates and integrates EWC consolidation.
   *
   * For each successful trajectory step with high confidence,
   * increases the pattern's stored confidence by confidenceLearningRate * reward.
   * Before applying updates, checks EWC penalty to prevent catastrophic forgetting.
   */
  async distillLearning(bank: LocalReasoningBank): Promise<{
    patternsDistilled: number;
    ewcPenalty: number;
  }> {
    let patternsDistilled = 0;
    let totalEwcPenalty = 0;

    // Get recent successful trajectories
    const recentSuccessful = this.trajectories
      .filter((t) => t.verdict === 'success' || t.verdict === 'partial')
      .slice(-10); // last 10 successful

    if (recentSuccessful.length === 0) {
      return { patternsDistilled: 0, ewcPenalty: 0 };
    }

    // Try to get EWC consolidator
    let ewcConsolidator: import('./ewc-consolidation.js').EWCConsolidator | null = null;
    try {
      const ewcModule = await import('./ewc-consolidation.js');
      ewcConsolidator = await ewcModule.getEWCConsolidator({
        lambda: this.config.ewcLambda,
      });
    } catch {
      // EWC not available, proceed without consolidation protection
    }

    const rewardMap: Record<string, number> = {
      success: 1.0,
      partial: 0.5,
    };

    // Collect confidence changes for EWC Fisher update
    const confidenceChanges: {
      id: string;
      oldConf: number;
      newConf: number;
      embedding: number[];
    }[] = [];

    for (const trajectory of recentSuccessful) {
      const reward = rewardMap[trajectory.verdict] ?? 0;

      for (const step of trajectory.steps) {
        if (!step.embedding || step.embedding.length === 0) continue;

        const similar = bank.findSimilar(step.embedding, {
          k: 3,
          threshold: 0.4,
        });

        for (const match of similar) {
          const pattern = bank.get(match.id);
          if (!pattern) continue;

          // Only distill from high-confidence matches
          if (match.confidence < 0.5) continue;

          const oldConfidence = pattern.confidence;

          // Check EWC penalty before applying update
          if (ewcConsolidator) {
            const oldWeights = [oldConfidence];
            const proposedConfidence = Math.min(
              1.0,
              oldConfidence + this.config.confidenceLearningRate * reward,
            );
            const newWeights = [proposedConfidence];
            const penalty = ewcConsolidator.getPenalty(oldWeights, newWeights);
            totalEwcPenalty += penalty;

            // If penalty is too high, reduce the update magnitude
            if (penalty > this.config.ewcLambda) {
              const dampedDelta = (this.config.confidenceLearningRate * reward) / (1 + penalty);
              pattern.confidence = Math.max(0.0, Math.min(1.0, oldConfidence + dampedDelta));
            } else {
              pattern.confidence = proposedConfidence;
            }
          } else {
            // No consolidation guard available: apply the full confidence update
            pattern.confidence = Math.max(
              0.0,
              Math.min(1.0, oldConfidence + this.config.confidenceLearningRate * reward),
            );
          }

          pattern.lastUsedAt = Date.now();
          patternsDistilled++;

          confidenceChanges.push({
            id: pattern.id,
            oldConf: oldConfidence,
            newConf: pattern.confidence,
            embedding: pattern.embedding,
          });
        }
      }
    }

    // Update EWC Fisher matrix with confidence changes
    if (ewcConsolidator && confidenceChanges.length > 0) {
      for (const change of confidenceChanges) {
        // Use confidence delta as gradient proxy
        const gradient = change.embedding.map((e) => e * Math.abs(change.newConf - change.oldConf));
        ewcConsolidator.recordGradient(change.id, gradient, true);
      }
    }

    // Persist updated patterns
    bank.flushToDisk();

    return { patternsDistilled, ewcPenalty: totalEwcPenalty };
  }

  /**
   * Get current trajectory steps (for inspection)
   */
  getCurrentTrajectorySteps(): TrajectoryStep[] {
    return [...this.currentTrajectorySteps];
  }

  /**
   * Get statistics
   */
  stats(): { signalCount: number; trajectoryCount: number; avgAdaptationMs: number } {
    return {
      signalCount: this.signalCount,
      trajectoryCount: this.trajectories.length,
      avgAdaptationMs: this.getAvgAdaptationTime(),
    };
  }
}
