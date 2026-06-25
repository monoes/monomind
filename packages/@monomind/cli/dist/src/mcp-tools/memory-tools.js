/**
 * Memory MCP Tools — Phase 6 of ADR-053
 *
 * Exposes Memory backend operations as MCP tools.
 * Provides direct access to ReasoningBank, CausalGraph, SkillLibrary,
 * AttestationLog, and bridge health through the MCP protocol.
 *
 * Security: All handlers validate input types, enforce length bounds,
 * and sanitize error messages before returning to MCP callers.
 *
 * @module v1/cli/mcp-tools/memory-tools
 */
// ===== Shared validation helpers =====
const MAX_STRING_LENGTH = 100_000; // 100KB max for any string input
const MAX_BATCH_SIZE = 500; // Max entries per batch operation
const MAX_TOP_K = 100; // Max results per query
// Reject NUL and C0 control chars except \t \n \r. NUL truncates strings at
// the C-API boundary in some bridge backends (key collision); ANSI/control
// chars enable terminal injection when values are echoed back; \r/\n in
// values fed to log files breaks log-line integrity.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
function validateString(value, name, maxLen = MAX_STRING_LENGTH) {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    if (value.length > maxLen)
        return null;
    if (CONTROL_CHAR_RE.test(value))
        return null;
    return value;
}
function validatePositiveInt(value, defaultVal, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return defaultVal;
    const n = Math.floor(value);
    return n > 0 ? Math.min(n, max) : defaultVal;
}
function validateScore(value, defaultVal) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return defaultVal;
    return Math.max(0, Math.min(1, value));
}
function sanitizeError(error) {
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
let bridgeModule = null;
async function getBridge() {
    if (!bridgeModule) {
        bridgeModule = await import('../memory/memory-bridge.js');
    }
    return bridgeModule;
}
// ===== memory_health — Controller health check =====
export const memoryHealth = {
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
            if (!health)
                return { available: false, error: 'Memory bridge not available' };
            return health;
        }
        catch (error) {
            return { available: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_controllers — List all controllers =====
export const memoryControllers = {
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
            if (!controllers)
                return { available: false, controllers: [], error: 'Memory bridge not available — @monomind/memory not installed or missing controller-registry. Use memory_store/memory_search tools instead.' };
            return {
                available: true,
                controllers,
                total: controllers.length,
                active: controllers.filter((c) => c.enabled).length,
            };
        }
        catch (error) {
            return { available: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_pattern_store — Store via ReasoningBank =====
export const memoryPatternStore = {
    name: 'memory_pattern-store',
    description: 'Store a pattern directly via ReasoningBank controller',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Pattern description' },
            type: { type: 'string', description: 'Pattern type (e.g., task-routing, error-recovery)' },
            confidence: { type: 'number', description: 'Confidence score (0-1)' },
        },
        required: ['pattern'],
    },
    handler: async (params) => {
        try {
            const pattern = validateString(params.pattern, 'pattern');
            if (!pattern)
                return { success: false, error: 'pattern is required (non-empty string, max 100KB)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeStorePattern({
                pattern,
                type: validateString(params.type, 'type', 200) ?? 'general',
                confidence: validateScore(params.confidence, 0.8),
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_pattern_search — Search via ReasoningBank =====
export const memoryPatternSearch = {
    name: 'memory_pattern-search',
    description: 'Search patterns via ReasoningBank controller with BM25+semantic hybrid',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            topK: { type: 'number', description: 'Number of results (default: 5)' },
            minConfidence: { type: 'number', description: 'Minimum score threshold (0-1)' },
        },
        required: ['query'],
    },
    handler: async (params) => {
        try {
            const query = validateString(params.query, 'query', 10_000);
            if (!query)
                return { results: [], error: 'query is required (non-empty string, max 10KB)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeSearchPatterns({
                query,
                topK: validatePositiveInt(params.topK, 5, MAX_TOP_K),
                minConfidence: validateScore(params.minConfidence, 0.3),
            });
            return result ?? { results: [], controller: 'unavailable' };
        }
        catch (error) {
            return { results: [], error: sanitizeError(error) };
        }
    },
};
// ===== memory_feedback — Record task feedback =====
export const memoryFeedback = {
    name: 'memory_feedback',
    description: 'Record task feedback for learning via LearningSystem + ReasoningBank controllers',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string', description: 'Task identifier' },
            success: { type: 'boolean', description: 'Whether task succeeded' },
            quality: { type: 'number', description: 'Quality score (0-1)' },
            agent: { type: 'string', description: 'Agent that performed the task' },
        },
        required: ['taskId'],
    },
    handler: async (params) => {
        try {
            const taskId = validateString(params.taskId, 'taskId', 500);
            if (!taskId)
                return { success: false, error: 'taskId is required (non-empty string, max 500 chars)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeRecordFeedback({
                taskId,
                success: params.success === true,
                quality: validateScore(params.quality, 0.85),
                agent: validateString(params.agent, 'agent', 200) ?? undefined,
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_causal_edge — Record causal relationships =====
export const memoryCausalEdge = {
    name: 'memory_causal-edge',
    description: 'Record a causal edge between two memory entries via CausalMemoryGraph',
    inputSchema: {
        type: 'object',
        properties: {
            sourceId: { type: 'string', description: 'Source entry ID' },
            targetId: { type: 'string', description: 'Target entry ID' },
            relation: { type: 'string', description: 'Relationship type (e.g., caused, preceded, succeeded)' },
            weight: { type: 'number', description: 'Edge weight (0-1)' },
        },
        required: ['sourceId', 'targetId', 'relation'],
    },
    handler: async (params) => {
        try {
            const sourceId = validateString(params.sourceId, 'sourceId', 500);
            const targetId = validateString(params.targetId, 'targetId', 500);
            const relation = validateString(params.relation, 'relation', 200);
            if (!sourceId)
                return { success: false, error: 'sourceId is required (non-empty string)' };
            if (!targetId)
                return { success: false, error: 'targetId is required (non-empty string)' };
            if (!relation)
                return { success: false, error: 'relation is required (non-empty string)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeRecordCausalEdge({
                sourceId,
                targetId,
                relation,
                weight: typeof params.weight === 'number' ? validateScore(params.weight, 0.5) : undefined,
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_route — Route via SemanticRouter =====
export const memoryRoute = {
    name: 'memory_route',
    description: 'Route a task via SemanticRouter or LearningSystem recommendAlgorithm',
    inputSchema: {
        type: 'object',
        properties: {
            task: { type: 'string', description: 'Task description to route' },
            context: { type: 'string', description: 'Additional context' },
        },
        required: ['task'],
    },
    handler: async (params) => {
        try {
            const task = validateString(params.task, 'task', 10_000);
            if (!task)
                return { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'error', error: 'task is required (non-empty string)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeRouteTask({
                task,
                context: validateString(params.context, 'context', 10_000) ?? undefined,
            });
            return result ?? { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'fallback' };
        }
        catch (error) {
            return { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'error', error: sanitizeError(error) };
        }
    },
};
// ===== memory_session_start — Session with ReflexionMemory =====
export const memorySessionStart = {
    name: 'memory_session-start',
    description: 'Start a session with ReflexionMemory episodic replay',
    inputSchema: {
        type: 'object',
        properties: {
            sessionId: { type: 'string', description: 'Session identifier' },
            context: { type: 'string', description: 'Session context for pattern retrieval' },
        },
        required: ['sessionId'],
    },
    handler: async (params) => {
        try {
            const sessionId = validateString(params.sessionId, 'sessionId', 500);
            if (!sessionId)
                return { success: false, error: 'sessionId is required (non-empty string)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeSessionStart({
                sessionId,
                context: validateString(params.context, 'context', 10_000) ?? undefined,
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_session_end — End session + NightlyLearner =====
export const memorySessionEnd = {
    name: 'memory_session-end',
    description: 'End session, persist to ReflexionMemory, trigger NightlyLearner consolidation',
    inputSchema: {
        type: 'object',
        properties: {
            sessionId: { type: 'string', description: 'Session identifier' },
            summary: { type: 'string', description: 'Session summary' },
            tasksCompleted: { type: 'number', description: 'Number of tasks completed' },
        },
        required: ['sessionId'],
    },
    handler: async (params) => {
        try {
            const sessionId = validateString(params.sessionId, 'sessionId', 500);
            if (!sessionId)
                return { success: false, error: 'sessionId is required (non-empty string)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeSessionEnd({
                sessionId,
                summary: validateString(params.summary, 'summary', 50_000) ?? undefined,
                tasksCompleted: validatePositiveInt(params.tasksCompleted, 0, 10_000),
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_hierarchical_store — Store to hierarchical memory =====
export const memoryHierarchicalStore = {
    name: 'memory_hierarchical-store',
    description: 'Store to hierarchical memory with tier (working, episodic, semantic)',
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
    handler: async (params) => {
        try {
            const key = validateString(params.key, 'key', 1000);
            const value = validateString(params.value, 'value');
            if (!key)
                return { success: false, error: 'key is required (non-empty string, max 1KB)' };
            if (!value)
                return { success: false, error: 'value is required (non-empty string, max 100KB)' };
            const tier = validateString(params.tier, 'tier', 20) ?? 'working';
            if (!['working', 'episodic', 'semantic'].includes(tier)) {
                return { success: false, error: `Invalid tier: ${tier}. Must be working, episodic, or semantic` };
            }
            const bridge = await getBridge();
            const result = await bridge.bridgeHierarchicalStore({ key, value, tier });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_hierarchical_recall — Recall from hierarchical memory =====
export const memoryHierarchicalRecall = {
    name: 'memory_hierarchical-recall',
    description: 'Recall from hierarchical memory with optional tier filter',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Recall query' },
            tier: { type: 'string', description: 'Filter by tier (working, episodic, semantic)' },
            topK: { type: 'number', description: 'Number of results (default: 5)' },
        },
        required: ['query'],
    },
    handler: async (params) => {
        try {
            const query = validateString(params.query, 'query', 10_000);
            if (!query)
                return { results: [], error: 'query is required (non-empty string, max 10KB)' };
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
        }
        catch (error) {
            return { results: [], error: sanitizeError(error) };
        }
    },
};
// ===== memory_consolidate — Run memory consolidation =====
export const memoryConsolidate = {
    name: 'memory_consolidate',
    description: 'Run memory consolidation to promote entries across tiers and compress old data',
    inputSchema: {
        type: 'object',
        properties: {
            minAge: { type: 'number', description: 'Minimum age in hours since store (optional)' },
            maxEntries: { type: 'number', description: 'Maximum entries to consolidate (optional)' },
        },
    },
    handler: async (params) => {
        try {
            const bridge = await getBridge();
            // Reject NaN and Infinity. typeof === 'number' returns true for both.
            // NaN propagates through arithmetic and corrupts consolidation accounting;
            // Infinity makes `entry.age >= minAge` always false, silently no-op.
            const minAge = typeof params.minAge === 'number' && Number.isFinite(params.minAge)
                ? Math.max(0, Math.min(params.minAge, 24 * 365 * 10))
                : undefined;
            const result = await bridge.bridgeConsolidate({
                minAge,
                maxEntries: params.maxEntries !== undefined
                    ? validatePositiveInt(params.maxEntries, 1000, 10_000)
                    : undefined,
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_batch — Batch operations (insert, update, delete) =====
export const memoryBatch = {
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
    handler: async (params) => {
        try {
            const operation = validateString(params.operation, 'operation', 20);
            if (!operation)
                return { success: false, error: 'operation is required (string)' };
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
            const validatedEntries = [];
            for (let i = 0; i < params.entries.length; i++) {
                const entry = params.entries[i];
                if (!entry || typeof entry !== 'object') {
                    return { success: false, error: `entries[${i}] must be an object` };
                }
                const key = validateString(entry.key, `entries[${i}].key`, 1000);
                if (!key)
                    return { success: false, error: `entries[${i}].key is required (non-empty string)` };
                const value = validateString(entry.value, `entries[${i}].value`);
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
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_context_synthesize — Synthesize context from memories =====
export const memoryContextSynthesize = {
    name: 'memory_context-synthesize',
    description: 'Synthesize context from stored memories for a given query',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Query to synthesize context for' },
            maxEntries: { type: 'number', description: 'Maximum entries to include (default: 10)' },
        },
        required: ['query'],
    },
    handler: async (params) => {
        try {
            const query = validateString(params.query, 'query', 10_000);
            if (!query)
                return { success: false, error: 'query is required (non-empty string, max 10KB)' };
            // validateExternalContent: guard against prompt injection in synthesized context
            // Source: https://arxiv.org/abs/2302.12173, https://arxiv.org/abs/2310.12815
            try {
                const secMod = await import('@monomind/security').catch(() => null);
                const validateExternalContent = secMod?.validateExternalContent;
                if (validateExternalContent) {
                    const check = await validateExternalContent(query, 'memory_context-synthesize query');
                    if (!check.safe) {
                        return { success: false, error: `Injection guard: ${check.reason}`, injectionDetected: true };
                    }
                }
            }
            catch { /* security module optional */ }
            const bridge = await getBridge();
            const result = await bridge.bridgeContextSynthesize({
                query,
                maxEntries: validatePositiveInt(params.maxEntries, 10, MAX_TOP_K),
            });
            return result ?? { success: false, error: 'Memory bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== memory_semantic_route — Route via SemanticRouter =====
export const memorySemanticRoute = {
    name: 'memory_semantic-route',
    description: 'Route an input via SemanticRouter for intent classification',
    inputSchema: {
        type: 'object',
        properties: {
            input: { type: 'string', description: 'Input text to route' },
        },
        required: ['input'],
    },
    handler: async (params) => {
        try {
            const input = validateString(params.input, 'input', 10_000);
            if (!input)
                return { route: null, error: 'input is required (non-empty string, max 10KB)' };
            const bridge = await getBridge();
            const result = await bridge.bridgeSemanticRoute({ input });
            return result ?? { route: null, error: 'Memory bridge not available. Use hooks route instead.' };
        }
        catch (error) {
            return { route: null, error: sanitizeError(error) };
        }
    },
};
// ===== Export all tools =====
export const memoryTools = [
    memoryHealth,
    memoryControllers,
    memoryPatternStore,
    memoryPatternSearch,
    memoryFeedback,
    memoryCausalEdge,
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
//# sourceMappingURL=memory-tools.js.map