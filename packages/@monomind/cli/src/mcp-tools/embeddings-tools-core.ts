/**
 * Embeddings MCP Tools — init, generate, compare, search.
 * Extracted from embeddings-tools.ts.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_EMBEDDING_DIMS, DEFAULT_EMBEDDING_MODEL } from '../init/types.js';
import { cosineSimilarity } from '../utils/cosine-similarity.js';
import {
  CONFIG_DIR,
  type EmbeddingsConfig,
  getConfigPath,
  loadConfig,
  MODELS_DIR,
  saveConfig,
  validateText,
} from './embeddings-tools-config.js';
import { generateRealEmbedding, poincareDistance, toPoincare } from './embeddings-tools-math.js';
import type { MCPTool } from './types.js';

export const embeddingsCoreTools: MCPTool[] = [
  {
    name: 'embeddings_init',
    description: 'Initialize the ONNX embedding subsystem with hyperbolic support',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'ONNX model ID',
          enum: [DEFAULT_EMBEDDING_MODEL, 'Xenova/all-MiniLM-L6-v2', 'Xenova/all-mpnet-base-v2'],
          default: DEFAULT_EMBEDDING_MODEL,
        },
        hyperbolic: {
          type: 'boolean',
          description: 'Enable hyperbolic (Poincaré ball) embeddings',
          default: true,
        },
        curvature: {
          type: 'number',
          description: 'Poincaré ball curvature (negative)',
          default: -1,
        },
        cacheSize: {
          type: 'number',
          description: 'LRU cache size',
          default: 256,
        },
        force: {
          type: 'boolean',
          description: 'Overwrite existing configuration',
          default: false,
        },
      },
    },
    handler: async (input) => {
      const model = (input.model as string) || DEFAULT_EMBEDDING_MODEL;
      const hyperbolic = input.hyperbolic !== false;
      const curvature = (input.curvature as number) || -1;
      const cacheSize = (input.cacheSize as number) || 256;
      const force = input.force === true;

      const existingConfig = loadConfig();
      if (existingConfig && !force) {
        return {
          success: false,
          error: 'Embeddings already initialized. Use force=true to overwrite.',
          existingConfig: {
            model: existingConfig.model,
            initialized: existingConfig.initialized,
          },
        };
      }

      const dimension =
        model === DEFAULT_EMBEDDING_MODEL
          ? DEFAULT_EMBEDDING_DIMS
          : model.includes('mpnet')
            ? 768
            : 384;
      const modelPath = resolve(join(CONFIG_DIR, MODELS_DIR));

      // Create models directory
      if (!existsSync(modelPath)) {
        mkdirSync(modelPath, { recursive: true });
      }

      const config: EmbeddingsConfig = {
        model,
        modelPath,
        dimension,
        cacheSize,
        hyperbolic: {
          enabled: hyperbolic,
          curvature,
          epsilon: 1e-15,
          maxNorm: 1 - 1e-5,
        },
        neural: {
          enabled: true,
          driftThreshold: 0.3,
          decayRate: 0.01,
        },
        initialized: new Date().toISOString(),
      };

      saveConfig(config);

      return {
        success: true,
        config: {
          model,
          dimension,
          cacheSize,
          hyperbolic: hyperbolic ? { enabled: true, curvature } : { enabled: false },
          neural: { enabled: true },
        },
        paths: {
          config: getConfigPath(),
          models: modelPath,
        },
        message: 'Embedding subsystem initialized successfully',
      };
    },
  },

  {
    name: 'embeddings_generate',
    description: 'Generate embeddings for text (Euclidean or hyperbolic)',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to embed',
        },
        hyperbolic: {
          type: 'boolean',
          description: 'Return hyperbolic (Poincaré) embedding',
          default: false,
        },
        normalize: {
          type: 'boolean',
          description: 'L2 normalize the embedding',
          default: true,
        },
      },
      required: ['text'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      let text: string;
      try {
        text = validateText(input.text, 'text');
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
      const useHyperbolic = input.hyperbolic === true && config.hyperbolic.enabled;

      // Generate real ONNX embedding
      const embedding = await generateRealEmbedding(text, config.dimension);

      let result: number[];
      let geometry: string;

      if (useHyperbolic) {
        result = toPoincare(embedding, config.hyperbolic.curvature);
        geometry = 'poincare';
      } else {
        result = embedding;
        geometry = 'euclidean';
      }

      return {
        success: true,
        embedding: result,
        metadata: {
          model: config.model,
          dimension: config.dimension,
          geometry,
          curvature: useHyperbolic ? config.hyperbolic.curvature : null,
          textLength: text.length,
          norm: Math.sqrt(result.reduce((sum, x) => sum + x * x, 0)),
        },
      };
    },
  },

  {
    name: 'embeddings_compare',
    description: 'Compare similarity between two texts',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: 'First text',
        },
        text2: {
          type: 'string',
          description: 'Second text',
        },
        metric: {
          type: 'string',
          description: 'Similarity metric',
          enum: ['cosine', 'euclidean', 'poincare'],
          default: 'cosine',
        },
      },
      required: ['text1', 'text2'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      let text1: string, text2: string;
      try {
        text1 = validateText(input.text1, 'text1');
        text2 = validateText(input.text2, 'text2');
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
      const metric = (input.metric as string) || 'cosine';

      // Generate real ONNX embeddings for both texts
      const [emb1, emb2] = await Promise.all([
        generateRealEmbedding(text1, config.dimension),
        generateRealEmbedding(text2, config.dimension),
      ]);

      let similarity: number;
      let distance: number;

      switch (metric) {
        case 'poincare': {
          if (!config.hyperbolic.enabled) {
            return {
              success: false,
              error: 'Hyperbolic mode not enabled. Initialize with hyperbolic=true.',
            };
          }
          const poinc1 = toPoincare(emb1, config.hyperbolic.curvature);
          const poinc2 = toPoincare(emb2, config.hyperbolic.curvature);
          distance = poincareDistance(poinc1, poinc2, config.hyperbolic.curvature);
          similarity = 1 / (1 + distance);
          break;
        }

        case 'euclidean':
          distance = Math.sqrt(emb1.reduce((sum, _, i) => sum + (emb1[i] - emb2[i]) ** 2, 0));
          similarity = 1 / (1 + distance);
          break;

        default: // cosine
          similarity = cosineSimilarity(emb1, emb2);
          distance = 1 - similarity;
      }

      return {
        success: true,
        similarity,
        distance,
        metric,
        texts: {
          text1: { length: text1.length, preview: text1.slice(0, 50) },
          text2: { length: text2.length, preview: text2.slice(0, 50) },
        },
        interpretation:
          similarity > 0.8
            ? 'very similar'
            : similarity > 0.6
              ? 'similar'
              : similarity > 0.4
                ? 'somewhat similar'
                : similarity > 0.2
                  ? 'different'
                  : 'very different',
      };
    },
  },

  {
    name: 'embeddings_search',
    description: 'Semantic search across stored embeddings',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        topK: {
          type: 'number',
          description: 'Number of results to return',
          default: 5,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (0-1)',
          default: 0.5,
        },
        namespace: {
          type: 'string',
          description: 'Search in specific namespace',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      // Cap query length: generateRealEmbedding has a hash-fallback that is
      // O(n) over the text length, so an unbounded query is a DoS vector.
      // Cap topK to prevent requesting a huge result set from searchEntries.
      let query: string;
      try {
        query = validateText(input.query, 'query');
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
      const MAX_SEARCH_TOP_K = 100;
      const rawTopK = (input.topK as number) || 5;
      const topK =
        Number.isFinite(rawTopK) && rawTopK > 0
          ? Math.min(Math.floor(rawTopK), MAX_SEARCH_TOP_K)
          : 5;
      const threshold = (input.threshold as number) || 0.5;
      const namespace = input.namespace as string;

      const startTime = performance.now();

      // Try to search using real memory search
      try {
        const { searchEntries } = await import('../memory/memory-initializer.js');
        const searchResult = await searchEntries({
          query,
          limit: topK,
          threshold,
          namespace: namespace || 'default',
        });

        const searchTime = (performance.now() - startTime).toFixed(2);

        return {
          success: true,
          query,
          results: searchResult.results.map((r) => ({
            key: r.key,
            content: r.content?.substring(0, 100),
            similarity: r.score,
            namespace: r.namespace,
          })),
          metadata: {
            model: config.model,
            topK,
            threshold,
            namespace: namespace || 'default',
            searchTime: `${searchTime}ms`,
            indexType: config.hyperbolic.enabled ? 'HNSW (hyperbolic)' : 'HNSW (euclidean)',
            resultCount: searchResult.results.length,
          },
        };
      } catch (e) {
        // Database not available - return empty but truthful
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[embeddings-tools] search failed:', e);
        const searchTime = (performance.now() - startTime).toFixed(2);
        return {
          success: true,
          query,
          results: [],
          metadata: {
            model: config.model,
            topK,
            threshold,
            namespace: namespace || 'default',
            searchTime: `${searchTime}ms`,
            indexType: config.hyperbolic.enabled ? 'HNSW (hyperbolic)' : 'HNSW (euclidean)',
          },
          message: 'No embeddings indexed yet. Use memory store to add documents.',
        };
      }
    },
  },
];
