/**
 * DAGLearner — Heterogeneous Swarms DAG topology proposal
 *
 * Reads task outcomes from ReasoningBank and proposes an optimal agent
 * topology (DAG of specialised agents) for a given task.  The proposed
 * topology is compiled and registered in SubGraphRegistry so that
 * subsequent AFLOW searches can discover it.
 *
 * Algorithm:
 *   1. Retrieve the top-K most similar past guidance patterns from ReasoningBank
 *   2. Extract agent-slug preferences from pattern content (keyword→slug heuristic)
 *   3. Build a coordinator → specialists → reviewer slug list
 *   4. Compile and register the topology in SubGraphRegistry
 *
 * Source: arXiv:2502.04510 — Heterogeneous Swarms: Jointly Optimising Agent Roles and Collaboration Topology
 *
 * @module v1/hooks/subgraph/dag-learner
 */

import type { CompiledSubGraph } from './types.js';
import { SubGraphRegistry } from './subgraph-registry.js';
import { compile } from './subgraph-compiler.js';

// ============================================================
// Keyword → agent-slug heuristic map
// ============================================================

const KEYWORD_TO_SLUG: Record<string, string> = {
  security: 'security-architect',
  audit: 'security-auditor',
  test: 'tester',
  code: 'coder',
  fix: 'coder',
  refactor: 'coder',
  architect: 'system-architect',
  plan: 'planner',
  research: 'researcher',
  review: 'reviewer',
  backend: 'backend-dev',
  mobile: 'mobile-dev',
  ml: 'ml-developer',
  neural: 'ml-developer',
  performance: 'perf-analyzer',
  memory: 'memory-specialist',
};

function extractSlugHints(text: string): string[] {
  const lower = text.toLowerCase();
  const slugs: string[] = [];
  for (const [kw, slug] of Object.entries(KEYWORD_TO_SLUG)) {
    if (lower.includes(kw) && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

// ============================================================
// Defaults
// ============================================================

/** Default specialist set when ReasoningBank has no relevant patterns */
const DEFAULT_SPECIALISTS = ['coder', 'tester'];

// ============================================================
// DAGLearner
// ============================================================

export interface DAGLearnerConfig {
  /** Number of ReasoningBank patterns to consider (default: 8) */
  topK?: number;
  /** Minimum similarity to consider a pattern relevant (default: 0) */
  threshold?: number;
  /** Maximum specialist agents to include (default: 3) */
  maxSpecialists?: number;
}

export interface DAGLearnerResult {
  /** Compiled topology registered in SubGraphRegistry */
  topology: CompiledSubGraph;
  /** Agent slugs selected for this topology */
  selectedSlugs: string[];
  /** Whether patterns were found in ReasoningBank */
  learnedFromPatterns: boolean;
}

/**
 * DAGLearner — proposes and registers optimised agent DAG topologies.
 *
 * The topology uses the existing `compile()` infrastructure:
 *   [coordinator, ...specialists, reviewer]
 *
 * Instances are stateless and safe to reuse; SubGraphRegistry persists
 * proposed topologies for downstream AFLOW discovery.
 */
export class DAGLearner {
  private readonly topK: number;
  private readonly threshold: number;
  private readonly maxSpecialists: number;

  constructor(config: DAGLearnerConfig = {}) {
    this.topK = config.topK ?? 8;
    this.threshold = config.threshold ?? 0;
    this.maxSpecialists = config.maxSpecialists ?? 3;
  }

  /**
   * Propose an agent DAG topology optimised for the given task.
   *
   * Queries ReasoningBank for similar past patterns, extracts agent
   * slug preferences, compiles a coordinator→specialists→reviewer topology,
   * and registers it in SubGraphRegistry for AFLOW discovery.
   */
  async propose(taskDescription: string): Promise<DAGLearnerResult> {
    const learnedSlugs = await this.learnSpecialists(taskDescription);
    const learnedFromPatterns = learnedSlugs.length > 0;

    const specialists = (learnedFromPatterns ? learnedSlugs : DEFAULT_SPECIALISTS)
      .slice(0, this.maxSpecialists);

    // Coordinator → specialists → reviewer
    const allSlugs = ['planner', ...specialists, 'reviewer'];

    const topology = compile(allSlugs, {
      name: `dag-learned-${Date.now()}`,
      description: `DAGLearner topology for: ${taskDescription.slice(0, 60)}`,
    });

    SubGraphRegistry.getInstance().register(topology);

    return { topology, selectedSlugs: allSlugs, learnedFromPatterns };
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  /** Query ReasoningBank and extract specialist slug preferences */
  private async learnSpecialists(task: string): Promise<string[]> {
    try {
      const { reasoningBank } = await import('../reasoningbank/index.js');
      const patterns = await reasoningBank.search(task, {
        topK: this.topK,
        threshold: this.threshold,
      });

      // Accumulate slug hints weighted by similarity score
      const tally = new Map<string, number>();
      for (const { pattern, similarity } of patterns) {
        const hints = [
          ...extractSlugHints(pattern.task ?? ''),
          ...extractSlugHints(pattern.guidance ?? ''),
        ];
        for (const slug of hints) {
          tally.set(slug, (tally.get(slug) ?? 0) + similarity);
        }
      }

      // Return slugs ordered by accumulated similarity weight
      return [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([slug]) => slug);
    } catch {
      // ReasoningBank unavailable
      return [];
    }
  }
}
