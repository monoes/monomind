/**
 * BootstrapFewShot - Automatic Few-Shot Prompt Optimization
 *
 * Selects high-quality trace examples and composes them into
 * few-shot prompt blocks that improve agent performance.
 *
 * @module @monobrain/hooks/optimization/bootstrap-fewshot
 */

import { createHash } from 'node:crypto';
import type { QualityMetric } from './quality-metric.js';

// ===== Types =====

export interface TraceRecord {
  traceId: string;
  agentSlug: string;
  input: string;
  output: string;
  /** Quality score in [0, 1] */
  qualityScore: number;
  createdAt: Date;
}

export interface FewShotExample {
  input: string;
  output: string;
  qualityScore: number;
}

export interface BootstrapFewShotConfig {
  /** Maximum number of examples to include (default 5) */
  maxExamples?: number;
  /** Minimum quality score threshold (default 0.80) */
  minQualityScore?: number;
  /** Remove duplicate inputs by hash (default true) */
  deduplicateInputs?: boolean;
  /** Optional metric to re-score traces during selection */
  qualityMetric?: QualityMetric;
}

// ===== Implementation =====

export class BootstrapFewShot {
  private readonly maxExamples: number;
  private readonly minQualityScore: number;
  private readonly deduplicateInputs: boolean;
  private readonly qualityMetric?: QualityMetric;

  constructor(config: BootstrapFewShotConfig = {}) {
    this.maxExamples = config.maxExamples ?? 5;
    this.minQualityScore = config.minQualityScore ?? 0.80;
    this.deduplicateInputs = config.deduplicateInputs ?? true;
    this.qualityMetric = config.qualityMetric;
  }

  /**
   * Select the best few-shot examples from a set of traces.
   *
   * Steps:
   * 1. Filter by minimum quality score
   * 2. Deduplicate by input hash (if enabled)
   * 3. Optionally re-score with the configured quality metric
   * 4. Sort descending by quality
   * 5. Take top K
   */
  async selectExamples(traces: TraceRecord[]): Promise<FewShotExample[]> {
    if (traces.length === 0) return [];

    // Step 1: filter by quality threshold
    let candidates = traces.filter((t) => t.qualityScore >= this.minQualityScore);

    // Step 2: deduplicate by input hash
    if (this.deduplicateInputs) {
      const seen = new Set<string>();
      candidates = candidates.filter((t) => {
        const hash = createHash('sha256').update(t.input).digest('hex');
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      });
    }

    // Step 3: optionally re-score
    let examples: FewShotExample[] = candidates.map((t) => ({
      input: t.input,
      output: t.output,
      qualityScore: t.qualityScore,
    }));

    if (this.qualityMetric) {
      examples = await Promise.all(
        examples.map(async (ex) => ({
          ...ex,
          qualityScore: await this.qualityMetric!.score(ex.input, ex.output),
        })),
      );
      // Re-filter after re-scoring
      examples = examples.filter((ex) => ex.qualityScore >= this.minQualityScore);
    }

    // Step 4: sort descending by quality
    examples.sort((a, b) => b.qualityScore - a.qualityScore);

    // Step 5: take top K
    return examples.slice(0, this.maxExamples);
  }

  /**
   * Format examples into a numbered markdown block.
   * Returns empty string when no examples are provided.
   */
  formatFewShotBlock(examples: FewShotExample[]): string {
    if (examples.length === 0) return '';

    const lines: string[] = ['## Few-Shot Examples', ''];
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      lines.push(`### Example ${i + 1} (quality: ${ex.qualityScore.toFixed(2)})`);
      lines.push('');
      lines.push('**Input:**');
      lines.push(ex.input);
      lines.push('');
      lines.push('**Output:**');
      lines.push(ex.output);
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Compose a full prompt by prepending the few-shot block
   * before the agent's system instructions.
   */
  composePrompt(agentSystemPrompt: string, examples: FewShotExample[]): string {
    const block = this.formatFewShotBlock(examples);
    if (!block) return agentSystemPrompt;
    return `${block}\n---\n\n${agentSystemPrompt}`;
  }
}
