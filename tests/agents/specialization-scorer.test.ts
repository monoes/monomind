/**
 * Tests for Agent Specialization Scoring (Task 39).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Run: npx vitest run tests/agents/specialization-scorer.test.ts --globals
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SpecializationScorer } from '../../packages/@monomind/cli/src/agents/specialization-scorer.js';
import { calculateDecayFactor, SCORE_HALF_LIFE_DAYS } from '../../packages/@monomind/cli/src/agents/score-decay.js';
import type { SpecializationScore, ScoreUpdate } from '../../packages/@monomind/shared/src/types/specialization.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'spec-score-'));
}

describe('SpecializationScorer', () => {
  let dir: string;
  let scorer: SpecializationScorer;

  beforeEach(() => {
    dir = makeTmpDir();
    scorer = new SpecializationScorer(join(dir, 'specialization-scores.jsonl'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ---- recordOutcome ----

  it('recordOutcome({ success: true }) increments successCount', () => {
    const result = scorer.recordOutcome({
      agentSlug: 'coder',
      taskType: 'bugfix',
      success: true,
      latencyMs: 500,
    });

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.totalCount).toBe(1);
    expect(result.successRate).toBe(1.0);
  });

  it('recordOutcome({ success: false }) increments failureCount', () => {
    const result = scorer.recordOutcome({
      agentSlug: 'coder',
      taskType: 'bugfix',
      success: false,
      latencyMs: 800,
    });

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(result.successRate).toBe(0.0);
  });

  it('recordOutcome accumulates across multiple calls', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 200 });
    const result = scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: false, latencyMs: 300 });

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.successRate).toBeCloseTo(2 / 3, 5);
    expect(result.avgLatencyMs).toBeCloseTo(200, 5);
  });

  // ---- getScore ----

  it('getScore() returns null for unknown agent/taskType', () => {
    const score = scorer.getScore('nonexistent', 'bugfix');
    expect(score).toBeNull();
  });

  it('getScore() returns correct successRate', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'feature', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'feature', success: false, latencyMs: 200 });

    const score = scorer.getScore('coder', 'feature');
    expect(score).not.toBeNull();
    expect(score!.successRate).toBeCloseTo(0.5, 5);
    expect(score!.totalCount).toBe(2);
  });

  // ---- getTopCandidates ----

  it('getTopCandidates() returns slugs sorted by effectiveScore descending', () => {
    // coder: 2/2 success
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });

    // reviewer: 1/2 success
    scorer.recordOutcome({ agentSlug: 'reviewer', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'reviewer', taskType: 'bugfix', success: false, latencyMs: 100 });

    // tester: 0/1 success
    scorer.recordOutcome({ agentSlug: 'tester', taskType: 'bugfix', success: false, latencyMs: 100 });

    const top = scorer.getTopCandidates('bugfix', ['coder', 'reviewer', 'tester']);

    expect(top).toHaveLength(3);
    expect(top[0].agentSlug).toBe('coder');
    expect(top[1].agentSlug).toBe('reviewer');
    expect(top[2].agentSlug).toBe('tester');
  });

  // ---- topCandidate ----

  it('topCandidate() returns the slug with highest effective score', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'refactor', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'reviewer', taskType: 'refactor', success: false, latencyMs: 100 });

    const best = scorer.topCandidate('refactor', ['coder', 'reviewer']);
    expect(best).toBe('coder');
  });

  it('topCandidate() returns first candidate when no scores exist (fallback)', () => {
    const best = scorer.topCandidate('unknown-task', ['alpha', 'beta', 'gamma']);
    expect(best).toBe('alpha');
  });

  // ---- getAllScores ----

  it('getAllScores() returns all task types for an agent', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'feature', success: true, latencyMs: 200 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'refactor', success: false, latencyMs: 300 });
    scorer.recordOutcome({ agentSlug: 'reviewer', taskType: 'bugfix', success: true, latencyMs: 100 });

    const scores = scorer.getAllScores('coder');
    expect(scores).toHaveLength(3);

    const taskTypes = scores.map((s) => s.taskType).sort();
    expect(taskTypes).toEqual(['bugfix', 'feature', 'refactor']);
  });

  // ---- resetScores ----

  it('resetScores(slug) deletes all scores for that slug', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'feature', success: true, latencyMs: 200 });
    scorer.recordOutcome({ agentSlug: 'reviewer', taskType: 'bugfix', success: true, latencyMs: 100 });

    const deleted = scorer.resetScores('coder');
    expect(deleted).toBe(2);

    expect(scorer.getScore('coder', 'bugfix')).toBeNull();
    expect(scorer.getScore('coder', 'feature')).toBeNull();
    // reviewer score should remain
    expect(scorer.getScore('reviewer', 'bugfix')).not.toBeNull();
  });

  it('resetScores(slug, taskType) deletes only specific taskType', () => {
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'feature', success: true, latencyMs: 200 });

    const deleted = scorer.resetScores('coder', 'bugfix');
    expect(deleted).toBe(1);

    expect(scorer.getScore('coder', 'bugfix')).toBeNull();
    expect(scorer.getScore('coder', 'feature')).not.toBeNull();
  });
});

describe('calculateDecayFactor', () => {
  it('returns 1.0 for now', () => {
    const now = new Date().toISOString();
    const decay = calculateDecayFactor(now);
    expect(decay).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.5 for 90 days ago', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const decay = calculateDecayFactor(ninetyDaysAgo);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 for 180 days ago', () => {
    const oneEightyDaysAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const decay = calculateDecayFactor(oneEightyDaysAgo);
    expect(decay).toBeCloseTo(0.25, 1);
  });
});

describe('effectiveScore integration', () => {
  it('effectiveScore correctly combines successRate and decay', () => {
    const dir = makeTmpDir();
    const scorer = new SpecializationScorer(join(dir, 'scores.jsonl'));

    // Record a perfect score
    scorer.recordOutcome({ agentSlug: 'coder', taskType: 'bugfix', success: true, latencyMs: 100 });

    const score = scorer.getScore('coder', 'bugfix');
    expect(score).not.toBeNull();

    // Just recorded, so decay should be ~1.0 and effective = successRate * 1.0
    expect(score!.successRate).toBe(1.0);
    expect(score!.decayFactor).toBeCloseTo(1.0, 2);
    expect(score!.effectiveScore).toBeCloseTo(1.0, 2);

    // Verify the formula: effectiveScore = successRate * decayFactor
    expect(score!.effectiveScore).toBeCloseTo(
      score!.successRate * score!.decayFactor,
      5,
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
