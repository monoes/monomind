/**
 * ERL — Experiential Reflective Learning heuristic extractor
 *
 * After each completed trajectory, distills portable "heuristics" — short,
 * actionable rules — from the trajectory content. Heuristics are stored in a
 * persistent `heuristics` namespace so that `pre-task` injection can retrieve
 * the top-k most relevant ones and prepend them to the agent system prompt.
 *
 * Algorithm (faithful to ERL paper):
 *   1. Receive a trajectory (list of steps with outcomes)
 *   2. LLM-call or pattern-match to extract 1–3 portable heuristics
 *   3. Deduplicate against the existing heuristic pool
 *   4. Store survivors in the `heuristics` namespace via memory store
 *   5. Return the extracted heuristics for injection
 *
 * Paper: arXiv:2603.24639 — ERL: Experiential Reflective Learning (+7.8% on GAIA2)
 *
 * Call sites:
 *   - `createLearningWorker()` runs ERL after trajectory completion
 *   - `pre-task` hook reads top-k heuristics from `heuristics` namespace
 *
 * @module v1/hooks/workers/erl-worker
 */

// ============================================================
// Types
// ============================================================

export interface TrajectoryStep {
  /** Step index */
  step: number;
  /** Tool or action name */
  action: string;
  /** Agent reasoning or plan text */
  reasoning?: string;
  /** Outcome: success | failure | partial */
  outcome: 'success' | 'failure' | 'partial';
  /** Optional error message on failure */
  error?: string;
}

export interface ERLTrajectory {
  /** Unique trajectory ID (maps to observability trace ID) */
  id: string;
  /** Task description that was being solved */
  taskDescription: string;
  /** Ordered steps */
  steps: TrajectoryStep[];
  /** Overall success flag */
  success: boolean;
  /** Agent slug responsible for the trajectory */
  agentSlug?: string;
  /** Timestamp of completion (Unix ms) */
  completedAt: number;
}

export interface ERLHeuristic {
  /** Unique heuristic ID (sha256-like short hash) */
  id: string;
  /** Short actionable rule (≤120 chars) */
  rule: string;
  /** Source trajectory ID */
  sourceTrajectoryId: string;
  /** Agent slug this heuristic applies to (null = general) */
  agentSlug: string | null;
  /** Usage count — how often this heuristic was injected */
  usageCount: number;
  /** Quality score updated by ReasoningBank outcome feedback */
  quality: number;
  /** Creation timestamp */
  createdAt: number;
}

export interface ERLResult {
  /** Heuristics extracted from this trajectory */
  extracted: ERLHeuristic[];
  /** Count of duplicates that were skipped */
  dedupedCount: number;
  /** Processing time ms */
  durationMs: number;
}

export interface ERLConfig {
  /**
   * Max heuristics to extract per trajectory.
   * ERL paper recommends 1–3 to maintain portability.
   */
  maxPerTrajectory?: number;
  /**
   * Minimum quality score for a heuristic to be stored.
   * Set higher to reduce noise.
   */
  minQuality?: number;
  /** Skip trajectories shorter than this many steps */
  minSteps?: number;
}

const DEFAULTS: Required<ERLConfig> = {
  maxPerTrajectory: 3,
  minQuality: 0.4,
  minSteps: 2,
};

// ============================================================
// Heuristic extraction patterns (rule-based, no LLM call required)
// ============================================================

interface ExtractionPattern {
  /** Regex applied to action names in failure steps */
  failurePattern: RegExp;
  /** Regex applied to action names in success steps */
  successPattern: RegExp;
  /** Template for the heuristic rule — ${action} is substituted */
  ruleTemplate: string;
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  {
    failurePattern: /read|fetch|load/i,
    successPattern: /validate|check|verify/i,
    ruleTemplate: 'Always validate external data before using it — fetch failures indicate missing preconditions.',
  },
  {
    failurePattern: /write|save|store/i,
    successPattern: /backup|snapshot/i,
    ruleTemplate: 'Snapshot state before destructive writes to enable rollback on failure.',
  },
  {
    failurePattern: /api|request|call/i,
    successPattern: /retry|fallback/i,
    ruleTemplate: 'Implement retry with exponential backoff for external API calls.',
  },
  {
    failurePattern: /parse|decode|deserialize/i,
    successPattern: /schema|type|validate/i,
    ruleTemplate: 'Validate schema before parsing external data to surface format errors early.',
  },
  {
    failurePattern: /compile|build|tsc/i,
    successPattern: /typecheck|lint/i,
    ruleTemplate: 'Run type checking before build to catch type errors at the earliest stage.',
  },
];

// ============================================================
// ERLWorker
// ============================================================

/**
 * ERLWorker — Stateless heuristic extractor.
 *
 * Designed to be called from `createLearningWorker()` after a trajectory
 * completes, or from any `post-task` hook handler.
 */
export class ERLWorker {
  readonly name = 'erl' as const;

  private readonly config: Required<ERLConfig>;
  private readonly existingIds: Set<string>;

  constructor(config: ERLConfig = {}, existingHeuristicIds: string[] = []) {
    this.config = { ...DEFAULTS, ...config };
    this.existingIds = new Set(existingHeuristicIds);
  }

  /**
   * Extract heuristics from a completed trajectory.
   *
   * Rule-based extraction: finds failure steps and identifies the pattern
   * of the subsequent recovery step to generate a portable heuristic rule.
   * For trajectories without recoveries, a generic "avoid X" rule is emitted.
   *
   * Source: arXiv:2603.24639 §3.2 — "Heuristic Extraction via Reflective Distillation"
   */
  extract(trajectory: ERLTrajectory): ERLResult {
    const start = Date.now();

    if (trajectory.steps.length < this.config.minSteps) {
      return { extracted: [], dedupedCount: 0, durationMs: Date.now() - start };
    }

    const candidates: ERLHeuristic[] = [];

    // Find failure→recovery pairs
    for (let i = 0; i < trajectory.steps.length - 1; i++) {
      const failStep = trajectory.steps[i];
      if (failStep.outcome !== 'failure') continue;

      const nextStep = trajectory.steps[i + 1];
      const rule = this.matchPattern(failStep, nextStep);
      if (!rule) continue;

      const id = this.shortHash(`${rule}:${trajectory.agentSlug ?? 'general'}`);
      if (this.existingIds.has(id)) continue;

      candidates.push({
        id,
        rule,
        sourceTrajectoryId: trajectory.id,
        agentSlug: trajectory.agentSlug ?? null,
        usageCount: 0,
        quality: trajectory.success ? 0.8 : 0.5,
        createdAt: Date.now(),
      });

      if (candidates.length >= this.config.maxPerTrajectory) break;
    }

    // If no failure-recovery pairs found but trajectory succeeded, extract a positive heuristic
    if (candidates.length === 0 && trajectory.success && trajectory.steps.length >= 2) {
      const lastStep = trajectory.steps[trajectory.steps.length - 1];
      const rule = `For tasks involving "${trajectory.taskDescription.slice(0, 60)}", finish with ${lastStep.action} to verify success.`;
      const id = this.shortHash(rule);

      if (!this.existingIds.has(id)) {
        candidates.push({
          id,
          rule,
          sourceTrajectoryId: trajectory.id,
          agentSlug: trajectory.agentSlug ?? null,
          usageCount: 0,
          quality: 0.6,
          createdAt: Date.now(),
        });
      }
    }

    const extracted = candidates.filter(h => h.quality >= this.config.minQuality);
    const dedupedCount = candidates.length - extracted.length;

    // Track new IDs
    for (const h of extracted) {
      this.existingIds.add(h.id);
    }

    return {
      extracted,
      dedupedCount,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Format top-k heuristics for injection into a system prompt.
   * Used by `pre-task` hooks.
   */
  formatForInjection(heuristics: ERLHeuristic[], topK = 5): string {
    if (heuristics.length === 0) return '';

    const sorted = [...heuristics]
      .sort((a, b) => b.quality * b.usageCount - a.quality * a.usageCount)
      .slice(0, topK);

    const lines = sorted.map((h, i) => `${i + 1}. ${h.rule}`);
    return `## Learned Heuristics (ERL)\nApply these rules learned from past trajectories:\n${lines.join('\n')}`;
  }

  // ===================================================
  // Private helpers
  // ===================================================

  private matchPattern(failStep: TrajectoryStep, recoveryStep: TrajectoryStep): string | null {
    for (const p of EXTRACTION_PATTERNS) {
      if (p.failurePattern.test(failStep.action) && p.successPattern.test(recoveryStep.action)) {
        return p.ruleTemplate;
      }
    }

    // Fallback: generic avoidance heuristic
    if (failStep.error) {
      const shortError = failStep.error.slice(0, 80);
      return `Avoid "${failStep.action}" when: ${shortError}.`;
    }

    return null;
  }

  /** FNV-1a-inspired short hash for stable heuristic IDs */
  private shortHash(input: string): string {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
