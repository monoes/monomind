/**
 * EvoAgentX Coordinator — orchestration glue for GEPA + SubGraphRegistry + memory
 *
 * Couples three existing systems into a single optimisation pipeline:
 *
 *   1. TraceQualityStore — loads recent high-quality traces for an agent type
 *   2. GEPAOptimizer — evolves the agent's system prompt via Pareto-front
 *      multi-prompt co-evolution across shared trace pools
 *   3. SubGraphRegistry — selects the pre-compiled topology best matching
 *      the agent category, or falls back to a DAGLearner-proposed topology
 *
 * Usage:
 *   const evo = new EvoAgentXCoordinator({ traceStorePath: './data/traces' });
 *   const result = await evo.optimise('coder', currentSystemPrompt);
 *   // result.evolvedPrompt  — improved system prompt
 *   // result.topology       — recommended CompiledSubGraph
 *
 * @module v1/hooks/optimization/evoagentx-coordinator
 */

import type { CompiledSubGraph } from '../subgraph/types.js';
import { SubGraphRegistry } from '../subgraph/subgraph-registry.js';
import { TraceQualityStore } from './trace-quality-store.js';
import { GEPAOptimizer } from './prompt-optimizer.js';
import type { GEPAConfig } from './prompt-optimizer.js';

// ============================================================
// Configuration
// ============================================================

export interface EvoAgentXConfig {
  /** Path to the directory containing trace-quality.jsonl */
  traceStorePath: string;
  /** Minimum quality score for trace selection (default: 0.7) */
  minTraceQuality?: number;
  /** Number of days to look back for traces (default: 7) */
  traceLookbackDays?: number;
  /** GEPA algorithm configuration */
  gepa?: GEPAConfig;
}

// ============================================================
// Result
// ============================================================

export interface EvoAgentXResult {
  /** Agent slug that was optimised */
  agentSlug: string;
  /** The best-evolved system prompt after GEPA co-evolution */
  evolvedPrompt: string;
  /** Quality score of the best evolved prompt (0-1) */
  bestQuality: number;
  /** GEPA evolutionary generations run */
  generationsRun: number;
  /** Number of shared traces used as the GEPA trace pool */
  tracePoolSize: number;
  /** Recommended SubGraph topology for this agent (may be undefined if registry is empty) */
  topology: CompiledSubGraph | undefined;
  /** True if a DAGLearner topology was synthesised because registry had no match */
  dagSynthesised: boolean;
}

// ============================================================
// EvoAgentXCoordinator
// ============================================================

/**
 * EvoAgentXCoordinator
 *
 * Orchestrates multi-agent prompt evolution by coupling:
 *  - ReasoningBank / TraceQualityStore for shared trace pools
 *  - GEPAOptimizer for Pareto-front multi-prompt co-evolution
 *  - SubGraphRegistry for topology recommendation
 *  - DAGLearner for on-demand topology synthesis when registry is empty
 */
export class EvoAgentXCoordinator {
  private readonly store: TraceQualityStore;
  private readonly minTraceQuality: number;
  private readonly traceLookbackDays: number;
  private readonly gepaConfig: GEPAConfig;

  constructor(config: EvoAgentXConfig) {
    this.store = new TraceQualityStore(config.traceStorePath);
    this.minTraceQuality = config.minTraceQuality ?? 0.7;
    this.traceLookbackDays = config.traceLookbackDays ?? 7;
    this.gepaConfig = config.gepa ?? {};
  }

  /**
   * Optimise the system prompt for a given agent slug.
   *
   * Steps:
   *  1. Load recent high-quality traces for `agentSlug` from TraceQualityStore
   *  2. Run GEPAOptimizer with those traces as the shared critique pool
   *  3. Recommend a topology from SubGraphRegistry; synthesise via DAGLearner if none found
   *  4. Return the evolved prompt + topology recommendation
   *
   * @param agentSlug       The agent type to optimise (e.g. 'coder', 'security-architect')
   * @param basePrompt      The current system prompt to evolve from
   * @param peerAgentSlugs  Optional additional agent slugs whose traces to include (shared pool)
   */
  async optimise(
    agentSlug: string,
    basePrompt: string,
    peerAgentSlugs: string[] = [],
  ): Promise<EvoAgentXResult> {
    // --- Step 1: Load traces ---
    const fromDate = new Date(Date.now() - this.traceLookbackDays * 86_400_000);
    const ownTraces = this.store.query(agentSlug, fromDate, this.minTraceQuality);
    const peerTraces = peerAgentSlugs.flatMap(slug =>
      this.store.query(slug, fromDate, this.minTraceQuality),
    );
    const sharedTraces = [...ownTraces, ...peerTraces];

    // --- Step 2: GEPA multi-prompt co-evolution ---
    const gepa = new GEPAOptimizer(this.gepaConfig);
    const gepaResult = await gepa.evolve(basePrompt, sharedTraces);

    // --- Step 3: Topology recommendation ---
    const { topology, dagSynthesised } = await this.resolveTopology(agentSlug);

    return {
      agentSlug,
      evolvedPrompt: gepaResult.bestPrompt,
      bestQuality: gepaResult.bestQuality,
      generationsRun: gepaResult.generations,
      tracePoolSize: sharedTraces.length,
      topology,
      dagSynthesised,
    };
  }

  // ----------------------------------------------------------------
  // Topology resolution
  // ----------------------------------------------------------------

  /**
   * Find the best matching topology in SubGraphRegistry for the given agent slug.
   * If the registry is empty or has no matching category, synthesise via DAGLearner.
   */
  private async resolveTopology(
    agentSlug: string,
  ): Promise<{ topology: CompiledSubGraph | undefined; dagSynthesised: boolean }> {
    const registry = SubGraphRegistry.getInstance();

    // Try to find a topology whose category matches the agent slug prefix
    const all = registry.listAll();
    const matching = all.find(g =>
      g.category === agentSlug ||
      g.category === agentSlug.split('-')[0] ||
      g.raw.agents.some(a => a.agentSlug === agentSlug),
    );

    if (matching) {
      return { topology: matching, dagSynthesised: false };
    }

    // Nothing in registry — synthesise with DAGLearner
    try {
      const { DAGLearner } = await import('../subgraph/dag-learner.js');
      const learner = new DAGLearner();
      const dagResult = await learner.propose(`Optimise ${agentSlug} agent`);
      return { topology: dagResult.topology, dagSynthesised: true };
    } catch {
      // DAGLearner unavailable
      return { topology: undefined, dagSynthesised: false };
    }
  }
}
