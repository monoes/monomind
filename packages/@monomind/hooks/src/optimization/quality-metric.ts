/**
 * Quality Metrics for Few-Shot Prompt Optimization
 *
 * Provides scoring functions to evaluate agent output quality.
 * Used by BootstrapFewShot to filter and rank trace examples.
 *
 * @module @monobrain/hooks/optimization/quality-metric
 */

// ===== Interface =====

export interface QualityMetric {
  /** Human-readable metric name */
  name: string;
  /**
   * Score the output for a given input.
   * @returns A value in [0, 1] where 1 is best quality.
   */
  score(input: string, output: string, expectedSchema?: Record<string, unknown>): Promise<number>;
}

// ===== Implementations =====

/**
 * Scores based on output length.
 * Too short (<50 chars) -> 0.2 (likely incomplete)
 * Too long (>8000 chars) -> 0.6 (likely verbose)
 * Otherwise -> 1.0
 */
export class LengthBasedMetric implements QualityMetric {
  readonly name = 'length-based';

  async score(_input: string, output: string): Promise<number> {
    if (output.length < 50) return 0.2;
    if (output.length > 8000) return 0.6;
    return 1.0;
  }
}

/**
 * Scores based on JSON validity and required field presence.
 * Valid JSON with all required fields -> 1.0
 * Valid JSON missing some fields -> 0.5
 * Invalid JSON -> 0.0
 */
export class JSONValidityMetric implements QualityMetric {
  readonly name = 'json-validity';

  async score(_input: string, output: string, expectedSchema?: Record<string, unknown>): Promise<number> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(output);
    } catch {
      return 0.0;
    }

    if (!expectedSchema || typeof parsed !== 'object' || parsed === null) {
      // Valid JSON but no schema to check against
      return typeof parsed === 'object' && parsed !== null ? 1.0 : 0.5;
    }

    const requiredKeys = Object.keys(expectedSchema);
    if (requiredKeys.length === 0) return 1.0;

    const presentKeys = requiredKeys.filter((k) => k in parsed);
    if (presentKeys.length === requiredKeys.length) return 1.0;
    return 0.5;
  }
}

/**
 * Uses an LLM (Claude Haiku) to judge output quality.
 * Sends a structured scoring prompt, parses JSON response, clamps to [0,1].
 * Returns 0.0 on any parse failure.
 */
export class LLMJudgeMetric implements QualityMetric {
  readonly name = 'llm-judge';

  constructor(
    private readonly claudeHaiku: (prompt: string) => Promise<string>,
  ) {}

  async score(input: string, output: string): Promise<number> {
    const prompt = [
      'You are a quality judge. Score the following agent output for the given input.',
      'Respond with ONLY a JSON object: {"score": <number between 0 and 1>, "reason": "<brief reason>"}',
      '',
      `INPUT: ${input}`,
      '',
      `OUTPUT: ${output}`,
    ].join('\n');

    try {
      const response = await this.claudeHaiku(prompt);
      const parsed = JSON.parse(response);
      if (typeof parsed.score !== 'number') return 0.0;
      return Math.max(0, Math.min(1, parsed.score));
    } catch {
      return 0.0;
    }
  }
}

// ===== Agent-as-a-Judge (arXiv:2410.10934) =====

/**
 * A single step in an agent's execution trace.
 * Captures the action taken and its intermediate outcome.
 */
export interface TraceStep {
  /** Role of the actor: "agent", "tool", "user" */
  role: 'agent' | 'tool' | 'user';
  /** Content of the step — reasoning, tool input, or observation */
  content: string;
  /** Tool call name if this is a tool invocation */
  toolCall?: string;
  /** Observed result / tool output */
  outcome?: string;
}

/**
 * Agent-as-a-Judge: Evaluates the FULL execution trajectory, not just input/output.
 *
 * Unlike LLMJudgeMetric (output-only), TraceAwareJudgeMetric reconstructs the
 * agent's reasoning chain and lets a judge model audit each intermediate step for
 * correctness, efficiency, and alignment before scoring the final answer.
 *
 * Source: arXiv:2410.10934 — "Agent-as-a-Judge: Evaluate Agents with Agents"
 */
export class TraceAwareJudgeMetric implements QualityMetric {
  readonly name = 'trace-aware-judge';

  constructor(
    private readonly claudeHaiku: (prompt: string) => Promise<string>,
    private readonly config: {
      /** Maximum trace steps to include in the prompt (default: 10) */
      maxSteps?: number;
      /** Also score the reasoning quality independently (default: false) */
      scoreReasoning?: boolean;
    } = {},
  ) {}

  async score(input: string, output: string, _schema?: Record<string, unknown>): Promise<number> {
    // No trace context — fall back to basic LLM judge
    return this.scoreWithTrace(input, output, []);
  }

  /**
   * Full trace-aware evaluation.
   * @param input  - Original task given to the agent
   * @param output - Final answer produced by the agent
   * @param trace  - Ordered list of intermediate steps (reasoning + tool calls)
   */
  async scoreWithTrace(
    input: string,
    output: string,
    trace: TraceStep[],
  ): Promise<number> {
    const maxSteps = this.config.maxSteps ?? 10;
    const traceSlice = trace.slice(-maxSteps);

    // Build the trace section of the prompt
    const traceLines: string[] = [];
    for (let i = 0; i < traceSlice.length; i++) {
      const step = traceSlice[i];
      const header = `STEP ${i + 1} [${step.role.toUpperCase()}]${step.toolCall ? ` → ${step.toolCall}` : ''}`;
      traceLines.push(header);
      traceLines.push(step.content.slice(0, 500)); // trim very long steps
      if (step.outcome) traceLines.push(`  ↳ ${step.outcome.slice(0, 200)}`);
    }

    const traceSection = traceLines.length > 0
      ? `\nEXECUTION TRACE (${traceSlice.length} steps):\n${traceLines.join('\n')}\n`
      : '';

    const prompt = [
      'You are an expert judge evaluating an AI agent\'s complete reasoning trajectory.',
      'Score holistically: correctness of final answer, reasoning quality, tool usage efficiency, and alignment with the original task.',
      'Penalise unnecessary detours, hallucinated tool calls, or reasoning errors even if the final answer happens to be correct.',
      'Respond with ONLY a JSON object:',
      '{"score": <0-1>, "reasoning_quality": <0-1>, "efficiency": <0-1>, "reason": "<one sentence>"}',
      '',
      `TASK: ${input}`,
      traceSection,
      `FINAL OUTPUT: ${output}`,
    ].join('\n');

    try {
      const response = await this.claudeHaiku(prompt);
      const parsed = JSON.parse(response);
      if (typeof parsed.score !== 'number') return 0.0;
      return Math.max(0, Math.min(1, parsed.score));
    } catch {
      return 0.0;
    }
  }
}
