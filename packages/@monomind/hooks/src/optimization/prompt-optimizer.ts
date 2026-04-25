/**
 * PromptOptimizer - Orchestrates few-shot prompt optimization
 *
 * Collects traces, selects examples, composes optimized prompts,
 * and manages version lifecycle via PromptVersionStore.
 *
 * @module @monobrain/hooks/optimization/prompt-optimizer
 */

import type { PromptVersionStore } from '../../../memory/src/prompt-version-store.js';
import { BootstrapFewShot } from './bootstrap-fewshot.js';
import type { TraceQualityStore } from './trace-quality-store.js';
import type { TraceRecord, FewShotExample } from './bootstrap-fewshot.js';

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
  /** If true, apply Bayesian exploration noise to example selection scores (DSPy-style)
   *  Source: https://dspy.ai */
  bayesian?: boolean;
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

    // Select examples — optionally add Bayesian exploration noise to scores (DSPy-style)
    // Source: https://dspy.ai
    let tracesToSelect = traces;
    if (options.bayesian && traces.length > 0) {
      tracesToSelect = [...traces].sort(() => {
        // Add U(0, 0.1) noise to naturally sort by quality+exploration
        return (Math.random() * 0.1) - (Math.random() * 0.1);
      });
    }
    const examples = await this.fewShot.selectExamples(tracesToSelect);

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

// ============================================================
// GEPA — Generalized Evolutionary Prompt Alignment
// Multi-prompt co-evolution with Pareto front optimization
// Source: https://arxiv.org/abs/2507.19457
// ============================================================

export interface GEPAConfig {
  /** Population size (number of candidate prompt variants). Default: 6 */
  populationSize?: number;
  /** Number of evolutionary generations. Default: 3 */
  generations?: number;
  /** Minimum quality score for few-shot selection. Default: 0.80 */
  minQualityScore?: number;
  /** Maximum examples per candidate. Default: 5 */
  maxExamples?: number;
}

export interface GEPACandidate {
  prompt: string;
  examples: FewShotExample[];
  qualityScore: number;
  /** Diversity score relative to rest of population (0-1) */
  diversityScore: number;
  /** True if on the Pareto front (not dominated on both quality AND diversity) */
  paretoFront: boolean;
}

export interface GEPAResult {
  bestPrompt: string;
  bestQuality: number;
  generations: number;
  populationSize: number;
  paretoFrontSize: number;
}

/**
 * GEPAOptimizer — evolves a population of prompt candidates across multiple
 * generations using Pareto front selection and shared trajectory critique.
 *
 * Shared trajectory critique: each agent contributes examples to a global pool;
 * candidates are cross-fertilised from multiple agents' best traces, improving
 * generalisation beyond single-agent DSPy-style bootstrapping.
 *
 * Source: https://arxiv.org/abs/2507.19457
 */
export class GEPAOptimizer {
  private readonly populationSize: number;
  private readonly generations: number;
  private readonly minQualityScore: number;
  private readonly maxExamples: number;

  constructor(config: GEPAConfig = {}) {
    this.populationSize = config.populationSize ?? 6;
    this.generations = config.generations ?? 3;
    this.minQualityScore = config.minQualityScore ?? 0.80;
    this.maxExamples = config.maxExamples ?? 5;
  }

  /**
   * Evolve a population of prompts for a given agent using traces from one or
   * more agents (shared trajectory critique pool).
   *
   * @param basePrompt       The current system prompt to evolve from
   * @param sharedTraces     Combined trace pool (own + peer agents for critique)
   * @returns Best prompt on the Pareto front after evolution
   */
  async evolve(basePrompt: string, sharedTraces: TraceRecord[]): Promise<GEPAResult> {
    if (sharedTraces.length === 0) {
      return { bestPrompt: basePrompt, bestQuality: 0, generations: 0, populationSize: 0, paretoFrontSize: 0 };
    }

    // Initialise population: N variants with stochastic example selection
    let population: GEPACandidate[] = await this.initPopulation(basePrompt, sharedTraces);

    for (let gen = 0; gen < this.generations; gen++) {
      // Evaluate diversity across population
      population = this.scoreDiversity(population);

      // Pareto selection
      population = this.paretoSelect(population);

      // Crossover: each surviving candidate inherits examples from two parents
      if (gen < this.generations - 1) {
        population = await this.crossover(population, sharedTraces);
      }
    }

    // Final Pareto scoring
    population = this.scoreDiversity(population);
    population = this.paretoSelect(population);

    // Best: highest quality on Pareto front
    const front = population.filter(c => c.paretoFront);
    const best = front.sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? population[0];

    return {
      bestPrompt: best.prompt,
      bestQuality: best.qualityScore,
      generations: this.generations,
      populationSize: this.populationSize,
      paretoFrontSize: front.length,
    };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async initPopulation(basePrompt: string, traces: TraceRecord[]): Promise<GEPACandidate[]> {
    const candidates: GEPACandidate[] = [];

    for (let i = 0; i < this.populationSize; i++) {
      // Stochastic shuffle — each variant picks a different random subset
      const shuffled = [...traces].sort(() => Math.random() - 0.5);
      const fewShot = new BootstrapFewShot({
        maxExamples: this.maxExamples,
        minQualityScore: this.minQualityScore,
        deduplicateInputs: true,
      });
      const examples = await fewShot.selectExamples(shuffled);
      const qualityScore = examples.length > 0
        ? examples.reduce((s, e) => s + e.qualityScore, 0) / examples.length
        : 0;
      const prompt = fewShot.composePrompt(basePrompt, examples);

      candidates.push({ prompt, examples, qualityScore, diversityScore: 0, paretoFront: false });
    }

    return candidates;
  }

  private scoreDiversity(population: GEPACandidate[]): GEPACandidate[] {
    return population.map((candidate, i) => {
      const others = population.filter((_, j) => j !== i);
      if (others.length === 0) return { ...candidate, diversityScore: 1 };

      // Diversity = 1 - average example-set Jaccard overlap with other candidates
      const avgJaccard =
        others.reduce((sum, other) => sum + this.exampleJaccard(candidate.examples, other.examples), 0) /
        others.length;

      return { ...candidate, diversityScore: 1 - avgJaccard };
    });
  }

  /** Jaccard similarity on output tokens between two example sets */
  private exampleJaccard(a: FewShotExample[], b: FewShotExample[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    const tokensA = new Set(a.flatMap(ex => ex.output.split(/\s+/)));
    const tokensB = new Set(b.flatMap(ex => ex.output.split(/\s+/)));
    const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
    const union = new Set([...tokensA, ...tokensB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private paretoSelect(population: GEPACandidate[]): GEPACandidate[] {
    // Mark Pareto front: a candidate is dominated if another is strictly better on BOTH objectives
    const withFront = population.map(c => {
      const dominated = population.some(
        other =>
          other !== c &&
          other.qualityScore >= c.qualityScore &&
          other.diversityScore >= c.diversityScore &&
          (other.qualityScore > c.qualityScore || other.diversityScore > c.diversityScore),
      );
      return { ...c, paretoFront: !dominated };
    });

    // Keep Pareto front + enough extras to maintain population size
    const front = withFront.filter(c => c.paretoFront);
    const nonFront = withFront.filter(c => !c.paretoFront).sort((a, b) => b.qualityScore - a.qualityScore);
    const combined = [...front, ...nonFront].slice(0, this.populationSize);
    return combined;
  }

  private async crossover(survivors: GEPACandidate[], sharedTraces: TraceRecord[]): Promise<GEPACandidate[]> {
    const offspring: GEPACandidate[] = [];

    for (const parent of survivors) {
      // Crossover: inherit half examples from parent, half from a random peer
      const peer = survivors[Math.floor(Math.random() * survivors.length)];
      const crossed: FewShotExample[] = [
        ...parent.examples.slice(0, Math.ceil(parent.examples.length / 2)),
        ...peer.examples.slice(0, Math.floor(peer.examples.length / 2)),
      ];

      // Optionally inject one shared-trajectory example (critique from pool)
      const highQualityExternal = sharedTraces
        .filter(t => t.qualityScore >= this.minQualityScore)
        .sort(() => Math.random() - 0.5)[0];
      if (highQualityExternal) {
        crossed.push({ input: highQualityExternal.input, output: highQualityExternal.output, qualityScore: highQualityExternal.qualityScore });
      }

      // Deduplicate and cap
      const seen = new Set<string>();
      const deduped = crossed.filter(ex => {
        if (seen.has(ex.input)) return false;
        seen.add(ex.input);
        return true;
      }).slice(0, this.maxExamples);

      const fewShot = new BootstrapFewShot({ maxExamples: this.maxExamples });
      const quality = deduped.length > 0
        ? deduped.reduce((s, e) => s + e.qualityScore, 0) / deduped.length
        : 0;
      const prompt = fewShot.composePrompt(parent.prompt.split('---\n\n').slice(-1)[0] ?? parent.prompt, deduped);

      offspring.push({ prompt, examples: deduped, qualityScore: quality, diversityScore: 0, paretoFront: false });
    }

    return offspring;
  }
}
