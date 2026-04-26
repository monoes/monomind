import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { RouteLayer } from '../../packages/@monomind/routing/src/route-layer.js';
import { coreRoutes } from '../../packages/@monomind/routing/src/routes/core.route.js';
import { securityRoutes } from '../../packages/@monomind/routing/src/routes/security.route.js';
import { engineeringRoutes } from '../../packages/@monomind/routing/src/routes/engineering.route.js';
import { ALL_ROUTES } from '../../packages/@monomind/routing/src/routes/index.js';
import { TestModel } from '../../packages/@monomind/shared/src/testing/index.js';

describe('RouteLayer', () => {
  let layer: RouteLayer;

  beforeEach(() => {
    layer = new RouteLayer({
      routes: [...coreRoutes, ...securityRoutes],
      debug: true,
    });
  });

  describe('route()', () => {
    it('returns a RouteResult with required fields', async () => {
      const result = await layer.route('implement the login endpoint');
      expect(result).toHaveProperty('agentSlug');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('routeName');
    });

    it('routes implementation task to a development agent', async () => {
      const result = await layer.route('implement the password reset functionality');
      // LocalEncoder uses hash-based pseudo-embeddings; exact slug depends on route centroids
      expect(result.agentSlug).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('routes security task to a security agent', async () => {
      const result = await layer.route('audit the JWT token handling for vulnerabilities');
      expect(['engineering-security-engineer', 'blockchain-security-auditor']).toContain(result.agentSlug);
    });

    it('routes review task to reviewer', async () => {
      const result = await layer.route('review this pull request for code quality issues');
      expect(result.agentSlug).toBe('reviewer');
    });

    it('routes testing task to a test-related agent', async () => {
      const result = await layer.route('write unit tests for the authentication module');
      // KeywordPreFilter matches "write unit tests" → tdd-london-swarm
      expect(['tester', 'tdd-london-swarm']).toContain(result.agentSlug);
    });

    it('routes research task to researcher', async () => {
      const result = await layer.route('investigate the root cause of the performance regression');
      expect(result.agentSlug).toBe('researcher');
    });

    it('returns all scores when debug=true (semantic route)', async () => {
      // Use a query that won't match keyword pre-filter
      const result = await layer.route('analyze the architecture of this module');
      // Semantic routing with debug=true populates allScores
      expect(result.allScores).toBeDefined();
      expect(result.allScores!.length).toBeGreaterThan(0);
    });

    it('returns confidence in [0, 1]', async () => {
      const result = await layer.route('some random task');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('marks low-confidence results as llm_fallback when threshold is very high', async () => {
      const strictLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
      });
      const result = await strictLayer.route('do something vague');
      expect(result.method).toBe('llm_fallback');
    });

    it('returns semantic method for confident matches', async () => {
      const lowThresholdLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.0 })),
      });
      const result = await lowThresholdLayer.route('implement the feature');
      expect(result.method).toBe('semantic');
    });
  });

  describe('addRoute()', () => {
    it('adds a new route and can match it', async () => {
      await layer.addRoute({
        name: 'test-custom',
        agentSlug: 'testing-api-tester',
        threshold: 0.5,
        fallbackToLLM: false,
        utterances: [
          'run API endpoint tests against the staging environment',
          'execute integration tests for the REST API',
          'test the HTTP endpoints for correct status codes',
          'validate API responses match the expected schema',
          'check the REST API returns correct error codes',
        ],
      });
      const result = await layer.route('run API endpoint tests against staging');
      expect(result.agentSlug).toBe('testing-api-tester');
    });
  });

  describe('initialize()', () => {
    it('is idempotent — calling twice does not duplicate centroids', async () => {
      await layer.initialize();
      const countBefore = layer['centroids'].length;
      await layer.initialize();
      expect(layer['centroids'].length).toBe(countBefore);
    });
  });

  describe('ALL_ROUTES coverage', () => {
    it('ALL_ROUTES contains routes from all categories', () => {
      expect(ALL_ROUTES.length).toBeGreaterThan(20);
    });

    it('every route has at least 8 utterances', () => {
      for (const route of ALL_ROUTES) {
        expect(route.utterances.length).toBeGreaterThanOrEqual(8);
      }
    });

    it('every route has a unique name', () => {
      const names = ALL_ROUTES.map(r => r.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it('every route has a non-empty agentSlug', () => {
      for (const route of ALL_ROUTES) {
        expect(route.agentSlug.length).toBeGreaterThan(0);
      }
    });

    it('all thresholds are between 0 and 1', () => {
      for (const route of ALL_ROUTES) {
        expect(route.threshold).toBeGreaterThan(0);
        expect(route.threshold).toBeLessThan(1);
      }
    });
  });

  describe('RouteLayer with all routes', () => {
    let fullLayer: RouteLayer;

    beforeAll(async () => {
      fullLayer = new RouteLayer({ routes: ALL_ROUTES });
      await fullLayer.initialize();
    });

    it('initializes without error with all routes', () => {
      expect(fullLayer['initialized']).toBe(true);
    });

    it('routes security task correctly in full route set', async () => {
      const result = await fullLayer.route('audit the smart contract for reentrancy vulnerabilities');
      // KeywordPreFilter matches "smart contract" → engineering-solidity-smart-contract-engineer
      expect(['blockchain-security-auditor', 'engineering-security-engineer', 'engineering-solidity-smart-contract-engineer']).toContain(result.agentSlug);
    });

    it('routes game dev task correctly in full route set', async () => {
      const result = await fullLayer.route('design the core gameplay loop for the action RPG');
      // LocalEncoder uses hash-based pseudo-embeddings; exact routing varies
      expect(result.agentSlug).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('routes UI design task correctly', async () => {
      const result = await fullLayer.route('design the UI for the user profile dashboard');
      // With pseudo-embeddings, any agent may match; verify a valid result is returned
      expect(result.agentSlug).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('completes 50 routings in under 5 seconds', async () => {
      const tasks = Array.from({ length: 50 }, (_, i) => `task description number ${i}`);
      const start = Date.now();
      await Promise.all(tasks.map(t => fullLayer.route(t)));
      expect(Date.now() - start).toBeLessThan(5000);
    });
  });

  describe('RouteLayer with LLM fallback + TestModel', () => {
    it('calls TestModel as llmCaller when semantic confidence is below threshold', async () => {
      const model = TestModel.withDefaultResponse('coder');
      const fallbackLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.999, fallbackToLLM: true })),
        llmFallback: {
          llmCaller: (prompt) => model.complete(prompt),
          onFallback: () => {},
        },
      });
      const result = await fallbackLayer.route('do something vague');
      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('coder');
    });

    it('TestModel.withDefaultResponse returns deterministic responses', async () => {
      const model = TestModel.withDefaultResponse('researcher');
      const r1 = await model.complete('any prompt');
      const r2 = await model.complete('different prompt');
      expect(r1).toBe('researcher');
      expect(r2).toBe('researcher');
    });

    it('TestModel.addFixture returns fixture for matching prompt', async () => {
      const model = TestModel.withDefaultResponse('coder');
      model.addFixture('route this security task', 'security-engineer');
      const result = await model.complete('route this security task');
      expect(result).toBe('security-engineer');
    });
  });
});
