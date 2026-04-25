import { Route, RouteResult, RouteLayerConfig } from './types.js';
import { cosineSimilarity, computeCentroid } from './cosine.js';
import { LocalEncoder, Encoder } from './encoder.js';
import { LLMFallbackRouter } from './llm-fallback.js';
import { KeywordPreFilter } from './keyword-pre-filter.js';

interface RouteCentroid {
  route: Route;
  centroid: number[];
}

export class RouteLayer {
  private centroids: RouteCentroid[] = [];
  private encoder: Encoder;
  private config: RouteLayerConfig;
  private initialized = false;
  private llmFallback?: LLMFallbackRouter;
  private keywordFilter?: KeywordPreFilter;

  constructor(config: RouteLayerConfig) {
    this.config = config;
    this.encoder = new LocalEncoder();
    if (config.llmFallback) {
      this.llmFallback = new LLMFallbackRouter(config.llmFallback);
    }
    if (config.enableKeywordFilter !== false) {
      this.keywordFilter = new KeywordPreFilter(config.keywordRules);
    }
  }

  /**
   * Pre-compute centroids for all routes.
   * Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.centroids = await Promise.all(
      this.config.routes.map(async (route) => {
        const vectors = await this.encoder.encodeAll(route.utterances);
        const centroid = computeCentroid(vectors);
        return { route, centroid };
      })
    );
    this.initialized = true;
  }

  /**
   * Route a task description to the most appropriate agent slug.
   * Auto-initializes on first call.
   */
  async route(taskDescription: string): Promise<RouteResult> {
    // Keyword pre-filter: fast deterministic match before semantic routing
    if (this.keywordFilter) {
      const keywordResult = this.keywordFilter.match(taskDescription);
      if (keywordResult) return keywordResult;
    }

    await this.initialize();

    if (this.centroids.length === 0) {
      return {
        agentSlug: 'general-purpose',
        confidence: 0,
        method: 'llm_fallback',
        routeName: 'fallback',
      };
    }

    const taskVector = await this.encoder.encode(taskDescription);
    const globalThreshold = this.config.globalThreshold ?? 0.5;

    const scores = this.centroids.map(({ route, centroid }) => ({
      routeName: route.name,
      agentSlug: route.agentSlug,
      score: cosineSimilarity(taskVector, centroid),
      threshold: this.config.globalThreshold ?? route.threshold ?? 0.5,
      fallbackToLLM: route.fallbackToLLM,
    }));

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    const method: RouteResult['method'] =
      best.score < (best.threshold ?? globalThreshold) ? 'llm_fallback' : 'semantic';

    // Delegate to LLM fallback when below threshold and configured
    if (method === 'llm_fallback' && this.llmFallback) {
      const fallbackResult = await this.llmFallback.classify(taskDescription, this.config.routes, scores);
      if (this.config.debug) {
        fallbackResult.allScores = scores.map(s => ({
          routeName: s.routeName,
          agentSlug: s.agentSlug,
          score: s.score,
        }));
      }
      return fallbackResult;
    }

    const result: RouteResult = {
      agentSlug: best.agentSlug,
      confidence: Math.max(0, Math.min(1, (best.score + 1) / 2)), // normalize [-1,1] → [0,1]
      method,
      routeName: best.routeName,
    };

    if (this.config.debug) {
      result.allScores = scores.map(s => ({
        routeName: s.routeName,
        agentSlug: s.agentSlug,
        score: s.score,
      }));
    }

    return result;
  }

  /**
   * Register an additional route at runtime without re-initializing all centroids.
   */
  async addRoute(route: Route): Promise<void> {
    const vectors = await this.encoder.encodeAll(route.utterances);
    const centroid = computeCentroid(vectors);
    this.centroids.push({ route, centroid });
    this.config.routes.push(route);
    if (!this.initialized) this.initialized = true;
  }
}
