/**
 * AFLOWSearch — MCTS-guided workflow search over registered subgraphs
 *
 * Implements the AFLOW (Automated Flow) approach: uses Monte Carlo Tree Search
 * to discover near-optimal agent subgraph sequences without manual workflow
 * engineering. The search space is the set of compiled subgraphs in the
 * SubGraphRegistry; the reward signal is a provided scoring function
 * (typically measured trace quality from PromptOptimizer or BenchmarkRunner).
 *
 * Source: https://arxiv.org/abs/2410.10762
 *
 * @module @monobrain/hooks/subgraph/aflow-search
 */

import type { CompiledSubGraph } from './types.js';
import { SubGraphRegistry } from './subgraph-registry.js';

// ===== Types =====

export interface AFLOWConfig {
  /** Max MCTS rollout depth (number of subgraph steps in a sequence). Default: 3 */
  maxDepth?: number;
  /** Number of MCTS simulations per search. Default: 20 */
  simulations?: number;
  /** UCB1 exploration constant (higher = more exploration). Default: 1.41 */
  explorationConstant?: number;
  /** If true, the registry singleton is used; pass a custom registry to override. */
  registry?: SubGraphRegistry;
}

export interface AFLOWNode {
  /** Subgraph sequence explored so far */
  sequence: CompiledSubGraph[];
  /** Total reward accumulated in simulations through this node */
  totalReward: number;
  /** Number of times this node was visited */
  visits: number;
  /** Child nodes (one per candidate next subgraph) */
  children: AFLOWNode[];
  /** Parent node */
  parent: AFLOWNode | null;
}

export interface AFLOWResult {
  /** Best subgraph sequence found */
  bestSequence: CompiledSubGraph[];
  /** Estimated quality score for the best sequence */
  bestScore: number;
  /** Number of MCTS simulations performed */
  simulationsRun: number;
  /** IDs of subgraphs in the best sequence */
  subGraphIds: string[];
}

/** Reward function signature — evaluates a subgraph sequence and returns 0-1 */
export type SequenceRewardFn = (sequence: CompiledSubGraph[]) => Promise<number>;

// ===== MCTS helpers =====

function ucb1(node: AFLOWNode, parentVisits: number, c: number): number {
  if (node.visits === 0) return Infinity;
  const exploitation = node.totalReward / node.visits;
  const exploration = c * Math.sqrt(Math.log(parentVisits) / node.visits);
  return exploitation + exploration;
}

function bestChild(node: AFLOWNode, c: number): AFLOWNode | null {
  if (node.children.length === 0) return null;
  return node.children.reduce((best, child) =>
    ucb1(child, node.visits, c) > ucb1(best, node.visits, c) ? child : best,
  );
}

/** Expand a node by adding child nodes for all candidates not yet in the sequence */
function expand(node: AFLOWNode, candidates: CompiledSubGraph[]): void {
  const usedIds = new Set(node.sequence.map(g => g.subGraphId));
  for (const candidate of candidates) {
    if (!usedIds.has(candidate.subGraphId)) {
      node.children.push({
        sequence: [...node.sequence, candidate],
        totalReward: 0,
        visits: 0,
        children: [],
        parent: node,
      });
    }
  }
}

/** Random rollout from a node to max depth, returns simulated reward */
async function rollout(
  node: AFLOWNode,
  candidates: CompiledSubGraph[],
  maxDepth: number,
  rewardFn: SequenceRewardFn,
): Promise<number> {
  let sequence = [...node.sequence];
  const usedIds = new Set(sequence.map(g => g.subGraphId));

  // Extend with random candidates up to maxDepth
  const remaining = candidates.filter(c => !usedIds.has(c.subGraphId));
  const shuffled = [...remaining].sort(() => Math.random() - 0.5);

  for (const next of shuffled) {
    if (sequence.length >= maxDepth) break;
    sequence = [...sequence, next];
  }

  return await rewardFn(sequence);
}

/** Back-propagate reward up the tree */
function backpropagate(node: AFLOWNode | null, reward: number): void {
  let current = node;
  while (current !== null) {
    current.visits++;
    current.totalReward += reward;
    current = current.parent;
  }
}

// ===== AFLOWSearch =====

/**
 * AFLOWSearch — discovers near-optimal subgraph execution sequences
 * using Monte Carlo Tree Search (MCTS).
 *
 * Source: https://arxiv.org/abs/2410.10762
 */
export class AFLOWSearch {
  private readonly maxDepth: number;
  private readonly simulations: number;
  private readonly explorationConstant: number;
  private readonly registry: SubGraphRegistry;

  constructor(config: AFLOWConfig = {}) {
    this.maxDepth = config.maxDepth ?? 3;
    this.simulations = config.simulations ?? 20;
    this.explorationConstant = config.explorationConstant ?? 1.41;
    this.registry = config.registry ?? SubGraphRegistry.getInstance();
  }

  /**
   * Search for the best subgraph sequence for a given task.
   *
   * @param rewardFn  Async function that scores a candidate sequence [0, 1].
   *                  Typically wraps a BenchmarkRunner or PromptOptimizer call.
   * @returns The best sequence found and its estimated score.
   */
  async search(rewardFn: SequenceRewardFn): Promise<AFLOWResult> {
    const candidates = this.registry.listAll();

    if (candidates.length === 0) {
      return { bestSequence: [], bestScore: 0, simulationsRun: 0, subGraphIds: [] };
    }

    const root: AFLOWNode = {
      sequence: [],
      totalReward: 0,
      visits: 0,
      children: [],
      parent: null,
    };

    for (let sim = 0; sim < this.simulations; sim++) {
      // 1. Selection — walk tree using UCB1 until unexpanded or leaf
      let node = root;
      while (node.children.length > 0 && node.sequence.length < this.maxDepth) {
        const child = bestChild(node, this.explorationConstant);
        if (!child) break;
        node = child;
      }

      // 2. Expansion — if not at max depth and not fully expanded
      if (node.sequence.length < this.maxDepth) {
        expand(node, candidates);
        const child = node.children[Math.floor(Math.random() * node.children.length)];
        if (child) node = child;
      }

      // 3. Simulation (rollout)
      const reward = await rollout(node, candidates, this.maxDepth, rewardFn);

      // 4. Back-propagation
      backpropagate(node, reward);
    }

    // Extract best sequence: walk greedy from root (exploit, no explore)
    let best: AFLOWNode = root;
    let bestSeqNode: AFLOWNode = root;
    let bestScore = root.visits > 0 ? root.totalReward / root.visits : 0;

    // BFS to find the node with highest average reward
    const queue: AFLOWNode[] = [root];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.visits > 0) {
        const avg = current.totalReward / current.visits;
        if (avg > bestScore) {
          bestScore = avg;
          bestSeqNode = current;
        }
      }
      queue.push(...current.children);
    }
    best = bestSeqNode;

    return {
      bestSequence: best.sequence,
      bestScore,
      simulationsRun: this.simulations,
      subGraphIds: best.sequence.map(g => g.subGraphId),
    };
  }
}
