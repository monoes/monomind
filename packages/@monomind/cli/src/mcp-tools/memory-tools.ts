/**
 * Memory MCP Tools — Phase 6 of ADR-053
 *
 * Exposes Memory backend operations as MCP tools: pattern store/search,
 * usage-weighted feedback (EWMA), the conversation knowledge graph
 * (memory_kg_*), session records, weight-aware GC, and bridge health.
 *
 * Security: All handlers validate input types, enforce length bounds,
 * and sanitize error messages before returning to MCP callers.
 *
 * @module v1/cli/mcp-tools/memory-tools
 */

import type { MCPTool } from './types.js';

// ===== Shared validation helpers =====

const MAX_STRING_LENGTH = 100_000; // 100KB max for any string input
const MAX_BATCH_SIZE = 500;        // Max entries per batch operation
const MAX_TOP_K = 100;             // Max results per query

// Reject NUL and C0 control chars except \t \n \r. NUL truncates strings at
// the C-API boundary in some bridge backends (key collision); ANSI/control
// chars enable terminal injection when values are echoed back; \r/\n in
// values fed to log files breaks log-line integrity.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
function validateString(value: unknown, name: string, maxLen = MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > maxLen) return null;
  if (CONTROL_CHAR_RE.test(value)) return null;
  return value;
}

function validatePositiveInt(value: unknown, defaultVal: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultVal;
  const n = Math.floor(value);
  return n > 0 ? Math.min(n, max) : defaultVal;
}

function validateScore(value: unknown, defaultVal: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultVal;
  return Math.max(0, Math.min(1, value));
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Strip filesystem paths from error messages — match path components even
    // when no trailing slash (path at end of message before whitespace, colon, EOL)
    return error.message
      .replace(/\/[^\s:]+(\/|(?=\s|:|$))/g, '<path>/')
      .substring(0, 500);
  }
  return 'Internal error';
}

// Lazy-cached bridge module
let bridgeModule: typeof import('../memory/memory-bridge.js') | null = null;
async function getBridge() {
  if (!bridgeModule) {
    bridgeModule = await import('../memory/memory-bridge.js');
  }
  return bridgeModule;
}

// ===== memory_health — Controller health check =====

export const memoryHealth: MCPTool = {
  name: 'memory_health',
  description: 'Get Memory backend health status including cache stats and attestation count',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    try {
      const bridge = await getBridge();
      const health = await bridge.bridgeHealthCheck();
      if (!health) return { available: false, error: 'Memory bridge not available' };
      return health;
    } catch (error) {
      return { available: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_controllers — List all controllers =====

export const memoryControllers: MCPTool = {
  name: 'memory_controllers',
  description: 'List all Memory backends and their initialization status',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    try {
      const bridge = await getBridge();
      const controllers = await bridge.bridgeListControllers();
      if (!controllers) return { available: false, controllers: [], error: 'Memory bridge not available — @monomind/memory not installed or missing controller-registry. Use memory_store/memory_search tools instead.' };
      return {
        available: true,
        controllers: controllers.controllers,
        total: controllers.controllers.length,
        active: controllers.active.length,
      };
    } catch (error) {
      return { available: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_pattern_store — Store via ReasoningBank =====

export const memoryPatternStore: MCPTool = {
  name: 'memory_pattern-store',
  description: 'Store a reusable pattern (embedded, semantically searchable) in the patterns namespace',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern description' },
      type: { type: 'string', description: 'Pattern type (e.g., task-routing, error-recovery)' },
      confidence: { type: 'number', description: 'Confidence score (0-1)' },
    },
    required: ['pattern'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const pattern = validateString(params.pattern, 'pattern');
      if (!pattern) return { success: false, error: 'pattern is required (non-empty string, max 100KB)' };

      // validateExternalContent: guard against prompt injection in stored patterns.
      // This is a WRITE to persistent memory, so it fails CLOSED: if
      // validation throws, the write is blocked rather than silently
      // persisted unvalidated.
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(pattern, 'memory_pattern-store pattern');
        if (!check.safe) {
          return { success: false, error: `Injection guard: ${check.reason}`, injectionDetected: true };
        }
      }

      const bridge = await getBridge();
      const result = await bridge.bridgeStorePattern({
        pattern,
        taskType: validateString(params.type, 'type', 200) ?? 'general',
        confidence: validateScore(params.confidence, 0.8),
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_pattern_search — Search via ReasoningBank =====

export const memoryPatternSearch: MCPTool = {
  name: 'memory_pattern-search',
  description: 'Search stored patterns — semantic when the local embedding model is available, keyword otherwise',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
      minConfidence: { type: 'number', description: 'Minimum score threshold (0-1)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query) return { results: [], error: 'query is required (non-empty string, max 10KB)' };

      // validateExternalContent: guard against prompt injection in search queries.
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(query, 'memory_pattern-search query');
        if (!check.safe) {
          return { results: [], error: `Injection guard: ${check.reason}`, injectionDetected: true };
        }
      }

      const bridge = await getBridge();
      const minConfidence = validateScore(params.minConfidence, 0.3);
      const result = await bridge.bridgeSearchPatterns({
        query,
        limit: validatePositiveInt(params.topK, 5, MAX_TOP_K),
      });
      if (!result) return { results: [], controller: 'unavailable' };
      return {
        ...result,
        patterns: result.patterns.filter((p: { score: number }) => p.score >= minConfidence),
      };
    } catch (error) {
      return { results: [], error: sanitizeError(error) };
    }
  },
};

// ===== memory_feedback — Record task feedback =====

export const memoryFeedback: MCPTool = {
  name: 'memory_feedback',
  description: 'Rate the usefulness of memory entries that produced an answer. Pass the entryIds returned by a prior search — their feedback_weight is EWMA-updated and blended into future ranking. Idempotent per taskId.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task identifier (also the idempotency key — the same taskId never double-applies)' },
      entryIds: { type: 'array', items: { type: 'string' }, description: 'Memory entry IDs (from search results) that were used for this task' },
      success: { type: 'boolean', description: 'Whether task succeeded' },
      quality: { type: 'number', description: 'Quality score (0-1); defaults from success (0.9/0.2)' },
      agent: { type: 'string', description: 'Agent that performed the task' },
    },
    required: ['taskId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const taskId = validateString(params.taskId, 'taskId', 500);
      if (!taskId) return { success: false, error: 'taskId is required (non-empty string, max 500 chars)' };
      const bridge = await getBridge();

      // Closed loop: apply the rating to the entries that were actually used.
      const entryIds = Array.isArray(params.entryIds)
        ? (params.entryIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 500).slice(0, 100)
        : [];
      let weighting: unknown = null;
      if (entryIds.length) {
        const score = typeof params.quality === 'number' && Number.isFinite(params.quality)
          ? Math.max(0, Math.min(1, params.quality))
          : (params.success === true ? 0.9 : 0.2);
        weighting = await bridge.bridgeApplyFeedback({ entryIds, score, ledgerKey: taskId });
      }

      // Keep the historical feedback-event record alongside the weighting.
      const result = await bridge.bridgeRecordFeedback({
        taskType: validateString(params.agent, 'agent', 200) ?? 'task',
        action: taskId,
        outcome: params.success === true ? 'success' : 'failure',
        confidence: validateScore(params.quality, 0.85),
        metadata: { taskId, entryIds },
      });
      if (!result) return { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
      return { ...result, weighting };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_causal_edge — Record causal relationships =====

export const memoryCausalEdge: MCPTool = {
  name: 'memory_causal-edge',
  description: 'Record a causal relationship between two named things as a real knowledge-graph edge (traversable via memory_kg_search)',
  inputSchema: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'Source entity name (or entry ID)' },
      targetId: { type: 'string', description: 'Target entity name (or entry ID)' },
      relation: { type: 'string', description: 'Relationship type (e.g., causes, preceded, fixed_by)' },
      weight: { type: 'number', description: 'Edge weight (0-1)' },
      description: { type: 'string', description: 'One-sentence concrete fact for this edge' },
    },
    required: ['sourceId', 'targetId', 'relation'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sourceId = validateString(params.sourceId, 'sourceId', 500);
      const targetId = validateString(params.targetId, 'targetId', 500);
      const relation = validateString(params.relation, 'relation', 200);
      if (!sourceId) return { success: false, error: 'sourceId is required (non-empty string)' };
      if (!targetId) return { success: false, error: 'targetId is required (non-empty string)' };
      if (!relation) return { success: false, error: 'relation is required (non-empty string)' };
      const kg = await import('../memory/memory-kg.js');
      const result = await kg.kgIngest({
        nodes: [{ name: sourceId }, { name: targetId }],
        edges: [{ source: sourceId, target: targetId, relation, description: validateString(params.description, 'description', 2000) ?? undefined }],
        originRef: 'causal-edge-tool',
      });
      return result;
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_kg_* — Conversation/org knowledge graph =====

export const memoryKgIngest: MCPTool = {
  name: 'memory_kg_ingest',
  description: 'Merge extracted entities/relations (and optionally distilled rules) into the persistent knowledge graph. Same-name entities merge idempotently. Call with LLM-extracted nodes/edges — basic types ("Person", "Tool"), coreference-resolved fullest names, snake_case relations, one-sentence edge facts. Pass rawText instead to use the lower-trust regex extractor.',
  inputSchema: {
    type: 'object',
    properties: {
      nodes: { type: 'array', items: { type: 'object' }, description: 'Entities: [{name, type?, description?, nodeSet?}]' },
      edges: { type: 'array', items: { type: 'object' }, description: 'Relations: [{source, target, relation, description?}]' },
      rules: { type: 'array', items: { type: 'object' }, description: 'Distilled durable rules: [{rule, context?}] — deduped semantically against existing rules' },
      rawText: { type: 'string', description: 'Fallback: raw text for regex-based extraction (no LLM)' },
      originRef: { type: 'string', description: 'Provenance ref (session/run/doc id) — enables memory_kg_rollback' },
    },
    required: ['originRef'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const originRef = validateString(params.originRef, 'originRef', 500);
      if (!originRef) return { success: false, error: 'originRef is required' };
      const kg = await import('../memory/memory-kg.js');

      let nodes = Array.isArray(params.nodes) ? params.nodes as any[] : [];
      let edges = Array.isArray(params.edges) ? params.edges as any[] : [];
      if (!nodes.length && !edges.length && typeof params.rawText === 'string' && params.rawText.trim()) {
        const extracted = kg.heuristicExtract(params.rawText, { sourceName: originRef });
        nodes = extracted.nodes; edges = extracted.edges;
      }

      const graph = (nodes.length || edges.length)
        ? await kg.kgIngest({ nodes, edges, originRef })
        : { success: true, nodesAdded: 0, nodesMerged: 0, edgesAdded: 0, edgesMerged: 0 };
      const rules = Array.isArray(params.rules) && (params.rules as any[]).length
        ? await kg.kgIngestRules({ rules: params.rules as any[], originRef })
        : null;
      return { ...graph, rules };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgSearch: MCPTool = {
  name: 'memory_kg_search',
  description: 'Search the knowledge graph: vector-seeded entities expanded to ranked relationship triplets. Returns rendered context lines plus seed entry ids (rate them via memory_feedback).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language query' },
      limit: { type: 'number', description: 'Max triplets (default 8)' },
      nodeSet: { type: 'string', description: "Filter to a node set (e.g. 'rules')" },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 2000);
      if (!query) return { success: false, error: 'query is required' };
      const kg = await import('../memory/memory-kg.js');
      return await kg.kgSearch({
        query,
        limit: validatePositiveInt(params.limit, 8, 50),
        nodeSet: validateString(params.nodeSet, 'nodeSet', 100) ?? undefined,
      });
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgRollback: MCPTool = {
  name: 'memory_kg_rollback',
  description: 'Delete all knowledge-graph nodes/edges/rules whose only provenance is the given originRef (bad-ingest recovery). Elements shared with other origins are retained.',
  inputSchema: {
    type: 'object',
    properties: {
      originRef: { type: 'string', description: 'The provenance ref to roll back (session/run/doc id)' },
    },
    required: ['originRef'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const originRef = validateString(params.originRef, 'originRef', 500);
      if (!originRef) return { success: false, error: 'originRef is required' };
      const kg = await import('../memory/memory-kg.js');
      return await kg.kgRollback({ originRef });
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgStats: MCPTool = {
  name: 'memory_kg_stats',
  description: 'Knowledge graph size: node, edge, and rule counts (plus the entity glossary for extraction prompts)',
  inputSchema: {
    type: 'object',
    properties: {
      glossary: { type: 'boolean', description: 'Include top entity names (default false)' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const kg = await import('../memory/memory-kg.js');
      const stats = await kg.kgStats();
      const glossary = params.glossary === true ? await kg.kgGlossary() : undefined;
      return { success: true, ...stats, ...(glossary ? { glossary } : {}) };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_route — Route via SemanticRouter =====

export const memoryRoute: MCPTool = {
  name: 'memory_route',
  description: 'Suggest agent routing for a task by searching past routing patterns',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description to route' },
      context: { type: 'string', description: 'Additional context' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const task = validateString(params.task, 'task', 10_000);
      if (!task) return { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'error', error: 'task is required (non-empty string)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeRouteTask({ task });
      return result ?? { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'fallback' };
    } catch (error) {
      return { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'error', error: sanitizeError(error) };
    }
  },
};

// ===== memory_session_start — Session with ReflexionMemory =====

export const memorySessionStart: MCPTool = {
  name: 'memory_session-start',
  description: 'Record a session start in the sessions namespace',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      context: { type: 'string', description: 'Session context for pattern retrieval' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sessionId = validateString(params.sessionId, 'sessionId', 500);
      if (!sessionId) return { success: false, error: 'sessionId is required (non-empty string)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSessionStart({
        sessionId,
        metadata: { context: validateString(params.context, 'context', 10_000) ?? undefined },
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_session_end — End session + NightlyLearner =====

export const memorySessionEnd: MCPTool = {
  name: 'memory_session-end',
  description: 'Record session end with summary and metrics in the sessions namespace',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      summary: { type: 'string', description: 'Session summary' },
      tasksCompleted: { type: 'number', description: 'Number of tasks completed' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sessionId = validateString(params.sessionId, 'sessionId', 500);
      if (!sessionId) return { success: false, error: 'sessionId is required (non-empty string)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSessionEnd({
        sessionId,
        summary: validateString(params.summary, 'summary', 50_000) ?? undefined,
        metrics: { tasksCompleted: validatePositiveInt(params.tasksCompleted, 0, 10_000) },
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_hierarchical_store — Store to hierarchical memory =====

export const memoryHierarchicalStore: MCPTool = {
  name: 'memory_hierarchical-store',
  description: 'Store into a tier-labeled namespace (tier_working/episodic/semantic). Note: tiers are labels, not automatic promotion',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory entry key' },
      value: { type: 'string', description: 'Memory entry value' },
      tier: {
        type: 'string',
        description: 'Memory tier (working, episodic, semantic)',
        enum: ['working', 'episodic', 'semantic'],
        default: 'working',
      },
    },
    required: ['key', 'value'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const key = validateString(params.key, 'key', 1000);
      const value = validateString(params.value, 'value');
      if (!key) return { success: false, error: 'key is required (non-empty string, max 1KB)' };
      if (!value) return { success: false, error: 'value is required (non-empty string, max 100KB)' };
      const tier = validateString(params.tier, 'tier', 20) ?? 'working';
      if (!['working', 'episodic', 'semantic'].includes(tier)) {
        return { success: false, error: `Invalid tier: ${tier}. Must be working, episodic, or semantic` };
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalStore({ key, value, tier });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_hierarchical_recall — Recall from hierarchical memory =====

export const memoryHierarchicalRecall: MCPTool = {
  name: 'memory_hierarchical-recall',
  description: 'Search tier-labeled namespaces (tier_working/episodic/semantic), or all when no tier given',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Recall query' },
      tier: { type: 'string', description: 'Filter by tier (working, episodic, semantic)' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query) return { results: [], error: 'query is required (non-empty string, max 10KB)' };
      const tier = validateString(params.tier, 'tier', 20);
      if (tier && !['working', 'episodic', 'semantic'].includes(tier)) {
        return { results: [], error: `Invalid tier: ${tier}. Must be working, episodic, or semantic` };
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalRecall({
        query,
        tier: tier ?? undefined,
        topK: validatePositiveInt(params.topK, 5, MAX_TOP_K),
      });
      return result ?? { results: [], error: 'Memory bridge not available. Use memory_search instead.' };
    } catch (error) {
      return { results: [], error: sanitizeError(error) };
    }
  },
};

// ===== memory_consolidate — Run memory consolidation =====

export const memoryConsolidate: MCPTool = {
  name: 'memory_consolidate',
  description: 'Garbage-collect stale, unused memory entries. Weight-aware: entries with high feedback_weight or repeated usage are never collected.',
  inputSchema: {
    type: 'object',
    properties: {
      minAge: { type: 'number', description: 'Minimum age in hours since last update (optional, default 168 = 7 days)' },
      maxEntries: { type: 'number', description: 'Maximum entries to scan (optional)' },
      namespace: { type: 'string', description: "Namespace to GC, or 'all' for every non-protected namespace (optional)" },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await getBridge();
      // Reject NaN and Infinity. typeof === 'number' returns true for both.
      // NaN propagates through arithmetic and corrupts consolidation accounting;
      // Infinity makes `entry.age >= minAge` always false, silently no-op.
      // The bridge expects MILLISECONDS; this param is documented in hours —
      // convert here (previously passed through raw, so 720 hours became 720ms).
      const minAge = typeof params.minAge === 'number' && Number.isFinite(params.minAge)
        ? Math.max(0, Math.min(params.minAge, 24 * 365 * 10)) * 3600 * 1000
        : undefined;
      const result = await bridge.bridgeConsolidate({
        minAge,
        maxEntries: params.maxEntries !== undefined
          ? validatePositiveInt(params.maxEntries, 1000, 10_000)
          : undefined,
        namespace: validateString(params.namespace, 'namespace', 128) ?? undefined,
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_batch — Batch operations (insert, update, delete) =====

export const memoryBatch: MCPTool = {
  name: 'memory_batch',
  description: 'Batch operations on memory entries (insert, update, delete)',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Batch operation type',
        enum: ['insert', 'update', 'delete'],
      },
      entries: {
        type: 'array',
        description: 'Array of {key, value} entries to operate on',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key'],
        },
      },
    },
    required: ['operation', 'entries'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const operation = validateString(params.operation, 'operation', 20);
      if (!operation) return { success: false, error: 'operation is required (string)' };
      if (!['insert', 'update', 'delete'].includes(operation)) {
        return { success: false, error: `Invalid operation: ${operation}. Must be insert, update, or delete` };
      }
      if (!Array.isArray(params.entries) || params.entries.length === 0) {
        return { success: false, error: 'entries is required (non-empty array)' };
      }
      if (params.entries.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Too many entries: ${params.entries.length}. Max is ${MAX_BATCH_SIZE}` };
      }
      // Validate each entry. Aggregate-byte cap prevents 500 entries × 100KB
      // values = 50MB single-call payloads from spiking Node heap to ~200MB
      // (UTF-16 doubling + downstream copies in the bridge layer).
      const MAX_BATCH_BYTES = 1_048_576; // 1 MiB total
      let totalBytes = 0;
      const validatedEntries: Array<{ key: string; value?: string; metadata?: Record<string, unknown> }> = [];
      for (let i = 0; i < params.entries.length; i++) {
        const entry = params.entries[i];
        if (!entry || typeof entry !== 'object') {
          return { success: false, error: `entries[${i}] must be an object` };
        }
        const key = validateString((entry as any).key, `entries[${i}].key`, 1000);
        if (!key) return { success: false, error: `entries[${i}].key is required (non-empty string)` };
        const value = validateString((entry as any).value, `entries[${i}].value`);
        totalBytes += key.length + (value?.length ?? 0);
        if (totalBytes > MAX_BATCH_BYTES) {
          return { success: false, error: `Batch payload exceeds ${MAX_BATCH_BYTES} bytes` };
        }
        validatedEntries.push({ key, value: value ?? undefined });
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeBatchOperation({
        operation,
        entries: validatedEntries,
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_context_synthesize — Synthesize context from memories =====

export const memoryContextSynthesize: MCPTool = {
  name: 'memory_context-synthesize',
  description: 'Concatenate top matching memories into a context block for a query (no summarization)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query to synthesize context for' },
      maxEntries: { type: 'number', description: 'Maximum entries to include (default: 10)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query) return { success: false, error: 'query is required (non-empty string, max 10KB)' };

      // validateExternalContent: guard against prompt injection in synthesized context
      // Source: https://arxiv.org/abs/2302.12173, https://arxiv.org/abs/2310.12815
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(query, 'memory_context-synthesize query');
        if (!check.safe) {
          return { success: false, error: `Injection guard: ${check.reason}`, injectionDetected: true };
        }
      }

      const bridge = await getBridge();
      const result = await bridge.bridgeContextSynthesize({
        query,
        maxEntries: validatePositiveInt(params.maxEntries, 10, MAX_TOP_K),
      });
      return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_semantic_route — Route via SemanticRouter =====

export const memorySemanticRoute: MCPTool = {
  name: 'memory_semantic-route',
  description: 'Route an input via SemanticRouter for intent classification',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input text to route' },
    },
    required: ['input'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const input = validateString(params.input, 'input', 10_000);
      if (!input) return { route: null, error: 'input is required (non-empty string, max 10KB)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSemanticRoute({ input });
      return result ?? { route: null, error: 'Memory bridge not available. Use hooks route instead.' };
    } catch (error) {
      return { route: null, error: sanitizeError(error) };
    }
  },
};

// ===== Export all tools =====

export const memoryTools: MCPTool[] = [
  memoryHealth,
  memoryControllers,
  memoryPatternStore,
  memoryPatternSearch,
  memoryFeedback,
  memoryCausalEdge,
  memoryKgIngest,
  memoryKgSearch,
  memoryKgRollback,
  memoryKgStats,
  memoryRoute,
  memorySessionStart,
  memorySessionEnd,
  memoryHierarchicalStore,
  memoryHierarchicalRecall,
  memoryConsolidate,
  memoryBatch,
  memoryContextSynthesize,
  memorySemanticRoute,
];
