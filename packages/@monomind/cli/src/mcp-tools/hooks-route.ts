/**
 * Hooks MCP Tools — route, route_semantic and explain.
 * Extracted from hooks-routing.ts.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { recordRoute } from '../monovector/route-outcomes.js';
import { pickAgents } from '../routing/agent-pick.js';
import { validateMcpString } from '../utils/input-guards.js';
import { getRouteOutcomesBaseDir, getRoutingOutcomesPath } from './hooks-embedding.js';
import type { MCPTool } from './types.js';

/** Rough effort band from task wording — shared by hooks_route and hooks_pre-task. */
export function taskComplexity(task: string): 'low' | 'medium' | 'high' {
  const lower = task.toLowerCase();
  if (lower.includes('complex') || lower.includes('architecture') || task.length > 200) {
    return 'high';
  }
  if (lower.includes('simple') || lower.includes('fix') || task.length < 50) return 'low';
  return 'medium';
}

export function estimatedDuration(complexity: 'low' | 'medium' | 'high'): string {
  return complexity === 'high' ? '2-4 hours' : complexity === 'medium' ? '30-60 min' : '10-30 min';
}

export const hooksRoute: MCPTool = {
  name: 'hooks_route',
  description:
    'Route a task to the best agent — a thin wrapper over the central picker (same ranking as ' +
    'the `pick` tool and `monomind pick`). primaryAgent.type is a spawnable Task subagent_type.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      context: { type: 'string', description: 'Additional context' },
      topK: { type: 'number', description: 'Number of agents to return, 1-20 (default: 3)' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task and context lengths: task is ranked and stored in
    // route-outcomes.jsonl.  16 KB matches the cap in hooksPatternSearch.
    const MAX_ROUTE_TASK_LEN = 16 * 1024;
    const MAX_ROUTE_CTX_LEN = 4 * 1024;
    const task = validateMcpString(params.task, 'task', MAX_ROUTE_TASK_LEN);
    if (!task) {
      return { error: 'task is required (non-empty string, no control chars, max 16KB)' };
    }
    validateMcpString(params.context, 'context', MAX_ROUTE_CTX_LEN) ?? undefined;
    const topK = Math.max(1, Math.min(20, Math.trunc(Number(params.topK)) || 3));

    const started = Date.now();
    const pick = await pickAgents(task, topK);
    const routingLatencyMs = Date.now() - started;
    const [primary, ...alternatives] = pick.agents;
    const agents = pick.agents.map((a) => a.type);
    const routingMethod = pick.method;
    const complexity = taskComplexity(task);

    // Record the route recommendation so post-task can join the actual outcome
    const routeId = randomUUID();
    await recordRoute(getRouteOutcomesBaseDir(), {
      routeId,
      ts: Date.now(),
      task,
      recommendedAgent: primary.type,
      routingMethod,
      confidence: primary.confidence,
      learningMode: 'js' as const,
    });

    return {
      routeId,
      task,
      routing: {
        method: routingMethod,
        backend: pick.provider ? `jev: ${pick.provider}` : 'monomind pick',
        latencyMs: routingLatencyMs,
        throughput:
          routingLatencyMs > 0 ? `${Math.round(1000 / routingLatencyMs)} routes/s` : 'N/A',
      },
      matchedPattern: routingMethod,
      semanticMatches: [],
      // pick's verdict: act on primaryAgent only when confident is true.
      confident: pick.confident,
      summary: pick.summary,
      primaryAgent: primary,
      alternativeAgents: alternatives,
      estimatedMetrics: {
        successProbability: primary.confidence,
        estimatedDuration: estimatedDuration(complexity),
        complexity,
      },
      swarmRecommendation:
        agents.length > 2
          ? {
              topology: 'hierarchical',
              agents,
              coordination: 'queen-led',
            }
          : null,
    };
  },
};

export const hooksRouteSemantic: MCPTool = {
  name: 'hooks_route_semantic',
  description:
    'Route a task through the central picker first (the decision model, then the @monoes/routing ' +
    'keyword patterns, then a clearly leading keyword pick), and only when none decides through ' +
    'real-embedding cosine-similarity matching (isolated worker) with a headless Claude (Haiku) ' +
    'fallback below the confidence threshold. Slower than hooks_route — use for ambiguous or ' +
    'highly specialized tasks (e.g. Solidity, embedded, DevOps) where keyword matching is likely ' +
    'to under-specify the agent. agentSlug is a spawnable Task subagent_type.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      debug: {
        type: 'boolean',
        description: 'Include all route scores in the response (default: false)',
      },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    const MAX_ROUTE_TASK_LEN = 2000; // matches route-layer-factory's MAX_TASK_LENGTH
    const task = validateMcpString(params.task, 'task', MAX_ROUTE_TASK_LEN);
    const debug = params.debug === true;

    if (!task) {
      throw new Error('task is required (non-empty string, no control chars, max 2000 chars)');
    }

    const { createConfiguredRouteLayer } = await import('../routing/route-layer-factory.js');
    const layer = await createConfiguredRouteLayer({ debug });
    const result = await layer.route(task);

    const routeId = randomUUID();
    await recordRoute(getRouteOutcomesBaseDir(), {
      routeId,
      ts: Date.now(),
      task,
      recommendedAgent: result.agentSlug,
      routingMethod: `routing-pkg:${result.method}`,
      confidence: result.confidence,
      learningMode: 'js' as const,
    }).catch(() => {
      /* non-fatal — outcome joining is best-effort */
    });

    return { routeId, task, ...result };
  },
};

// Explain hook - transparent routing explanation
export const hooksExplain: MCPTool = {
  name: 'hooks_explain',
  description: 'Explain routing decision with full transparency',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      agent: { type: 'string', description: 'Specific agent to explain' },
      verbose: { type: 'boolean', description: 'Verbose explanation' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task: ranked by the central picker and
    // reflected verbatim in the response.
    const MAX_EXPLAIN_TASK_LEN = 16 * 1024;
    const task = validateMcpString(params.task, 'task', MAX_EXPLAIN_TASK_LEN);
    if (!task) {
      return { error: 'task is required (non-empty string, no control chars, max 16KB)' };
    }
    // Same pick hooks_route makes, so the explanation matches the decision.
    const pick = await pickAgents(task, 3);
    const top = pick.agents[0];
    const how =
      pick.method === 'jev'
        ? `the decision model${pick.provider ? ` (${pick.provider})` : ''} ranked the registry agents`
        : pick.method === 'keyword'
          ? 'task words were matched against registry agent names and descriptions'
          : 'no registry agent matched, so the default agent was used';
    // The patterns that matched are the agents the picker ranked.
    const matchedPatterns = pick.agents.map((a) => ({
      pattern: a.type,
      matchScore: a.confidence,
      examples: [a.reason],
    }));

    // Calculate real historical success rate from routing outcomes file
    let historicalSuccess: number | null = null;
    let historicalNote = 'No historical data yet';
    try {
      const outcomesPath = getRoutingOutcomesPath();
      if (existsSync(outcomesPath)) {
        const data = JSON.parse(readFileSync(outcomesPath, 'utf-8'));
        const outcomes: Array<{ success: boolean }> = data.outcomes || [];
        if (outcomes.length > 0) {
          historicalSuccess = outcomes.filter((o) => o.success).length / outcomes.length;
          historicalNote = `Calculated from ${outcomes.length} recorded outcomes`;
        }
      }
    } catch (e) {
      // File unreadable or corrupt; leave as null
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-explain] routing outcomes file read/parse failed:', e);
    }

    return {
      task,
      explanation:
        `The routing decision was made by the central picker: ${how}. ` +
        `"${top.type}" ranked first with ${(top.confidence * 100).toFixed(0)}% confidence` +
        (pick.confident ? '.' : ', below the pick bar (no confident match).'),
      confident: pick.confident,
      factors: [
        {
          factor: pick.method === 'jev' ? 'Decision Model' : 'Keyword Match',
          weight: 0.4,
          value: top.confidence,
          impact: 'Primary routing signal',
        },
        {
          factor: 'Historical Success',
          weight: 0.3,
          value: historicalSuccess,
          impact: historicalNote,
        },
        {
          factor: 'Agent Availability',
          weight: 0.2,
          value: null,
          impact: 'Agent availability tracking not implemented',
        },
        {
          factor: 'Task Complexity',
          weight: 0.1,
          value: task.length > 100 ? 0.8 : 0.3,
          impact: 'Complexity assessment',
        },
      ],
      patterns:
        matchedPatterns.length > 0
          ? matchedPatterns
          : [
              {
                pattern: 'general-task',
                matchScore: 0.7,
                examples: ['Default pattern for unclassified tasks'],
              },
            ],
      decision: {
        agent: top.type,
        confidence: top.confidence,
        reasoning: [
          `Ranking method: ${pick.method} — ${how}`,
          `"${top.type}" ranked first`,
          pick.agents.length > 1
            ? `Alternatives: ${pick.agents
                .slice(1)
                .map((a) => a.type)
                .join(', ')}`
            : 'No alternative agent ranked',
          historicalSuccess !== null
            ? `Historical success rate for similar tasks: ${(historicalSuccess * 100).toFixed(0)}%`
            : `No historical outcome data available yet`,
        ],
      },
    };
  },
};
