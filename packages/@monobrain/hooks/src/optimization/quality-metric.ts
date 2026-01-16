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
