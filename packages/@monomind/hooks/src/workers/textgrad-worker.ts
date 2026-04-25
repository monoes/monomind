/**
 * TextGrad Backward Pass — Automatic "Differentiation" via Text
 *
 * After a task completes, sends the agent's output to an LLM critic that
 * produces a structured "textual gradient" — a natural-language critique of
 * the form "this response can be improved by…". Textual gradients are stored
 * in the `textual_gradients` namespace via `agentdb_pattern-store` and can
 * be injected back into the next prompt optimisation cycle via
 * `SynthesisPromptTemplate`.
 *
 * Architecture mirrors PyTorch's backward() / autograd:
 *   forward()  = agent produces output (already done before this worker runs)
 *   backward() = LLM critic produces textual gradient (this worker)
 *   step()     = prompt optimizer applies gradient (PromptOptimizer / GEPA)
 *
 * Paper: arXiv:2406.07496 — TextGrad: Automatic Differentiation via Text (Nature, 2024)
 *   +20% relative gain on LeetCode-Hard, +4% on Google-Proof QA.
 *
 * Call sites:
 *   - `post-task` hook with output to critique
 *   - `PromptOptimizer.optimize()` reads gradients from `textual_gradients` namespace
 *
 * @module v1/hooks/workers/textgrad-worker
 */

// ============================================================
// Types
// ============================================================

export interface TextGradInput {
  /** Unique task or trace ID */
  taskId: string;
  /** Task description that was solved */
  taskDescription: string;
  /** Agent output to critique */
  output: string;
  /** Agent slug whose prompt will be updated */
  agentSlug: string;
  /** Optional ground-truth or expected behaviour for calibrated critique */
  groundTruth?: string;
  /** Optional quality score (0–1) from an earlier verifier */
  priorQuality?: number;
}

export interface TextualGradient {
  /** Unique gradient ID */
  id: string;
  /** The textual critique / improvement suggestion */
  critique: string;
  /** Dimension being critiqued: reasoning | format | correctness | safety */
  dimension: 'reasoning' | 'format' | 'correctness' | 'safety' | 'efficiency';
  /** Estimated gradient magnitude 0–1 (how impactful this improvement would be) */
  magnitude: number;
  /** Agent slug this gradient targets */
  agentSlug: string;
  /** Source task ID */
  taskId: string;
  /** Unix ms timestamp */
  createdAt: number;
}

export interface TextGradResult {
  /** All generated textual gradients */
  gradients: TextualGradient[];
  /** Key for storage in the `textual_gradients` namespace */
  storageKey: string;
  /** Processing duration ms */
  durationMs: number;
}

export interface TextGradConfig {
  /**
   * Maximum textual gradients to generate per task.
   * Default: 3 (one per dimension).
   */
  maxGradients?: number;
  /**
   * Minimum magnitude for a gradient to be stored.
   * Default: 0.2 (suppress trivial critiques).
   */
  minMagnitude?: number;
}

const DEFAULTS: Required<TextGradConfig> = {
  maxGradients: 3,
  minMagnitude: 0.2,
};

// ============================================================
// Pattern-based critique generation (no LLM call — rule-based)
// ============================================================

interface CritiquePattern {
  dimension: TextualGradient['dimension'];
  /** Test applied to the agent output */
  test: (output: string, taskDesc: string) => boolean;
  /** Generates the critique string */
  critique: (output: string, taskDesc: string) => string;
  /** Base magnitude for this dimension */
  baseMagnitude: number;
}

const CRITIQUE_PATTERNS: CritiquePattern[] = [
  {
    dimension: 'correctness',
    test: (out, task) => out.length < 50 && task.length > 30,
    critique: (out, task) =>
      `The output is too brief (${out.length} chars) for a task of this complexity. ` +
      'Expand the response to cover all sub-requirements listed in the task description.',
    baseMagnitude: 0.8,
  },
  {
    dimension: 'reasoning',
    test: (out) => !/because|therefore|since|given that|reasoning|step/i.test(out),
    critique: () =>
      'The output lacks explicit reasoning steps. Add a brief "why" before each decision ' +
      'to improve auditability and catch logical errors earlier.',
    baseMagnitude: 0.6,
  },
  {
    dimension: 'format',
    test: (out) => out.length > 500 && !/```|##|^\d+\./m.test(out),
    critique: () =>
      'Long unstructured output is hard to parse. Use markdown headers or numbered steps ' +
      'to structure the response for downstream agent consumption.',
    baseMagnitude: 0.5,
  },
  {
    dimension: 'safety',
    test: (out) => /exec|eval|rm -rf|sudo|os\.system/i.test(out),
    critique: () =>
      'The output contains potentially unsafe execution patterns. Wrap shell commands ' +
      'in SafeExecutor and validate inputs before use.',
    baseMagnitude: 0.9,
  },
  {
    dimension: 'efficiency',
    test: (out, task) => (out.match(/for\s*\(/g) ?? []).length > 3,
    critique: () =>
      'Multiple nested loops detected. Consider replacing inner loops with HNSW vector ' +
      'search or a pre-built index to improve query-time complexity.',
    baseMagnitude: 0.4,
  },
];

// ============================================================
// TextGradWorker
// ============================================================

/**
 * TextGradWorker — Stateless LLM-free textual gradient generator.
 *
 * In production, swap the pattern-based critique generator for an actual
 * LLM call (e.g. `guidance-provider.ts` critique prompt). The interface
 * is identical regardless of the backend.
 *
 * Source: arXiv:2406.07496 — TextGrad automatic differentiation via text.
 */
export class TextGradWorker {
  readonly name = 'textgrad' as const;

  private readonly config: Required<TextGradConfig>;

  constructor(config: TextGradConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Run the backward pass: critique `input.output` and return textual gradients.
   */
  compute(input: TextGradInput): TextGradResult {
    const start = Date.now();
    const gradients: TextualGradient[] = [];

    for (const pattern of CRITIQUE_PATTERNS) {
      if (gradients.length >= this.config.maxGradients) break;

      if (!pattern.test(input.output, input.taskDescription)) continue;

      // Adjust magnitude by prior quality (low quality → higher magnitude)
      const qualityFactor = input.priorQuality !== undefined
        ? 1 - input.priorQuality
        : 0.5;
      const magnitude = Math.min(1, pattern.baseMagnitude * (0.5 + qualityFactor));

      if (magnitude < this.config.minMagnitude) continue;

      gradients.push({
        id: this.gradientId(input.taskId, pattern.dimension),
        critique: pattern.critique(input.output, input.taskDescription),
        dimension: pattern.dimension,
        magnitude,
        agentSlug: input.agentSlug,
        taskId: input.taskId,
        createdAt: Date.now(),
      });
    }

    const storageKey = `textgrad:${input.agentSlug}:${input.taskId}`;

    return {
      gradients,
      storageKey,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Format gradients for injection into the next prompt optimisation cycle.
   * Returns a prompt fragment that `SynthesisPromptTemplate` can prepend.
   */
  formatForPrompt(gradients: TextualGradient[]): string {
    if (gradients.length === 0) return '';

    const sorted = [...gradients].sort((a, b) => b.magnitude - a.magnitude);
    const lines = sorted.map(g =>
      `[${g.dimension.toUpperCase()} Δ${(g.magnitude * 100).toFixed(0)}%] ${g.critique}`
    );

    return `## Textual Gradients (TextGrad backward pass)\nApply these improvements to your next output:\n${lines.join('\n')}`;
  }

  // ===================================================
  // Private helpers
  // ===================================================

  private gradientId(taskId: string, dimension: string): string {
    const input = `${taskId}:${dimension}`;
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return `tg-${h.toString(16).padStart(8, '0')}`;
  }
}
