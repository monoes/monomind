/**
 * Pattern Store MCP Tools — "neural" namespace (legacy name, kept for API compat)
 *
 * These tools embed text as vectors and search by cosine similarity.
 * No ML training, gradient descent, or neural network inference occurs.
 * The "train" tool embeds and stores; the "predict" tool finds similar stored
 * patterns. Embeddings come from the shared memory/embedding-operations.ts
 * pipeline (SQLite-backed memory bridge -> ONNX -> deterministic hash fallback).
 *
 * All pattern storage is delegated to intelligence.ts's LocalReasoningBank
 * (single source of truth for patterns.json). No separate models.json store.
 */

import { type MCPTool } from './types.js';

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_MODEL_ID_LEN = 256;
const MAX_PATTERNS = 10000;
const MAX_TRAINING_ENTRIES = 1000;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_SEARCH_QUERY_LENGTH = 16 * 1024;

// Embeddings: delegate to the shared embedding pipeline (SQLite-backed memory bridge -> ONNX ->
// deterministic hash fallback) in memory/embedding-operations.ts.
let lastEmbeddingModel = 'unknown';

/**
 * Generate embedding via the shared pipeline (SQLite-backed memory bridge -> ONNX -> deterministic
 * hash), same one used by CLI `neural` commands and memory search. Falls back to a
 * local deterministic hash only if the shared module fails to load entirely.
 */
async function generateEmbedding(text?: string, dims: number = 384): Promise<number[]> {
  if (!text) return new Array(dims).fill(0);

  try {
    const { generateEmbedding: sharedGenerateEmbedding } = await import('../memory/embedding-operations.js');
    const result = await sharedGenerateEmbedding(text);
    lastEmbeddingModel = result.model;
    return result.embedding;
  } catch {
    // memory/embedding-operations.js unavailable — deterministic hash fallback
    lastEmbeddingModel = 'hash-fallback';
    const hash = text.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);
    const embedding: number[] = [];
    let seed = hash;
    for (let i = 0; i < dims; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      embedding.push((seed / 0x7fffffff) * 2 - 1);
    }
    return embedding;
  }
}

/** Truncate and validate a modelId string */
function sanitizeModelId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.length > MAX_MODEL_ID_LEN ? raw.slice(0, MAX_MODEL_ID_LEN) : raw;
  if (RESERVED_KEYS.has(id)) return null;
  return id;
}

export const neuralTools: MCPTool[] = [
  {
    name: 'neural_train',
    description: 'Embed text as vectors and store as named patterns for later similarity search (no ML training occurs)',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Store ID (groups related patterns)' },
        modelType: { type: 'string', enum: ['pattern', 'embedding'], description: 'Store type' },
        epochs: { type: 'number', description: 'Deprecated — ignored. Patterns are embedded and stored, not trained.' },
        learningRate: { type: 'number', description: 'Deprecated — ignored. No gradient-based training occurs.' },
        data: { type: 'object', description: 'Data to embed and store (array of strings or {text/content/label} objects)' },
      },
      required: ['modelType'],
    },
    handler: async (input) => {
      const rawModelId = (input.modelId as string) || `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const modelId = sanitizeModelId(rawModelId);
      if (modelId === null) {
        return { success: false, error: 'Invalid modelId' };
      }

      const VALID_MODEL_TYPES = new Set<string>(['pattern', 'embedding']);
      const rawModelType = input.modelType as string;
      if (!rawModelType || !VALID_MODEL_TYPES.has(rawModelType)) {
        return { success: false, error: `Invalid modelType "${rawModelType}". Must be one of: pattern, embedding` };
      }
      const modelType = rawModelType;

      // Initialize intelligence system (single source of truth)
      const { initializeIntelligence, getReasoningBank, getAllPatterns, flushPatterns } =
        await import('../memory/intelligence.js');
      const init = await initializeIntelligence();
      if (!init.success) {
        return { success: false, error: 'Failed to initialize intelligence system' };
      }
      const bank = getReasoningBank();
      if (!bank) {
        return { success: false, error: 'ReasoningBank not available' };
      }

      // Check pattern capacity
      const existingPatterns = await getAllPatterns();
      if (existingPatterns.length >= MAX_PATTERNS) {
        return { success: false, error: `Pattern store full (max ${MAX_PATTERNS}). Run neural_compress first.` };
      }

      const trainingData = input.data as Record<string, unknown> | Array<unknown> | undefined;
      let patternsStored = 0;

      if (trainingData) {
        const rawEntries = Array.isArray(trainingData) ? trainingData : [trainingData];
        const entries = rawEntries.slice(0, MAX_TRAINING_ENTRIES);
        for (let i = 0; i < entries.length; i++) {
          // Re-check capacity inside loop to prevent bypass via large arrays
          const currentPatterns = await getAllPatterns();
          if (currentPatterns.length >= MAX_PATTERNS) break;

          const entry = entries[i];
          let text = typeof entry === 'string' ? entry
            : (entry as Record<string, unknown>)?.text as string
            || (entry as Record<string, unknown>)?.content as string
            || (entry as Record<string, unknown>)?.label as string
            || JSON.stringify(entry);
          if (!text || typeof text !== 'string') continue;
          if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);

          const embedding = await generateEmbedding(text, 384);
          const patternId = `${modelId}-train-${i}`;

          bank.store({
            id: patternId,
            type: modelType,
            embedding,
            content: typeof entry === 'object' && entry !== null && 'label' in entry
              ? String((entry as Record<string, unknown>).label) : text.slice(0, 100),
            confidence: 0.8,
            metadata: { modelId, index: i, raw: entry },
          });
          patternsStored++;
        }
      }

      // Flush immediately to persist
      flushPatterns();

      const totalPatterns = (await getAllPatterns()).length;

      return {
        success: true,
        _realEmbedding: lastEmbeddingModel !== 'hash-fallback',
        modelId,
        type: modelType,
        status: 'ready',
        patternsStored,
        totalPatterns,
        epochs: 1,
        trainedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'neural_predict',
    description: 'Find stored patterns most similar to input text via cosine similarity (not ML prediction)',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to use' },
        input: { type: 'string', description: 'Text to find similar patterns for' },
        topK: { type: 'number', description: 'Number of top results to return' },
      },
      required: ['input'],
    },
    handler: async (input) => {
      const rawModelIdPred = input.modelId as string;
      if (rawModelIdPred) {
        const modelId = sanitizeModelId(rawModelIdPred);
        if (modelId === null) {
          return { success: false, error: 'Invalid modelId' };
        }
      }

      const inputText = typeof input.input === 'string' ? input.input.slice(0, MAX_SEARCH_QUERY_LENGTH) : '';
      const topK = Math.max(1, Math.min((input.topK as number) || 3, 50));

      const { initializeIntelligence, findSimilarPatterns } =
        await import('../memory/intelligence.js');
      await initializeIntelligence();

      const startTime = performance.now();
      const embedding = await generateEmbedding(inputText, 384);

      // Use intelligence.ts findSimilarPatterns which handles embedding + search
      const results = await findSimilarPatterns(inputText, {
        k: topK,
        threshold: 0.1,
      });
      const latency = Math.round(performance.now() - startTime);

      const predictions = results.map(r => ({
        label: r.content || r.type || r.id,
        confidence: r.similarity ?? r.confidence,
        patternId: r.id,
      }));

      return {
        success: true,
        _realEmbedding: lastEmbeddingModel !== 'hash-fallback',
        _hasStoredPatterns: results.length > 0,
        modelId: rawModelIdPred || 'default',
        input: inputText,
        predictions,
        embedding: embedding.slice(0, 8),
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
      const action = (input.action as string) || 'list';

      const { initializeIntelligence, getAllPatterns, getPatternsByType, getReasoningBank, findSimilarPatterns, deletePattern, flushPatterns } =
        await import('../memory/intelligence.js');
      await initializeIntelligence();

      if (action === 'list') {
        const typeFilter = input.type as string;
        const patterns = typeFilter
          ? await getPatternsByType(typeFilter)
          : await getAllPatterns();

        return {
          patterns: patterns.map(p => ({
            id: p.id,
            name: p.content,
            type: p.type,
            usageCount: p.usageCount,
            createdAt: typeof p.createdAt === 'number' ? new Date(p.createdAt).toISOString() : p.createdAt,
          })),
          total: patterns.length,
        };
      }

      if (action === 'get') {
        const patternId = input.patternId as string;
        if (!patternId || RESERVED_KEYS.has(patternId)) {
          return { success: false, error: 'Invalid patternId' };
        }
        const bank = getReasoningBank();
        if (!bank) {
          return { success: false, error: 'ReasoningBank not available' };
        }
        const pattern = bank.get(patternId);
        if (!pattern) {
          return { success: false, error: 'Pattern not found' };
        }
        return {
          success: true,
          pattern: {
            id: pattern.id,
            name: pattern.content,
            type: pattern.type,
            embedding: pattern.embedding,
            metadata: pattern.metadata ?? {},
            createdAt: new Date(pattern.createdAt).toISOString(),
            usageCount: pattern.usageCount,
          },
        };
      }

      if (action === 'store') {
        const allPatterns = await getAllPatterns();
        if (allPatterns.length >= MAX_PATTERNS) {
          return { success: false, error: `Pattern store full (max ${MAX_PATTERNS}). Run neural_compress first.` };
        }

        const MAX_PATTERN_NAME_LENGTH = 16 * 1024;
        const rawPatternName = (input.name as string) || 'Unnamed pattern';
        const patternName = typeof rawPatternName === 'string' && rawPatternName.length > MAX_PATTERN_NAME_LENGTH
          ? rawPatternName.slice(0, MAX_PATTERN_NAME_LENGTH)
          : rawPatternName;

        const embedding = await generateEmbedding(patternName, 384);
        const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const patternType = (input.type as string) || 'general';

        const bank = getReasoningBank();
        if (!bank) {
          return { success: false, error: 'ReasoningBank not available' };
        }

        bank.store({
          id: patternId,
          type: patternType,
          embedding,
          content: patternName,
          confidence: 0.8,
          metadata: (input.data as Record<string, unknown>) || {},
        });
        flushPatterns();

        return {
          success: true,
          _realEmbedding: lastEmbeddingModel !== 'hash-fallback',
          patternId,
          name: patternName,
          type: patternType,
          embeddingDims: embedding.length,
          createdAt: new Date().toISOString(),
        };
      }

      if (action === 'search') {
        const rawQuery = input.query as string;
        const query = typeof rawQuery === 'string' && rawQuery.length > MAX_SEARCH_QUERY_LENGTH
          ? rawQuery.slice(0, MAX_SEARCH_QUERY_LENGTH)
          : rawQuery;

        const results = await findSimilarPatterns(query || '', {
          k: 10,
          threshold: 0.1,
        });

        return {
          _realSimilarity: true,
          _realEmbedding: lastEmbeddingModel !== 'hash-fallback',
          query,
          results: results.map(r => ({
            id: r.id,
            name: r.content,
            type: r.type,
            similarity: r.similarity ?? r.confidence,
          })),
          total: results.length,
        };
      }

      if (action === 'delete') {
        const patternId = input.patternId as string;
        if (!patternId || RESERVED_KEYS.has(patternId)) {
          return { success: false, error: 'Invalid patternId' };
        }
        const deleted = await deletePattern(patternId);
        if (!deleted) {
          return { success: false, error: 'Pattern not found' };
        }
        return { success: true, deleted: patternId };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'neural_compress',
    description: 'Compress pattern store (quantize, prune, or deduplicate)',
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
      const method = (input.method as string) || 'quantize';

      const { initializeIntelligence, compactPatterns, getAllPatterns } =
        await import('../memory/intelligence.js');
      await initializeIntelligence();

      const patterns = await getAllPatterns();
      if (patterns.length === 0) {
        return { success: false, error: 'No patterns to compress. Train patterns first with neural_train.' };
      }

      const beforeCount = patterns.length;

      if (method === 'quantize' || method === 'distill') {
        // Both quantize and distill map to compactPatterns (dedup by cosine similarity)
        const threshold = method === 'quantize' ? 0.99 : 0.95;
        const result = await compactPatterns(threshold);
        return {
          success: true, _real: true, method,
          patternsBefore: result.before,
          patternsAfter: result.after,
          patternsRemoved: result.removed,
          note: method === 'quantize'
            ? 'Near-duplicate patterns removed (cosine > 0.99).'
            : `Similar patterns merged (cosine > ${threshold}).`,
        };
      }

      if (method === 'prune') {
        // Prune maps to compactPatterns with a looser threshold
        const targetReduction = (input.targetSize as number) || 0.5;
        // Use a threshold proportional to target reduction (lower = more aggressive)
        const threshold = 0.7 + (1 - targetReduction) * 0.25;
        const result = await compactPatterns(threshold);
        return {
          success: true, _real: true, method,
          patternsBefore: result.before,
          patternsAfter: result.after,
          patternsRemoved: result.removed,
        };
      }

      return { success: false, error: `Unknown method: ${method}. Use quantize, prune, or distill.` };
    },
  },
  {
    name: 'neural_status',
    description: 'Get pattern store status (pattern count, embedding dimensions, store health)',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Specific model ID' },
        detailed: { type: 'boolean', description: 'Include detailed info' },
      },
    },
    handler: async (input) => {
      const { initializeIntelligence, getIntelligenceStats, getAllPatterns } =
        await import('../memory/intelligence.js');
      await initializeIntelligence();

      const stats = getIntelligenceStats();
      const patterns = await getAllPatterns();

      if (input.modelId) {
        const modelId = sanitizeModelId(input.modelId as string);
        if (modelId === null) {
          return { success: false, error: 'Invalid modelId' };
        }
        // Filter patterns belonging to this model (by metadata or id prefix)
        const modelPatterns = patterns.filter(p =>
          p.id.startsWith(modelId) ||
          ((p as unknown as { metadata?: { modelId?: string } }).metadata?.modelId === modelId)
        );
        return {
          success: true,
          model: {
            id: modelId,
            patternsStored: modelPatterns.length,
            status: modelPatterns.length > 0 ? 'ready' : 'empty',
          },
        };
      }

      const byType: Record<string, number> = {};
      for (const p of patterns) {
        byType[p.type] = (byType[p.type] || 0) + 1;
      }

      return {
        embeddingProvider: lastEmbeddingModel === 'unknown' ? 'not yet used' : lastEmbeddingModel,
        sonaEnabled: stats.sonaEnabled,
        models: {
          total: 0, // models concept removed; patterns are stored directly
          ready: 0,
          indexing: 0,
        },
        patterns: {
          total: patterns.length,
          byType,
          embeddingDims: patterns.length > 0 && patterns[0].embedding ? patterns[0].embedding.length : 384,
        },
        intelligence: {
          reasoningBankSize: stats.reasoningBankSize,
          patternsLearned: stats.patternsLearned,
          trajectoriesRecorded: stats.trajectoriesRecorded,
        },
      };
    },
  },
  {
    name: 'neural_optimize',
    description: 'Optimize pattern store (deduplicate, quantize, prune empty)',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to optimize' },
        target: { type: 'string', enum: ['speed', 'memory', 'accuracy', 'balanced'], description: 'Optimization target' },
      },
    },
    handler: async (input) => {
      const target = (input.target as string) || 'balanced';

      const { initializeIntelligence, compactPatterns, getAllPatterns } =
        await import('../memory/intelligence.js');
      await initializeIntelligence();

      const patterns = await getAllPatterns();
      if (patterns.length === 0) {
        return { success: false, error: 'No patterns to optimize. Train patterns first with neural_train.' };
      }

      const startTime = performance.now();
      const actions: string[] = [];
      const beforeCount = patterns.length;
      const dims = patterns[0]?.embedding?.length || 0;

      // All optimization targets delegate to compactPatterns with varying thresholds
      let threshold: number;
      switch (target) {
        case 'speed':
          threshold = 0.99; // only near-exact duplicates
          break;
        case 'memory':
          threshold = 0.90; // aggressive dedup
          break;
        case 'accuracy':
          threshold = 0.98; // conservative
          break;
        case 'balanced':
        default:
          threshold = 0.95;
          break;
      }

      const result = await compactPatterns(threshold);
      if (result.removed > 0) {
        actions.push(`Removed ${result.removed} similar patterns (cosine > ${threshold})`);
      } else {
        actions.push('No duplicate patterns found');
      }

      const elapsed = Math.round(performance.now() - startTime);

      return {
        success: true, _real: true, target,
        actions,
        patternsBefore: result.before,
        patternsAfter: result.after,
        duplicatesRemoved: result.removed,
        patternsQuantized: 0,
        patternsRemoved: result.removed,
        embeddingDims: dims,
        elapsedMs: elapsed,
      };
    },
  },
];
