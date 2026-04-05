/**
 * LATS — Language Agent Tree Search for coordinator planning
 *
 * Applies MCTS to the coordinator's planning decision space:
 *   - Nodes     = partial plan states (steps accumulated so far)
 *   - Edges     = candidate next steps (template-expanded from task keywords)
 *   - Value fn  = ReasoningBank similarity to past successful guidance patterns
 *   - Selection = UCB1 (Upper Confidence Bound)
 *   - Rollout   = random step extension to max depth
 *
 * Returns the best plan string found — a drop-in alternative to the
 * prompt returned by `buildPlanningPrompt()`, except that this function
 * returns the *plan itself* rather than instructions to write one.
 *
 * Source: arXiv:2310.04406 (Language Agent Tree Search)
 *
 * @module v1/hooks/planning/lats-planner
 */

import type { PlanFormat } from './types.js';

// ============================================================
// Configuration
// ============================================================

export interface LATSConfig {
  /** Number of MCTS simulations to run (default: 20) */
  simulations?: number;
  /** Maximum plan depth in steps (default: 5) */
  maxDepth?: number;
  /** UCB1 exploration constant (default: 1.41 ≈ √2) */
  explorationConstant?: number;
  /** Plan output format (default: 'numbered-list') */
  format?: PlanFormat;
}

// ============================================================
// MCTS node
// ============================================================

interface LATSNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  /** Plan steps accumulated on the path from root to this node */
  steps: string[];
  visits: number;
  totalValue: number;
}

// ============================================================
// Step candidates — keyword-driven expansion templates
// ============================================================

const STEP_TEMPLATES: Record<string, string[]> = {
  fix: [
    'Reproduce the bug and write a failing test',
    'Identify the root cause by reading the relevant code',
    'Implement the minimal fix',
    'Run tests to confirm the bug is resolved',
    'Review for regressions in adjacent code paths',
  ],
  test: [
    'Identify components that need test coverage',
    'Write unit tests for the core logic',
    'Write integration tests for the critical paths',
    'Measure coverage and identify remaining gaps',
    'Add edge-case tests for boundary conditions',
  ],
  implement: [
    'Clarify requirements and define the interface contract',
    'Design the data structures and algorithm',
    'Implement the core logic',
    'Add input validation and error handling',
    'Write tests and review for correctness',
  ],
  refactor: [
    'Map the current code structure and identify code smells',
    'Define the target design',
    'Extract and rename components incrementally',
    'Run tests after each step to prevent regressions',
    'Update documentation to reflect new structure',
  ],
  security: [
    'Enumerate potential threat vectors',
    'Review input validation at all system boundaries',
    'Check for injection, traversal, and auth issues',
    'Apply hardening patches and mitigations',
    'Verify with a targeted security scan',
  ],
  review: [
    'Read the change end-to-end for correctness',
    'Check adherence to project conventions',
    'Identify potential bugs or edge cases',
    'Verify test coverage for the modified paths',
    'Summarise findings and suggest improvements',
  ],
};

const DEFAULT_STEPS = [
  'Understand the requirements and gather context',
  'Break the task into discrete sub-tasks',
  'Execute each sub-task in dependency order',
  'Validate outcomes against acceptance criteria',
  'Document changes and update relevant artefacts',
];

/** Extract candidate steps from task keywords */
function candidateStepsFor(task: string): string[] {
  const lower = task.toLowerCase();
  for (const [keyword, steps] of Object.entries(STEP_TEMPLATES)) {
    if (lower.includes(keyword)) return steps;
  }
  return DEFAULT_STEPS;
}

// ============================================================
// MCTS implementation
// ============================================================

class LATSPlanner {
  private readonly nodes = new Map<string, LATSNode>();
  private nodeCounter = 0;
  private readonly simulations: number;
  private readonly maxDepth: number;
  private readonly C: number;
  private readonly candidates: string[];

  constructor(taskDescription: string, cfg: Required<LATSConfig>) {
    this.simulations = cfg.simulations;
    this.maxDepth = cfg.maxDepth;
    this.C = cfg.explorationConstant;
    this.candidates = candidateStepsFor(taskDescription);

    // Root node — empty plan
    const root: LATSNode = {
      id: 'n0',
      parentId: null,
      childIds: [],
      depth: 0,
      steps: [],
      visits: 0,
      totalValue: 0,
    };
    this.nodes.set('n0', root);
  }

  private nextId(): string {
    return `n${++this.nodeCounter}`;
  }

  /** UCB1 score for node selection */
  private ucb1(node: LATSNode, parentVisits: number): number {
    if (node.visits === 0) return Infinity;
    return (
      node.totalValue / node.visits +
      this.C * Math.sqrt(Math.log(parentVisits) / node.visits)
    );
  }

  /** Select the most promising leaf via UCB1 tree policy */
  private select(): LATSNode {
    let current = this.nodes.get('n0')!;
    while (current.childIds.length > 0 && !this.isTerminal(current)) {
      let best: LATSNode | undefined;
      let bestScore = -Infinity;
      for (const cid of current.childIds) {
        const child = this.nodes.get(cid)!;
        const score = this.ucb1(child, current.visits || 1);
        if (score > bestScore) { bestScore = score; best = child; }
      }
      current = best!;
    }
    return current;
  }

  /** Expand: add one new child per unvisited candidate step */
  private expand(node: LATSNode): LATSNode {
    if (this.isTerminal(node)) return node;
    // One candidate per existing child already; add a new one
    const usedSteps = new Set(node.childIds.map(cid => {
      const c = this.nodes.get(cid)!;
      return c.steps[c.steps.length - 1];
    }));
    const nextStep = this.candidates.find(s => !usedSteps.has(s));
    if (!nextStep) return node; // all candidates exhausted

    const child: LATSNode = {
      id: this.nextId(),
      parentId: node.id,
      childIds: [],
      depth: node.depth + 1,
      steps: [...node.steps, nextStep],
      visits: 0,
      totalValue: 0,
    };
    this.nodes.set(child.id, child);
    node.childIds.push(child.id);
    return child;
  }

  /** Rollout: random extension from node to max depth */
  private rollout(node: LATSNode): number {
    let steps = [...node.steps];
    const remaining = this.candidates.filter(s => !steps.includes(s));
    while (steps.length < this.maxDepth && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      steps = [...steps, remaining.splice(idx, 1)[0]];
    }
    // Heuristic value: normalised step count (more complete plans score higher)
    return steps.length / this.maxDepth;
  }

  /** Async rollout with optional ReasoningBank value function */
  private async evaluate(node: LATSNode): Promise<number> {
    const heuristic = this.rollout(node);
    try {
      // Augment with ReasoningBank quality signal when available
      const { reasoningBank } = await import('../reasoningbank/index.js');
      const planText = node.steps.join('\n');
      const patterns = await reasoningBank.search(planText, { topK: 1, threshold: 0 });
      if (patterns.length > 0) {
        const rbScore = patterns[0].similarity;
        return (heuristic + rbScore) / 2;
      }
    } catch {
      // ReasoningBank unavailable — use heuristic only
    }
    return heuristic;
  }

  /** Backpropagate value from leaf to root */
  private backpropagate(node: LATSNode, value: number): void {
    let current: LATSNode | undefined = node;
    while (current) {
      current.visits++;
      current.totalValue += value;
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }
  }

  private isTerminal(node: LATSNode): boolean {
    return node.depth >= this.maxDepth;
  }

  /** Run MCTS and return the best plan node */
  async run(): Promise<LATSNode> {
    for (let i = 0; i < this.simulations; i++) {
      const selected = this.select();
      const expanded = this.expand(selected);
      const value = await this.evaluate(expanded);
      this.backpropagate(expanded, value);
    }

    // Best plan = highest average value among nodes with at least 1 visit
    let best: LATSNode = this.nodes.get('n0')!;
    for (const node of this.nodes.values()) {
      if (node.visits > 0 && node.depth > 0) {
        const avgValue = node.totalValue / node.visits;
        const bestAvg = best.visits > 0 ? best.totalValue / best.visits : 0;
        if (avgValue > bestAvg) best = node;
      }
    }
    return best;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a plan for the given task using MCTS (LATS algorithm).
 *
 * Unlike `buildPlanningPrompt()` which returns a prompt instructing an agent
 * to write a plan, this function returns the plan itself — a ready-to-use
 * sequence of steps derived from MCTS exploration over candidate actions.
 *
 * The value function first tries ReasoningBank quality scores from past
 * guidance patterns; it falls back to a step-completeness heuristic when
 * ReasoningBank is unavailable.
 *
 * @param taskDescription  Natural-language task description
 * @param config           LATS algorithm configuration
 * @returns                Plan string in numbered-list or other format
 */
export async function buildLATSPlan(
  taskDescription: string,
  config: LATSConfig = {},
): Promise<string> {
  const cfg: Required<LATSConfig> = {
    simulations: config.simulations ?? 20,
    maxDepth: config.maxDepth ?? 5,
    explorationConstant: config.explorationConstant ?? 1.41,
    format: config.format ?? 'numbered-list',
  };

  const planner = new LATSPlanner(taskDescription, cfg);
  const bestNode = await planner.run();

  if (bestNode.steps.length === 0) {
    // Degenerate case — return default steps
    bestNode.steps.push(...candidateStepsFor(taskDescription).slice(0, 3));
  }

  return formatPlan(taskDescription, bestNode.steps, cfg.format);
}

function formatPlan(task: string, steps: string[], format: PlanFormat): string {
  const header = `Task: ${task}`;
  switch (format) {
    case 'json':
      return JSON.stringify({
        task,
        steps,
        estimatedSteps: steps.length,
        generatedBy: 'LATS (arXiv:2310.04406)',
      }, null, 2);

    case 'markdown':
      return [
        header,
        '',
        '## Plan (LATS)',
        ...steps.map(s => `- ${s}`),
      ].join('\n');

    case 'numbered-list':
    default:
      return [
        header,
        '',
        ...steps.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n');
  }
}
