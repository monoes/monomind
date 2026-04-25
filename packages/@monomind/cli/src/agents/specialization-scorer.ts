/**
 * Agent Specialization Scorer (Task 39)
 *
 * JSONL-based per-agent-per-task-type scoring with time-decay.
 * Enables monobrain to prefer historically successful agents for specific task types.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { SpecializationScore, ScoreUpdate } from '../../../shared/src/types/specialization.js';
import { calculateDecayFactor } from './score-decay.js';

/** Key used to identify a unique agent+taskType pair in the JSONL store. */
function scoreKey(agentSlug: string, taskType: string): string {
  return `${agentSlug}::${taskType}`;
}

/**
 * JSONL-based specialization scorer.
 *
 * Stores one JSON object per line in the configured file path.
 * Each line represents a SpecializationScore for a unique agent+taskType pair.
 * On update, the entire file is rewritten to maintain a single record per pair.
 */
export class SpecializationScorer {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private readAll(): SpecializationScore[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const raw = readFileSync(this.filePath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpecializationScore);
  }

  private writeAll(records: SpecializationScore[]): void {
    const lines = records.map((r) => JSON.stringify(r));
    writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Record an outcome for a given agent+taskType pair.
   *
   * Updates running averages for latency and quality, recalculates
   * successRate, applies time-decay, and persists the result.
   */
  recordOutcome(update: ScoreUpdate): SpecializationScore {
    const records = this.readAll();
    const key = scoreKey(update.agentSlug, update.taskType);
    let idx = records.findIndex(
      (r) => scoreKey(r.agentSlug, r.taskType) === key,
    );

    const now = new Date().toISOString();

    if (idx === -1) {
      // Create new record
      const score: SpecializationScore = {
        agentSlug: update.agentSlug,
        taskType: update.taskType,
        successCount: update.success ? 1 : 0,
        failureCount: update.success ? 0 : 1,
        totalCount: 1,
        successRate: update.success ? 1.0 : 0.0,
        avgLatencyMs: update.latencyMs,
        avgQualityScore: update.qualityScore ?? (update.success ? 1.0 : 0.0),
        lastUpdated: now,
        decayFactor: 1.0,
        effectiveScore: update.success ? 1.0 : 0.0,
      };
      records.push(score);
      this.writeAll(records);
      return score;
    }

    // Update existing record
    const existing = records[idx];
    const newTotal = existing.totalCount + 1;
    const newSuccess = existing.successCount + (update.success ? 1 : 0);
    const newFailure = existing.failureCount + (update.success ? 0 : 1);
    const newRate = newSuccess / newTotal;

    // Running average for latency
    const newAvgLatency =
      (existing.avgLatencyMs * existing.totalCount + update.latencyMs) /
      newTotal;

    // Running average for quality
    const quality = update.qualityScore ?? (update.success ? 1.0 : 0.0);
    const newAvgQuality =
      (existing.avgQualityScore * existing.totalCount + quality) / newTotal;

    const decay = calculateDecayFactor(now);

    const updated: SpecializationScore = {
      agentSlug: update.agentSlug,
      taskType: update.taskType,
      successCount: newSuccess,
      failureCount: newFailure,
      totalCount: newTotal,
      successRate: newRate,
      avgLatencyMs: newAvgLatency,
      avgQualityScore: newAvgQuality,
      lastUpdated: now,
      decayFactor: decay,
      effectiveScore: newRate * decay,
    };

    records[idx] = updated;
    this.writeAll(records);
    return updated;
  }

  /**
   * Get the score for a specific agent+taskType pair, or null if not found.
   * Recalculates decay on read.
   */
  getScore(agentSlug: string, taskType: string): SpecializationScore | null {
    const records = this.readAll();
    const key = scoreKey(agentSlug, taskType);
    const record = records.find(
      (r) => scoreKey(r.agentSlug, r.taskType) === key,
    );
    if (!record) return null;

    // Recalculate decay on read
    const decay = calculateDecayFactor(record.lastUpdated);
    return {
      ...record,
      decayFactor: decay,
      effectiveScore: record.successRate * decay,
    };
  }

  /**
   * Get top N candidates for a task type from the given list of slugs,
   * sorted by effectiveScore descending.
   */
  getTopCandidates(
    taskType: string,
    slugs: string[],
    topN: number = 3,
  ): SpecializationScore[] {
    const scored: SpecializationScore[] = [];

    for (const slug of slugs) {
      const score = this.getScore(slug, taskType);
      if (score) {
        scored.push(score);
      }
    }

    return scored
      .sort((a, b) => b.effectiveScore - a.effectiveScore)
      .slice(0, topN);
  }

  /**
   * Return the best candidate slug for a task type.
   * Falls back to the first candidate if no scores exist.
   */
  topCandidate(taskType: string, candidates: string[]): string {
    if (candidates.length === 0) {
      throw new Error('candidates array must not be empty');
    }

    const top = this.getTopCandidates(taskType, candidates, 1);
    if (top.length === 0) {
      return candidates[0];
    }
    return top[0].agentSlug;
  }

  /**
   * Get all scores for a given agent across all task types.
   */
  getAllScores(agentSlug: string): SpecializationScore[] {
    const records = this.readAll();
    return records
      .filter((r) => r.agentSlug === agentSlug)
      .map((r) => {
        const decay = calculateDecayFactor(r.lastUpdated);
        return {
          ...r,
          decayFactor: decay,
          effectiveScore: r.successRate * decay,
        };
      });
  }

  /**
   * Reset scores for an agent. If taskType is provided, only that
   * pair is removed; otherwise all scores for the agent are removed.
   *
   * @returns The number of records deleted.
   */
  resetScores(agentSlug: string, taskType?: string): number {
    const records = this.readAll();
    const before = records.length;

    const remaining = records.filter((r) => {
      if (r.agentSlug !== agentSlug) return true;
      if (taskType !== undefined && r.taskType !== taskType) return true;
      return false;
    });

    const deleted = before - remaining.length;
    if (deleted > 0) {
      if (remaining.length === 0) {
        writeFileSync(this.filePath, '', 'utf-8');
      } else {
        this.writeAll(remaining);
      }
    }
    return deleted;
  }
}
