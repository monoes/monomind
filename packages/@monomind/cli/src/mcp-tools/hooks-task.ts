/**
 * Hooks MCP Tools — pre-task and post-task.
 * Extracted from hooks-routing.ts.
 */

import { deriveRecentSuccess } from '../monovector/command-outcomes.js';
import { joinLatestUnresolved, joinOutcome } from '../monovector/route-outcomes.js';
import { pickAgents } from '../routing/agent-pick.js';
import { validateMcpString } from '../utils/input-guards.js';
import {
  extractKeywords,
  getRealSearchFunction,
  getRealStoreFunction,
  getRouteOutcomesBaseDir,
  loadRoutingOutcomes,
  saveRoutingOutcomes,
} from './hooks-embedding.js';
import { estimatedDuration, taskComplexity } from './hooks-route.js';
import type { MCPTool } from './types.js';

export const hooksPreTask: MCPTool = {
  name: 'hooks_pre-task',
  description:
    'Record task start and get agent suggestions with intelligent model routing (ADR-026)',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task identifier' },
      description: { type: 'string', description: 'Task description' },
      filePath: { type: 'string', description: 'Optional file path for AST analysis' },
    },
    required: ['taskId', 'description'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap taskId: it is used as a suffix in SQLite memory keys (heuristic:${taskId},
    // routing-decision:${taskId}, textual_gradient:${taskId}) and as sourceId/targetId
    // in causal-graph edges persisted to SQLite. An uncapped ID can inflate the DB key
    // column and every JSON payload that includes the ID.
    const MAX_TASK_ID_LEN = 256;
    const taskId = validateMcpString(params.taskId, 'taskId', MAX_TASK_ID_LEN);
    if (!taskId) {
      return { error: 'taskId is required (non-empty string, no control chars, max 256 chars)' };
    }
    // Cap description: it is forwarded to generateEmbedding twice (ERL heuristics
    // + TextGrad gradient queries) and used in O(n) keyword extraction.
    // 16 KB matches the cap applied in hooks_route and hooksPatternSearch.
    const MAX_PRE_TASK_DESC_LEN = 16 * 1024;
    const description = validateMcpString(params.description, 'description', MAX_PRE_TASK_DESC_LEN);
    if (!description) {
      return { error: 'description is required (non-empty string, no control chars, max 16KB)' };
    }
    validateMcpString(params.filePath, 'filePath', 4 * 1024) ?? undefined;
    const suggestion = await pickAgents(description, 3);
    const complexity = taskComplexity(description);

    // Enhanced model routing module was never shipped — modelRouting stays undefined.
    const modelRouting: Record<string, unknown> | undefined = undefined;

    // ERL: Retrieve past heuristics to inject into recommendations
    // Source: https://arxiv.org/abs/2603.24639
    const erlHints: string[] = [];
    try {
      const searchFn = await getRealSearchFunction();
      if (searchFn) {
        const heuristicResults = await searchFn({
          query: description,
          namespace: 'heuristics',
          limit: 3,
          threshold: 0.6,
        });
        for (const r of heuristicResults?.results ?? []) {
          try {
            const h = JSON.parse(r.content ?? '{}') as {
              condition?: string;
              action?: string;
              confidence?: number;
            };
            if (h.action && h.confidence !== undefined && h.confidence >= 0.6) {
              erlHints.push(
                `ERL hint (conf=${h.confidence.toFixed(2)}): use "${h.action}" for tasks involving "${h.condition ?? 'similar context'}"`,
              );
            }
          } catch {
            /* skip malformed */
          }
        }

        // TextGrad: also inject relevant past failure gradients to guide away from known pitfalls
        // Source: https://arxiv.org/abs/2406.07496
        const gradientResults = await searchFn({
          query: description,
          namespace: 'gradients',
          limit: 2,
          threshold: 0.55,
        });
        for (const r of gradientResults?.results ?? []) {
          const critique = r.content ?? '';
          if (critique && critique.length > 10) {
            erlHints.push(`TextGrad warning: ${critique.slice(0, 120)}`);
          }
        }
      }
    } catch {
      /* non-critical */
    }

    // NOTE: a LATS planning pass used to be attempted here via
    // `import('@monoes/hooks').buildLATSPlan` — that function never existed
    // in the package (the planning module was removed), so the import failed
    // silently on every call. The dead block was removed.
    let plan: string | undefined;

    // P2-15: Retrieve Reflexion reflections for this task — past failures
    // on similar tasks are injected as recommendations so the agent avoids
    // repeating mistakes. Keyword match only — no model is involved.
    let reflexionWarnings: string[] = [];
    try {
      const hooksPkg = await import('@monoes/hooks').catch(() => null);
      const fn = (hooksPkg as Record<string, unknown> | null)?.getReflectionsForTask;
      if (typeof fn === 'function') {
        const cwd = process.cwd();
        const reflections = await (
          fn as (
            root: string,
            desc: string,
            limit?: number,
          ) => Promise<Array<{ reflection: string }>>
        )(cwd, description, 3);
        reflexionWarnings = reflections.map((r) => `⚠ Past failure: ${r.reflection.slice(0, 200)}`);
      }
    } catch {
      /* non-critical — reflexion store may not exist yet */
    }

    return {
      taskId,
      description,
      suggestedAgents: suggestion.agents,
      confident: suggestion.confident,
      complexity,
      estimatedDuration: estimatedDuration(complexity),
      risks: complexity === 'high' ? ['Complex task may require multiple iterations'] : [],
      recommendations: [
        suggestion.confident
          ? `Use ${suggestion.agents[0].type} as primary agent`
          : 'No confident agent match (monomind pick); choose the agent yourself',
        suggestion.agents.length > 2
          ? 'Consider using swarm coordination'
          : 'Single agent recommended',
        ...erlHints,
        ...reflexionWarnings,
      ],
      modelRouting,
      plan,
      timestamp: new Date().toISOString(),
    };
  },
};

/** Provenance ref for the causal edge this hook writes.
 *
 *  Every post-task hook used to ingest under the bare string
 *  `hooks-post-task`, so a graph rollback aimed at one bad task withdrew the
 *  causal record of every task the hook had ever seen, and there was no ref
 *  that named a single one. Keying on the task id makes the ref unique per
 *  operation and stable for it: re-running post-task for the same task
 *  re-asserts the same support rather than minting a second one. */
export function postTaskOriginRef(taskId: string): string {
  return `hooks-post-task:${taskId}`;
}

export const hooksPostTask: MCPTool = {
  name: 'hooks_post-task',
  description: 'Record a task outcome against its routed agent',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task identifier' },
      success: { type: 'boolean', description: 'Whether task was successful' },
      agent: { type: 'string', description: 'Agent that completed the task' },
      quality: { type: 'number', description: 'Quality score (0-1)' },
      task: {
        type: 'string',
        description: 'Task description text (used for learning keyword extraction)',
      },
      storeDecisions: { type: 'boolean', description: 'Also store routing decision in memory DB' },
      routeId: {
        type: 'string',
        description:
          'Route ID from a prior hooks_route call — joins the recommendation to this outcome',
      },
    },
    required: ['taskId'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap taskId for the same reason as hooks_pre_task: it flows into SQLite memory keys
    // (heuristic:${taskId}, routing-decision:${taskId}, textual_gradient:${taskId}) and
    // into causal-graph edge IDs persisted to the DB.  Without a cap an attacker can
    // inflate every row that stores the raw ID.
    const MAX_POST_TASK_ID_LEN = 256;
    const taskId = validateMcpString(params.taskId, 'taskId', MAX_POST_TASK_ID_LEN);
    if (!taskId) {
      return { error: 'taskId is required (non-empty string, no control chars, max 256 chars)' };
    }
    // The success flag, when the caller asserts it (--success true), is taken as
    // ground truth. But callers usually do NOT pass it. Rather than treating every
    // unverified task as "unknown" (and thus excluding it from learning), we now
    // derive a MEASURED success signal from the real command exit codes recorded by
    // post-command within a recent time window. post-command appends each exit code
    // to the command-outcome store keyed by timestamp; deriveRecentSuccess returns:
    //   true  → recent commands exist and the LAST command exited 0 (final-state heuristic)
    //   false → recent commands exist and the LAST command exited non-zero
    //   null  → no recent commands (genuinely no signal → stays unknown)
    // Note: "final-state" not "all must pass" — intermediate failures (e.g. grep no-match,
    // test-then-fix cycles) are intentionally ignored; the last exit code decides.
    // Precedence: an explicit --success ALWAYS wins; the derived signal only fills
    // in when no explicit flag is given; only when there is also no recent command
    // signal does the outcome stay unknown (and excluded from SONA + route join,
    // per the existing "unknown ≠ success" principle).
    const explicitSuccess = typeof params.success === 'boolean';
    let outcomeKnown = explicitSuccess;
    let success = params.success !== false;
    let successSource: 'explicit' | 'derived-commands' | 'unknown' = explicitSuccess
      ? 'explicit'
      : 'unknown';

    if (!explicitSuccess) {
      const derived = await deriveRecentSuccess(getRouteOutcomesBaseDir());
      if (derived !== null) {
        outcomeKnown = true;
        success = derived;
        successSource = 'derived-commands';
      }
    }
    // Cap agent: forwarded to bridgeRecordFeedback where it is stored in the
    // feedback record and used as a tag string in the JSON store.  An uncapped
    // agent value inflates the on-disk store entry.
    const MAX_POST_TASK_AGENT_LEN = 256;
    const agent = validateMcpString(params.agent, 'agent', MAX_POST_TASK_AGENT_LEN) ?? undefined;
    const quality =
      typeof params.quality === 'number' && Number.isFinite(params.quality)
        ? Math.max(0, Math.min(1, params.quality as number))
        : success
          ? 0.85
          : 0.3;
    const startTime = Date.now();
    // Cap task description: passed to generateEmbedding via bridgeRecordFeedback
    // and persisted to route-outcomes.jsonl.  16 KB matches hooks_route cap.
    const MAX_POST_TASK_LEN = 16 * 1024;
    const cappedPostTask = validateMcpString(params.task, 'task', MAX_POST_TASK_LEN) ?? undefined;

    // Phase 3: Wire recordFeedback through bridge → LearningSystem + ReasoningBank
    let feedbackResult: { success: boolean; id?: string; error?: string } | null = null;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      feedbackResult = await bridge.bridgeRecordFeedback({
        taskType: agent ?? 'task',
        action: cappedPostTask?.slice(0, 80) ?? taskId,
        outcome: success ? 'success' : outcomeKnown ? 'failure' : 'partial',
        confidence: quality,
        metadata: {
          taskId,
          duration:
            typeof params.duration === 'number' && Number.isFinite(params.duration)
              ? params.duration
              : undefined,
          patterns: Array.isArray(params.patterns)
            ? (params.patterns as unknown[])
                .filter(
                  (p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 200,
                )
                .slice(0, 50)
            : undefined,
        },
      });
    } catch (e) {
      // Bridge not available — continue with basic response
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-post-task] memory bridge feedback failed:', e);
    }

    // Phase 3: Record causal edge (task → outcome) as a real, traversable
    // knowledge-graph edge (via memory_kg_ingest — same path as the
    // memory_causal-edge MCP tool), not the opaque write-only `causal:` bridge namespace.
    try {
      const kg = await import('../memory/memory-kg.js');
      const outcomeId = `outcome-${taskId}`;
      await kg.kgIngest({
        nodes: [{ name: taskId }, { name: outcomeId }],
        edges: [
          {
            source: taskId,
            target: outcomeId,
            relation: success ? 'succeeded' : 'failed',
          },
        ],
        originRef: postTaskOriginRef(taskId),
      });
    } catch (e) {
      // Non-fatal
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-post-task] causal edge record failed:', e);
    }

    // Persist routing outcome for runtime learning (file-based, always reliable).
    // B1.3: also gate this sibling learning sink on a known outcome — an unverified
    // task must not train the router as a success either. When the caller did not
    // assert success, the outcome is unknown and we skip persisting a labeled sample.
    const taskText = cappedPostTask || '';
    const outcomeKeywords = extractKeywords(taskText);
    let outcomePersisted = false;
    if (
      outcomeKnown &&
      taskText &&
      agent &&
      agent.length <= 100 &&
      /^[a-zA-Z0-9_-]+$/.test(agent)
    ) {
      try {
        const outcomes = loadRoutingOutcomes();
        outcomes.push({
          task: taskText,
          agent,
          success,
          quality,
          keywords: outcomeKeywords,
          timestamp: new Date().toISOString(),
        });
        outcomePersisted = saveRoutingOutcomes(outcomes);
      } catch {
        /* non-critical */
      }
    }

    // Join this outcome back onto the original route recommendation. This is the
    // recommendation→actual→success link that routing-accuracy metrics and SONA
    // labels depend on. When the caller threads an explicit routeId we join that
    // record; otherwise we auto-correlate to the most recent unresolved route
    // (within a 10-min window) so the loop closes without the LLM manually
    // threading the routeId. Only join when the outcome is actually measured —
    // per "unknown ≠ success", an unverified task must not pollute the metric.
    if (outcomeKnown) {
      const outcome = {
        agentActuallyUsed: agent,
        measuredSuccess: success,
        quality: typeof params.quality === 'number' ? (params.quality as number) : undefined,
      };
      if (params.routeId) {
        const routeId = validateMcpString(params.routeId, 'routeId', 256);
        if (routeId) {
          await joinOutcome(getRouteOutcomesBaseDir(), routeId, outcome);
        }
      } else {
        await joinLatestUnresolved(getRouteOutcomesBaseDir(), outcome);
      }
    }

    // ERL: Extract and persist structured heuristic for future pre-task injection
    // Source: https://arxiv.org/abs/2603.24639
    if (taskText && agent && success !== undefined) {
      try {
        const storeFn = await getRealStoreFunction();
        if (storeFn) {
          const heuristic = {
            condition: outcomeKeywords.slice(0, 3).join(', ') || taskText.slice(0, 60),
            action: agent,
            confidence: success ? (quality ?? 0.8) : 0.2,
          };
          await storeFn({
            key: `heuristic:${taskId}`,
            value: JSON.stringify(heuristic),
            namespace: 'heuristics',
            tags: ['erl', agent, success ? 'success' : 'failure'],
          });
        }
      } catch {
        /* non-critical */
      }
    }

    // Optionally store in memory DB for cross-session vector retrieval
    if (params.storeDecisions && taskText && agent) {
      try {
        const storeFn = await getRealStoreFunction();
        if (storeFn) {
          await storeFn({
            key: `routing-decision:${taskId}`,
            namespace: 'patterns',
            value: JSON.stringify({
              task: taskText,
              agent,
              success,
              quality,
              keywords: outcomeKeywords,
            }),
            tags: ['routing-decision'],
          });
        }
      } catch {
        /* non-critical */
      }
    }

    const duration = Date.now() - startTime;

    // TextGrad: Store textual gradient critique for failed tasks
    // Source: https://arxiv.org/abs/2406.07496 (TextGrad — Nature)
    if (!success && taskText) {
      try {
        const storeFn = await getRealStoreFunction();
        if (storeFn) {
          const critique =
            `Task "${taskText.slice(0, 80)}" failed with agent "${agent}". ` +
            `Quality score: ${quality ?? 'unknown'}. ` +
            `Improvement direction: review agent selection, consider more capable agent or task decomposition.`;
          await storeFn({
            key: `textual_gradient:${taskId}`,
            value: critique,
            namespace: 'gradients',
            tags: ['textual_gradient', agent ?? 'unknown', 'failure'],
          });
        }
      } catch {
        /* non-critical */
      }
    }

    // MAR: Structured multi-agent reflection on failure
    // Source: https://arxiv.org/html/2512.20845 (MAR — December 2025)
    const marReflection = !success
      ? {
          needed: true,
          suggestedAgents: [
            { role: 'diagnoser', description: 'Analyze root cause of task failure' },
            { role: 'critic-1', description: 'Critique from correctness angle (temperature 0.3)' },
            { role: 'critic-2', description: 'Critique from efficiency angle (temperature 0.8)' },
            {
              role: 'aggregator',
              description: 'Synthesize critiques into actionable reflection heuristic',
            },
          ],
          storeAs: 'heuristics',
          note: 'Spawn agents sequentially: Diagnoser → Critics in parallel → Aggregator',
        }
      : { needed: false };

    return {
      taskId,
      success,
      outcomeKnown,
      successSource,
      duration,
      learningUpdates: {
        controller: feedbackResult?.success ? 'sqlite' : 'none',
        outcomePersisted,
      },
      quality,
      feedback: feedbackResult
        ? {
            recorded: feedbackResult.success,
            controller: feedbackResult.success ? 'sqlite' : 'unavailable',
            updates: feedbackResult.success ? 1 : 0,
          }
        : { recorded: false, controller: 'unavailable', updates: 0 },
      marReflection,
      timestamp: new Date().toISOString(),
    };
  },
};
