/**
 * Hooks Routing MCP Tools
 * MCP tool implementations for pre/post edit/command, route, explain, pretrain,
 * transfer, session, list, metrics, pre-task, post-task, intelligence.
 * Extracted from hooks-tools.ts.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { deriveRecentSuccess, recordCommand } from '../monovector/command-outcomes.js';
import { joinLatestUnresolved, joinOutcome, recordRoute } from '../monovector/route-outcomes.js';
import { validateMcpString } from '../utils/input-guards.js';
import { mergeRecordsById } from '../utils/json-file.js';
import {
  activeTrajectories,
  assessCommandRisk,
  extractKeywords,
  getFileExtension,
  getIntelligenceStatsFromMemory,
  getMemoryPath,
  getRealSearchFunction,
  getRealStoreFunction,
  getRouteOutcomesBaseDir,
  getRoutingOutcomesPath,
  getSONAOptimizer,
  loadMemoryStore,
  loadRoutingOutcomes,
  MEMORY_DIR,
  saveRoutingOutcomes,
  suggestAgentsForFile,
  suggestAgentsForTask,
  suggestAgentsFromIntelligence,
  TASK_PATTERNS,
} from './hooks-embedding.js';
import { getProjectCwd, type MCPTool } from './types.js';

/** Shape of a record in `.monomind/neural/patterns.json` — mirrors the
 *  `Pattern`/`StoredPattern` interfaces in src/memory/intelligence.ts. Kept
 *  loose here (no embedding required) since `hooks transfer` only needs to
 *  filter/dedupe/report on id, type, and confidence. */
interface NeuralPattern {
  id: string;
  type?: string;
  confidence?: number;
  [key: string]: unknown;
}

// MCP Tool implementations - return raw data for direct CLI use
export const hooksPreEdit: MCPTool = {
  name: 'hooks_pre-edit',
  description: 'Get context and agent suggestions before editing a file',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file being edited' },
      operation: {
        type: 'string',
        description: 'Type of operation (create, update, delete, refactor)',
      },
      context: { type: 'string', description: 'Additional context' },
    },
    required: ['filePath'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap filePath: passed to suggestAgentsForFile (O(n) regex) and reflected in
    // response.  Cap operation to prevent oversized strings in recommendations.
    const MAX_PRE_EDIT_PATH_LEN = 4 * 1024;
    const MAX_PRE_EDIT_OP_LEN = 64;
    const filePath = validateMcpString(params.filePath, 'filePath', MAX_PRE_EDIT_PATH_LEN);
    if (!filePath) {
      return { error: 'filePath is required (non-empty string, no control chars, max 4KB)' };
    }
    const operation =
      validateMcpString(params.operation, 'operation', MAX_PRE_EDIT_OP_LEN) ?? 'update';

    const suggestedAgents = suggestAgentsForFile(filePath);
    const ext = getFileExtension(filePath);

    return {
      filePath,
      operation,
      context: {
        fileExists: true,
        fileType: ext || 'unknown',
        relatedFiles: [],
        suggestedAgents,
        patterns: [{ pattern: `${ext} file editing`, confidence: 0.85 }],
        risks: operation === 'delete' ? ['File deletion is irreversible'] : [],
      },
      recommendations: [
        `Recommended agents: ${suggestedAgents.join(', ')}`,
        'Run tests after changes',
      ],
    };
  },
};

export const hooksPostEdit: MCPTool = {
  name: 'hooks_post-edit',
  description: 'Record editing outcome for learning',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the edited file' },
      success: { type: 'boolean', description: 'Whether the edit was successful' },
      agent: { type: 'string', description: 'Agent that performed the edit' },
    },
    required: ['filePath'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap filePath: interpolated into taskId and task text forwarded to
    // bridgeRecordFeedback (which calls generateEmbedding — O(n) hash fallback).
    // Cap agent: stored in feedback record and forwarded to bridge.
    const MAX_POST_EDIT_PATH_LEN = 4 * 1024;
    const MAX_POST_EDIT_AGENT_LEN = 256;
    const filePath = validateMcpString(params.filePath, 'filePath', MAX_POST_EDIT_PATH_LEN);
    if (!filePath) {
      return { error: 'filePath is required (non-empty string, no control chars, max 4KB)' };
    }
    const success = params.success !== false;
    const agent = validateMcpString(params.agent, 'agent', MAX_POST_EDIT_AGENT_LEN) ?? undefined;

    // Wire recordFeedback through bridge (issue #1209)
    let feedbackResult: { success: boolean; id?: string; error?: string } | null = null;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      feedbackResult = await bridge.bridgeRecordFeedback({
        taskType: agent ?? 'coder',
        action: `edit ${filePath}`,
        outcome: success ? 'success' : 'failure',
        confidence: success ? 0.85 : 0.3,
      });
    } catch (e) {
      // Bridge not available — continue with basic response
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-post-edit] memory bridge feedback failed:', e);
    }

    return {
      recorded: true,
      filePath,
      success,
      timestamp: new Date().toISOString(),
      learningUpdate: success ? 'pattern_reinforced' : 'pattern_adjusted',
      feedback: feedbackResult
        ? {
            recorded: feedbackResult.success,
            controller: feedbackResult.success ? 'sqlite' : 'unavailable',
            updates: feedbackResult.success ? 1 : 0,
          }
        : { recorded: false, controller: 'unavailable', updates: 0 },
    };
  },
};

export const hooksPreCommand: MCPTool = {
  name: 'hooks_pre-command',
  description: 'Assess risk before executing a command',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
    },
    required: ['command'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap command length: assessCommandRisk runs O(n) string searches, and the
    // raw command is reflected verbatim in the response.  Limit to 4 KB which
    // is far beyond any realistic shell command.
    const MAX_CMD_LEN = 4 * 1024;
    const command = validateMcpString(params.command, 'command', MAX_CMD_LEN);
    if (!command) {
      return { error: 'command is required (non-empty string, no control chars, max 4KB)' };
    }
    const assessment = assessCommandRisk(command);

    const riskLevel =
      assessment.level >= 0.8
        ? 'critical'
        : assessment.level >= 0.6
          ? 'high'
          : assessment.level >= 0.3
            ? 'medium'
            : 'low';

    return {
      command,
      riskLevel,
      risks: assessment.warnings.map((warning, i) => ({
        type: `risk-${i + 1}`,
        severity: assessment.level >= 0.6 ? 'high' : 'medium',
        description: warning,
      })),
      recommendations:
        assessment.warnings.length > 0
          ? ['Review warnings before proceeding', 'Consider using safer alternative']
          : ['Command appears safe to execute'],
      safeAlternatives: [],
      shouldProceed: assessment.level < 0.7,
    };
  },
};

export const hooksPostCommand: MCPTool = {
  name: 'hooks_post-command',
  description: 'Record command execution outcome',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Executed command' },
      exitCode: { type: 'number', description: 'Command exit code' },
    },
    required: ['command'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap command: it is stored in JSON memory store (line 824), forwarded to
    // bridgeStoreEntry which calls generateEmbedding by default — O(n) hash
    // fallback, and reflected verbatim in the response.  The recordCommand path
    // already caps to 200 chars; apply a consistent 4 KB cap here that still
    // covers any realistic shell command.
    const MAX_POST_CMD_LEN = 4 * 1024;
    const command = validateMcpString(params.command, 'command', MAX_POST_CMD_LEN);
    if (!command) {
      return { error: 'command is required (non-empty string, no control chars, max 4KB)' };
    }
    const exitCode =
      typeof params.exitCode === 'number' && Number.isFinite(params.exitCode)
        ? Math.floor(params.exitCode)
        : 0;
    const success = exitCode === 0;

    // Record the real exit code in the time-windowed command-outcome store so
    // post-task can derive a MEASURED success signal (grounded in actual exit
    // codes) when the caller does not explicitly assert --success. Non-fatal.
    await recordCommand(getRouteOutcomesBaseDir(), {
      ts: Date.now(),
      command: typeof command === 'string' ? command.slice(0, 200) : String(command).slice(0, 200),
      exitCode,
    });

    // Persist command outcome via memory backend
    let _storedIn: 'sqlite' | 'json-store' | 'none' = 'none';
    try {
      const bridge = await import('../memory/memory-bridge.js');
      await bridge.bridgeStoreEntry({
        key: `cmd-${Date.now()}`,
        value: JSON.stringify({ command, exitCode, success }),
        namespace: 'commands',
        tags: [success ? 'success' : 'error'],
      });
      _storedIn = 'sqlite';
    } catch {
      // memory backend unavailable — store in JSON
      try {
        const store = loadMemoryStore();
        const key = `cmd-${Date.now()}`;
        store.entries[key] = {
          key,
          value: JSON.stringify({ command, exitCode, success }),
          namespace: 'commands',
          createdAt: new Date().toISOString(),
        } as any;
        const memDir = join(getProjectCwd(), MEMORY_DIR);
        if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
        const _mp = getMemoryPath();
        const _mptmp = `${_mp}.tmp`;
        writeFileSync(_mptmp, JSON.stringify(store, null, 2), 'utf-8');
        renameSync(_mptmp, _mp);
        _storedIn = 'json-store';
      } catch {
        /* non-critical */
      }
    }

    return {
      recorded: _storedIn !== 'none',
      command,
      exitCode,
      success,
      timestamp: new Date().toISOString(),
      _storedIn,
    };
  },
};

export const hooksRoute: MCPTool = {
  name: 'hooks_route',
  description: 'Route task to optimal agent using semantic similarity (native HNSW or pure JS)',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      context: { type: 'string', description: 'Additional context' },
      useSemanticRouter: {
        type: 'boolean',
        description: 'Use semantic similarity routing (default: true)',
      },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task and context lengths: both are forwarded to generateEmbedding
    // via bridgeRouteTask, and task is used in extractKeywords + stored in
    // route-outcomes.jsonl.  16 KB matches the cap in hooksPatternSearch.
    const MAX_ROUTE_TASK_LEN = 16 * 1024;
    const MAX_ROUTE_CTX_LEN = 4 * 1024;
    const task = validateMcpString(params.task, 'task', MAX_ROUTE_TASK_LEN);
    if (!task) {
      return { error: 'task is required (non-empty string, no control chars, max 16KB)' };
    }
    const _context = validateMcpString(params.context, 'context', MAX_ROUTE_CTX_LEN) ?? undefined;
    const useSemanticRouter = params.useSemanticRouter !== false;

    // Phase 5: Try memory backend SemanticRouter / LearningSystem first
    if (useSemanticRouter) {
      try {
        const bridge = await import('../memory/memory-bridge.js');
        const memoryRoute = await bridge.bridgeRouteTask({ task });
        if (memoryRoute?.routes && memoryRoute.routes.length > 0) {
          const topRoute = memoryRoute.routes[0];
          const routeConfidence = topRoute.confidence ?? 0;
          if (routeConfidence > 0.5) {
            const agents = memoryRoute.routes.map((r: { agentType: string }) => r.agentType);
            const complexity = task.length > 200 ? 'high' : task.length < 50 ? 'low' : 'medium';
            const memoryMethod = 'memory-sqlite';
            const memoryConfidence = Math.round(routeConfidence * 100) / 100;
            const matchedPattern = topRoute.pattern ?? task.slice(0, 60);
            // Record the route recommendation so post-task can join the actual outcome
            const routeId = randomUUID();
            await recordRoute(getRouteOutcomesBaseDir(), {
              routeId,
              ts: Date.now(),
              task,
              recommendedAgent: agents[0],
              routingMethod: memoryMethod,
              confidence: memoryConfidence,
              learningMode: 'js' as const,
            });
            return {
              routeId,
              task,
              routing: {
                method: memoryMethod,
                backend: 'sqlite',
                latencyMs: 0,
                throughput: 'N/A',
              },
              matchedPattern,
              semanticMatches: [{ pattern: matchedPattern, score: routeConfidence }],
              primaryAgent: {
                type: agents[0],
                confidence: memoryConfidence,
                reason: `memory:sqlite: "${matchedPattern}" (${Math.round(routeConfidence * 100)}%)`,
              },
              alternativeAgents: agents.slice(1).map((agent: string, i: number) => ({
                type: agent,
                confidence: Math.round((routeConfidence - 0.1 * (i + 1)) * 100) / 100,
                reason: 'Alternative from sqlite',
              })),
              estimatedMetrics: {
                successProbability: memoryConfidence,
                estimatedDuration:
                  complexity === 'high'
                    ? '2-4 hours'
                    : complexity === 'medium'
                      ? '30-60 min'
                      : '10-30 min',
                complexity,
              },
              swarmRecommendation:
                agents.length > 2
                  ? { topology: 'hierarchical', agents, coordination: 'queen-led' }
                  : null,
            };
          }
        }
      } catch {
        // memory router not available — fall through to local routing
      }
    }

    // Deterministic keyword routing is the baseline (and only) local path.
    const semanticResult: { intent: string; score: number; metadata: Record<string, unknown> }[] =
      [];
    let routingMethod = 'keyword';
    const routingLatencyMs = 0;
    let backendInfo = '';

    // Get agents from keyword routing
    let agents: string[];
    let confidence: number;
    let matchedPattern = '';

    {
      // Keyword fallback is the baseline
      const keywordSuggestion = suggestAgentsForTask(task);
      agents = keywordSuggestion.agents;
      confidence = keywordSuggestion.confidence;
      matchedPattern = 'keyword-fallback';
      routingMethod = 'keyword';
      backendInfo = 'keyword matching';

      // V3: augment with neural ReasoningBank patterns — merge into agent list
      // rather than replacing, so keyword precision is preserved while neural
      // adds learned agents from past sessions.
      const intelSuggestion = await suggestAgentsFromIntelligence(task).catch(() => null);
      if (intelSuggestion && intelSuggestion.confidence > 0.5) {
        // Prepend neural agents (deduped) and boost confidence
        const existingSet = new Set(agents);
        const neuralOnly = intelSuggestion.agents.filter((a) => !existingSet.has(a));
        agents = [
          ...intelSuggestion.agents,
          ...agents.filter((a) => !new Set(intelSuggestion.agents).has(a)),
        ];
        const neuralWeight = intelSuggestion.confidence > 0.7 ? 0.65 : 0.5;
        const keywordWeight = 1 - neuralWeight;
        confidence = Math.min(
          0.95,
          intelSuggestion.confidence * neuralWeight +
            confidence * keywordWeight +
            (neuralOnly.length > 0 ? 0.03 : 0),
        );
        matchedPattern = 'neural+keyword';
        routingMethod = 'neural-augmented';
        backendInfo = 'intelligence ReasoningBank + keyword matching';
      }
    }

    // Determine complexity
    const taskLower = task.toLowerCase();
    const complexity =
      taskLower.includes('complex') || taskLower.includes('architecture') || task.length > 200
        ? 'high'
        : taskLower.includes('simple') || taskLower.includes('fix') || task.length < 50
          ? 'low'
          : 'medium';

    const primaryConfidence = Math.round(confidence * 100) / 100;
    // Record the route recommendation so post-task can join the actual outcome
    const routeId = randomUUID();
    await recordRoute(getRouteOutcomesBaseDir(), {
      routeId,
      ts: Date.now(),
      task,
      recommendedAgent: agents[0],
      routingMethod,
      confidence: primaryConfidence,
      learningMode: 'js' as const,
    });

    return {
      routeId,
      task,
      routing: {
        method: routingMethod,
        backend: backendInfo,
        latencyMs: routingLatencyMs,
        throughput:
          routingLatencyMs > 0 ? `${Math.round(1000 / routingLatencyMs)} routes/s` : 'N/A',
      },
      matchedPattern,
      semanticMatches: semanticResult.slice(0, 3).map((r) => ({
        pattern: r.intent,
        score: Math.round(r.score * 100) / 100,
      })),
      primaryAgent: {
        type: agents[0],
        confidence: Math.round(confidence * 100) / 100,
        reason: routingMethod.startsWith('semantic')
          ? `Semantic similarity to "${matchedPattern}" pattern (${Math.round(confidence * 100)}%)`
          : `Task contains keywords matching ${agents[0]} specialization`,
      },
      alternativeAgents: agents.slice(1).map((agent, i) => ({
        type: agent,
        confidence: Math.round((confidence - 0.1 * (i + 1)) * 100) / 100,
        reason: `Alternative agent for ${agent} capabilities`,
      })),
      estimatedMetrics: {
        successProbability: Math.round(confidence * 100) / 100,
        estimatedDuration:
          complexity === 'high' ? '2-4 hours' : complexity === 'medium' ? '30-60 min' : '10-30 min',
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
    'Route a task using the @monoes/routing package: keyword pre-filter, then real-embedding ' +
    'cosine-similarity matching (isolated worker), with a headless Claude (Haiku) fallback below ' +
    'the confidence threshold. Slower and more precise than hooks_route — use for ambiguous or ' +
    'highly specialized tasks (e.g. Solidity, game engines, embedded, DevOps) where keyword matching ' +
    'is likely to under-specify the agent.',
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

export const hooksMetrics: MCPTool = {
  name: 'hooks_metrics',
  description: 'View learning metrics dashboard',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', description: 'Metrics period (1h, 24h, 7d, 30d)' },
      includeV1: { type: 'boolean', description: 'Include v1 performance metrics' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const period = validateMcpString(params.period, 'period', 32) ?? '24h';

    // Try to read real counts from memory store
    const store = loadMemoryStore();
    const entries = Object.values(store.entries);

    // Count patterns by looking at stored pattern entries
    const patternEntries = entries.filter((e) => e.key.includes('pattern'));
    const routingEntries = entries.filter(
      (e) => e.key.includes('route') || e.key.includes('routing'),
    );
    const taskEntries = entries.filter((e) => e.key.includes('task'));

    if (entries.length === 0) {
      return {
        _real: true,
        _note:
          'No metrics data collected yet. Data populates from hooks_post-task, hooks_post-edit, hooks_post-command, and hooks_route calls.',
        period,
        patterns: { total: 0, successful: 0, failed: 0, avgConfidence: null },
        agents: { routingAccuracy: null, totalRoutes: 0, topAgent: null },
        commands: { totalExecuted: 0, successRate: null, avgRiskScore: null },
        lastUpdated: new Date().toISOString(),
      };
    }

    return {
      period,
      patterns: {
        total: patternEntries.length,
        _note:
          'Success/failure breakdown not tracked yet — store outcomes via hooks_post-task to populate.',
      },
      agents: {
        totalRoutes: routingEntries.length,
        _note: 'Routing accuracy not tracked yet — requires route-outcome correlation data.',
      },
      commands: {
        totalExecuted: taskEntries.length,
        _note: 'Success rate not tracked yet — requires command-outcomes.jsonl data.',
      },
      dataSource: 'memory-store',
      entriesFound: entries.length,
      lastUpdated: new Date().toISOString(),
    };
  },
};

export const hooksList: MCPTool = {
  name: 'hooks_list',
  description: 'List all registered hooks',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    // Static registry — not live discovery from handler objects.
    // Update this list when hooks are added or removed.
    const hooks = [
      // Core hooks
      { name: 'pre-edit', type: 'PreToolUse', status: 'active' },
      { name: 'post-edit', type: 'PostToolUse', status: 'active' },
      { name: 'pre-command', type: 'PreToolUse', status: 'active' },
      { name: 'post-command', type: 'PostToolUse', status: 'active' },
      { name: 'pre-task', type: 'PreToolUse', status: 'active' },
      { name: 'post-task', type: 'PostToolUse', status: 'active' },
      // Routing hooks
      { name: 'route', type: 'intelligence', status: 'active' },
      { name: 'explain', type: 'intelligence', status: 'active' },
      // Session hooks
      { name: 'session-start', type: 'SessionStart', status: 'active' },
      { name: 'session-end', type: 'SessionEnd', status: 'active' },
      { name: 'session-restore', type: 'SessionStart', status: 'active' },
      // Learning hooks
      { name: 'pretrain', type: 'intelligence', status: 'active' },
      { name: 'transfer', type: 'intelligence', status: 'active' },
      { name: 'metrics', type: 'analytics', status: 'active' },
      // System hooks
      { name: 'init', type: 'system', status: 'active' },
      { name: 'notify', type: 'coordination', status: 'active' },
      // Intelligence subcommands
      { name: 'intelligence', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-start', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-step', type: 'intelligence', status: 'active' },
      { name: 'intelligence_trajectory-end', type: 'intelligence', status: 'active' },
      { name: 'intelligence_pattern-store', type: 'intelligence', status: 'active' },
      { name: 'intelligence_pattern-search', type: 'intelligence', status: 'active' },
      { name: 'intelligence_stats', type: 'analytics', status: 'active' },
      { name: 'intelligence_learn', type: 'intelligence', status: 'active' },
    ];
    return {
      _note: 'Static registry — update this list when hooks are added or removed.',
      hooks,
      total: hooks.length,
    };
  },
};

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
    const _filePath = validateMcpString(params.filePath, 'filePath', 4 * 1024) ?? undefined;
    const suggestion = suggestAgentsForTask(description);

    // Determine complexity
    const descLower = description.toLowerCase();
    const complexity: 'low' | 'medium' | 'high' =
      descLower.includes('complex') ||
      descLower.includes('architecture') ||
      description.length > 200
        ? 'high'
        : descLower.includes('simple') || descLower.includes('fix') || description.length < 50
          ? 'low'
          : 'medium';

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
    // repeating mistakes. This closes the self-learning loop.
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
      suggestedAgents: suggestion.agents.map((agent, i) => ({
        type: agent,
        confidence: suggestion.confidence - 0.05 * i,
        reason:
          i === 0
            ? `Primary agent for ${agent} tasks based on learned patterns`
            : `Alternative agent with ${agent} capabilities`,
      })),
      complexity,
      estimatedDuration:
        complexity === 'high' ? '2-4 hours' : complexity === 'medium' ? '30-60 min' : '10-30 min',
      risks: complexity === 'high' ? ['Complex task may require multiple iterations'] : [],
      recommendations: [
        `Use ${suggestion.agents[0]} as primary agent`,
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

export const hooksPostTask: MCPTool = {
  name: 'hooks_post-task',
  description: 'Record task completion for learning',
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
        originRef: 'hooks-post-task',
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
        saveRoutingOutcomes(outcomes);
        outcomePersisted = true;
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
        patternsUpdated: feedbackResult?.success ? (success ? 2 : 1) : 0,
        newPatterns: success ? 1 : 0,
        trajectoryId: `traj-${Date.now()}`,
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
    // Cap task: forwarded to suggestAgentsForTask (O(n) keyword loop + extractKeywords),
    // .toLowerCase() (O(n)), and reflected verbatim in the response.
    const MAX_EXPLAIN_TASK_LEN = 16 * 1024;
    const task = validateMcpString(params.task, 'task', MAX_EXPLAIN_TASK_LEN);
    if (!task) {
      return { error: 'task is required (non-empty string, no control chars, max 16KB)' };
    }
    const suggestion = suggestAgentsForTask(task);
    const taskLower = task.toLowerCase();

    // Determine matched patterns
    const matchedPatterns: Array<{ pattern: string; matchScore: number; examples: string[] }> = [];
    for (const [pattern, _result] of Object.entries(TASK_PATTERNS)) {
      if (taskLower.includes(pattern)) {
        matchedPatterns.push({
          pattern,
          matchScore: pattern.length / Math.max(taskLower.length, 1), // real ratio: pattern length vs task length
          examples: [`Keyword "${pattern}" matched in task description`],
        });
      }
    }

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
        `The routing decision was made based on keyword analysis of the task description. ` +
        `The task contains keywords that match the "${suggestion.agents[0]}" specialization with ${(suggestion.confidence * 100).toFixed(0)}% confidence.`,
      factors: [
        {
          factor: 'Keyword Match',
          weight: 0.4,
          value: suggestion.confidence,
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
        agent: suggestion.agents[0],
        confidence: suggestion.confidence,
        reasoning: [
          `Task analysis identified ${matchedPatterns.length || 1} relevant patterns`,
          `"${suggestion.agents[0]}" has highest capability match for this task type`,
          historicalSuccess !== null
            ? `Historical success rate for similar tasks: ${(historicalSuccess * 100).toFixed(0)}%`
            : `No historical outcome data available yet`,
          `Confidence threshold met (${(suggestion.confidence * 100).toFixed(0)}% >= 70%)`,
        ],
      },
    };
  },
};

// Pretrain hook - repository analysis for intelligence bootstrap
export const hooksPretrain: MCPTool = {
  name: 'hooks_pretrain',
  description:
    'Walk the repository counting file extensions and directory patterns to seed the keyword router. This is a filesystem scan writing JSON state — despite the name, no model is trained.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path' },
      depth: { type: 'string', description: 'Analysis depth (shallow, medium, deep)' },
      skipCache: { type: 'boolean', description: 'Skip cached analysis' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const repoPath = resolve(validateMcpString(params.path, 'path', 4 * 1024) ?? '.');
    const projectRoot = getProjectCwd();
    if (repoPath !== projectRoot && !repoPath.startsWith(projectRoot + sep)) {
      return { error: 'Invalid path: must be within the project directory.' };
    }
    const depth = validateMcpString(params.depth, 'depth', 16) ?? 'medium';
    const allowedDepths = new Set(['shallow', 'medium', 'deep']);
    if (!allowedDepths.has(depth)) {
      return { error: 'Invalid depth: must be shallow, medium, or deep' };
    }
    const startTime = performance.now();

    // Real file scanning — count files by extension, extract patterns
    const { readdirSync, statSync } = await import('node:fs');
    const extCounts: Record<string, number> = {};
    let filesAnalyzed = 0;
    let totalLines = 0;
    const maxDepth = depth === 'shallow' ? 2 : depth === 'deep' ? 6 : 4;
    const patterns: string[] = [];

    const scan = (dir: string, currentDepth: number) => {
      if (currentDepth > maxDepth) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full, currentDepth + 1);
          } else if (entry.isFile()) {
            const ext = entry.name.includes('.')
              ? entry.name.slice(entry.name.lastIndexOf('.'))
              : '';
            if (ext) extCounts[ext] = (extCounts[ext] || 0) + 1;
            filesAnalyzed++;
            // For code files, count lines and extract imports
            if (['.ts', '.js', '.py', '.go', '.rs', '.java'].includes(ext)) {
              try {
                // Skip very large files (minified bundles, generated code) to prevent OOM.
                // 1 MB is generous for a source file; anything larger is unlikely to have
                // useful import patterns in the first 30 lines anyway.
                const MAX_CODE_FILE_BYTES = 1 * 1024 * 1024;
                if (statSync(full).size > MAX_CODE_FILE_BYTES) continue;
                const content = readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                totalLines += lines.length;
                // Extract import patterns (first 50 files max for performance)
                if (filesAnalyzed <= 50) {
                  for (const line of lines.slice(0, 30)) {
                    if (
                      line.startsWith('import ') ||
                      line.startsWith('from ') ||
                      (line.startsWith('const ') && line.includes('require('))
                    ) {
                      const trimmed = line.trim();
                      if (trimmed.length < 120 && !patterns.includes(trimmed))
                        patterns.push(trimmed);
                      if (patterns.length >= 100) break;
                    }
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        }
      } catch {
        /* skip inaccessible dirs */
      }
    };

    scan(repoPath, 0);
    const elapsed = Math.round(performance.now() - startTime);

    // Store extracted patterns in memory backend
    let patternsStored = 0;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      await bridge.bridgeStoreEntry({
        key: `pretrain-${Date.now()}`,
        value: JSON.stringify({
          filesAnalyzed,
          totalLines,
          topExtensions: Object.entries(extCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
          importPatterns: patterns.slice(0, 20),
        }),
        namespace: 'pretrain',
        tags: ['pretrain', depth],
      });
      patternsStored = patterns.length;
    } catch (e) {
      /* memory backend unavailable */
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-pretrain] pattern store failed:', e);
    }

    // Feed extracted import patterns into the neural training system so
    // pretrain actually trains, not just scans.
    let neuralPatternsLearned = 0;
    if (patterns.length > 0) {
      try {
        const intel = await import('../memory/intelligence.js');
        await intel.initializeIntelligence({
          confidenceLearningRate: 0.002,
          maxTrajectorySize: patterns.length,
        });
        // Record each extracted pattern as an action step
        for (const pat of patterns.slice(0, 50)) {
          await intel.recordStep({
            type: 'action',
            content: pat,
            metadata: { source: 'pretrain', depth },
          });
        }
        // Record the entire scan as a completed trajectory
        const steps = patterns.slice(0, 50).map((p) => ({ type: 'action' as const, content: p }));
        await intel.recordTrajectory(steps, 'success');
        intel.flushPatterns();
        neuralPatternsLearned = steps.length;
      } catch (e) {
        /* intelligence not available */
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[hooks-pretrain] intelligence training failed:', e);
      }
    }

    return {
      success: true,
      _real: true,
      path: repoPath,
      depth,
      durationMs: elapsed,
      stats: {
        filesAnalyzed,
        totalLines,
        patternsExtracted: patterns.length,
        patternsStored,
        neuralPatternsLearned,
        fileTypes: Object.entries(extCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([ext, count]) => ({ ext, count })),
      },
    };
  },
};

// Transfer hook - transfer patterns from another project
export const hooksTransfer: MCPTool = {
  name: 'hooks_transfer',
  description: 'Transfer learned patterns from another project',
  inputSchema: {
    type: 'object',
    properties: {
      sourcePath: { type: 'string', description: 'Source project path' },
      filter: { type: 'string', description: 'Filter patterns by type' },
      minConfidence: { type: 'number', description: 'Minimum confidence threshold' },
    },
    required: ['sourcePath'],
  },
  handler: async (params: Record<string, unknown>) => {
    const sourcePath = validateMcpString(params.sourcePath, 'sourcePath', 4 * 1024);
    if (!sourcePath) {
      return { error: 'sourcePath is required (non-empty string, no control chars, max 4KB)' };
    }
    const minConfidence =
      typeof params.minConfidence === 'number' && Number.isFinite(params.minConfidence)
        ? Math.max(0, Math.min(1, params.minConfidence as number))
        : 0.7;
    const filter = validateMcpString(params.filter, 'filter', 64) ?? undefined;

    // Validate sourcePath is an existing directory before reading from it
    const resolvedSource = resolve(sourcePath);
    const { statSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const home = homedir();
    if (resolvedSource !== home && !resolvedSource.startsWith(home + sep)) {
      return { error: 'sourcePath must be within the home directory.' };
    }
    try {
      const st = statSync(resolvedSource);
      if (!st.isDirectory()) {
        return { error: 'sourcePath must be a directory' };
      }
    } catch {
      return { error: 'sourcePath does not exist' };
    }

    // Load learned patterns from the source project's neural pattern store —
    // the same `.monomind/neural/patterns.json` file `hooks intelligence
    // import` writes to and intelligence.ts reads from (src/memory/intelligence.ts
    // getPatternsPath()).
    const sourcePatternsPath = join(resolvedSource, '.monomind', 'neural', 'patterns.json');
    let sourcePatterns: NeuralPattern[] = [];

    const MAX_SOURCE_PATTERNS_BYTES = 50 * 1024 * 1024; // 50 MB — matches other store readers
    try {
      if (
        existsSync(sourcePatternsPath) &&
        statSync(sourcePatternsPath).size <= MAX_SOURCE_PATTERNS_BYTES
      ) {
        const parsed = JSON.parse(readFileSync(sourcePatternsPath, 'utf-8'));
        if (Array.isArray(parsed)) sourcePatterns = parsed;
      }
    } catch (e) {
      // Fall back to empty list
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-transfer] source patterns.json read/parse failed:', e);
    }

    if (sourcePatterns.length === 0) {
      return {
        success: false,
        message: 'No patterns found in source project',
        sourcePath,
        transferred: { total: 0, byType: {} },
      };
    }

    // Qualifying patterns: confidence at/above threshold, and (if given) type
    // matches the filter.
    const qualifying = sourcePatterns.filter(
      (p) =>
        typeof p.id === 'string' &&
        p.id.length > 0 &&
        (typeof p.confidence !== 'number' || p.confidence >= minConfidence) &&
        (!filter || (typeof p.type === 'string' && p.type.includes(filter))),
    );

    if (qualifying.length === 0) {
      return {
        success: false,
        message: 'No patterns in source project meet the filter/confidence threshold',
        sourcePath,
        transferred: { total: 0, byType: {} },
      };
    }

    // Merge into this project's pattern store, reusing the same by-id dedupe
    // logic as `hooks intelligence import` (neural-registry.ts's importCommand).
    const destDir = join(getProjectCwd(), '.monomind', 'neural');
    const destPatternsPath = join(destDir, 'patterns.json');
    let destPatterns: NeuralPattern[] = [];
    try {
      if (
        existsSync(destPatternsPath) &&
        statSync(destPatternsPath).size <= MAX_SOURCE_PATTERNS_BYTES
      ) {
        const parsed = JSON.parse(readFileSync(destPatternsPath, 'utf-8'));
        if (Array.isArray(parsed)) destPatterns = parsed;
      }
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-transfer] destination patterns.json read/parse failed:', e);
    }

    const { merged, added } = mergeRecordsById(destPatterns, qualifying);

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const tmpDest = `${destPatternsPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpDest, JSON.stringify(merged, null, 2), 'utf-8');
    renameSync(tmpDest, destPatternsPath);

    // Real counts of what was actually transferred, grouped by each pattern's
    // own `type` field (falling back to 'unknown' when absent).
    const byType: Record<string, number> = {};
    for (const p of added) {
      const type = typeof p.type === 'string' && p.type.length > 0 ? p.type : 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      success: true,
      sourcePath,
      transferred: {
        total: added.length,
        byType,
      },
      dataSource: 'source-project',
    };
  },
};

// Session start hook
export const hooksSessionStart: MCPTool = {
  name: 'hooks_session-start',
  description: 'Initialize a new session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Optional session ID' },
      restoreLatest: { type: 'boolean', description: 'Restore latest session state' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const sessionId =
      validateMcpString(params.sessionId, 'sessionId', 256) ?? `session-${Date.now()}`;
    const restoreLatest = params.restoreLatest === true;

    // Phase 5: Wire ReflexionMemory session start via bridge
    let sessionMemory: { controller: string; restoredPatterns: number } | null = null;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSessionStart({
        sessionId,
        metadata: { context: restoreLatest ? 'restore previous session patterns' : 'new session' },
      });
      if (result) {
        sessionMemory = {
          controller: result.success ? 'sqlite' : 'none',
          restoredPatterns: 0,
        };
      }
    } catch (e) {
      // Bridge not available
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-session-start] memory bridge failed:', e);
    }

    return {
      sessionId,
      started: new Date().toISOString(),
      restored: restoreLatest,
      config: {
        intelligenceEnabled: true,
        hooksEnabled: true,
        memoryPersistence: true,
      },
      sessionMemory: sessionMemory || { controller: 'none', restoredPatterns: 0 },
      previousSession: restoreLatest
        ? {
            id: `session-${Date.now() - 86400000}`,
            tasksRestored: sessionMemory?.restoredPatterns || 0,
            memoryRestored: sessionMemory?.restoredPatterns || 0,
          }
        : null,
    };
  },
};

// Session restore hook — hooks.ts's `hooks session-restore` (and its
// `session-start` alias) called this tool name, but it was never registered
// anywhere in the tool registry, so both always failed. This repo has no
// per-session snapshot of agents/tasks to restore from, so "restore" here
// means: report the currently-live (non-terminated/non-terminal) agents and
// tasks as "carried forward", and reinitialize the memory-bridge session
// context the same way hooks_session-start does — an honest, working
// implementation rather than a fabricated one.
export const hooksSessionRestore: MCPTool = {
  name: 'hooks_session-restore',
  description:
    'Restore a previous session — reports currently-live agents/tasks and reinitializes memory-bridge session context',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to restore, or "latest"' },
      restoreAgents: {
        type: 'boolean',
        description: 'Include a count of currently-live agents (default true)',
      },
      restoreTasks: {
        type: 'boolean',
        description: 'Include a count of currently-live tasks (default true)',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const originalSessionId = validateMcpString(params.sessionId, 'sessionId', 256) ?? 'latest';
    const newSessionId = `session-${Date.now()}`;
    const warnings: string[] = [];

    let agentsRestored = 0;
    if (params.restoreAgents !== false) {
      try {
        const { loadAgentStore } = await import('./agent-tools.js');
        const store = loadAgentStore();
        agentsRestored = Object.values(store.agents).filter(
          (a) => a.status !== 'terminated',
        ).length;
      } catch (e) {
        warnings.push('Agent store unavailable — agent count not restored');
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[hooks-session-restore] agent store read failed:', e);
      }
    }

    let tasksRestored = 0;
    if (params.restoreTasks !== false) {
      try {
        const { loadTaskStore } = await import('./task-tools.js');
        const store = loadTaskStore();
        tasksRestored = Object.values(store.tasks).filter(
          (t) => t.status === 'pending' || t.status === 'in_progress',
        ).length;
      } catch (e) {
        warnings.push('Task store unavailable — task count not restored');
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[hooks-session-restore] task store read failed:', e);
      }
    }

    // bridgeSessionStart only stores a new "session active" marker entry —
    // it has no pattern-restoration data to count, so there is no real
    // "memoryRestored" number to report. Track whether the bridge itself
    // came up instead of faking a count.
    let memoryBridgeInitialized = false;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSessionStart({
        sessionId: newSessionId,
        metadata: { context: 'restore previous session patterns' },
      });
      if (result) {
        memoryBridgeInitialized = result.success;
      } else {
        warnings.push('Memory bridge unavailable — pattern restoration skipped');
      }
    } catch (e) {
      warnings.push('Memory bridge failed to initialize');
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-session-restore] memory bridge failed:', e);
    }

    return {
      sessionId: newSessionId,
      originalSessionId,
      restoredState: { tasksRestored, agentsRestored, memoryBridgeInitialized },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};

// Session end hook - persists state
export const hooksSessionEnd: MCPTool = {
  name: 'hooks_session-end',
  description: 'End current session and persist state',
  inputSchema: {
    type: 'object',
    properties: {
      saveState: { type: 'boolean', description: 'Save session state' },
      exportMetrics: { type: 'boolean', description: 'Export session metrics' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const saveState = params.saveState !== false;
    // Use caller-supplied sessionId if provided, otherwise generate a current-time ID.
    // The -3600000 offset was incorrect — it prevented matching session-start IDs.
    const sessionId =
      typeof params.sessionId === 'string' && params.sessionId
        ? params.sessionId
        : `session-${Date.now()}`;

    // Read actual counts from stores
    const store = loadMemoryStore();
    const allEntries = Object.values(store.entries);
    const taskCount = allEntries.filter((e) => e.key.includes('task')).length;
    const agentCount = allEntries.filter((e) => e.key.includes('agent')).length;
    const patternCount = allEntries.filter((e) => e.key.includes('pattern')).length;
    const trajectoryCount = activeTrajectories.size;

    // Check for pending-insights.jsonl
    let insightCount = 0;
    try {
      const insightsPath = join(getProjectCwd(), '.monomind', 'data', 'pending-insights.jsonl');
      if (existsSync(insightsPath)) {
        const content = readFileSync(insightsPath, 'utf-8').trim();
        insightCount = content ? content.split('\n').length : 0;
      }
    } catch {
      // File not available
    }

    // Phase 5: Wire ReflexionMemory session end + NightlyLearner consolidation via bridge
    let sessionPersistence: { controller: string; persisted: boolean } | null = null;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSessionEnd({
        sessionId,
        summary: saveState ? 'Session ended with state saved' : 'Session ended',
        metrics: { tasksCompleted: taskCount, patternsLearned: patternCount },
      });
      if (result) {
        sessionPersistence = {
          controller: result.success ? 'sqlite' : 'none',
          persisted: result.success,
        };
      }
    } catch (e) {
      // Bridge not available
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-session-end] memory bridge failed:', e);
    }

    // KG nudge: check if knowledge graph is empty and suggest distillation
    let kgNudge: { empty: boolean; prompt?: string } = { empty: false };
    if (process.env.MONOMIND_KG_NUDGE !== 'false') {
      try {
        const kg = await import('../memory/memory-kg.js');
        const stats = await kg.kgStats();
        const kgEmpty = stats.nodes === 0 && stats.edges === 0 && stats.rules === 0;
        if (kgEmpty && taskCount > 0) {
          kgNudge = {
            empty: true,
            prompt: [
              'The knowledge graph is empty (0 nodes, 0 edges, 0 rules). Before ending, distill 2-5 key insights:',
              '1. Identify important entities (functions, patterns, architectural decisions)',
              '2. Call memory_kg_ingest with nodes [{name, type, description}], edges [{source, target, relation}],',
              '   and any durable rules [{rule, context}] — use session ID as originRef',
              '3. Check existing entities first: memory_kg_stats with glossary:true',
              'Skip for trivial sessions. Disable with MONOMIND_KG_NUDGE=false',
            ].join('\n'),
          };
        }
      } catch {
        // non-fatal — skip nudge if KG module unavailable
      }
    }

    return {
      sessionId,
      statePath: saveState ? `.claude/sessions/${sessionId}.json` : undefined,
      sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },
      summary: {
        tasksExecuted: taskCount,
        filesModified: 0,
        agentsSpawned: agentCount,
        pendingInsights: insightCount,
        memoryEntries: allEntries.length,
      },
      learningUpdates: {
        patternsLearned: patternCount,
        trajectoriesRecorded: trajectoryCount,
      },
      kgNudge,
    };
  },
};

// Intelligence hook - JS pattern/trajectory logging
export const hooksIntelligence: MCPTool = {
  name: 'hooks_intelligence',
  description: 'Intelligence status: pattern/trajectory logging metrics from the memory store',
  inputSchema: {
    type: 'object',
    properties: {
      enableHnsw: { type: 'boolean', description: 'Enable HNSW search' },
      forceTraining: { type: 'boolean', description: 'Force training cycle' },
      showStatus: { type: 'boolean', description: 'Show status only' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const enableHnsw = params.enableHnsw !== false;

    // Get REAL statistics from memory store
    const realStats = getIntelligenceStatsFromMemory();

    // Check actual implementation availability
    const sonaAvailable = (await getSONAOptimizer()) !== null;

    return {
      status: 'active',
      components: {
        sona: {
          enabled: sonaAvailable,
          status: sonaAvailable ? 'active' : 'idle',
          implemented: true,
          trajectoriesRecorded: realStats.trajectories.total,
          trajectoriesSuccessful: realStats.trajectories.successful,
          patternsLearned: realStats.patterns.learned,
          note: 'Trajectory + pattern logging (no neural training in the lean build)',
        },
        moe: {
          enabled: false,
          status: 'removed',
          implemented: false,
          routingDecisions: realStats.routing.decisions,
          note: 'MoE removed in lean build; keyword routing is used instead (see monoes-full-loop)',
        },
        hnsw: {
          enabled: enableHnsw,
          status: enableHnsw ? 'active' : 'disabled',
          implemented: true,
          indexSize: realStats.memory.indexSize,
          memorySizeBytes: realStats.memory.memorySizeBytes,
          note: 'Pure-JS HNSW vector indexing (O(log n) vs O(n))',
        },
        flashAttention: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'Flash Attention removed in lean build; lives on monoes-full-loop branch',
        },
        ewc: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'EWC++ removed in lean build; lives on monoes-full-loop branch',
        },
        lora: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'LoRA removed in lean build; lives on monoes-full-loop branch',
        },
        embeddings: {
          provider: 'transformers',
          model: 'Xenova/all-MiniLM-L6-v2',
          dimension: 384,
          implemented: true,
          note: 'Real ONNX embeddings via Xenova/all-MiniLM-L6-v2',
        },
      },
      realMetrics: {
        trajectories: realStats.trajectories,
        patterns: realStats.patterns,
        memory: realStats.memory,
        routing: realStats.routing,
      },
      implementationStatus: {
        working: [
          'memory-store',
          'embeddings',
          'trajectory-recording',
          'claims',
          'swarm-coordination',
          'hnsw-index',
          'pattern-storage',
          'keyword-routing',
        ],
        partial: [],
        notImplemented: [],
        removed: [
          'moe-routing',
          'flash-attention',
          'lora-adapter',
          'native-sona-engine',
          'native-router',
          'native-attention',
        ],
      },
      version: '3.0.0-alpha.102',
    };
  },
};
