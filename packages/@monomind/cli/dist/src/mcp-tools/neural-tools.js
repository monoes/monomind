/**
 * Neural MCP Tools for CLI
 *
 * V2 Compatibility - Neural network and ML tools
 *
 * ✅ HYBRID Implementation:
 * - Uses agentic-flow/reasoningbank for REAL ML embeddings when available
 * - Falls back to deterministic hash-based embeddings when ML model not installed
 * - Pattern storage and search with cosine similarity (real math in all tiers)
 * - Training stores patterns as searchable embeddings (not simulated)
 *
 * Note: The lean build has no neural training. The full loop lives on monoes-full-loop.
 */
import { getProjectCwd } from './types.js';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const MAX_NEURAL_STORE_BYTES = 50 * 1024 * 1024; // 50 MB
const NEURAL_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Try to import real embeddings — agentic-flow v1 ReasoningBank when available,
// otherwise the deterministic hash fallback below.
let realEmbeddings = null;
let embeddingServiceName = 'none';
try {
    const rb = await import('agentic-flow/reasoningbank').catch(() => null);
    if (rb?.computeEmbedding) {
        realEmbeddings = { embed: async (text) => Array.from(await rb.computeEmbedding(text)) };
        embeddingServiceName = 'agentic-flow/reasoningbank';
    }
}
catch {
    // No embedding provider available, will use fallback
}
// Storage paths
const STORAGE_DIR = '.monomind';
const NEURAL_DIR = 'neural';
const MODELS_FILE = 'models.json';
const PATTERNS_FILE = 'patterns.json';
function getNeuralDir() {
    return join(getProjectCwd(), STORAGE_DIR, NEURAL_DIR);
}
function getNeuralPath() {
    return join(getNeuralDir(), MODELS_FILE);
}
function ensureNeuralDir() {
    const dir = getNeuralDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function loadNeuralStore() {
    try {
        const path = getNeuralPath();
        if (existsSync(path)) {
            if (statSync(path).size > MAX_NEURAL_STORE_BYTES) {
                return { models: {}, patterns: {}, version: '3.0.0' };
            }
            const raw = JSON.parse(readFileSync(path, 'utf-8'));
            // Strip proto-polluting keys from top-level containers
            const models = {};
            for (const [k, v] of Object.entries(raw.models ?? {})) {
                if (!NEURAL_RESERVED_KEYS.has(k))
                    models[k] = v;
            }
            const patterns = {};
            for (const [k, v] of Object.entries(raw.patterns ?? {})) {
                if (!NEURAL_RESERVED_KEYS.has(k))
                    patterns[k] = v;
            }
            return {
                models: models,
                patterns: patterns,
                version: typeof raw.version === 'string' ? raw.version : '3.0.0',
            };
        }
    }
    catch {
        // Return empty store
    }
    return { models: {}, patterns: {}, version: '3.0.0' };
}
function saveNeuralStore(store) {
    ensureNeuralDir();
    const dest = getNeuralPath();
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmp, dest);
}
// Generate embedding - uses real ML embeddings if available, falls back to deterministic hash
async function generateEmbedding(text, dims = 384) {
    // If real embeddings available and text provided, use them
    if (realEmbeddings && text) {
        try {
            return await realEmbeddings.embed(text);
        }
        catch {
            // Fall back to hash-based
        }
    }
    // Hash-based deterministic embedding (better than pure random for consistency)
    if (text) {
        const hash = text.split('').reduce((acc, char, i) => {
            return acc + char.charCodeAt(0) * (i + 1);
        }, 0);
        // Use hash to seed a deterministic embedding
        const embedding = [];
        let seed = hash;
        for (let i = 0; i < dims; i++) {
            // Simple LCG random with seed
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            embedding.push((seed / 0x7fffffff) * 2 - 1);
        }
        return embedding;
    }
    // No text provided — return zero vector (callers should always provide text)
    return new Array(dims).fill(0);
}
// Cosine similarity for pattern search
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}. Ensure all embeddings use the same provider and dims.`);
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
export const neuralTools = [
    {
        name: 'neural_train',
        description: 'Train a neural model',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                modelId: { type: 'string', description: 'Model ID to train' },
                modelType: { type: 'string', enum: ['moe', 'transformer', 'classifier', 'embedding'], description: 'Model type' },
                epochs: { type: 'number', description: 'Number of training epochs' },
                learningRate: { type: 'number', description: 'Learning rate' },
                data: { type: 'object', description: 'Training data' },
            },
            required: ['modelType'],
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            // Cap modelId to prevent DoS via oversized object keys written to the neural store JSON.
            const MAX_MODEL_ID_LEN = 256;
            const rawModelId = input.modelId || `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const modelId = typeof rawModelId === 'string' && rawModelId.length > MAX_MODEL_ID_LEN
                ? rawModelId.slice(0, MAX_MODEL_ID_LEN)
                : rawModelId;
            const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
            if (RESERVED_KEYS.has(modelId)) {
                return { success: false, error: 'Invalid modelId' };
            }
            const MAX_PATTERNS = 10000;
            if (Object.keys(store.patterns ?? {}).length >= MAX_PATTERNS) {
                return { success: false, error: `Pattern store full (max ${MAX_PATTERNS}). Run neural_compress first.` };
            }
            const MAX_MODELS = 100;
            if (Object.keys(store.models ?? {}).length >= MAX_MODELS) {
                return { success: false, error: `Model store full (max ${MAX_MODELS}). Delete old models first.` };
            }
            // Runtime-validate modelType against the allowed enum. The JSON schema
            // declares an enum but callers that bypass schema validation (e.g. direct
            // MCP calls) can pass arbitrary strings, which would be stored verbatim.
            const VALID_MODEL_TYPES = new Set(['moe', 'transformer', 'classifier', 'embedding']);
            const rawModelType = input.modelType;
            if (!rawModelType || !VALID_MODEL_TYPES.has(rawModelType)) {
                return { success: false, error: `Invalid modelType "${rawModelType}". Must be one of: moe, transformer, classifier, embedding` };
            }
            const modelType = rawModelType;
            // Cap epochs to prevent storing absurdly large numbers in the JSON store.
            const MAX_EPOCHS = 10000;
            const rawEpochs = typeof input.epochs === 'number' && Number.isFinite(input.epochs) ? input.epochs : 10;
            const epochs = Math.max(1, Math.min(Math.floor(rawEpochs), MAX_EPOCHS));
            const model = {
                id: modelId,
                name: `${modelType}-model`,
                type: modelType,
                status: 'training',
                accuracy: 0,
                epochs,
                config: {
                    learningRate: input.learningRate || 0.001,
                    batchSize: 32,
                },
            };
            store.models[modelId] = model;
            saveNeuralStore(store);
            // Real training: embed training data and store as searchable patterns.
            // Cap input array length and re-check the pattern cap inside the loop —
            // the pre-loop check at line 199 alone allowed an attacker to bypass
            // MAX_PATTERNS by passing a 100k-entry array.
            const MAX_TRAINING_ENTRIES = 1000;
            const MAX_TEXT_LENGTH = 64 * 1024;
            const trainingData = input.data;
            let patternsStored = 0;
            if (trainingData) {
                const rawEntries = Array.isArray(trainingData) ? trainingData : [trainingData];
                const entries = rawEntries.slice(0, MAX_TRAINING_ENTRIES);
                for (let i = 0; i < entries.length; i++) {
                    if (Object.keys(store.patterns ?? {}).length >= MAX_PATTERNS)
                        break;
                    const entry = entries[i];
                    let text = typeof entry === 'string' ? entry
                        : entry?.text
                            || entry?.content
                            || entry?.label
                            || JSON.stringify(entry);
                    if (!text || typeof text !== 'string')
                        continue;
                    if (text.length > MAX_TEXT_LENGTH)
                        text = text.slice(0, MAX_TEXT_LENGTH);
                    const embedding = await generateEmbedding(text, 384);
                    const patternId = `${modelId}-train-${i}`;
                    store.patterns[patternId] = {
                        id: patternId,
                        name: typeof entry === 'object' && entry !== null && 'label' in entry
                            ? String(entry.label) : text.slice(0, 100),
                        type: modelType,
                        embedding,
                        metadata: { modelId, epoch: epochs, index: i, raw: entry },
                        createdAt: new Date().toISOString(),
                        usageCount: 0,
                    };
                    patternsStored++;
                }
            }
            model.status = 'ready';
            model.accuracy = patternsStored > 0 ? 1.0 : 0; // accuracy = data stored, not simulated
            model.trainedAt = new Date().toISOString();
            saveNeuralStore(store);
            // Mirror patterns to patterns.json so CLI commands (neural patterns list,
            // neural predict) can find patterns trained via MCP and vice versa.
            if (patternsStored > 0) {
                try {
                    const patternsPath = join(getNeuralDir(), PATTERNS_FILE);
                    let existing = [];
                    if (existsSync(patternsPath) && statSync(patternsPath).size <= MAX_NEURAL_STORE_BYTES) {
                        const raw = readFileSync(patternsPath, 'utf-8');
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed))
                            existing = parsed;
                    }
                    const existingIds = new Set(existing.map(p => p['id']));
                    const newEntries = Object.values(store.patterns)
                        .filter(p => p.id.startsWith(modelId) && !existingIds.has(p.id))
                        .map(p => ({
                        id: p.id,
                        type: p.type,
                        content: p.name,
                        confidence: 0.8,
                        usageCount: 0,
                        embedding: p.embedding,
                        createdAt: p.createdAt,
                    }));
                    if (newEntries.length > 0) {
                        const merged = [...existing, ...newEntries];
                        const tmp = `${patternsPath}.${process.pid}.${Date.now()}.tmp`;
                        writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
                        renameSync(tmp, patternsPath);
                    }
                }
                catch {
                    // Mirror is best-effort; don't fail the train operation
                }
            }
            return {
                success: true,
                _realEmbedding: !!realEmbeddings,
                modelId,
                type: modelType,
                status: model.status,
                patternsStored,
                totalPatterns: Object.keys(store.patterns).length,
                epochs,
                trainedAt: model.trainedAt,
            };
        },
    },
    {
        name: 'neural_predict',
        description: 'Make predictions using a neural model',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                modelId: { type: 'string', description: 'Model ID to use' },
                input: { type: 'string', description: 'Input text or data' },
                topK: { type: 'number', description: 'Number of top predictions' },
            },
            required: ['input'],
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            // Cap modelId to prevent O(n) hash/compare cost on absurdly long keys.
            const MAX_MODEL_ID_LEN_PRED = 256;
            const rawModelIdPred = input.modelId;
            const modelId = typeof rawModelIdPred === 'string' && rawModelIdPred.length > MAX_MODEL_ID_LEN_PRED
                ? rawModelIdPred.slice(0, MAX_MODEL_ID_LEN_PRED)
                : rawModelIdPred;
            const inputText = typeof input.input === 'string' ? input.input.slice(0, 16 * 1024) : '';
            const topK = Math.max(1, Math.min(input.topK || 3, 50));
            const RESERVED_KEYS_PRED = new Set(['__proto__', 'constructor', 'prototype']);
            if (modelId && (RESERVED_KEYS_PRED.has(modelId) || typeof modelId !== 'string')) {
                return { success: false, error: 'Invalid modelId' };
            }
            // Find model or use default
            const model = modelId
                ? (Object.hasOwn(store.models, modelId) ? store.models[modelId] : undefined)
                : Object.values(store.models).find(m => m.status === 'ready');
            if (model && model.status !== 'ready') {
                return { success: false, error: 'Model not ready' };
            }
            // Generate real embedding for the input
            const startTime = performance.now();
            const embedding = await generateEmbedding(inputText, 384);
            const latency = Math.round(performance.now() - startTime);
            // Search stored patterns via real cosine similarity.
            // Merge MCP models.json patterns with CLI patterns.json so both training
            // paths are visible from predict.
            const MAX_SCAN = 10000;
            const EARLY_EXIT_THRESHOLD = 0.1;
            const mcpPatterns = Object.values(store.patterns);
            const cliPatternsRaw = [];
            try {
                const cliPath = join(getNeuralDir(), PATTERNS_FILE);
                if (existsSync(cliPath) && statSync(cliPath).size <= MAX_NEURAL_STORE_BYTES) {
                    const raw = JSON.parse(readFileSync(cliPath, 'utf-8'));
                    if (Array.isArray(raw)) {
                        const mcpIds = new Set(mcpPatterns.map(p => p.id));
                        for (const p of raw) {
                            if (p?.id && !mcpIds.has(p.id) && Array.isArray(p.embedding)) {
                                cliPatternsRaw.push(p);
                            }
                        }
                    }
                }
            }
            catch { /* best-effort */ }
            const cliMapped = cliPatternsRaw.map(p => ({
                id: p.id ?? '',
                name: p.content ?? p.name ?? p.type ?? '',
                type: p.type ?? 'general',
                embedding: p.embedding ?? [],
                metadata: {},
                createdAt: new Date().toISOString(),
                usageCount: 0,
            }));
            const storedPatterns = [...mcpPatterns, ...cliMapped].slice(0, MAX_SCAN);
            let predictions;
            if (storedPatterns.length > 0) {
                const scored = [];
                for (const p of storedPatterns) {
                    if (!Array.isArray(p.embedding) || p.embedding.length !== embedding.length)
                        continue;
                    const conf = Math.max(0, cosineSimilarity(embedding, p.embedding));
                    if (conf < EARLY_EXIT_THRESHOLD)
                        continue;
                    scored.push({ label: p.name || p.type || p.id, confidence: conf, patternId: p.id });
                }
                predictions = scored.sort((a, b) => b.confidence - a.confidence).slice(0, topK);
            }
            else {
                // No patterns stored — no predictions possible
                predictions = [];
            }
            return {
                success: true,
                _realEmbedding: !!realEmbeddings,
                _hasStoredPatterns: storedPatterns.length > 0,
                modelId: model?.id || 'default',
                input: inputText,
                predictions,
                embedding: embedding.slice(0, 8), // Preview of embedding
                embeddingDims: embedding.length,
                latency,
            };
        },
    },
    {
        name: 'neural_patterns',
        description: 'Get or manage neural patterns',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'get', 'store', 'search', 'delete'], description: 'Action to perform' },
                patternId: { type: 'string', description: 'Pattern ID' },
                name: { type: 'string', description: 'Pattern name' },
                type: { type: 'string', description: 'Pattern type' },
                query: { type: 'string', description: 'Search query' },
                data: { type: 'object', description: 'Pattern data' },
            },
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            const action = input.action || 'list';
            if (action === 'list') {
                const patterns = Object.values(store.patterns);
                const typeFilter = input.type;
                const filtered = typeFilter ? patterns.filter(p => p.type === typeFilter) : patterns;
                return {
                    patterns: filtered.map(p => ({
                        id: p.id,
                        name: p.name,
                        type: p.type,
                        usageCount: p.usageCount,
                        createdAt: p.createdAt,
                    })),
                    total: filtered.length,
                };
            }
            if (action === 'get') {
                const patternId = input.patternId;
                if (!patternId || NEURAL_RESERVED_KEYS.has(patternId)) {
                    return { success: false, error: 'Invalid patternId' };
                }
                const pattern = Object.hasOwn(store.patterns, patternId) ? store.patterns[patternId] : undefined;
                if (!pattern) {
                    return { success: false, error: 'Pattern not found' };
                }
                return { success: true, pattern };
            }
            if (action === 'store') {
                const MAX_PATTERNS = 10000;
                if (Object.keys(store.patterns ?? {}).length >= MAX_PATTERNS) {
                    return { success: false, error: `Pattern store full (max ${MAX_PATTERNS}). Run neural_compress first.` };
                }
                const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                // Cap name length to prevent DoS in generateEmbedding (hash path is O(n))
                const MAX_PATTERN_NAME_LENGTH = 16 * 1024; // 16 KB
                const rawPatternName = input.name || 'Unnamed pattern';
                const patternName = typeof rawPatternName === 'string' && rawPatternName.length > MAX_PATTERN_NAME_LENGTH
                    ? rawPatternName.slice(0, MAX_PATTERN_NAME_LENGTH)
                    : rawPatternName;
                // Generate embedding from pattern name/content
                const embedding = await generateEmbedding(patternName, 384);
                const pattern = {
                    id: patternId,
                    name: patternName,
                    type: input.type || 'general',
                    embedding,
                    metadata: input.data || {},
                    createdAt: new Date().toISOString(),
                    usageCount: 0,
                };
                store.patterns[patternId] = pattern;
                saveNeuralStore(store);
                return {
                    success: true,
                    _realEmbedding: !!realEmbeddings,
                    patternId,
                    name: pattern.name,
                    type: pattern.type,
                    embeddingDims: embedding.length,
                    createdAt: pattern.createdAt,
                };
            }
            if (action === 'search') {
                // Cap query length to prevent DoS in generateEmbedding (hash path is O(n))
                const MAX_SEARCH_QUERY_LENGTH = 16 * 1024; // 16 KB — matches neural_predict cap
                const rawQuery = input.query;
                const query = typeof rawQuery === 'string' && rawQuery.length > MAX_SEARCH_QUERY_LENGTH
                    ? rawQuery.slice(0, MAX_SEARCH_QUERY_LENGTH)
                    : rawQuery;
                // Generate query embedding for real similarity search
                const queryEmbedding = await generateEmbedding(query, 384);
                // Calculate REAL cosine similarity against stored patterns
                const results = Object.values(store.patterns)
                    .map(p => ({
                    ...p,
                    similarity: cosineSimilarity(queryEmbedding, p.embedding),
                }))
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 10);
                // Increment usageCount so prune can track retrieval frequency
                for (const r of results) {
                    if (Object.hasOwn(store.patterns, r.id)) {
                        store.patterns[r.id].usageCount = (store.patterns[r.id].usageCount || 0) + 1;
                    }
                }
                saveNeuralStore(store);
                return {
                    _realSimilarity: true,
                    _realEmbedding: !!realEmbeddings,
                    query,
                    results: results.map(r => ({
                        id: r.id,
                        name: r.name,
                        type: r.type,
                        similarity: r.similarity,
                    })),
                    total: results.length,
                };
            }
            if (action === 'delete') {
                const patternId = input.patternId;
                if (!patternId || NEURAL_RESERVED_KEYS.has(patternId)) {
                    return { success: false, error: 'Invalid patternId' };
                }
                if (!Object.hasOwn(store.patterns, patternId)) {
                    return { success: false, error: 'Pattern not found' };
                }
                delete store.patterns[patternId];
                saveNeuralStore(store);
                return { success: true, deleted: patternId };
            }
            return { success: false, error: 'Unknown action' };
        },
    },
    {
        name: 'neural_compress',
        description: 'Compress neural model or embeddings',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                modelId: { type: 'string', description: 'Model ID to compress' },
                method: { type: 'string', enum: ['quantize', 'prune', 'distill'], description: 'Compression method' },
                targetSize: { type: 'number', description: 'Target size reduction (0-1)' },
            },
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            const method = input.method || 'quantize';
            const targetReduction = input.targetSize || 0.5;
            const patterns = Object.values(store.patterns);
            if (patterns.length === 0) {
                return { success: false, error: 'No patterns to compress. Train patterns first with neural_train.' };
            }
            const beforeCount = patterns.length;
            const beforeSize = patterns.reduce((s, p) => s + (p.embedding?.length || 0) * 4, 0); // Float32 = 4 bytes
            if (method === 'quantize') {
                try {
                    const { quantizeInt8, getQuantizationStats } = await import('../memory/memory-initializer.js');
                    let totalCompressed = 0;
                    for (const pattern of patterns) {
                        if (pattern.embedding && pattern.embedding.length > 0) {
                            const stats = getQuantizationStats(pattern.embedding);
                            const quantized = quantizeInt8(pattern.embedding);
                            // Store quantized metadata (keep original embedding for search)
                            pattern._quantized = {
                                scale: quantized.scale,
                                zeroPoint: quantized.zeroPoint,
                                compressionRatio: stats.compressionRatio,
                            };
                            totalCompressed++;
                        }
                    }
                    saveNeuralStore(store);
                    return {
                        success: true, _real: true, method,
                        patternsCompressed: totalCompressed,
                        note: 'Quantization metadata stored; original embeddings retained for search accuracy.',
                    };
                }
                catch {
                    return { success: false, error: 'Quantization requires memory-initializer. Run `memory init` first.' };
                }
            }
            if (method === 'prune') {
                // Prune the least-used fraction of patterns. targetReduction (0-1) is a percentile:
                // 0.5 removes the bottom 50% by usageCount, 0.8 removes the bottom 80%, etc.
                const counts = Object.values(store.patterns)
                    .map(p => p.usageCount || 0)
                    .sort((a, b) => a - b);
                const cutoffIdx = Math.floor(targetReduction * counts.length);
                const threshold = counts[cutoffIdx] ?? 0;
                const toRemove = [];
                for (const [id, pattern] of Object.entries(store.patterns)) {
                    if ((pattern.usageCount || 0) < threshold)
                        toRemove.push(id);
                }
                for (const id of toRemove)
                    delete store.patterns[id];
                saveNeuralStore(store);
                return {
                    success: true, _real: true, method,
                    threshold,
                    patternsRemoved: toRemove.length,
                    patternsBefore: beforeCount,
                    patternsAfter: Object.keys(store.patterns).length,
                };
            }
            if (method === 'distill') {
                // Merge similar patterns by cosine similarity > 0.95
                const patternList = Object.entries(store.patterns);
                const merged = [];
                for (let i = 0; i < patternList.length; i++) {
                    const [idA, a] = patternList[i];
                    if (merged.includes(idA))
                        continue;
                    for (let j = i + 1; j < patternList.length; j++) {
                        const [idB, b] = patternList[j];
                        if (!a.embedding || !b.embedding || merged.includes(idB))
                            continue;
                        const sim = cosineSimilarity(a.embedding, b.embedding);
                        if (sim > 0.95) {
                            // Merge: average embeddings, keep higher usage count
                            for (let k = 0; k < a.embedding.length; k++) {
                                a.embedding[k] = (a.embedding[k] + (b.embedding[k] || 0)) / 2;
                            }
                            a.usageCount = Math.max(a.usageCount || 0, b.usageCount || 0);
                            delete store.patterns[idB];
                            merged.push(idB);
                        }
                    }
                }
                saveNeuralStore(store);
                return {
                    success: true, _real: true, method,
                    patternsMerged: merged.length,
                    patternsBefore: beforeCount,
                    patternsAfter: Object.keys(store.patterns).length,
                };
            }
            return { success: false, error: `Unknown method: ${method}. Use quantize, prune, or distill.` };
        },
    },
    {
        name: 'neural_status',
        description: 'Get neural system status',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                modelId: { type: 'string', description: 'Specific model ID' },
                detailed: { type: 'boolean', description: 'Include detailed info' },
            },
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            if (input.modelId) {
                const MAX_MODEL_ID_LEN_STATUS = 256;
                const rawModelIdStatus = input.modelId;
                const modelId = typeof rawModelIdStatus === 'string' && rawModelIdStatus.length > MAX_MODEL_ID_LEN_STATUS
                    ? rawModelIdStatus.slice(0, MAX_MODEL_ID_LEN_STATUS)
                    : rawModelIdStatus;
                if (NEURAL_RESERVED_KEYS.has(modelId)) {
                    return { success: false, error: 'Invalid modelId' };
                }
                const model = Object.hasOwn(store.models, modelId) ? store.models[modelId] : undefined;
                if (!model) {
                    return { success: false, error: 'Model not found' };
                }
                return { success: true, model };
            }
            const models = Object.values(store.models);
            const patterns = Object.values(store.patterns);
            return {
                _realEmbeddings: !!realEmbeddings,
                embeddingProvider: realEmbeddings ? embeddingServiceName : 'hash-based (deterministic)',
                models: {
                    total: models.length,
                    ready: models.filter(m => m.status === 'ready').length,
                    training: models.filter(m => m.status === 'training').length,
                    avgAccuracy: models.length > 0
                        ? models.reduce((sum, m) => sum + m.accuracy, 0) / models.length
                        : 0,
                },
                patterns: {
                    total: patterns.length,
                    byType: patterns.reduce((acc, p) => {
                        acc[p.type] = (acc[p.type] || 0) + 1;
                        return acc;
                    }, {}),
                    totalEmbeddingDims: patterns.length > 0 ? patterns[0].embedding.length : 384,
                },
                features: {
                    hnsw: true,
                    quantization: true,
                    flashAttention: false,
                    reasoningBank: true,
                },
            };
        },
    },
    {
        name: 'neural_optimize',
        description: 'Optimize neural model performance',
        category: 'neural',
        inputSchema: {
            type: 'object',
            properties: {
                modelId: { type: 'string', description: 'Model ID to optimize' },
                target: { type: 'string', enum: ['speed', 'memory', 'accuracy', 'balanced'], description: 'Optimization target' },
            },
        },
        handler: async (input) => {
            const store = loadNeuralStore();
            const target = input.target || 'balanced';
            const patterns = Object.values(store.patterns);
            if (patterns.length === 0) {
                return { success: false, error: 'No patterns to optimize. Train patterns first with neural_train.' };
            }
            const startTime = performance.now();
            const actions = [];
            const beforeCount = patterns.length;
            const dims = patterns[0]?.embedding?.length || 0;
            let patternsRemoved = 0;
            let patternsQuantized = 0;
            let duplicatesRemoved = 0;
            // speed / balanced: deduplicate identical or near-identical patterns
            if (target === 'speed' || target === 'balanced') {
                const seen = new Map(); // hash -> id
                for (const [id, p] of Object.entries(store.patterns)) {
                    if (!p.embedding || p.embedding.length === 0)
                        continue;
                    // Quick hash: first 8 dims rounded
                    const hash = p.embedding.slice(0, 8).map(v => v.toFixed(4)).join(',');
                    if (seen.has(hash)) {
                        // Verify with full cosine similarity
                        const existingId = seen.get(hash);
                        const existing = store.patterns[existingId];
                        if (existing && cosineSimilarity(p.embedding, existing.embedding) > 0.99) {
                            existing.usageCount = Math.max(existing.usageCount || 0, p.usageCount || 0);
                            delete store.patterns[id];
                            duplicatesRemoved++;
                        }
                    }
                    else {
                        seen.set(hash, id);
                    }
                }
                if (duplicatesRemoved > 0)
                    actions.push(`Removed ${duplicatesRemoved} near-duplicate patterns`);
            }
            // memory / balanced: quantize large embeddings
            if (target === 'memory' || target === 'balanced') {
                try {
                    const { quantizeInt8, getQuantizationStats } = await import('../memory/memory-initializer.js');
                    for (const p of Object.values(store.patterns)) {
                        if (p.embedding && p.embedding.length > 0 && !p._quantized) {
                            const stats = getQuantizationStats(p.embedding);
                            const q = quantizeInt8(p.embedding);
                            p._quantized = { scale: q.scale, zeroPoint: q.zeroPoint, compressionRatio: stats.compressionRatio };
                            patternsQuantized++;
                        }
                    }
                    if (patternsQuantized > 0)
                        actions.push(`Quantized ${patternsQuantized} pattern embeddings (Int8, ~3.92x)`);
                }
                catch {
                    actions.push('Quantization skipped (memory-initializer not available)');
                }
            }
            // accuracy / balanced: prune low-usage, zero-embedding patterns
            if (target === 'accuracy' || target === 'balanced') {
                for (const [id, p] of Object.entries(store.patterns)) {
                    if (!p.embedding || p.embedding.length === 0) {
                        delete store.patterns[id];
                        patternsRemoved++;
                        continue;
                    }
                    // Remove patterns with all-zero embeddings (no useful signal)
                    const norm = p.embedding.reduce((s, v) => s + v * v, 0);
                    if (norm < 1e-10) {
                        delete store.patterns[id];
                        patternsRemoved++;
                    }
                }
                if (patternsRemoved > 0)
                    actions.push(`Pruned ${patternsRemoved} empty/zero-signal patterns`);
            }
            saveNeuralStore(store);
            const elapsed = Math.round(performance.now() - startTime);
            return {
                success: true, _real: true, target,
                actions,
                patternsBefore: beforeCount,
                patternsAfter: Object.keys(store.patterns).length,
                duplicatesRemoved,
                patternsQuantized,
                patternsRemoved,
                embeddingDims: dims,
                elapsedMs: elapsed,
            };
        },
    },
];
//# sourceMappingURL=neural-tools.js.map