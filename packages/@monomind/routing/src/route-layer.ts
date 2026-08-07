import { Route, RouteResult, RouteLayerConfig } from './types.js';
import { cosineSimilarity, computeCentroid } from './cosine.js';
import { LocalEncoder, HNSWEncoder, Encoder } from './encoder.js';
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
    // A real injected embedder (or explicit 'hnsw') uses HNSWEncoder; otherwise
    // the deterministic hash-based LocalEncoder. When embeddingGenerator is
    // present, HNSWEncoder embeds with it exclusively (no dimension mixing).
    if (config.embeddingGenerator) {
      this.encoder = new HNSWEncoder(config.embeddingGenerator);
    } else if (config.encoder === 'hnsw') {
      this.encoder = new HNSWEncoder();
    } else {
      this.encoder = new LocalEncoder();
    }
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

    // Fast path: host supplied precomputed centroids (e.g. from a disk cache),
    // aligned 1:1 with routes. Skip the expensive per-utterance embedding.
    const precomputed = this.config.centroids;
    if (precomputed && precomputed.length === this.config.routes.length) {
      this.centroids = this.config.routes.map((route, i) => ({
        route,
        centroid: precomputed[i],
      }));
      this.initialized = true;
      return;
    }

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
      // No routes to score and no LLM consulted — this is a degraded default,
      // not a fallback that ran. It used to report method 'llm_fallback'.
      return {
        agentSlug: 'general-purpose',
        confidence: 0,
        method: 'semantic_degraded',
        routeName: 'fallback',
      };
    }

    const taskVector = await this.encoder.encode(taskDescription);
    const globalThreshold = this.config.globalThreshold ?? 0.5;

    const scores = this.centroids.map(({ route, centroid }) => ({
      routeName: route.name,
      agentSlug: route.agentSlug,
      score: cosineSimilarity(taskVector, centroid),
      threshold: route.threshold ?? this.config.globalThreshold ?? 0.5,
      fallbackToLLM: route.fallbackToLLM,
    }));

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    const belowThreshold = best.score < (best.threshold ?? globalThreshold);
    // Below threshold with no LLM configured means nothing escalated: the
    // returned slug is the nearest centroid, so report it as degraded rather
    // than as an 'llm_fallback' that never happened. (When an LLM *is*
    // configured, classify() below owns the label.)
    const method: RouteResult['method'] = belowThreshold ? 'semantic_degraded' : 'semantic';

    // Delegate to LLM fallback when below threshold and configured
    if (belowThreshold && this.llmFallback) {
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
    // Only mark initialized when centroids cover every configured route. If
    // addRoute() runs before initialize() on a non-empty route table, the
    // pre-existing config.routes still lack centroids — setting initialized
    // here would make initialize() return early and silently drop the whole
    // configured table. Leaving it false lets the next initialize() (called
    // automatically by route()) compute centroids for all routes, including
    // this one.
    if (!this.initialized && this.centroids.length === this.config.routes.length) {
      this.initialized = true;
    }
  }
}
