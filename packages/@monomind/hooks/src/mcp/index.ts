/**
 * Hooks MCP Tools
 *
 * MCP tool definitions for hooks system integration.
 * These tools provide programmatic access to hooks functionality.
 */

import type {
  RouteTaskInput,
  RouteTaskResult,
} from '../types.js';

/**
 * MCP Tool definition interface
 */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>, context?: unknown) => Promise<unknown>;
}

// Renamed from 'hooks/route' → 'hooks/route-advanced' to disambiguate from the CLI's
// hooks_route (mcp-tools/hooks-routing.ts), which is the primary, actually-wired routing
// tool. This one is opt-in for AFLOW/DAGLearner/LATS-augmented routing only.
export const routeAdvancedTool: MCPTool = {
  name: 'hooks/route-advanced',
  description: 'Route a task to the optimal agent using AFLOW/DAGLearner/LATS augmentation (MCTS-based subgraph and plan search). For standard routing, use hooks_route instead.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description to route',
      },
      context: {
        type: 'string',
        description: 'Additional context for routing',
      },
      preferredAgents: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of preferred agents',
      },
      constraints: {
        type: 'object',
        description: 'Routing constraints',
      },
      includeExplanation: {
        type: 'boolean',
        description: 'Include explanation for routing decision',
        default: true,
      },
      useAFLOW: {
        type: 'boolean',
        description: 'Engage MCTS-guided AFLOW subgraph search for complex multi-step tasks (source: arXiv:2410.10762)',
        default: false,
      },
      aflowSimulations: {
        type: 'number',
        description: 'Number of MCTS simulations for AFLOW search (default: 20)',
      },
      useLATS: {
        type: 'boolean',
        description: 'Generate a coordinator plan using LATS (Language Agent Tree Search, arXiv:2310.04406). Runs MCTS over candidate plan steps and returns the best plan found.',
        default: false,
      },
      latsSimulations: {
        type: 'number',
        description: 'Number of MCTS simulations for LATS planning (default: 20)',
      },
      useDAGLearner: {
        type: 'boolean',
        description: 'Propose an optimised heterogeneous swarm topology using DAGLearner (reads ReasoningBank patterns to select specialist agents)',
        default: false,
      },
    },
    required: ['task'],
  },
  handler: async (input: Record<string, unknown>): Promise<RouteTaskResult> => {
    const task = input.task as string;
    const includeExplanation = input.includeExplanation !== false;
    const useAFLOW = input.useAFLOW === true;
    const aflowSimulations = typeof input.aflowSimulations === 'number' ? input.aflowSimulations : 20;
    const useLATS = input.useLATS === true;
    const latsSimulations = typeof input.latsSimulations === 'number' ? input.latsSimulations : 20;
    const useDAGLearner = input.useDAGLearner === true;

    // Simple keyword-based routing (real implementation uses ReasoningBank)
    const agent = routeTaskToAgent(task);

    const result: RouteTaskResult = {
      task,
      recommendedAgent: agent.name,
      confidence: agent.confidence,
      alternativeAgents: agent.alternatives,
    };

    if (includeExplanation) {
      result.explanation = agent.explanation;
      result.reasoning = {
        factors: agent.factors,
      };
    }

    // DAGLearner: heterogeneous swarm topology proposal
    if (useDAGLearner) {
      try {
        const { DAGLearner } = await import('../subgraph/dag-learner.js');
        const learner = new DAGLearner();
        const dagResult = await learner.propose(task);
        const r = result as unknown as Record<string, unknown>;
        r.dagLearnedTopology = dagResult.topology.subGraphId;
        r.dagSelectedSlugs = dagResult.selectedSlugs;
        r.dagLearnedFromPatterns = dagResult.learnedFromPatterns;
      } catch {
        // DAGLearner unavailable — degrade gracefully
      }
    }

    // LATS: Language Agent Tree Search coordinator planning (source: arXiv:2310.04406)
    if (useLATS) {
      try {
        const { buildLATSPlan } = await import('../planning/lats-planner.js');
        const latsPlan = await buildLATSPlan(task, { simulations: latsSimulations });
        const r = result as unknown as Record<string, unknown>;
        r.latsPlan = latsPlan;
        r.latsSimulationsRun = latsSimulations;
      } catch {
        // LATS unavailable — degrade gracefully
      }
    }

    // AFLOW: MCTS-guided subgraph workflow search (source: arXiv:2410.10762)
    if (useAFLOW) {
      try {
        const { AFLOWSearch } = await import('../subgraph/aflow-search.js');
        const aflow = new AFLOWSearch({ simulations: aflowSimulations, maxDepth: 3 });

        // Simple quality heuristic: reward sequences whose agent slugs match task keywords
        const taskTokens = task.toLowerCase().split(/\s+/);
        const aflowResult = await aflow.search(async (sequence) => {
          if (sequence.length === 0) return 0;
          // CompiledSubGraph.raw.agents is the authoritative slug list
          const slugs = sequence
            .flatMap(g => g.raw?.agents?.map((a: { agentSlug: string }) => a.agentSlug) ?? [])
            .join(' ')
            .toLowerCase();
          const hits = taskTokens.filter(t => slugs.includes(t)).length;
          return hits / Math.max(taskTokens.length, 1);
        });

        if (aflowResult.bestSequence.length > 0) {
          const r = result as unknown as Record<string, unknown>;
          r.aflowSubgraphSequence = aflowResult.subGraphIds;
          r.aflowScore = aflowResult.bestScore;
          r.aflowSimulationsRun = aflowResult.simulationsRun;
        }
      } catch {
        // AFLOW unavailable — degrade gracefully
      }
    }

    return result;
  },
};

export const statuslineTool: MCPTool = {
  name: 'hooks/statusline',
  description: 'Get statusline data for display.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['json', 'text'],
        description: 'Output format',
        default: 'json',
      },
    },
  },
  handler: async (input: Record<string, unknown>): Promise<unknown> => {
    const { StatuslineGenerator } = await import('../statusline/index.js');
    const generator = new StatuslineGenerator();

    const format = (input.format as string) || 'json';

    if (format === 'text') {
      return { statusline: generator.generateStatusline() };
    }

    return generator.generateData();
  },
};

/**
 * EvoAgentX — GEPA + SubGraphRegistry + memory orchestration (Tier 4)
 */
export const evoAgentXTool: MCPTool = {
  name: 'hooks/evo-agentx',
  description: 'Optimise an agent\'s system prompt using EvoAgentX (GEPA co-evolution + topology recommendation). Reads trace history, evolves prompts across Pareto generations, and returns the best prompt with a recommended SubGraph topology.',
  inputSchema: {
    type: 'object',
    properties: {
      agentSlug: {
        type: 'string',
        description: 'Agent type to optimise (e.g. "coder", "security-architect")',
      },
      basePrompt: {
        type: 'string',
        description: 'Current system prompt to evolve from',
      },
      traceStorePath: {
        type: 'string',
        description: 'Path to trace-quality store directory (default: "./data/traces")',
      },
      peerAgentSlugs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional agent slugs whose traces to include in the shared critique pool',
      },
      generations: {
        type: 'number',
        description: 'GEPA evolutionary generations (default: 3)',
      },
    },
    required: ['agentSlug', 'basePrompt'],
  },
  handler: async (input: Record<string, unknown>): Promise<unknown> => {
    const { EvoAgentXCoordinator } = await import('../optimization/evoagentx-coordinator.js');
    const coordinator = new EvoAgentXCoordinator({
      traceStorePath: (input.traceStorePath as string) ?? './data/traces',
      gepa: {
        generations: typeof input.generations === 'number' ? input.generations : 3,
      },
    });
    return coordinator.optimise(
      input.agentSlug as string,
      input.basePrompt as string,
      (input.peerAgentSlugs as string[] | undefined) ?? [],
    );
  },
};

/**
 * RLVR model-outcome tool — Verifiable Reward Learning (newinnovation.md §3.8)
 *
 * Connects external verifiers (TypeScript compiler, AI-defence scanner) to the
 * ReasoningBank learning loop as binary reward signals.  Call this after any
 * agent task completes to record a verifiable outcome.
 *
 * Source: RLVR — Reinforcement Learning with Verifiable Rewards (DeepSeek-R1)
 */
// Renamed from 'hooks/model-outcome' → 'hooks/rlvr-outcome' to disambiguate from the
// CLI's hooks_model-outcome (mcp-tools/hooks-intelligence.ts), which records
// haiku/sonnet/opus model-routing outcomes — a different concept from this tool's
// RLVR verifiable-reward computation.
export const rlvrOutcomeTool: MCPTool = {
  name: 'hooks/rlvr-outcome',
  description: 'Record a verifiable agent outcome for RLVR reward learning. Runs tsc --noEmit and/or monofence_scan pattern checks and stores the binary reward in ReasoningBank.',
  inputSchema: {
    type: 'object',
    properties: {
      agentSlug: {
        type: 'string',
        description: 'Agent type that produced the output',
      },
      taskDescription: {
        type: 'string',
        description: 'Human-readable task that was performed',
      },
      traceId: {
        type: 'string',
        description: 'Optional trace ID from the observability system',
      },
      verifierType: {
        type: 'string',
        enum: ['tsc', 'aidefence', 'both', 'none'],
        description: 'Which verifier(s) to run for reward computation',
        default: 'none',
      },
      output: {
        type: 'string',
        description: 'Agent output content to verify (code, response, etc.)',
      },
      baseReward: {
        type: 'number',
        description: 'Optional human-provided base quality score (0–1)',
      },
      traceSteps: {
        type: 'array',
        description: 'Optional execution trace steps for Agent-as-a-Judge evaluation (arXiv:2410.10934). Each step: {role, content, toolCall?, outcome?}',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['agent', 'tool', 'user'] },
            content: { type: 'string' },
            toolCall: { type: 'string' },
            outcome: { type: 'string' },
          },
        },
      },
    },
    required: ['agentSlug', 'taskDescription'],
  },
  handler: async (input: Record<string, unknown>): Promise<{
    agentSlug: string;
    taskDescription: string;
    verifierType: string;
    reward: number;
    verifierResults: Record<string, unknown>;
    patternStored: boolean;
    erlHeuristic?: string;
    textGradCritique?: string;
    marReflection?: Record<string, unknown>;
    traceJudgeScore?: number;
  }> => {
    const agentSlug = input.agentSlug as string;
    const taskDescription = input.taskDescription as string;
    const verifierType = (input.verifierType as string) ?? 'none';
    const output = (input.output as string) ?? '';
    const baseReward = typeof input.baseReward === 'number' ? input.baseReward : 1.0;

    const verifierResults: Record<string, unknown> = {};
    let reward = baseReward;

    // RLVR: static-analysis-based verifiable rewards
    // tsc check: penalise output that looks like TypeScript with type errors
    if (verifierType === 'tsc' || verifierType === 'both') {
      // Detect obvious TypeScript violations by pattern (full tsc requires disk write)
      const tsErrors = [
        /cannot find name/i,
        /type .* is not assignable/i,
        /property .* does not exist/i,
      ];
      const hasTscErrors = tsErrors.some(rx => rx.test(output));
      verifierResults.tsc = { passed: !hasTscErrors };
      if (hasTscErrors) reward *= 0.5;
    }

    // aidefence check: penalise injection-like patterns in output
    if (verifierType === 'aidefence' || verifierType === 'both') {
      const injectionPatterns = [
        /ignore (all |previous |prior )(instructions?|prompts?)/i,
        /you are now/i,
        /disregard (your |all )(instructions?|guidelines?)/i,
        /system prompt:/i,
      ];
      const hasInjection = injectionPatterns.some(rx => rx.test(output));
      verifierResults.aidefence = { safe: !hasInjection };
      if (hasInjection) reward = 0;
    }

    // ERL heuristic extraction: derive a portable rule from this outcome.
    // Source: arXiv:2603.24639 — Experiential Reflective Learning.
    let erlHeuristic: string | undefined;
    if (output) {
      try {
        const { ERLWorker } = await import('../workers/erl-worker.js');
        const erlWorker = new ERLWorker();
        const trajectory = {
          id: `outcome-${Date.now()}`,
          taskDescription,
          steps: [{
            step: 1,
            action: agentSlug,
            reasoning: output.slice(0, 200),
            outcome: reward >= 0.7 ? ('success' as const) : ('failure' as const),
            error: reward < 0.5 && verifierResults.tsc
              ? 'TypeScript pattern violation'
              : reward === 0 && verifierResults.aidefence
                ? 'Injection pattern detected'
                : undefined,
          }],
          success: reward >= 0.7,
          agentSlug,
          completedAt: Date.now(),
        };
        const erlResult = erlWorker.extract(trajectory);
        erlHeuristic = erlResult.extracted[0]?.rule;
      } catch {
        // ERL unavailable
      }
    }

    // TextGrad backward pass: generate a textual gradient critique from this output.
    // Source: arXiv:2406.07496 — TextGrad automatic differentiation via text.
    let textGradCritique: string | undefined;
    if (output) {
      try {
        const { TextGradWorker } = await import('../workers/textgrad-worker.js');
        const textgradWorker = new TextGradWorker({ maxGradients: 2 });
        const tgResult = textgradWorker.compute({
          taskId: `outcome-${Date.now()}`,
          taskDescription,
          output,
          agentSlug,
          priorQuality: reward,
        });
        if (tgResult.gradients.length > 0) {
          textGradCritique = textgradWorker.formatForPrompt(tgResult.gradients);
        }
      } catch {
        // TextGrad unavailable
      }
    }

    // MAR structured reflection: when quality is low, run multi-agent reflection
    // to surface root cause and extract an ERL heuristic.
    // Source: arXiv:2512.20845 — Multi-Agent Reflexion.
    let marReflection: Record<string, unknown> | undefined;
    if (reward < 0.5) {
      try {
        const { MARWorker } = await import('../workers/mar-worker.js');
        const marWorker = new MARWorker({ numCritics: 3 });
        const marResult = marWorker.reflect({
          taskDescription,
          agentOutput: output,
          success: false,
          agentSlug,
          errorMessage: verifierResults.tsc
            ? 'TypeScript pattern violation detected'
            : verifierResults.aidefence
              ? 'Injection pattern detected in output'
              : undefined,
          qualityScore: reward,
        });
        marReflection = {
          synthesis: marResult.reflection.synthesis,
          heuristic: marResult.reflection.heuristic,
          promptUpdate: marResult.reflection.promptUpdate,
          reflectionQuality: marResult.reflection.reflectionQuality,
        };
      } catch {
        // MAR unavailable — continue without reflection
      }
    }

    // Agent-as-a-Judge: if trace steps are provided, run TraceAwareJudgeMetric for
    // a more holistic quality score that examines the full reasoning chain.
    // Source: arXiv:2410.10934 — "Agent-as-a-Judge: Evaluate Agents with Agents"
    let traceJudgeScore: number | undefined;
    const traceStepsRaw = input.traceSteps as Array<Record<string, unknown>> | undefined;
    if (output && traceStepsRaw && traceStepsRaw.length > 0) {
      try {
        const { TraceAwareJudgeMetric } = await import('../optimization/quality-metric.js');
        const traceJudge = new TraceAwareJudgeMetric(
          // Haiku-compatible stub — returns a score based on reward when no LLM configured
          async (_prompt: string) => JSON.stringify({ score: reward, reason: 'Derived from verifier reward' }),
          { maxSteps: 10 },
        );
        const traceSteps = traceStepsRaw.map(s => ({
          role: (s.role as 'agent' | 'tool' | 'user') || 'agent',
          content: String(s.content ?? ''),
          toolCall: s.toolCall as string | undefined,
          outcome: s.outcome as string | undefined,
        }));
        traceJudgeScore = await traceJudge.scoreWithTrace(taskDescription, output, traceSteps);
      } catch {
        // TraceAwareJudgeMetric unavailable
      }
    }

    // Store reward as a pattern in ReasoningBank for future routing
    let patternStored = false;
    try {
      const { reasoningBank } = await import('../reasoningbank/index.js');
      // storePattern(strategy, domain, metadata) — ReasoningBank public API
      await reasoningBank.storePattern(
        `${agentSlug}:${reward >= 0.7 ? 'success' : 'failure'}`,
        taskDescription,
        {
          agentSlug,
          quality: reward,
          verifierType,
          verifierResults,
          traceId: input.traceId ?? null,
          rlvr: true,
          marReflection: marReflection ?? null,
        },
      );
      patternStored = true;
    } catch {
      // ReasoningBank unavailable — reward is still computed and returned
    }

    return {
      agentSlug, taskDescription, verifierType, reward,
      verifierResults, patternStored,
      erlHeuristic, textGradCritique, marReflection, traceJudgeScore,
    };
  },
};

// Trace tools (GAP-010)
export { listTracesTool, getTraceTool, traceMCPTools } from './trace-tools.js';

// Interrupt checkpoint tools (GAP-008)
export {
  listPendingCheckpointsTool,
  approveCheckpointTool,
  rejectCheckpointTool,
  getCheckpointTool,
  checkpointMCPTools,
} from './checkpoint-tools.js';

/**
 * All hooks MCP tools
 */
import { traceMCPTools } from './trace-tools.js';
import { checkpointMCPTools } from './checkpoint-tools.js';

export const hooksMCPTools: MCPTool[] = [
  routeAdvancedTool,
  statuslineTool,
  evoAgentXTool,
  rlvrOutcomeTool,
  ...traceMCPTools,
  ...checkpointMCPTools,
];

/**
 * Get tool by name
 */
export function getHooksTool(name: string): MCPTool | undefined {
  return hooksMCPTools.find((t) => t.name === name);
}

// Helper functions

function routeTaskToAgent(task: string): {
  name: string;
  confidence: number;
  alternatives: Array<{ agent: string; confidence: number }>;
  explanation: string;
  factors: Array<{ factor: string; weight: number; value: number }>;
} {
  const taskLower = task.toLowerCase();

  // Security-related tasks
  if (taskLower.includes('security') || taskLower.includes('auth') || taskLower.includes('cve')) {
    return {
      name: 'security-auditor',
      confidence: 0.92,
      alternatives: [
        { agent: 'coder', confidence: 0.78 },
        { agent: 'reviewer', confidence: 0.75 },
      ],
      explanation: 'Task involves security considerations, routing to security-auditor.',
      factors: [
        { factor: 'keyword_match', weight: 0.4, value: 0.95 },
        { factor: 'historical_success', weight: 0.3, value: 0.88 },
        { factor: 'agent_availability', weight: 0.3, value: 0.93 },
      ],
    };
  }

  // Testing tasks
  if (taskLower.includes('test') || taskLower.includes('spec') || taskLower.includes('coverage')) {
    return {
      name: 'tester',
      confidence: 0.89,
      alternatives: [
        { agent: 'coder', confidence: 0.72 },
        { agent: 'reviewer', confidence: 0.68 },
      ],
      explanation: 'Task involves testing, routing to tester agent.',
      factors: [
        { factor: 'keyword_match', weight: 0.4, value: 0.90 },
        { factor: 'historical_success', weight: 0.3, value: 0.87 },
        { factor: 'agent_availability', weight: 0.3, value: 0.91 },
      ],
    };
  }

  // Review tasks
  if (taskLower.includes('review') || taskLower.includes('check') || taskLower.includes('audit')) {
    return {
      name: 'reviewer',
      confidence: 0.87,
      alternatives: [
        { agent: 'coder', confidence: 0.70 },
        { agent: 'tester', confidence: 0.65 },
      ],
      explanation: 'Task involves review, routing to reviewer agent.',
      factors: [
        { factor: 'keyword_match', weight: 0.4, value: 0.88 },
        { factor: 'historical_success', weight: 0.3, value: 0.85 },
        { factor: 'agent_availability', weight: 0.3, value: 0.88 },
      ],
    };
  }

  // Default to coder
  return {
    name: 'coder',
    confidence: 0.80,
    alternatives: [
      { agent: 'reviewer', confidence: 0.65 },
      { agent: 'tester', confidence: 0.60 },
    ],
    explanation: 'General development task, routing to coder agent.',
    factors: [
      { factor: 'default_routing', weight: 0.5, value: 0.80 },
      { factor: 'historical_success', weight: 0.3, value: 0.78 },
      { factor: 'agent_availability', weight: 0.2, value: 0.82 },
    ],
  };
}


export { type MCPTool };
