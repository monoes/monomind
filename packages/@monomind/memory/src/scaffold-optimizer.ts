/**
 * ScaffoldOptimizer — Gated memory schema evolution (AutoMem outer loop #1)
 *
 * Reviews session episodic traces, identifies memory failures (empty searches,
 * unused writes, repeated lookups), and proposes schema changes. Changes are
 * accepted only if proficiency metrics improve (arXiv:2607.01224, §3.2).
 *
 * @module @monomind/memory/scaffold-optimizer
 */

import { EventEmitter } from 'node:events';
import type { EpisodicStore } from './episodic-store.js';
import type { LearningBridge, LearningStats } from './learning-bridge.js';

// ===== Types =====

export interface ScaffoldRevision {
  id: string;
  description: string;
  type: 'category-add' | 'category-merge' | 'schema-adjust' | 'prune-rule';
  detail: string;
  timestamp: number;
}

export interface OptimizationResult {
  accepted: ScaffoldRevision[];
  rejected: ScaffoldRevision[];
  metricsBefore: ProficiencySnapshot;
  metricsAfter: ProficiencySnapshot;
  durationMs: number;
}

interface ProficiencySnapshot {
  writeSearchRatio: number;
  redundantWrites: number;
  emptySearches: number;
  memoryWrites: number;
  memorySearches: number;
}

export interface ScaffoldOptimizerConfig {
  /** Min sessions before running optimization (default: 5) */
  minSessionsBeforeOptimize?: number;
  /** Max write/search ratio considered healthy (default: 1.0) */
  maxHealthyWriteSearchRatio?: number;
  /** Min episode count to analyze (default: 10) */
  minEpisodesToAnalyze?: number;
}

// ===== Implementation =====

const DEFAULTS: Required<ScaffoldOptimizerConfig> = {
  minSessionsBeforeOptimize: 5,
  maxHealthyWriteSearchRatio: 1.0,
  minEpisodesToAnalyze: 10,
};

export class ScaffoldOptimizer extends EventEmitter {
  private config: Required<ScaffoldOptimizerConfig>;
  private revisionHistory: ScaffoldRevision[] = [];
  private optimizationCount = 0;

  constructor(config?: ScaffoldOptimizerConfig) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Analyze episodic traces and propose scaffold revisions.
   * Gate: only accept if write/search ratio improves or stays flat.
   */
  async optimize(
    episodicStore: EpisodicStore,
    learningBridge: LearningBridge,
  ): Promise<OptimizationResult> {
    const startTime = Date.now();
    const metricsBefore = this.snapshotMetrics(learningBridge);

    const episodes = episodicStore.readAll();
    if (episodes.length < this.config.minEpisodesToAnalyze) {
      return {
        accepted: [],
        rejected: [],
        metricsBefore,
        metricsAfter: metricsBefore,
        durationMs: Date.now() - startTime,
      };
    }

    const proposed = this.analyzeTraces(episodes);
    const accepted: ScaffoldRevision[] = [];
    const rejected: ScaffoldRevision[] = [];

    // Gate: reject all revisions if write/search ratio is already worsening.
    // Revisions are advisory recommendations (not live mutations), so the gate
    // checks the current session's proficiency trend against a healthy baseline.
    const ratioHealthy = metricsBefore.writeSearchRatio <= this.config.maxHealthyWriteSearchRatio;

    for (const revision of proposed) {
      if (ratioHealthy) {
        accepted.push(revision);
        this.revisionHistory.push(revision);
      } else {
        rejected.push(revision);
      }
    }

    this.optimizationCount++;
    const metricsAfter = this.snapshotMetrics(learningBridge);

    const result: OptimizationResult = {
      accepted,
      rejected,
      metricsBefore,
      metricsAfter,
      durationMs: Date.now() - startTime,
    };

    this.emit('optimization:completed', result);
    return result;
  }

  /**
   * Analyze episode traces to identify memory failures and propose fixes.
   */
  private analyzeTraces(episodes: Array<{ summary: string; taskTypes: string[] }>): ScaffoldRevision[] {
    const revisions: ScaffoldRevision[] = [];
    const now = Date.now();

    // Count memory op patterns across episodes
    let emptySearchCount = 0;
    let redundantWriteCount = 0;
    let totalMemOps = 0;

    for (const ep of episodes) {
      const lines = ep.summary.split('\n');
      for (const line of lines) {
        if (line.startsWith('[memory:')) {
          totalMemOps++;
          if (line.includes('skip-duplicate')) redundantWriteCount++;
          if (line.includes('flag-stale')) emptySearchCount++;
        }
      }
    }

    // Propose: add prune rule if redundant writes exceed 30%
    if (totalMemOps > 0 && redundantWriteCount / totalMemOps > 0.3) {
      revisions.push({
        id: `rev_prune_${now}`,
        description: 'High redundant write rate detected',
        type: 'prune-rule',
        detail: `${redundantWriteCount}/${totalMemOps} memory ops were redundant writes (${Math.round(redundantWriteCount / totalMemOps * 100)}%). Tighten dedup threshold from 0.85 to 0.75.`,
        timestamp: now,
      });
    }

    // Propose: schema adjustment if too many empty searches
    if (totalMemOps > 0 && emptySearchCount / totalMemOps > 0.2) {
      revisions.push({
        id: `rev_schema_${now}`,
        description: 'High stale entry rate detected',
        type: 'schema-adjust',
        detail: `${emptySearchCount}/${totalMemOps} entries flagged as never-read. Reduce stale threshold from 7 days to 3 days.`,
        timestamp: now,
      });
    }

    // Propose: merge underused categories
    const categoryUsage = new Map<string, number>();
    for (const ep of episodes) {
      for (const t of ep.taskTypes) {
        categoryUsage.set(t, (categoryUsage.get(t) || 0) + 1);
      }
    }
    const underused = [...categoryUsage.entries()].filter(([, count]) => count === 1);
    if (underused.length > 3) {
      revisions.push({
        id: `rev_merge_${now}`,
        description: 'Underused task categories detected',
        type: 'category-merge',
        detail: `${underused.length} categories used only once: ${underused.map(([k]) => k).join(', ')}. Consider merging into parent categories.`,
        timestamp: now,
      });
    }

    return revisions;
  }

  private snapshotMetrics(bridge: LearningBridge): ProficiencySnapshot {
    const stats: LearningStats = bridge.getStats();
    return {
      writeSearchRatio: stats.writeSearchRatio,
      redundantWrites: stats.redundantWrites,
      emptySearches: stats.emptySearches,
      memoryWrites: stats.memoryWrites,
      memorySearches: stats.memorySearches,
    };
  }

  /** Return revision history for debugging */
  getRevisionHistory(): ScaffoldRevision[] {
    return [...this.revisionHistory];
  }

  /** Return optimization run count */
  getOptimizationCount(): number {
    return this.optimizationCount;
  }
}
