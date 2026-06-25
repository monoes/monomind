/**
 * Memory Bridge — Routes CLI memory operations through LanceDB
 *
 * Uses LanceDBBackend from @monoes/memory.
 * All exported function signatures are unchanged.
 *
 * @module v1/cli/memory-bridge
 */
import * as path from 'path';
import * as crypto from 'crypto';
// ===== Embedding validation =====
const MAX_EMBEDDING_DIMS = 8192;
const MAX_EMBEDDING_JSON_BYTES = MAX_EMBEDDING_DIMS * 32; // ~256KB ceiling
export function safeParseEmbedding(raw) {
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    if (raw.length > MAX_EMBEDDING_JSON_BYTES)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!Array.isArray(parsed))
        return null;
    if (parsed.length === 0 || parsed.length > MAX_EMBEDDING_DIMS)
        return null;
    for (let i = 0; i < parsed.length; i++) {
        const v = parsed[i];
        if (typeof v !== 'number' || !Number.isFinite(v))
            return null;
    }
    return parsed;
}
// ===== Constants =====
const BRIDGE_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const BRIDGE_EMBEDDING_DIMS = 384;
const BRIDGE_MAX_KEY_LEN = 4 * 1024;
const BRIDGE_MAX_VALUE_LEN = 1024 * 1024;
const MAX_TAGS = 32;
const MAX_TAG_LEN = 64;
// ===== DB path resolution =====
function getDbPath(customPath) {
    const swarmDir = path.resolve(process.cwd(), '.swarm');
    if (!customPath)
        return path.join(swarmDir, 'lancedb');
    // Treat legacy .db paths as a signal to use lancedb sibling dir
    if (customPath.endsWith('.db')) {
        return path.join(path.dirname(customPath), 'lancedb');
    }
    if (customPath === ':memory:')
        return path.join(swarmDir, 'lancedb');
    const resolved = path.resolve(customPath);
    const rel = path.relative(process.cwd(), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return path.join(swarmDir, 'lancedb');
    }
    return resolved;
}
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}
// ===== Lazy singleton LanceDB backend =====
let backendPromise = null;
let backendInstance = null;
let bridgeAvailable = null;
let _embedder = null;
const MAX_INIT_ATTEMPTS = 3;
let initAttempts = 0;
async function getBackend(dbPath) {
    if (bridgeAvailable === false)
        return null;
    if (initAttempts >= MAX_INIT_ATTEMPTS) {
        bridgeAvailable = false;
        return null;
    }
    if (backendInstance)
        return backendInstance;
    if (!backendPromise) {
        backendPromise = (async () => {
            try {
                const mod = await import('@monoes/memory');
                const { LanceDBBackend } = mod;
                // Try to create embedding generator from HuggingFace transformers
                let embeddingGenerator;
                try {
                    const hf = await import('@huggingface/transformers');
                    const extractor = await hf.pipeline('feature-extraction', BRIDGE_EMBEDDING_MODEL, { revision: 'default' });
                    embeddingGenerator = async (text) => {
                        const output = await extractor(text, { pooling: 'mean', normalize: true });
                        return new Float32Array(output.data);
                    };
                    _embedder = embeddingGenerator;
                }
                catch { /* embeddings unavailable — store and search without vectors */ }
                const backend = new LanceDBBackend({
                    dbPath: dbPath || getDbPath(),
                    vectorDimension: BRIDGE_EMBEDDING_DIMS,
                    embeddingGenerator,
                    enableFts: false,
                    nProbes: 20,
                });
                const origLog = console.log;
                console.log = (...args) => {
                    const msg = String(args[0] ?? '');
                    if (msg.includes('Transformers.js') || msg.includes('[LanceDB]') || msg.includes('Loading model'))
                        return;
                    origLog.apply(console, args);
                };
                try {
                    await backend.initialize();
                }
                finally {
                    console.log = origLog;
                }
                backendInstance = backend;
                bridgeAvailable = true;
                return backend;
            }
            catch {
                initAttempts++;
                backendPromise = null;
                if (initAttempts >= MAX_INIT_ATTEMPTS)
                    bridgeAvailable = false;
                return null;
            }
        })();
    }
    return backendPromise;
}
// ===== Core CRUD =====
export async function bridgeStoreEntry(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const key = typeof options.key === 'string' && options.key.length > BRIDGE_MAX_KEY_LEN
            ? options.key.slice(0, BRIDGE_MAX_KEY_LEN) : options.key;
        const value = typeof options.value === 'string' && options.value.length > BRIDGE_MAX_VALUE_LEN
            ? options.value.slice(0, BRIDGE_MAX_VALUE_LEN) : options.value;
        const namespace = options.namespace ?? 'default';
        const tags = Array.isArray(options.tags)
            ? options.tags.filter(t => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LEN).slice(0, MAX_TAGS)
            : [];
        const now = Date.now();
        const id = generateId('entry');
        // Generate embedding
        let embedding;
        let embeddingInfo;
        if (options.generateEmbeddingFlag !== false && value.length > 0 && _embedder) {
            try {
                embedding = await _embedder(value);
                embeddingInfo = { dimensions: embedding.length, model: BRIDGE_EMBEDDING_MODEL };
            }
            catch { /* store without embedding */ }
        }
        const mod = await import('@monoes/memory');
        const entry = mod.createDefaultEntry({
            key,
            content: value,
            namespace,
            tags,
            expiresAt: options.ttl ? now + options.ttl * 1000 : undefined,
        });
        // Override id and set embedding
        entry.id = id;
        if (embedding)
            entry.embedding = embedding;
        // Upsert: delete existing entry with same key+namespace first
        if (options.upsert) {
            try {
                const existing = await backend.getByKey(namespace, key);
                if (existing)
                    await backend.delete(existing.id);
            }
            catch { /* non-fatal */ }
        }
        await backend.store(entry);
        return { success: true, id, embedding: embeddingInfo };
    }
    catch (err) {
        return { success: false, id: '', error: String(err?.message ?? err) };
    }
}
export async function bridgeSearchEntries(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const { query: queryStr, namespace, limit = 10, threshold = 0.3 } = options;
        const startTime = Date.now();
        let results = [];
        let searchMethod = 'keyword';
        if (_embedder && queryStr.length > 0) {
            try {
                const queryEmbedding = await _embedder(queryStr);
                const searchResults = await backend.search(queryEmbedding, {
                    k: limit,
                    threshold,
                    filters: namespace ? { type: 'exact', namespace } : undefined,
                });
                results = searchResults.map((r) => ({
                    id: r.entry.id,
                    key: r.entry.key,
                    content: (r.entry.content || '').substring(0, 60) + ((r.entry.content || '').length > 60 ? '...' : ''),
                    score: r.score,
                    namespace: r.entry.namespace,
                    provenance: `semantic:${r.score.toFixed(3)}`,
                }));
                searchMethod = 'semantic';
            }
            catch { /* fall through to keyword search */ }
        }
        // Keyword fallback
        if (results.length === 0) {
            const entries = await backend.query({
                type: 'exact',
                namespace: namespace ?? 'default',
                limit: Math.max(limit * 10, 100),
            });
            const queryLower = queryStr.toLowerCase();
            results = entries
                .filter((e) => e.content.toLowerCase().includes(queryLower))
                .slice(0, limit)
                .map((e) => ({
                id: e.id,
                key: e.key,
                content: (e.content || '').substring(0, 60) + ((e.content || '').length > 60 ? '...' : ''),
                score: 0.5,
                namespace: e.namespace,
                provenance: 'keyword',
            }));
            searchMethod = 'keyword';
        }
        return {
            success: true,
            results,
            searchTime: Date.now() - startTime,
            searchMethod,
        };
    }
    catch {
        return null;
    }
}
export async function bridgeListEntries(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const entries = await backend.query({
            type: 'exact',
            namespace: options.namespace ?? 'default',
            limit: options.limit ?? 100,
            offset: options.offset,
        });
        return {
            success: true,
            entries: entries.map((e) => ({
                id: e.id,
                key: e.key,
                namespace: e.namespace,
                content: e.content,
                accessCount: e.accessCount ?? 0,
                createdAt: new Date(e.createdAt).toISOString(),
                updatedAt: new Date(e.updatedAt).toISOString(),
                hasEmbedding: !!(e.embedding && e.embedding.length > 0),
                tags: e.tags ?? [],
            })),
            total: entries.length,
        };
    }
    catch {
        return null;
    }
}
export async function bridgeGetEntry(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const { key, namespace = 'default' } = options;
        const entry = await backend.getByKey(namespace, key);
        if (!entry)
            return { success: true, found: false };
        return {
            success: true,
            found: true,
            entry: {
                id: entry.id,
                key: entry.key,
                namespace: entry.namespace,
                content: entry.content,
                accessCount: entry.accessCount ?? 0,
                createdAt: new Date(entry.createdAt).toISOString(),
                updatedAt: new Date(entry.updatedAt).toISOString(),
                hasEmbedding: !!(entry.embedding && entry.embedding.length > 0),
                tags: entry.tags ?? [],
            },
        };
    }
    catch {
        return null;
    }
}
export async function bridgeDeleteEntry(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const namespace = options.namespace ?? 'default';
        let deleted = false;
        if (options.id) {
            deleted = await backend.delete(options.id);
        }
        else if (options.key) {
            const entry = await backend.getByKey(namespace, options.key);
            if (entry)
                deleted = await backend.delete(entry.id);
        }
        return { success: true, deleted };
    }
    catch {
        return { success: false, deleted: false };
    }
}
// ===== Embeddings =====
export async function bridgeGenerateEmbedding(text, dbPath) {
    await getBackend(dbPath); // ensure embedder is initialized
    if (!_embedder)
        return null;
    try {
        const emb = await _embedder(text);
        return { embedding: Array.from(emb), dimensions: emb.length, model: BRIDGE_EMBEDDING_MODEL };
    }
    catch {
        return null;
    }
}
export async function bridgeLoadEmbeddingModel(dbPath) {
    const startTime = Date.now();
    await getBackend(dbPath);
    if (!_embedder)
        return null;
    try {
        const test = await _embedder('test');
        if (!test)
            return null;
        return {
            success: true,
            dimensions: test.length,
            modelName: BRIDGE_EMBEDDING_MODEL,
            loadTime: Date.now() - startTime,
        };
    }
    catch {
        return null;
    }
}
// ===== HNSW (replaced by LanceDB ANN — stubs kept for API compat) =====
export async function bridgeGetHNSWStatus(dbPath) {
    const backend = await getBackend(dbPath);
    if (!backend)
        return null;
    try {
        const stats = await backend.getStats();
        return { built: true, size: stats?.totalEntries ?? 0, dimensions: BRIDGE_EMBEDDING_DIMS };
    }
    catch {
        return { built: false, size: 0, dimensions: BRIDGE_EMBEDDING_DIMS };
    }
}
export async function bridgeSearchHNSW(options) {
    // Delegate to bridgeSearchEntries which uses LanceDB ANN
    const result = await bridgeSearchEntries({
        query: options.query,
        namespace: options.namespace,
        limit: options.limit,
        threshold: options.threshold,
        dbPath: options.dbPath,
    });
    if (!result)
        return null;
    return {
        success: result.success,
        results: result.results.map(r => ({ id: r.id, key: r.key, score: r.score, namespace: r.namespace })),
        searchTime: result.searchTime,
    };
}
export async function bridgeAddToHNSW(options) {
    // LanceDB indexes entries automatically on store — this is a no-op
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const stats = await backend.getStats();
        return { success: true, indexSize: stats?.totalEntries ?? 0 };
    }
    catch {
        return { success: true };
    }
}
// ===== Controller stubs (LanceDB has no equivalent controllers) =====
export async function bridgeGetController(controllerName, dbPath) {
    await getBackend(dbPath);
    return null;
}
export async function bridgeHasController(controllerName, dbPath) {
    return false;
}
export async function bridgeListControllers(dbPath) {
    const backend = await getBackend(dbPath);
    if (!backend)
        return null;
    return { controllers: [], active: [] };
}
// ===== Availability / lifecycle =====
export async function isBridgeAvailable(dbPath) {
    const backend = await getBackend(dbPath);
    return !!backend;
}
export async function getControllerRegistry(dbPath) {
    return getBackend(dbPath);
}
export async function shutdownBridge() {
    if (backendInstance) {
        try {
            await backendInstance.shutdown();
        }
        catch { /* ignore */ }
    }
    backendInstance = null;
    backendPromise = null;
    bridgeAvailable = null;
    _embedder = null;
    initAttempts = 0;
}
// ===== Pattern store =====
export async function bridgeStorePattern(options) {
    return bridgeStoreEntry({
        key: `pattern_${options.taskType ?? 'general'}_${generateId('p')}`,
        value: JSON.stringify({
            pattern: options.pattern,
            taskType: options.taskType,
            outcome: options.outcome,
            confidence: options.confidence ?? 0.5,
        }),
        namespace: 'patterns',
        tags: options.taskType ? [options.taskType] : [],
        generateEmbeddingFlag: true,
        dbPath: options.dbPath,
    });
}
export async function bridgeSearchPatterns(options) {
    const result = await bridgeSearchEntries({
        query: options.query,
        namespace: 'patterns',
        limit: options.limit ?? 5,
        dbPath: options.dbPath,
    });
    if (!result)
        return null;
    return {
        success: result.success,
        patterns: result.results.map(r => {
            let parsed = {};
            try {
                parsed = JSON.parse(r.content + (r.content.endsWith('...') ? '' : ''));
            }
            catch { /* use raw */ }
            return {
                id: r.id,
                pattern: parsed.pattern ?? r.content,
                confidence: parsed.confidence ?? r.score,
                taskType: parsed.taskType,
                score: r.score,
            };
        }),
    };
}
// ===== Feedback =====
export async function bridgeRecordFeedback(options) {
    return bridgeStoreEntry({
        key: `feedback_${options.taskType}_${Date.now()}`,
        value: JSON.stringify({
            taskType: options.taskType,
            action: options.action,
            outcome: options.outcome,
            confidence: options.confidence ?? 0.5,
            metadata: options.metadata ?? {},
            recordedAt: Date.now(),
        }),
        namespace: 'feedback',
        tags: [options.taskType, options.outcome],
        generateEmbeddingFlag: true,
        dbPath: options.dbPath,
    });
}
// ===== Causal edges =====
export async function bridgeRecordCausalEdge(options) {
    return bridgeStoreEntry({
        key: `causal_${options.sourceId}_${options.targetId}`,
        value: JSON.stringify({
            sourceId: options.sourceId,
            targetId: options.targetId,
            relation: options.relation,
            strength: options.strength ?? 1.0,
        }),
        namespace: 'causal',
        tags: ['causal', options.relation],
        generateEmbeddingFlag: false,
        dbPath: options.dbPath,
        upsert: true,
    });
}
// ===== Session lifecycle =====
export async function bridgeSessionStart(options) {
    return bridgeStoreEntry({
        key: `session_${options.sessionId}`,
        value: JSON.stringify({
            sessionId: options.sessionId,
            agentId: options.agentId,
            startedAt: Date.now(),
            status: 'active',
            metadata: options.metadata ?? {},
        }),
        namespace: 'sessions',
        tags: ['session', 'active'],
        generateEmbeddingFlag: false,
        dbPath: options.dbPath,
        upsert: true,
    });
}
export async function bridgeSessionEnd(options) {
    const backend = await getBackend(options.dbPath);
    if (!backend)
        return null;
    try {
        const existing = await backend.getByKey('sessions', `session_${options.sessionId}`);
        if (existing) {
            let data = {};
            try {
                data = JSON.parse(existing.content);
            }
            catch { /* use empty */ }
            await backend.update(existing.id, {
                content: JSON.stringify({
                    ...data,
                    status: 'ended',
                    endedAt: Date.now(),
                    summary: options.summary,
                    metrics: options.metrics ?? {},
                }),
                tags: ['session', 'ended'],
            });
        }
        return { success: true };
    }
    catch {
        return { success: false };
    }
}
// ===== Task routing =====
export async function bridgeRouteTask(options) {
    const result = await bridgeSearchEntries({
        query: options.task,
        namespace: 'patterns',
        limit: options.topK ?? 3,
        dbPath: options.dbPath,
    });
    if (!result)
        return null;
    return {
        success: result.success,
        routes: result.results.map(r => {
            let parsed = {};
            try {
                parsed = JSON.parse(r.content);
            }
            catch { /* use raw */ }
            return {
                agentType: parsed.taskType ?? 'coder',
                confidence: r.score,
                pattern: parsed.pattern,
            };
        }),
    };
}
// ===== Health check =====
export async function bridgeHealthCheck(dbPath) {
    const backend = await getBackend(dbPath);
    if (!backend)
        return { healthy: false, backend: 'lancedb', error: 'unavailable' };
    try {
        const health = await backend.healthCheck?.();
        const stats = await backend.getStats?.();
        return {
            healthy: health?.healthy ?? true,
            backend: 'lancedb',
            stats: stats ? {
                totalEntries: stats.totalEntries ?? 0,
                namespaces: Object.keys(stats.entriesByNamespace ?? {}),
            } : undefined,
        };
    }
    catch {
        return { healthy: false, backend: 'lancedb' };
    }
}
// ===== Hierarchical memory =====
export async function bridgeHierarchicalStore(params) {
    return bridgeStoreEntry({
        key: params.key,
        value: params.value,
        namespace: `tier_${params.tier ?? 'working'}`,
        tags: [params.tier ?? 'working'],
        generateEmbeddingFlag: true,
    });
}
export async function bridgeHierarchicalRecall(params) {
    return bridgeSearchEntries({
        query: params.query,
        namespace: params.tier ? `tier_${params.tier}` : undefined,
        limit: params.topK ?? 5,
    });
}
// ===== Consolidation =====
export async function bridgeConsolidate(params) {
    const backend = await getBackend();
    if (!backend)
        return { success: false, consolidated: 0 };
    try {
        const minAge = params.minAge ?? 7 * 24 * 3600 * 1000; // default: 7 days
        const cutoff = Date.now() - minAge;
        const entries = await backend.query({
            type: 'exact',
            namespace: 'default',
            limit: params.maxEntries ?? 1000,
        });
        let deleted = 0;
        for (const e of entries) {
            if (e.updatedAt < cutoff && e.accessCount === 0) {
                await backend.delete(e.id).catch(() => { });
                deleted++;
            }
        }
        return { success: true, consolidated: deleted };
    }
    catch {
        return { success: false, consolidated: 0 };
    }
}
// ===== Batch operations =====
export async function bridgeBatchOperation(params) {
    const backend = await getBackend();
    if (!backend)
        return { success: false, processed: 0 };
    try {
        let processed = 0;
        if (params.operation === 'store') {
            for (const e of params.entries) {
                const result = await bridgeStoreEntry({ key: e.key, value: e.value, namespace: e.namespace });
                if (result?.success)
                    processed++;
            }
        }
        else if (params.operation === 'delete') {
            for (const e of params.entries) {
                const result = await bridgeDeleteEntry({ key: e.key, namespace: e.namespace });
                if (result?.deleted)
                    processed++;
            }
        }
        return { success: true, processed };
    }
    catch {
        return { success: false, processed: 0 };
    }
}
// ===== Context synthesis =====
export async function bridgeContextSynthesize(params) {
    const result = await bridgeSearchEntries({
        query: params.query,
        limit: params.maxEntries ?? 5,
    });
    if (!result?.success)
        return null;
    const context = result.results.map(r => `[${r.key}]: ${r.content}`).join('\n');
    return { success: true, context, sources: result.results.length };
}
// ===== Semantic routing =====
export async function bridgeSemanticRoute(params) {
    return bridgeRouteTask({ task: params.input });
}
//# sourceMappingURL=memory-bridge.js.map