import { describe, expect, it, vi } from 'vitest';
import { RouteLayer } from '../route-layer.js';
import type { Route, RouteLayerConfig } from '../types.js';

const coderRoute: Route = {
  name: 'coder',
  agentSlug: 'coder',
  utterances: [
    'implement the feature',
    'write the function',
    'code the migration',
    'build the API endpoint',
  ],
  threshold: 0.5,
  fallbackToLLM: true,
  description: 'General code implementation',
};

const testerRoute: Route = {
  name: 'tester',
  agentSlug: 'tester',
  utterances: [
    'write unit tests',
    'create integration tests',
    'add test coverage',
    'fix failing tests',
  ],
  threshold: 0.5,
  fallbackToLLM: true,
  description: 'Testing specialist',
};

const reviewerRoute: Route = {
  name: 'reviewer',
  agentSlug: 'reviewer',
  utterances: [
    'review this code',
    'check the pull request',
    'review the diff',
    'code review for the module',
  ],
  threshold: 0.5,
  fallbackToLLM: true,
  description: 'Code review',
};

function makeConfig(overrides?: Partial<RouteLayerConfig>): RouteLayerConfig {
  return {
    routes: [coderRoute, testerRoute, reviewerRoute],
    enableKeywordFilter: false, // disable keyword filter by default for semantic tests
    ...overrides,
  };
}

describe('RouteLayer', () => {
  describe('keyword pre-filter', () => {
    it('keyword match short-circuits semantic routing', async () => {
      const layer = new RouteLayer(makeConfig({ enableKeywordFilter: true }));
      const result = await layer.route('Fix CVE-2024-12345 in production');
      expect(result.method).toBe('keyword');
      expect(result.agentSlug).toBe('engineering-security-engineer');
      expect(result.confidence).toBe(1.0);
    });

    it('enableKeywordFilter: false disables keyword pre-filter', async () => {
      const layer = new RouteLayer(makeConfig({ enableKeywordFilter: false }));
      const result = await layer.route('Fix CVE-2024-12345 in production');
      expect(result.method).not.toBe('keyword');
    });
  });

  describe('semantic routing', () => {
    it('auto-initializes on first route() call', async () => {
      const layer = new RouteLayer(makeConfig());
      // No explicit initialize() call
      const result = await layer.route('implement a new feature');
      expect(result.agentSlug).toBeDefined();
      expect(result.method).toBeDefined();
    });

    it('returns a valid RouteResult with semantic method', async () => {
      const layer = new RouteLayer(makeConfig());
      await layer.initialize();
      const result = await layer.route('implement the login function');
      expect(result.agentSlug).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(['semantic', 'semantic_degraded', 'llm_fallback']).toContain(result.method);
    });

    it('initialize is idempotent', async () => {
      const layer = new RouteLayer(makeConfig());
      await layer.initialize();
      await layer.initialize(); // should not throw or re-compute
      const result = await layer.route('write code');
      expect(result.agentSlug).toBeDefined();
    });
  });

  describe('no routes configured', () => {
    it('returns general-purpose fallback', async () => {
      const layer = new RouteLayer(makeConfig({ routes: [] }));
      const result = await layer.route('do something');
      expect(result.agentSlug).toBe('general-purpose');
      expect(result.confidence).toBe(0);
      // No LLM was consulted here, so this must not claim to be an
      // llm_fallback — it is a degraded default.
      expect(result.method).toBe('semantic_degraded');
      expect(result.routeName).toBe('fallback');
    });
  });

  describe('addRoute', () => {
    it('registers a route at runtime', async () => {
      const layer = new RouteLayer(makeConfig({ routes: [] }));
      await layer.addRoute({
        name: 'custom',
        agentSlug: 'custom-agent',
        utterances: ['handle custom task', 'do custom work'],
        threshold: 0.5,
        fallbackToLLM: false,
      });
      const result = await layer.route('handle custom task');
      expect(result.agentSlug).toBe('custom-agent');
    });

    it('does not mutate the caller config.routes array (PKG-4)', async () => {
      const sharedRoutes: Route[] = [{ ...coderRoute }];
      const config: RouteLayerConfig = { routes: sharedRoutes, enableKeywordFilter: false };

      const layer1 = new RouteLayer(config);
      const layer2 = new RouteLayer(config);

      await layer1.addRoute({
        name: 'extra',
        agentSlug: 'extra-agent',
        utterances: ['do extra thing'],
        threshold: 0.5,
        fallbackToLLM: false,
      });

      // Caller's original array is not mutated by layer1.addRoute.
      expect(sharedRoutes.length).toBe(1);
      expect(sharedRoutes[0].name).toBe('coder');

      // layer2 was built from the same config but does not see the addition —
      // its routes table still has only the single original route, so routing
      // for the added utterance falls back rather than resolving to 'extra'.
      const result = await layer2.route('do extra thing');
      expect(result.agentSlug).not.toBe('extra-agent');
    });

    it('marks layer as initialized after addRoute', async () => {
      const layer = new RouteLayer(makeConfig({ routes: [] }));
      await layer.addRoute(coderRoute);
      // Should not throw - layer is now initialized
      const result = await layer.route('implement feature');
      expect(result.agentSlug).toBeDefined();
    });

    it('does not drop pre-configured routes when addRoute runs before initialize (#95)', async () => {
      // Regression: addRoute() on an uninitialized layer used to set
      // initialized=true after pushing one centroid, so initialize() returned
      // early and the configured route table never got centroids.
      const layer = new RouteLayer(makeConfig({ debug: true })); // 3 configured routes
      await layer.addRoute({
        name: 'custom',
        agentSlug: 'custom-agent',
        utterances: ['handle custom task', 'do custom work'],
        threshold: 0.5,
        fallbackToLLM: false,
      });
      const result = await layer.route('implement the login function');
      // All 3 built-in routes + the added one must participate in scoring
      expect(result.allScores).toBeDefined();
      expect(result.allScores?.length).toBe(4);
      const routeNames = result.allScores?.map((s) => s.routeName).sort();
      expect(routeNames).toEqual(['coder', 'custom', 'reviewer', 'tester']);
    });

    it('initializes from config when addRoute left centroids incomplete (#95)', async () => {
      // Same regression, asserting the semantic outcome directly: a query that
      // clearly matches a built-in route must not be routed to the added route
      // just because the built-ins lost their centroids.
      const layer = new RouteLayer(makeConfig());
      await layer.addRoute({
        name: 'custom',
        agentSlug: 'custom-agent',
        utterances: ['zzzqxv quibblesnack frobnicate', 'zzzqxv wobblenarble'],
        threshold: 0.5,
        fallbackToLLM: false,
      });
      const result = await layer.route('review this code');
      expect(result.agentSlug).toBe('reviewer');
    });
  });

  describe('globalThreshold', () => {
    it('overrides per-route thresholds', async () => {
      // With a very high global threshold, everything should fall below it
      const layer = new RouteLayer(
        makeConfig({
          globalThreshold: 0.99,
        }),
      );
      await layer.initialize();
      const result = await layer.route('implement something');
      // With LocalEncoder the cosine similarity for hash-based embeddings
      // will be below 0.99. No llmFallback is configured, so nothing
      // escalated: the result is the nearest centroid, reported as degraded
      // rather than as an llm_fallback that never ran.
      expect(result.method).toBe('semantic_degraded');
    });
  });

  describe('LLM fallback', () => {
    it('triggers LLM fallback when below threshold and configured', async () => {
      const llmCaller = vi.fn().mockResolvedValue('tester');
      const layer = new RouteLayer(
        makeConfig({
          globalThreshold: 0.99, // ensure below threshold
          llmFallback: { llmCaller, onFallback: vi.fn() },
        }),
      );
      await layer.initialize();
      const result = await layer.route('implement something');
      expect(llmCaller).toHaveBeenCalled();
      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('tester');
    });

    it('does not trigger LLM fallback when not configured', async () => {
      const layer = new RouteLayer(
        makeConfig({
          globalThreshold: 0.99,
          // No llmFallback configured
        }),
      );
      const result = await layer.route('implement something');
      // Below threshold with no LLM configured => degraded, not llm_fallback.
      expect(result.method).toBe('semantic_degraded');
      // Still returns best semantic match
      expect(result.agentSlug).toBeDefined();
    });
  });

  describe('precomputed centroids', () => {
    it('skips utterance embedding when centroids provided', async () => {
      const dim = 256;
      // Create distinct centroids for each route
      const centroids = [
        Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)),
        Array.from({ length: dim }, (_, i) => (i === 1 ? 1 : 0)),
        Array.from({ length: dim }, (_, i) => (i === 2 ? 1 : 0)),
      ];
      const layer = new RouteLayer(makeConfig({ centroids }));
      await layer.initialize();
      const result = await layer.route('test something');
      expect(result.agentSlug).toBeDefined();
    });

    it('ignores centroids if count does not match routes', async () => {
      const layer = new RouteLayer(
        makeConfig({
          centroids: [
            [1, 0],
            [0, 1],
          ], // only 2, but 3 routes
        }),
      );
      // Should fall back to computing centroids from utterances
      await layer.initialize();
      const result = await layer.route('test');
      expect(result.agentSlug).toBeDefined();
    });
  });

  describe('debug mode', () => {
    it('includes allScores when debug is true', async () => {
      const layer = new RouteLayer(makeConfig({ debug: true }));
      await layer.initialize();
      const result = await layer.route('implement the login');
      expect(result.allScores).toBeDefined();
      expect(result.allScores?.length).toBe(3);
      for (const s of result.allScores!) {
        expect(s).toHaveProperty('routeName');
        expect(s).toHaveProperty('agentSlug');
        expect(s).toHaveProperty('score');
      }
    });

    it('does not include allScores when debug is false', async () => {
      const layer = new RouteLayer(makeConfig({ debug: false }));
      await layer.initialize();
      const result = await layer.route('implement the login');
      expect(result.allScores).toBeUndefined();
    });
  });

  describe('encoder selection', () => {
    it('uses LocalEncoder by default', async () => {
      const layer = new RouteLayer(makeConfig());
      await layer.initialize();
      const result = await layer.route('write code');
      expect(result.agentSlug).toBeDefined();
    });

    it('uses HNSWEncoder when encoder is "hnsw"', async () => {
      const layer = new RouteLayer(makeConfig({ encoder: 'hnsw' }));
      await layer.initialize();
      const result = await layer.route('write code');
      // HNSWEncoder without embedder falls back to LocalEncoder
      expect(result.agentSlug).toBeDefined();
    });

    it('uses injected embeddingGenerator', async () => {
      const mockEmbed = vi.fn().mockImplementation(async () => {
        const vec = new Array(64).fill(0);
        vec[0] = 1; // unit vector
        return vec;
      });
      const routes: Route[] = [
        {
          name: 'test-route',
          agentSlug: 'test-agent',
          utterances: ['test utterance'],
          threshold: 0.0,
          fallbackToLLM: false,
        },
      ];
      const layer = new RouteLayer({
        routes,
        embeddingGenerator: mockEmbed,
        enableKeywordFilter: false,
      });
      await layer.initialize();
      const result = await layer.route('some query');
      expect(mockEmbed).toHaveBeenCalled();
      expect(result.agentSlug).toBe('test-agent');
    });
  });
});
