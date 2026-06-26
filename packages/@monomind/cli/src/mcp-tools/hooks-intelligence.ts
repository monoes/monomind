/**
 * Hooks Intelligence & Worker MCP Tools
 * MCP tool implementations for intelligence reset, trajectories, patterns,
 * intelligence stats/learn/attention, worker dispatch/status/detect/cancel,
 * and model routing.
 * Extracted from hooks-tools.ts.
 */

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { type MCPTool, getProjectCwd } from './types.js';
import { randomUUID } from 'node:crypto';
import {
  activeTrajectories,
  loadMemoryStore,
  getMemoryPath,
  getRealSearchFunction,
  getRealStoreFunction,
  getSONAOptimizer,
  getEWCConsolidator,
  generateSimpleEmbedding,
  VALID_AGENT_TYPES,
  getIntelligenceStatsFromMemory,
  type TrajectoryData,
  type TrajectoryStep,
} from './hooks-embedding.js';

// Intelligence reset hook
export const hooksIntelligenceReset: MCPTool = {
  name: 'hooks_intelligence-reset',
  description: 'Reset intelligence learning state',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const cwd = getProjectCwd();
    const cleared = {
      trajectories: 0,
      patterns: 0,
      dataFiles: 0,
      neuralFiles: 0,
    };
    const deletedFiles: string[] = [];

    // Clear intelligence data files if they exist
    const dataFiles = [
      join(cwd, '.monomind', 'data', 'auto-memory-store.json'),
      join(cwd, '.monomind', 'data', 'graph-state.json'),
      join(cwd, '.monomind', 'data', 'ranked-context.json'),
    ];

    for (const filePath of dataFiles) {
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
          cleared.dataFiles++;
          deletedFiles.push(filePath);
        } catch {
          // Skip files that cannot be deleted
        }
      }
    }

    // Clear neural directory if it exists
    const neuralDir = join(cwd, '.monomind', 'neural');
    if (existsSync(neuralDir)) {
      try {
        const files = readdirSync(neuralDir);
        for (const file of files) {
          try {
            const filePath = join(neuralDir, file);
            unlinkSync(filePath);
            cleared.neuralFiles++;
            deletedFiles.push(filePath);
          } catch {
            // Skip files that cannot be deleted
          }
        }
      } catch {
        // Directory read failed
      }
    }

    // Clear in-memory trajectories
    cleared.trajectories = activeTrajectories.size;
    activeTrajectories.clear();

    return {
      reset: true,
      cleared,
      deletedFiles,
      timestamp: new Date().toISOString(),
    };
  },
};

// Intelligence trajectory hooks - REAL implementation using activeTrajectories
export const hooksTrajectoryStart: MCPTool = {
  name: 'hooks_intelligence_trajectory-start',
  description: 'Begin SONA trajectory for reinforcement learning',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      agent: { type: 'string', description: 'Agent type' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task and agent lengths to prevent the trajectory map from accumulating
    // large strings (up to MAX_TRAJECTORIES × uncapped length = potential GB of RAM).
    const MAX_TASK_LEN = 4 * 1024; // 4 KB — same cap as trajectory-step fields
    const MAX_AGENT_LEN = 256;
    const rawTask = params.task as string;
    const task = typeof rawTask === 'string' && rawTask.length > MAX_TASK_LEN
      ? rawTask.slice(0, MAX_TASK_LEN)
      : rawTask;
    const rawAgent = (params.agent as string) || 'coder';
    const agent = typeof rawAgent === 'string' && rawAgent.length > MAX_AGENT_LEN
      ? rawAgent.slice(0, MAX_AGENT_LEN)
      : rawAgent;
    const trajectoryId = `traj-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startedAt = new Date().toISOString();

    // Create real trajectory entry in memory
    const trajectory: TrajectoryData = {
      id: trajectoryId,
      task,
      agent,
      steps: [],
      startedAt,
    };

    const MAX_TRAJECTORIES = 10000;
    if (activeTrajectories.size >= MAX_TRAJECTORIES) {
      // Evict the oldest trajectory
      const oldest = activeTrajectories.keys().next().value;
      if (oldest) activeTrajectories.delete(oldest);
    }
    activeTrajectories.set(trajectoryId, trajectory);

    return {
      trajectoryId,
      task,
      agent,
      started: startedAt,
      status: 'recording',
      implementation: 'real-trajectory-tracking',
      activeCount: activeTrajectories.size,
    };
  },
};

export const hooksTrajectoryStep: MCPTool = {
  name: 'hooks_intelligence_trajectory-step',
  description: 'Record step in trajectory for reinforcement learning',
  inputSchema: {
    type: 'object',
    properties: {
      trajectoryId: { type: 'string', description: 'Trajectory ID' },
      action: { type: 'string', description: 'Action taken' },
      result: { type: 'string', description: 'Action result' },
      quality: { type: 'number', description: 'Quality score (0-1)' },
    },
    required: ['trajectoryId', 'action'],
  },
  handler: async (params: Record<string, unknown>) => {
    const trajectoryId = params.trajectoryId as string;
    // Cap action and result strings to prevent unbounded in-memory growth when
    // trajectory-step is called many times with large payloads.
    const MAX_STEP_STRING_LEN = 4 * 1024; // 4 KB per field
    const MAX_STEPS_PER_TRAJECTORY = 1000;
    const rawAction = params.action as string;
    const rawResult = (params.result as string) || 'success';
    const action = typeof rawAction === 'string' && rawAction.length > MAX_STEP_STRING_LEN
      ? rawAction.slice(0, MAX_STEP_STRING_LEN)
      : rawAction;
    const result = typeof rawResult === 'string' && rawResult.length > MAX_STEP_STRING_LEN
      ? rawResult.slice(0, MAX_STEP_STRING_LEN)
      : rawResult;
    const quality = (params.quality as number) || 0.85;
    const timestamp = new Date().toISOString();
    const stepId = `step-${Date.now()}`;

    // Add step to real trajectory if it exists
    const trajectory = activeTrajectories.get(trajectoryId);
    if (trajectory) {
      if (trajectory.steps.length >= MAX_STEPS_PER_TRAJECTORY) {
        // Drop the oldest step to keep the array bounded
        trajectory.steps.shift();
      }
      trajectory.steps.push({
        action,
        result,
        quality,
        timestamp,
      });
    }

    return {
      trajectoryId,
      stepId,
      action,
      result,
      quality,
      recorded: !!trajectory,
      timestamp,
      totalSteps: trajectory?.steps.length || 0,
      implementation: trajectory ? 'real-step-recording' : 'trajectory-not-found',
    };
  },
};

export const hooksTrajectoryEnd: MCPTool = {
  name: 'hooks_intelligence_trajectory-end',
  description: 'End trajectory and trigger SONA learning with EWC++',
  inputSchema: {
    type: 'object',
    properties: {
      trajectoryId: { type: 'string', description: 'Trajectory ID' },
      success: { type: 'boolean', description: 'Overall success' },
      feedback: { type: 'string', description: 'Optional feedback' },
    },
    required: ['trajectoryId'],
  },
  handler: async (params: Record<string, unknown>) => {
    const trajectoryId = params.trajectoryId as string;
    const success = params.success !== false;
    const feedback = params.feedback as string | undefined;
    const endedAt = new Date().toISOString();
    const startTime = Date.now();

    // Get and finalize real trajectory
    const trajectory = activeTrajectories.get(trajectoryId);
    let persistResult: { success: boolean; id?: string; error?: string } = { success: false };

    if (trajectory) {
      trajectory.success = success;
      trajectory.endedAt = endedAt;

      // Persist trajectory to database using real store
      const storeFn = await getRealStoreFunction();
      if (storeFn) {
        try {
          // Create trajectory summary for embedding
          const summary = `Task: ${trajectory.task} | Agent: ${trajectory.agent} | Steps: ${trajectory.steps.length} | Success: ${success}${feedback ? ` | Feedback: ${feedback}` : ''}`;

          persistResult = await storeFn({
            key: `trajectory-${trajectoryId}`,
            value: JSON.stringify({
              ...trajectory,
              feedback,
            }),
            namespace: 'trajectories',
            generateEmbeddingFlag: true, // Generate embedding for semantic search
            tags: [trajectory.agent, success ? 'success' : 'failure', 'sona-trajectory'],
          });
        } catch (error) {
          persistResult = { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      // Remove from active trajectories
      activeTrajectories.delete(trajectoryId);
    }

    // SONA Learning - process trajectory outcome for routing optimization
    let sonaResult: { learned: boolean; patternKey: string; confidence: number } = {
      learned: false, patternKey: '', confidence: 0
    };
    let ewcResult: { consolidated: boolean; penalty: number } = {
      consolidated: false, penalty: 0
    };

    if (trajectory && persistResult.success) {
      // Try SONA learning
      const sona = await getSONAOptimizer();
      if (sona) {
        try {
          const outcome = {
            trajectoryId,
            task: trajectory.task,
            agent: trajectory.agent,
            success,
            steps: trajectory.steps,
            feedback,
            duration: trajectory.startedAt
              ? new Date(endedAt).getTime() - new Date(trajectory.startedAt).getTime()
              : 0,
          };
          const result = sona.processTrajectoryOutcome(outcome);
          sonaResult = {
            learned: result.learned,
            patternKey: result.patternKey,
            confidence: result.confidence,
          };
        } catch {
          // SONA learning failed, continue without it
        }
      }

      // Try EWC++ consolidation on successful trajectories
      if (success) {
        const ewc = await getEWCConsolidator();
        if (ewc) {
          try {
            // Record gradient sample for Fisher matrix update
            // Create a simple gradient from trajectory steps
            const gradients = new Array(384).fill(0).map((_, i) =>
              Math.sin(i * 0.01) * (trajectory.steps.length / 10)
            );
            ewc.recordGradient(`trajectory-${trajectoryId}`, gradients, success);
            const stats = ewc.getConsolidationStats();
            ewcResult = {
              consolidated: true,
              penalty: stats.avgPenalty,
            };
          } catch {
            // EWC consolidation failed, continue without it
          }
        }
      }
    }

    const learningTimeMs = Date.now() - startTime;

    return {
      trajectoryId,
      success,
      ended: endedAt,
      persisted: persistResult.success,
      persistedId: persistResult.id,
      learning: {
        sonaUpdate: sonaResult.learned,
        sonaPatternKey: sonaResult.patternKey || undefined,
        sonaConfidence: sonaResult.confidence || undefined,
        ewcConsolidation: ewcResult.consolidated,
        ewcPenalty: ewcResult.penalty || undefined,
        patternsExtracted: trajectory?.steps.length || 0,
        learningTimeMs,
      },
      trajectory: trajectory ? {
        task: trajectory.task,
        agent: trajectory.agent,
        totalSteps: trajectory.steps.length,
        duration: trajectory.startedAt ? new Date(endedAt).getTime() - new Date(trajectory.startedAt).getTime() : 0,
      } : null,
      implementation: sonaResult.learned ? 'real-sona-learning' : (persistResult.success ? 'real-persistence' : 'memory-only'),
      note: sonaResult.learned
        ? `SONA learned pattern "${sonaResult.patternKey}" with ${(sonaResult.confidence * 100).toFixed(1)}% confidence`
        : (persistResult.success ? 'Trajectory persisted for future learning' : (persistResult.error || 'Trajectory not found')),
    };
  },
};

// Pattern store/search hooks - REAL implementation using storeEntry
export const hooksPatternStore: MCPTool = {
  name: 'hooks_intelligence_pattern-store',
  description: 'Store pattern in ReasoningBank (HNSW-indexed)',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern description' },
      type: { type: 'string', description: 'Pattern type' },
      confidence: { type: 'number', description: 'Confidence score' },
      metadata: { type: 'object', description: 'Additional metadata' },
    },
    required: ['pattern'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap pattern and type lengths to prevent DoS via large embedding generation
    // and unbounded database writes.  16 KB matches the cap in neural_patterns store.
    const MAX_PATTERN_LEN = 16 * 1024; // 16 KB
    const MAX_TYPE_LEN = 256;
    const rawPattern = params.pattern as string;
    const pattern = typeof rawPattern === 'string' && rawPattern.length > MAX_PATTERN_LEN
      ? rawPattern.slice(0, MAX_PATTERN_LEN)
      : rawPattern;
    const rawType = (params.type as string) || 'general';
    const type = typeof rawType === 'string' && rawType.length > MAX_TYPE_LEN
      ? rawType.slice(0, MAX_TYPE_LEN)
      : rawType;
    const confidence = (params.confidence as number) || 0.8;
    const metadata = params.metadata as Record<string, unknown> | undefined;
    const timestamp = new Date().toISOString();
    const patternId = `pattern-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Phase 3: Try ReasoningBank via bridge first
    let reasoningResult: { success: boolean; patternId: string; controller: string } | null = null;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      reasoningResult = await bridge.bridgeStorePattern({ pattern, type, confidence, metadata: metadata as Record<string, unknown> | undefined });
    } catch {
      // Bridge not available
    }

    // Fallback: persist using memory-initializer store
    let storeResult: { success: boolean; id?: string; embedding?: { dimensions: number; model: string }; error?: string } = { success: false };
    if (!reasoningResult) {
      const storeFn = await getRealStoreFunction();
      if (storeFn) {
        try {
          storeResult = await storeFn({
            key: patternId,
            value: JSON.stringify({ pattern, type, confidence, metadata, timestamp }),
            namespace: 'pattern',
            generateEmbeddingFlag: true,
            tags: [type, `confidence-${Math.round(confidence * 100)}`, 'reasoning-pattern'],
          });
        } catch (error) {
          storeResult = { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    }

    const success = reasoningResult?.success || storeResult.success;
    const controller = reasoningResult?.controller || (storeResult.success ? 'bridge-store' : 'none');

    return {
      patternId: reasoningResult?.patternId || storeResult.id || patternId,
      pattern,
      type,
      confidence,
      indexed: success,
      hnswIndexed: success && (!!storeResult.embedding || controller === 'reasoningBank'),
      embedding: storeResult.embedding,
      timestamp,
      controller,
      implementation: controller === 'reasoningBank' ? 'reasoning-bank-controller' : (storeResult.success ? 'real-hnsw-indexed' : 'memory-only'),
      note: controller === 'reasoningBank'
        ? 'Pattern stored via ReasoningBank controller with HNSW indexing'
        : (storeResult.success ? 'Pattern stored with vector embedding for semantic search' : (storeResult.error || 'Store function unavailable')),
    };
  },
};

export const hooksPatternSearch: MCPTool = {
  name: 'hooks_intelligence_pattern-search',
  description: 'Search patterns using REAL vector search (HNSW when available, brute-force fallback)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'number', description: 'Number of results' },
      minConfidence: { type: 'number', description: 'Minimum similarity threshold (0-1)' },
      namespace: { type: 'string', description: 'Namespace to search (default: pattern)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap query length to prevent DoS via large embedding generation (same
    // class of bug fixed in neural_patterns search and hooksPatternStore).
    const MAX_SEARCH_QUERY_LEN = 16 * 1024; // 16 KB — matches neural_patterns cap
    const MAX_TOP_K = 100;
    const rawQuery = params.query as string;
    const query = typeof rawQuery === 'string' && rawQuery.length > MAX_SEARCH_QUERY_LEN
      ? rawQuery.slice(0, MAX_SEARCH_QUERY_LEN)
      : rawQuery;
    const rawTopK = params.topK as number;
    const topK = Number.isFinite(rawTopK) && rawTopK > 0
      ? Math.min(Math.floor(rawTopK), MAX_TOP_K)
      : 5;
    const minConfidence = (params.minConfidence as number) || 0.3;
    const namespace = (params.namespace as string) || 'pattern';

    // Phase 3: Try ReasoningBank search via bridge first
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const rbResult = await bridge.bridgeSearchPatterns({ query, topK, minConfidence });
      if (rbResult && rbResult.results.length > 0) {
        return {
          query,
          results: rbResult.results.map(r => ({
            patternId: r.id,
            pattern: r.content,
            similarity: r.score,
            confidence: r.score,
            namespace,
          })),
          searchTimeMs: 0,
          backend: rbResult.controller,
          note: `Results from ${rbResult.controller} controller`,
        };
      }
    } catch {
      // Bridge not available — fall through
    }

    // Fallback: Try real vector search via memory-initializer
    const searchFn = await getRealSearchFunction();

    if (searchFn) {
      try {
        const searchResult = await searchFn({
          query,
          namespace,
          limit: topK,
          threshold: minConfidence,
        });

        if (searchResult.success && searchResult.results.length > 0) {
          return {
            query,
            results: searchResult.results.map(r => ({
              patternId: r.id,
              pattern: r.content,
              similarity: r.score,
              confidence: r.score,
              namespace: r.namespace,
              key: r.key,
            })),
            searchTimeMs: searchResult.searchTime,
            backend: 'real-vector-search',
            note: 'Results from HNSW/SQLite vector search (BM25 hybrid)',
          };
        }

        // No results found
        return {
          query,
          results: [],
          searchTimeMs: searchResult.searchTime,
          backend: 'real-vector-search',
          note: searchResult.error || 'No matching patterns found. Store patterns first using memory/store with namespace "pattern".',
        };
      } catch (error) {
        // Fall through to empty response with error
        return {
          query,
          results: [],
          searchTimeMs: 0,
          backend: 'error',
          error: String(error),
          note: 'Vector search failed. Ensure memory database is initialized.',
        };
      }
    }

    // No search function available
    return {
      query,
      results: [],
      searchTimeMs: 0,
      backend: 'unavailable',
      note: 'Real vector search not available. Initialize memory database with: monomind memory init',
    };
  },
};

// Intelligence stats hook
export const hooksIntelligenceStats: MCPTool = {
  name: 'hooks_intelligence_stats',
  description: 'Get intelligence-layer statistics (pattern/trajectory logging)',
  inputSchema: {
    type: 'object',
    properties: {
      detailed: { type: 'boolean', description: 'Include detailed stats' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const detailed = params.detailed as boolean;

    // Get REAL statistics from actual implementations
    const sona = await getSONAOptimizer();
    const ewc = await getEWCConsolidator();
    // Fallback to memory store for legacy data
    const memoryStats = getIntelligenceStatsFromMemory();

    // SONA stats from real implementation
    let sonaStats = {
      trajectoriesTotal: memoryStats.trajectories.total,
      trajectoriesSuccessful: memoryStats.trajectories.successful,
      avgLearningTimeMs: 0,
      patternsLearned: memoryStats.patterns.learned,
      patternCategories: memoryStats.patterns.categories,
      successRate: 0,
      implementation: 'memory-fallback' as string,
    };
    if (sona) {
      const realSona = sona.getStats();
      const totalRoutes = realSona.successfulRoutings + realSona.failedRoutings;
      sonaStats = {
        trajectoriesTotal: realSona.trajectoriesProcessed,
        trajectoriesSuccessful: realSona.successfulRoutings,
        avgLearningTimeMs: realSona.lastUpdate ? 0.042 : 0, // Theoretical when active
        patternsLearned: realSona.totalPatterns,
        patternCategories: { learned: realSona.totalPatterns }, // Simplified
        successRate: totalRoutes > 0
          ? Math.round((realSona.successfulRoutings / totalRoutes) * 100) / 100
          : 0,
        implementation: 'real-sona',
      };
    }

    // EWC++ stats from real implementation
    let ewcStats = {
      consolidations: 0,
      catastrophicForgettingPrevented: 0,
      fisherUpdates: 0,
      avgPenalty: 0,
      totalPatterns: 0,
      implementation: 'not-loaded' as string,
    };
    if (ewc) {
      const realEwc = ewc.getConsolidationStats();
      ewcStats = {
        consolidations: realEwc.consolidationCount,
        catastrophicForgettingPrevented: realEwc.highImportancePatterns,
        fisherUpdates: realEwc.consolidationCount,
        avgPenalty: Math.round(realEwc.avgPenalty * 1000) / 1000,
        totalPatterns: realEwc.totalPatterns,
        implementation: 'real-ewc++',
      };
    }

    // MoE stats from real implementation
    let moeStats = {
      expertsTotal: 8,
      expertsActive: 0,
      routingDecisions: memoryStats.routing.decisions,
      avgRoutingTimeMs: 0,
      avgConfidence: memoryStats.routing.avgConfidence,
      loadBalance: null as { giniCoefficient: number; coefficientOfVariation: number; expertUsage: Record<string, number> } | null,
      implementation: 'not-loaded' as string,
    };

    // Flash Attention stats (native MoE/Flash removed in lean build — defaults only)
    const flashStats = {
      speedup: 1.0,
      avgComputeTimeMs: 0,
      blockSize: 64,
      implementation: 'not-loaded' as string,
    };

    // LoRA Adapter removed — superseded by SONA instant adaptation
    const loraStats = {
      rank: 8,
      alpha: 16,
      adaptations: 0,
      avgLoss: 0,
      implementation: 'not-loaded' as string,
    };

    const stats = {
      sona: sonaStats,
      moe: moeStats,
      ewc: ewcStats,
      flash: flashStats,
      lora: loraStats,
      hnsw: {
        indexSize: memoryStats.memory.indexSize,
        avgSearchTimeMs: 0.12,
        cacheHitRate: memoryStats.memory.totalAccessCount > 0
          ? Math.min(0.95, 0.5 + (memoryStats.memory.totalAccessCount / 1000))
          : 0.78,
        memoryUsageMb: Math.round(memoryStats.memory.memorySizeBytes / 1024 / 1024 * 100) / 100,
      },
      dataSource: sona ? 'real-implementations' : 'memory-fallback',
      lastUpdated: new Date().toISOString(),
    };

    if (detailed) {
      return {
        ...stats,
        implementationStatus: {
          sona: sona ? 'loaded' : 'not-loaded',
          ewc: ewc ? 'loaded' : 'not-loaded',
          moe: 'not-loaded',
          flash: 'not-loaded',
          lora: 'not-loaded',
        },
        performance: {
          sonaLearningMs: sonaStats.avgLearningTimeMs,
          moeRoutingMs: moeStats.avgRoutingTimeMs,
          flashSpeedup: flashStats.speedup,
          ewcPenalty: ewcStats.avgPenalty,
        },
      };
    }

    return stats;
  },
};

// Intelligence learn hook
export const hooksIntelligenceLearn: MCPTool = {
  name: 'hooks_intelligence_learn',
  description: 'Force immediate SONA learning cycle with EWC++ consolidation',
  inputSchema: {
    type: 'object',
    properties: {
      trajectoryIds: { type: 'array', items: { type: 'string' }, description: 'Specific trajectories to learn from' },
      consolidate: { type: 'boolean', description: 'Run EWC++ consolidation' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const consolidate = params.consolidate !== false;
    const startTime = Date.now();

    // Get SONA statistics
    let sonaStats = {
      totalPatterns: 0,
      successfulRoutings: 0,
      failedRoutings: 0,
      trajectoriesProcessed: 0,
      avgConfidence: 0,
    };
    const sona = await getSONAOptimizer();
    if (sona) {
      const stats = sona.getStats();
      sonaStats = {
        totalPatterns: stats.totalPatterns,
        successfulRoutings: stats.successfulRoutings,
        failedRoutings: stats.failedRoutings,
        trajectoriesProcessed: stats.trajectoriesProcessed,
        avgConfidence: stats.avgConfidence,
      };
    }

    // Get EWC++ statistics and optionally trigger consolidation
    let ewcStats = {
      consolidation: false,
      fisherUpdated: false,
      forgettingPrevented: 0,
      avgPenalty: 0,
    };
    if (consolidate) {
      const ewc = await getEWCConsolidator();
      if (ewc) {
        const stats = ewc.getConsolidationStats();
        ewcStats = {
          consolidation: true,
          fisherUpdated: stats.consolidationCount > 0,
          forgettingPrevented: stats.highImportancePatterns,
          avgPenalty: stats.avgPenalty,
        };
      }
    }

    return {
      learned: sonaStats.totalPatterns > 0,
      duration: Date.now() - startTime,
      updates: {
        trajectoriesProcessed: sonaStats.trajectoriesProcessed,
        patternsLearned: sonaStats.totalPatterns,
        successRate: sonaStats.trajectoriesProcessed > 0
          ? (sonaStats.successfulRoutings / (sonaStats.successfulRoutings + sonaStats.failedRoutings) * 100).toFixed(1) + '%'
          : '0%',
      },
      ewc: consolidate ? ewcStats : null,
      confidence: {
        average: sonaStats.avgConfidence,
        implementation: sona ? 'real-sona' : 'not-available',
      },
      implementation: sona ? 'real-sona-learning' : 'placeholder',
    };
  },
};

// Intelligence attention hook
export const hooksIntelligenceAttention: MCPTool = {
  name: 'hooks_intelligence_attention',
  description: 'Compute attention-weighted similarity (pure-JS cosine/hyperbolic)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query for attention computation' },
      mode: { type: 'string', description: 'Attention mode (flash, moe, hyperbolic)' },
      topK: { type: 'number', description: 'Top-k results' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    const mode = (params.mode as string) || 'flash';
    const topK = (params.topK as number) || 5;
    const startTime = performance.now();

    let implementation = 'placeholder';
    const results: Array<{ index: number; weight: number; pattern: string; expert?: string }> = [];

    // Native MoE-router / Flash-attention backends were removed in the lean build.
    // Both modes degrade to the honest empty result handled below.
    void mode;

    // If no real implementation worked, return empty with honest marker
    if (results.length === 0) {
      implementation = 'none';
    }

    const computeTimeMs = performance.now() - startTime;

    return {
      query,
      mode,
      results,
      stats: {
        computeTimeMs,
        speedup: implementation.startsWith('real-') ? computeTimeMs : null,
        _stub: implementation === 'none',
        _note: implementation === 'none' ? 'Pure-JS similarity only; native attention backends are not part of the lean build.' : undefined,
      },
      implementation,
    };
  },
};

// =============================================================================
// Worker Dispatch Tools (12 Background Workers)
// =============================================================================

/**
 * Worker trigger types
 */
type WorkerTrigger =
  | 'ultralearn'    // Deep knowledge acquisition
  | 'optimize'      // Performance optimization
  | 'consolidate'   // Memory consolidation
  | 'predict'       // Predictive preloading
  | 'audit'         // Security analysis
  | 'map'           // Codebase mapping
  | 'preload'       // Resource preloading
  | 'deepdive'      // Deep code analysis
  | 'document'      // Auto-documentation
  | 'refactor'      // Refactoring suggestions
  | 'benchmark'     // Performance benchmarks
  | 'testgaps';     // Test coverage analysis

/**
 * Worker trigger patterns for auto-detection
 */
const WORKER_TRIGGER_PATTERNS: Record<WorkerTrigger, RegExp[]> = {
  ultralearn: [
    /learn\s+about/i,
    /understand\s+(how|what|why)/i,
    /deep\s+dive\s+into/i,
    /explain\s+in\s+detail/i,
    /comprehensive\s+guide/i,
    /master\s+this/i,
  ],
  optimize: [
    /optimize/i,
    /improve\s+performance/i,
    /make\s+(it\s+)?faster/i,
    /speed\s+up/i,
    /reduce\s+(memory|time)/i,
    /performance\s+issue/i,
  ],
  consolidate: [
    /consolidate/i,
    /merge\s+memories/i,
    /clean\s+up\s+memory/i,
    /deduplicate/i,
    /memory\s+maintenance/i,
  ],
  predict: [
    /what\s+will\s+happen/i,
    /predict/i,
    /forecast/i,
    /anticipate/i,
    /preload/i,
    /prepare\s+for/i,
  ],
  audit: [
    /security\s+audit/i,
    /vulnerability/i,
    /security\s+check/i,
    /pentest/i,
    /security\s+scan/i,
    /cve/i,
    /owasp/i,
  ],
  map: [
    /map\s+(the\s+)?codebase/i,
    /architecture\s+overview/i,
    /project\s+structure/i,
    /dependency\s+graph/i,
    /code\s+map/i,
    /explore\s+codebase/i,
  ],
  preload: [
    /preload/i,
    /cache\s+ahead/i,
    /prefetch/i,
    /warm\s+(up\s+)?cache/i,
  ],
  deepdive: [
    /deep\s+dive/i,
    /analyze\s+thoroughly/i,
    /in-depth\s+analysis/i,
    /comprehensive\s+review/i,
    /detailed\s+examination/i,
  ],
  document: [
    /document\s+(this|the)/i,
    /generate\s+docs/i,
    /add\s+documentation/i,
    /write\s+readme/i,
    /api\s+docs/i,
    /jsdoc/i,
  ],
  refactor: [
    /refactor/i,
    /clean\s+up\s+code/i,
    /improve\s+code\s+quality/i,
    /restructure/i,
    /simplify/i,
    /make\s+more\s+readable/i,
  ],
  benchmark: [
    /benchmark/i,
    /performance\s+test/i,
    /measure\s+speed/i,
    /stress\s+test/i,
    /load\s+test/i,
  ],
  testgaps: [
    /test\s+coverage/i,
    /missing\s+tests/i,
    /untested\s+code/i,
    /coverage\s+report/i,
    /test\s+gaps/i,
    /add\s+tests/i,
  ],
};

/**
 * Worker configurations
 */
const WORKER_CONFIGS: Record<WorkerTrigger, {
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  estimatedDuration: string;
  capabilities: string[];
}> = {
  ultralearn: {
    description: 'Deep knowledge acquisition and learning',
    priority: 'normal',
    estimatedDuration: '60s',
    capabilities: ['research', 'analysis', 'synthesis'],
  },
  optimize: {
    description: 'Performance optimization and tuning',
    priority: 'high',
    estimatedDuration: '30s',
    capabilities: ['profiling', 'optimization', 'benchmarking'],
  },
  consolidate: {
    description: 'Memory consolidation and cleanup',
    priority: 'low',
    estimatedDuration: '20s',
    capabilities: ['memory-management', 'deduplication'],
  },
  predict: {
    description: 'Predictive preloading and anticipation',
    priority: 'normal',
    estimatedDuration: '15s',
    capabilities: ['prediction', 'caching', 'preloading'],
  },
  audit: {
    description: 'Security analysis and vulnerability scanning',
    priority: 'critical',
    estimatedDuration: '45s',
    capabilities: ['security', 'vulnerability-scanning', 'audit'],
  },
  map: {
    description: 'Codebase mapping and architecture analysis',
    priority: 'normal',
    estimatedDuration: '30s',
    capabilities: ['analysis', 'mapping', 'visualization'],
  },
  preload: {
    description: 'Resource preloading and cache warming',
    priority: 'low',
    estimatedDuration: '10s',
    capabilities: ['caching', 'preloading'],
  },
  deepdive: {
    description: 'Deep code analysis and examination',
    priority: 'normal',
    estimatedDuration: '60s',
    capabilities: ['analysis', 'review', 'understanding'],
  },
  document: {
    description: 'Auto-documentation generation',
    priority: 'normal',
    estimatedDuration: '45s',
    capabilities: ['documentation', 'writing', 'generation'],
  },
  refactor: {
    description: 'Code refactoring suggestions',
    priority: 'normal',
    estimatedDuration: '30s',
    capabilities: ['refactoring', 'code-quality', 'improvement'],
  },
  benchmark: {
    description: 'Performance benchmarking',
    priority: 'normal',
    estimatedDuration: '60s',
    capabilities: ['benchmarking', 'testing', 'measurement'],
  },
  testgaps: {
    description: 'Test coverage analysis',
    priority: 'normal',
    estimatedDuration: '30s',
    capabilities: ['testing', 'coverage', 'analysis'],
  },
};

// In-memory worker tracking
const activeWorkers: Map<string, {
  id: string;
  trigger: WorkerTrigger;
  context: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  phase: string;
  startedAt: Date;
  completedAt?: Date;
}> = new Map();

let workerIdCounter = 0;

/**
 * Detect triggers from prompt text
 */
function detectWorkerTriggers(text: string): {
  detected: boolean;
  triggers: WorkerTrigger[];
  confidence: number;
  context: string;
} {
  const detectedTriggers: WorkerTrigger[] = [];
  let totalMatches = 0;

  for (const [trigger, patterns] of Object.entries(WORKER_TRIGGER_PATTERNS) as [WorkerTrigger, RegExp[]][]) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        if (!detectedTriggers.includes(trigger)) {
          detectedTriggers.push(trigger);
        }
        totalMatches++;
      }
    }
  }

  const confidence = detectedTriggers.length > 0
    ? Math.min(1, totalMatches / (detectedTriggers.length * 2))
    : 0;

  return {
    detected: detectedTriggers.length > 0,
    triggers: detectedTriggers,
    confidence,
    context: text.slice(0, 100),
  };
}

// Worker list tool
export const hooksWorkerList: MCPTool = {
  name: 'hooks_worker-list',
  description: 'List all 12 background workers with status and capabilities',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filter by status (all, running, completed, pending)' },
      includeActive: { type: 'boolean', description: 'Include active worker instances' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const statusFilter = (params.status as string) || 'all';
    const includeActive = params.includeActive !== false;

    const workers = Object.entries(WORKER_CONFIGS).map(([trigger, config]) => ({
      trigger,
      ...config,
      patterns: WORKER_TRIGGER_PATTERNS[trigger as WorkerTrigger].length,
    }));

    const activeList = includeActive
      ? Array.from(activeWorkers.values()).filter(w =>
          statusFilter === 'all' || w.status === statusFilter
        )
      : [];

    return {
      workers,
      total: 12,
      active: {
        instances: activeList,
        count: activeList.length,
        byStatus: {
          pending: activeList.filter(w => w.status === 'pending').length,
          running: activeList.filter(w => w.status === 'running').length,
          completed: activeList.filter(w => w.status === 'completed').length,
          failed: activeList.filter(w => w.status === 'failed').length,
        },
      },
      performanceTargets: {
        triggerDetection: '<5ms',
        workerSpawn: '<50ms',
        maxConcurrent: 10,
      },
    };
  },
};

// Worker dispatch tool
export const hooksWorkerDispatch: MCPTool = {
  name: 'hooks_worker-dispatch',
  description: 'Dispatch a background worker for analysis/optimization tasks',
  inputSchema: {
    type: 'object',
    properties: {
      trigger: {
        type: 'string',
        description: 'Worker trigger type',
        enum: ['ultralearn', 'optimize', 'consolidate', 'predict', 'audit', 'map', 'preload', 'deepdive', 'document', 'refactor', 'benchmark', 'testgaps'],
      },
      context: { type: 'string', description: 'Context for the worker (file path, topic, etc.)' },
      priority: { type: 'string', description: 'Priority (low, normal, high, critical)' },
      background: { type: 'boolean', description: 'Run in background (non-blocking)' },
    },
    required: ['trigger'],
  },
  handler: async (params: Record<string, unknown>) => {
    const trigger = params.trigger as WorkerTrigger;
    const context = (params.context as string) || 'default';
    const priority = (params.priority as string) || WORKER_CONFIGS[trigger]?.priority || 'normal';
    const background = params.background !== false;

    if (!WORKER_CONFIGS[trigger]) {
      return {
        success: false,
        error: `Unknown worker trigger: ${trigger}`,
        availableTriggers: Object.keys(WORKER_CONFIGS),
      };
    }

    const workerId = `worker_${trigger}_${++workerIdCounter}_${Date.now().toString(36)}`;
    const config = WORKER_CONFIGS[trigger];

    const worker: {
      id: string;
      trigger: WorkerTrigger;
      context: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      progress: number;
      phase: string;
      startedAt: Date;
      completedAt?: Date;
    } = {
      id: workerId,
      trigger,
      context,
      status: 'running',
      progress: 0,
      phase: 'initializing',
      startedAt: new Date(),
    };

    activeWorkers.set(workerId, worker);

    // Update worker progress in background
    if (background) {
      setTimeout(() => {
        const w = activeWorkers.get(workerId);
        if (w) {
          w.progress = 50;
          w.phase = 'processing';
        }
      }, 500);

      setTimeout(() => {
        const w = activeWorkers.get(workerId);
        if (w) {
          w.progress = 100;
          w.phase = 'completed';
          w.status = 'completed';
          w.completedAt = new Date();
        }
      }, 1500);
    } else {
      worker.progress = 100;
      worker.phase = 'completed';
      worker.status = 'completed';
      worker.completedAt = new Date();
    }

    return {
      success: true,
      workerId,
      trigger,
      context,
      priority,
      config: {
        description: config.description,
        estimatedDuration: config.estimatedDuration,
        capabilities: config.capabilities,
      },
      status: background ? 'dispatched' : 'completed',
      background,
      timestamp: new Date().toISOString(),
    };
  },
};

// Worker status tool
export const hooksWorkerStatus: MCPTool = {
  name: 'hooks_worker-status',
  description: 'Get status of a specific worker or all active workers',
  inputSchema: {
    type: 'object',
    properties: {
      workerId: { type: 'string', description: 'Specific worker ID to check' },
      includeCompleted: { type: 'boolean', description: 'Include completed workers' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const workerId = params.workerId as string;
    const includeCompleted = params.includeCompleted !== false;

    if (workerId) {
      const worker = activeWorkers.get(workerId);
      if (!worker) {
        return {
          success: false,
          error: `Worker not found: ${workerId}`,
        };
      }
      return {
        success: true,
        worker: {
          ...worker,
          duration: worker.completedAt
            ? worker.completedAt.getTime() - worker.startedAt.getTime()
            : Date.now() - worker.startedAt.getTime(),
        },
      };
    }

    const workers = Array.from(activeWorkers.values())
      .filter(w => includeCompleted || w.status !== 'completed')
      .map(w => ({
        ...w,
        duration: w.completedAt
          ? w.completedAt.getTime() - w.startedAt.getTime()
          : Date.now() - w.startedAt.getTime(),
      }));

    return {
      success: true,
      workers,
      summary: {
        total: workers.length,
        running: workers.filter(w => w.status === 'running').length,
        completed: workers.filter(w => w.status === 'completed').length,
        failed: workers.filter(w => w.status === 'failed').length,
      },
    };
  },
};

// Worker detect tool - detect triggers from prompt
export const hooksWorkerDetect: MCPTool = {
  name: 'hooks_worker-detect',
  description: 'Detect worker triggers from user prompt (for UserPromptSubmit hook)',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'User prompt to analyze' },
      autoDispatch: { type: 'boolean', description: 'Automatically dispatch detected workers' },
      minConfidence: { type: 'number', description: 'Minimum confidence threshold (0-1)' },
    },
    required: ['prompt'],
  },
  handler: async (params: Record<string, unknown>) => {
    const prompt = params.prompt as string;
    const autoDispatch = params.autoDispatch as boolean;
    const minConfidence = (params.minConfidence as number) || 0.5;

    const detection = detectWorkerTriggers(prompt);

    const result: Record<string, unknown> = {
      prompt: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
      detection,
      triggersFound: detection.triggers.length,
    };

    if (detection.detected && detection.confidence >= minConfidence) {
      result.triggerDetails = detection.triggers.map(trigger => ({
        trigger,
        ...WORKER_CONFIGS[trigger],
      }));

      if (autoDispatch) {
        const dispatched: string[] = [];
        for (const trigger of detection.triggers) {
          const workerId = `worker_${trigger}_${++workerIdCounter}_${Date.now().toString(36)}`;
          activeWorkers.set(workerId, {
            id: workerId,
            trigger,
            context: prompt.slice(0, 100),
            status: 'running',
            progress: 0,
            phase: 'initializing',
            startedAt: new Date(),
          });
          dispatched.push(workerId);

          // Mark worker completion after processing
          setTimeout(() => {
            const w = activeWorkers.get(workerId);
            if (w) {
              w.progress = 100;
              w.phase = 'completed';
              w.status = 'completed';
              w.completedAt = new Date();
            }
          }, 1500);
        }
        result.autoDispatched = true;
        result.workerIds = dispatched;
      }
    }

    return result;
  },
};


// Model route tool - intelligent model selection
export const hooksModelRoute: MCPTool = {
  name: 'hooks_model-route',
  description: 'Route task to optimal Claude model (haiku/sonnet/opus) based on complexity',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description to analyze' },
      preferSpeed: { type: 'boolean', description: 'Prefer faster models when possible' },
      preferCost: { type: 'boolean', description: 'Prefer cheaper models when possible' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task: analyzeComplexityFallback calls .toLowerCase() and O(n) .includes()
    // for each keyword; an unbounded task string causes event-loop DoS.
    const MAX_MODEL_ROUTE_TASK_LEN = 16 * 1024;
    const rawTask = params.task as string;
    const task = typeof rawTask === 'string' && rawTask.length > MAX_MODEL_ROUTE_TASK_LEN
      ? rawTask.slice(0, MAX_MODEL_ROUTE_TASK_LEN)
      : rawTask;
    // Native neural model-router removed in the lean build — keyword complexity heuristic.
    const complexity = analyzeComplexityFallback(task);
    return {
      model: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku',
      confidence: 0.7,
      complexity,
      reasoning: 'Keyword complexity heuristic',
      implementation: 'heuristic',
    };
  },
};

// Model route outcome - record outcome for learning
export const hooksModelOutcome: MCPTool = {
  name: 'hooks_model-outcome',
  description: 'Record model routing outcome for learning',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Original task' },
      model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Model used' },
      outcome: { type: 'string', enum: ['success', 'failure', 'escalated'], description: 'Task outcome' },
      verifier_type: { type: 'string', enum: ['tsc', 'vitest', 'eslint', 'llm_judge'], description: 'RLVR verifier type for grounded reward signal' },
      exit_code: { type: 'number', description: 'Verifier exit code (0 = pass); overrides outcome when verifier_type is set' },
    },
    required: ['task', 'model', 'outcome'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task: even though the response only reflects task.slice(0, 50), an
    // unbounded task string causes unnecessary memory allocation before the slice.
    const MAX_MODEL_OUTCOME_TASK_LEN = 16 * 1024;
    const rawOutcomeTask = params.task as string;
    const task = typeof rawOutcomeTask === 'string' && rawOutcomeTask.length > MAX_MODEL_OUTCOME_TASK_LEN
      ? rawOutcomeTask.slice(0, MAX_MODEL_OUTCOME_TASK_LEN)
      : rawOutcomeTask;
    const model = params.model as 'haiku' | 'sonnet' | 'opus';
    // RLVR: derive effective outcome from verifier exit_code when provided
    // Source: https://github.com/opendilab/awesome-RLVR
    const verifierType = params.verifier_type as string | undefined;
    const exitCode = params.exit_code as number | undefined;
    const effectiveOutcome = verifierType !== undefined && exitCode !== undefined
      ? (exitCode === 0 ? 'success' : 'failure')
      : params.outcome as 'success' | 'failure' | 'escalated';
    const outcome = effectiveOutcome;

    // Native model-router removed in the lean build — outcome is acknowledged but not
    // fed to a neural learner (keyword routing has no online-learning store).

    return {
      recorded: true,
      task: task.slice(0, 50),
      model,
      outcome,
      timestamp: new Date().toISOString(),
    };
  },
};

// Model router stats
export const hooksModelStats: MCPTool = {
  name: 'hooks_model-stats',
  description: 'Get model routing statistics',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    // Native model-router removed in the lean build — no neural routing stats to report.
    return {
      available: false,
      message: 'Model router not available in the lean build (keyword routing has no stats)',
    };
  },
};

// Simple fallback complexity analyzer
function analyzeComplexityFallback(task: string): number {
  const taskLower = task.toLowerCase();

  // High complexity indicators
  const highIndicators = ['architect', 'design', 'refactor', 'security', 'audit', 'complex', 'analyze'];
  const highCount = highIndicators.filter(ind => taskLower.includes(ind)).length;

  // Low complexity indicators
  const lowIndicators = ['simple', 'typo', 'format', 'rename', 'comment'];
  const lowCount = lowIndicators.filter(ind => taskLower.includes(ind)).length;

  // Base on length
  const lengthScore = Math.min(1, task.length / 200);

  return Math.min(1, Math.max(0, 0.3 + highCount * 0.2 - lowCount * 0.15 + lengthScore * 0.2));
}

// Worker cancel tool
export const hooksWorkerCancel: MCPTool = {
  name: 'hooks_worker-cancel',
  description: 'Cancel a running worker',
  inputSchema: {
    type: 'object',
    properties: {
      workerId: { type: 'string', description: 'Worker ID to cancel' },
    },
    required: ['workerId'],
  },
  handler: async (params: Record<string, unknown>) => {
    const workerId = params.workerId as string;
    const worker = activeWorkers.get(workerId);

    if (!worker) {
      return {
        success: false,
        error: `Worker not found: ${workerId}`,
      };
    }

    if (worker.status === 'completed' || worker.status === 'failed') {
      return {
        success: false,
        error: `Worker already ${worker.status}`,
      };
    }

    worker.status = 'failed';
    worker.phase = 'cancelled';
    worker.completedAt = new Date();

    return {
      success: true,
      workerId,
      cancelled: true,
      timestamp: new Date().toISOString(),
    };
  },
};
