/**
 * PromptOptimizer - Orchestrates few-shot prompt optimization
 *
 * Collects traces, selects examples, composes optimized prompts,
 * and manages version lifecycle via PromptVersionStore.
 *
 * @module @monobrain/hooks/optimization/prompt-optimizer
 */

import type { PromptVersionStore } from '../../../memory/src/prompt-version-store.js';
import type { BootstrapFewShot } from './bootstrap-fewshot.js';
import type { TraceQualityStore } from './trace-quality-store.js';

// ===== Types =====

export interface OptimizationResult {
  agentSlug: string;
  examplesSelected: number;
  previousVersion: string | null;
  newVersion: string | null;
  qualityBefore: number;
  qualityAfter: number;
  improvement: number;
  promoted: boolean;
  dryRun: boolean;
  composedPrompt: string;
}

export interface OptimizeOptions {
  /** Period identifier, e.g. '7d', '30d' — maps to fromDate */
  period: string;
  /** If true, return the result without persisting */
  dryRun?: boolean;
  /** If true and improvement >= 0.02, set as active version */
  promote?: boolean;
}

// ===== Helpers =====

function periodToDate(period: string): Date {
  const now = Date.now();
  const match = period.match(/^(\d+)([dhm])$/);
  if (!match) return new Date(now - 7 * 24 * 60 * 60 * 1000); // default 7d

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const msMap: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return new Date(now - value * (msMap[unit] ?? msMap.d));
}

function nextVersion(current: string | null): string {
  if (!current) return '1.0.0';
  const parts = current.split('.').map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

// ===== Optimizer =====

export class PromptOptimizer {
  constructor(
    private readonly traceStore: TraceQualityStore,
    private readonly versionStore: PromptVersionStore,
    private readonly fewShot: BootstrapFewShot,
  ) {}

  async optimize(agentSlug: string, options: OptimizeOptions): Promise<OptimizationResult> {
    const fromDate = periodToDate(options.period);
    const dryRun = options.dryRun ?? false;
    const promote = options.promote ?? false;

    // Collect traces
    const traces = this.traceStore.query(agentSlug, fromDate, 0);
    const stats = this.traceStore.getStats(agentSlug);
    const qualityBefore = stats.avgQuality;

    // Select examples
    const examples = await this.fewShot.selectExamples(traces);

    // Get current active version
    const active = this.versionStore.getActive(agentSlug);
    const currentPrompt = active?.prompt ?? '';
    const currentVersion = active?.version ?? null;

    // Compose new prompt
    const composedPrompt = this.fewShot.composePrompt(currentPrompt, examples);

    // Calculate quality after (average of selected examples)
    const qualityAfter =
      examples.length > 0
        ? examples.reduce((sum, ex) => sum + ex.qualityScore, 0) / examples.length
        : qualityBefore;

    const improvement = qualityAfter - qualityBefore;
    const newVersionStr = nextVersion(currentVersion);

    let promoted = false;

    if (!dryRun && examples.length > 0) {
      // Save new version
      this.versionStore.save({
        agentSlug,
        version: newVersionStr,
        prompt: composedPrompt,
        changelog: `Auto-optimized with ${examples.length} few-shot examples`,
        activeFrom: new Date(),
        qualityScore: qualityAfter,
        traceCount: traces.length,
        publishedBy: 'prompt-optimizer',
        createdAt: new Date(),
      });

      // Promote if improvement is significant
      if (promote && improvement >= 0.02) {
        this.versionStore.setActive(agentSlug, newVersionStr);
        promoted = true;
      }
    }

    return {
      agentSlug,
      examplesSelected: examples.length,
      previousVersion: currentVersion,
      newVersion: dryRun ? null : newVersionStr,
      qualityBefore,
      qualityAfter,
      improvement,
      promoted,
      dryRun,
      composedPrompt,
    };
  }
}
