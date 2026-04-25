/**
 * MAR — Multi-Agent Reflexion structured reflection pipeline
 *
 * Separates the Reflexion self-correction loop into four heterogeneous roles:
 *   1. Diagnoser  — identifies what went wrong and why
 *   2. Critics    — 2–3 independent agents with varied "temperatures" to
 *                   prevent homogeneous bias (the key MAR insight)
 *   3. Aggregator — synthesises critic perspectives into a unified reflection
 *
 * The aggregated reflection is stored as a heuristic in the ERL pool for
 * future task injection, closing the loop between reflection and performance.
 *
 * Paper: arXiv:2512.20845 — Multi-Agent Reflexion (December 2025)
 *   Heterogeneous critics with different temperatures produce substantially
 *   better reflections than homogeneous teams.
 *
 * Call sites:
 *   - `post-task` hook (automatic, after any task with `success: false`)
 *   - `MCP tool hooks/model-outcome` (explicit invocation)
 *
 * @module v1/hooks/workers/mar-worker
 */

// ============================================================
// Types
// ============================================================

export interface MARInput {
  /** Task description */
  taskDescription: string;
  /** Agent output that is being reflected upon */
  agentOutput: string;
  /** Whether the task succeeded */
  success: boolean;
  /** Agent slug for the primary actor */
  agentSlug: string;
  /** Optional prior error message */
  errorMessage?: string;
  /** Optional quality score (0–1) from a verifier */
  qualityScore?: number;
}

export interface DiagnosisReport {
  /** Primary root cause of failure or area for improvement */
  rootCause: string;
  /** Confidence in the diagnosis 0–1 */
  confidence: number;
  /** Suggested focus areas for critics */
  focusAreas: string[];
}

export interface CriticPerspective {
  /** Which critic generated this (critic-1, critic-2, critic-3) */
  criticId: string;
  /** Simulated temperature bias: low | medium | high */
  temperatureBias: 'conservative' | 'balanced' | 'creative';
  /** The critique text */
  critique: string;
  /** Severity 0–1 */
  severity: number;
}

export interface MARReflection {
  /** Aggregated reflection synthesised from all critics */
  synthesis: string;
  /** Individual critic perspectives (preserved for auditability) */
  criticPerspectives: CriticPerspective[];
  /** Diagnosis report */
  diagnosis: DiagnosisReport;
  /** Suggested prompt update for the next run */
  promptUpdate: string;
  /** ERL-compatible heuristic extracted from the reflection */
  heuristic: string;
  /** Quality of the reflection itself 0–1 */
  reflectionQuality: number;
}

export interface MARResult {
  reflection: MARReflection;
  /** Processing duration ms */
  durationMs: number;
}

export interface MARConfig {
  /** Number of critic perspectives to generate (2–4; default: 3) */
  numCritics?: number;
}

const DEFAULTS: Required<MARConfig> = {
  numCritics: 3,
};

// ============================================================
// Internal diagnosis patterns
// ============================================================

interface DiagnosisPattern {
  test: (input: MARInput) => boolean;
  rootCause: string;
  focusAreas: string[];
  confidence: number;
}

const DIAGNOSIS_PATTERNS: DiagnosisPattern[] = [
  {
    test: (i) => /type|undefined|null|cannot read/i.test(i.errorMessage ?? ''),
    rootCause: 'Type error — the agent accessed a property on an undefined/null value.',
    focusAreas: ['input validation', 'null-checks', 'TypeScript strictness'],
    confidence: 0.85,
  },
  {
    test: (i) => /timeout|ETIMEDOUT|ECONNRESET/i.test(i.errorMessage ?? ''),
    rootCause: 'Network timeout — an external dependency was unreachable or too slow.',
    focusAreas: ['retry logic', 'fallback strategy', 'circuit breaker'],
    confidence: 0.9,
  },
  {
    test: (i) => /permission|EACCES|EPERM|forbidden/i.test(i.errorMessage ?? ''),
    rootCause: 'Permission denied — the agent attempted an operation beyond its access level.',
    focusAreas: ['access level', 'claims authorization', 'sandboxing'],
    confidence: 0.9,
  },
  {
    test: (i) => (i.qualityScore ?? 1) < 0.4,
    rootCause: 'Low output quality — the agent\'s output did not meet quality threshold.',
    focusAreas: ['output format', 'reasoning depth', 'task alignment'],
    confidence: 0.7,
  },
  {
    test: (i) => i.agentOutput.length < 30 && i.taskDescription.length > 40,
    rootCause: 'Incomplete output — the response is too short for the task complexity.',
    focusAreas: ['completeness', 'sub-task decomposition', 'response length'],
    confidence: 0.75,
  },
];

// ============================================================
// Critic perspective templates (simulates heterogeneous critics)
// ============================================================

const CRITIC_TEMPLATES: Array<{
  id: string;
  temperatureBias: CriticPerspective['temperatureBias'];
  perspective: (rootCause: string, focusArea: string) => string;
}> = [
  {
    id: 'critic-1',
    temperatureBias: 'conservative',
    perspective: (rc, fa) =>
      `From a risk-minimisation standpoint: "${rc}" is a systemic issue. ` +
      `Address "${fa}" by adding defensive checks before every boundary crossing.`,
  },
  {
    id: 'critic-2',
    temperatureBias: 'balanced',
    perspective: (rc, fa) =>
      `Balanced assessment: the root cause "${rc}" suggests the agent's planning ` +
      `phase underweighted "${fa}". A structured pre-task checklist would prevent recurrence.`,
  },
  {
    id: 'critic-3',
    temperatureBias: 'creative',
    perspective: (rc, fa) =>
      `Alternative framing: rather than reacting to "${rc}", redesign the agent's ` +
      `entry point to make "${fa}" an explicit precondition — fail fast rather than degrade.`,
  },
];

// ============================================================
// MARWorker
// ============================================================

/**
 * MARWorker — Structured multi-agent reflection pipeline.
 *
 * Operates fully synchronously (no LLM calls) using pattern-based critics.
 * In production, replace individual critic `perspective()` calls with real
 * LLM invocations at different temperatures, using `guidance-provider.ts`.
 *
 * Source: arXiv:2512.20845 — MAR heterogeneous multi-agent reflection.
 */
export class MARWorker {
  readonly name = 'mar' as const;

  private readonly config: Required<MARConfig>;

  constructor(config: MARConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Run the full MAR pipeline: Diagnose → Critique → Aggregate.
   *
   * Steps:
   *   1. Diagnose root cause from `input.errorMessage` or quality score
   *   2. Each critic generates an independent perspective
   *   3. Aggregator synthesises perspectives into a unified reflection
   *   4. Extract ERL-compatible heuristic from the reflection
   */
  reflect(input: MARInput): MARResult {
    const start = Date.now();

    // Step 1: Diagnose
    const diagnosis = this.diagnose(input);

    // Step 2: Generate critic perspectives
    const numCritics = Math.min(this.config.numCritics, CRITIC_TEMPLATES.length);
    const focusArea = diagnosis.focusAreas[0] ?? 'output quality';

    const criticPerspectives: CriticPerspective[] = CRITIC_TEMPLATES
      .slice(0, numCritics)
      .map((template) => ({
        criticId: template.id,
        temperatureBias: template.temperatureBias,
        critique: template.perspective(diagnosis.rootCause, focusArea),
        severity: diagnosis.confidence * (template.temperatureBias === 'conservative' ? 1.0 : 0.8),
      }));

    // Step 3: Aggregate
    const synthesis = this.aggregate(diagnosis, criticPerspectives);

    // Step 4: Extract ERL heuristic
    const heuristic = `For tasks like "${input.taskDescription.slice(0, 50)}…": ${diagnosis.rootCause} Mitigate via ${focusArea}.`;

    // Step 5: Suggest prompt update
    const promptUpdate = [
      `You previously failed on: "${input.taskDescription.slice(0, 60)}".`,
      `Diagnosis: ${diagnosis.rootCause}`,
      `Focus on: ${diagnosis.focusAreas.join(', ')}.`,
    ].join(' ');

    const reflectionQuality = diagnosis.confidence *
      (criticPerspectives.reduce((s, c) => s + c.severity, 0) / criticPerspectives.length);

    return {
      reflection: {
        synthesis,
        criticPerspectives,
        diagnosis,
        promptUpdate,
        heuristic,
        reflectionQuality,
      },
      durationMs: Date.now() - start,
    };
  }

  // ===================================================
  // Private helpers
  // ===================================================

  private diagnose(input: MARInput): DiagnosisReport {
    for (const pattern of DIAGNOSIS_PATTERNS) {
      if (pattern.test(input)) {
        return {
          rootCause: pattern.rootCause,
          confidence: pattern.confidence,
          focusAreas: pattern.focusAreas,
        };
      }
    }

    // Fallback diagnosis
    return {
      rootCause: `The agent did not complete "${input.taskDescription.slice(0, 40)}" successfully.`,
      confidence: 0.5,
      focusAreas: ['task decomposition', 'precondition checking'],
    };
  }

  private aggregate(
    diagnosis: DiagnosisReport,
    critics: CriticPerspective[],
  ): string {
    const critiques = critics.map(c => `[${c.temperatureBias}] ${c.critique}`).join(' | ');
    return (
      `Diagnosis: ${diagnosis.rootCause} ` +
      `Critic consensus (${critics.length} perspectives): ${critiques}. ` +
      `Recommended focus for next attempt: ${diagnosis.focusAreas.join(', ')}.`
    );
  }
}
