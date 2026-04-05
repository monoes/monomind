import { describe, it, expect, vi } from 'vitest';
import { LLMFallbackRouter } from '../../packages/@monobrain/routing/src/llm-fallback.js';
import { RouteLayer } from '../../packages/@monobrain/routing/src/route-layer.js';
import { buildCapabilityIndex, buildCandidateHints } from '../../packages/@monobrain/routing/src/capability-index.js';
import { buildClassificationPrompt } from '../../packages/@monobrain/routing/src/prompts/classify.js';
import { coreRoutes } from '../../packages/@monobrain/routing/src/routes/core.route.js';
import type { Route } from '../../packages/@monobrain/routing/src/types.js';

const testRoutes: Route[] = [
  {
    name: 'coder',
    agentSlug: 'coder',
    threshold: 0.65,
    fallbackToLLM: true,
    description: 'General code implementation',
    utterances: [
      'implement the user registration feature',
      'write the function to calculate shipping costs',
      'code the database migration script',
      'build the REST API endpoint',
      'implement the caching layer',
      'write the TypeScript interface',
      'code the background job',
      'implement the file upload handler',
    ],
  },
  {
    name: 'reviewer',
    agentSlug: 'reviewer',
    threshold: 0.68,
    fallbackToLLM: true,
    description: 'Code review and quality assessment',
    utterances: [
      'review this pull request for code quality',
      'check this code for best practices violations',
      'review the implementation for potential issues',
      'give feedback on this TypeScript module',
      'check this function for edge cases',
      'review the database query for performance',
      'look over this class design',
      'review the error handling in this module',
    ],
  },
  {
    name: 'tester',
    agentSlug: 'tester',
    threshold: 0.68,
    fallbackToLLM: true,
    description: 'Writing tests, test coverage analysis',
    utterances: [
      'write unit tests for the authentication module',
      'create integration tests for the payment API',
      'write Jest tests for this TypeScript class',
      'generate test cases for the user registration flow',
      'write end-to-end tests for the checkout process',
      'create test fixtures for the database layer',
      'write property-based tests for the validation logic',
      'generate mock data for testing the API endpoints',
    ],
  },
];

function createMockScores(topSlug = 'coder') {
  return [
    { routeName: 'coder', agentSlug: 'coder', score: 0.45 },
    { routeName: 'reviewer', agentSlug: 'reviewer', score: 0.32 },
    { routeName: 'tester', agentSlug: 'tester', score: 0.28 },
  ].sort((a, b) => (a.agentSlug === topSlug ? -1 : b.agentSlug === topSlug ? 1 : 0));
}

describe('LLMFallbackRouter', () => {
  describe('classify()', () => {
    it('returns method=llm_fallback with LLM-chosen slug on success', async () => {
      const llmCaller = vi.fn().mockResolvedValue('tester');
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('write tests for auth', testRoutes, scores);

      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('tester');
      expect(result.routeName).toBe('tester');
      expect(result.confidence).toBe(0.85);
      expect(llmCaller).toHaveBeenCalledTimes(1);
    });

    it('falls back to best semantic match when LLM returns invalid slug', async () => {
      const llmCaller = vi.fn().mockResolvedValue('!!!not-valid');
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('some task', testRoutes, scores);

      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('coder');
      expect(result.confidence).toBe(0.45);
    });

    it('falls back to best semantic match when LLM returns unknown slug', async () => {
      const llmCaller = vi.fn().mockResolvedValue('nonexistent-agent');
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('some task', testRoutes, scores);

      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('coder');
      expect(result.confidence).toBe(0.45);
    });

    it('strips backticks and quotes from LLM response', async () => {
      const llmCaller = vi.fn().mockResolvedValue('`reviewer`');
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('review code', testRoutes, scores);

      expect(result.agentSlug).toBe('reviewer');
      expect(result.routeName).toBe('reviewer');
    });

    it('strips single quotes from LLM response', async () => {
      const llmCaller = vi.fn().mockResolvedValue("'tester'");
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('write tests', testRoutes, scores);

      expect(result.agentSlug).toBe('tester');
    });

    it('falls back to best semantic match when LLM call throws', async () => {
      const llmCaller = vi.fn().mockRejectedValue(new Error('API timeout'));
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const result = await router.classify('some task', testRoutes, scores);
      consoleSpy.mockRestore();

      expect(result.method).toBe('llm_fallback');
      expect(result.agentSlug).toBe('coder');
      expect(result.confidence).toBe(0.45);
    });

    it('invokes onFallback callback when provided', async () => {
      const onFallback = vi.fn();
      const llmCaller = vi.fn().mockResolvedValue('tester');
      const router = new LLMFallbackRouter({ llmCaller, onFallback });
      const scores = createMockScores();

      await router.classify('write tests', testRoutes, scores);

      expect(onFallback).toHaveBeenCalledWith('coder', 'write tests', 0.45);
    });

    it('handles whitespace-padded LLM response', async () => {
      const llmCaller = vi.fn().mockResolvedValue('  tester  \n');
      const router = new LLMFallbackRouter({ llmCaller });
      const scores = createMockScores();

      const result = await router.classify('test task', testRoutes, scores);

      expect(result.agentSlug).toBe('tester');
    });
  });

  describe('getFallbackStats()', () => {
    it('tracks fallback invocation counts per route', async () => {
      const llmCaller = vi.fn().mockResolvedValue('coder');
      const onFallback = vi.fn();
      const router = new LLMFallbackRouter({ llmCaller, onFallback });
      const scores = createMockScores();

      await router.classify('task 1', testRoutes, scores);
      await router.classify('task 2', testRoutes, scores);
      await router.classify('task 3', testRoutes, scores);

      const stats = router.getFallbackStats();
      expect(stats['coder']).toBe(3);
    });

    it('returns empty stats before any invocations', () => {
      const llmCaller = vi.fn();
      const router = new LLMFallbackRouter({ llmCaller });
      expect(router.getFallbackStats()).toEqual({});
    });
  });
});

describe('buildCapabilityIndex()', () => {
  it('produces one line per route with agentSlug: description', () => {
    const index = buildCapabilityIndex(testRoutes);
    const lines = index.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('coder: General code implementation');
    expect(lines[1]).toBe('reviewer: Code review and quality assessment');
    expect(lines[2]).toBe('tester: Writing tests, test coverage analysis');
  });

  it('falls back to first utterance when description is absent', () => {
    const routes: Route[] = [
      {
        name: 'custom',
        agentSlug: 'custom-agent',
        threshold: 0.5,
        fallbackToLLM: false,
        utterances: ['do the custom thing', 'another utterance'],
      },
    ];
    const index = buildCapabilityIndex(routes);
    expect(index).toBe('custom-agent: do the custom thing');
  });

  it('truncates when total length exceeds 8000 chars', () => {
    const longRoutes: Route[] = Array.from({ length: 200 }, (_, i) => ({
      name: `route-${i}`,
      agentSlug: `agent-${i}`,
      threshold: 0.5,
      fallbackToLLM: false,
      description: 'A'.repeat(100),
      utterances: ['utterance'],
    }));
    const index = buildCapabilityIndex(longRoutes);
    expect(index.length).toBeLessThanOrEqual(8000);
  });
});

describe('buildCandidateHints()', () => {
  it('formats top-3 candidates with similarity scores', () => {
    const scores = [
      { agentSlug: 'coder', score: 0.452 },
      { agentSlug: 'reviewer', score: 0.321 },
      { agentSlug: 'tester', score: 0.280 },
      { agentSlug: 'planner', score: 0.100 },
    ];
    const hints = buildCandidateHints(scores);
    const lines = hints.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- coder (similarity: 0.452)');
    expect(lines[1]).toBe('- reviewer (similarity: 0.321)');
    expect(lines[2]).toBe('- tester (similarity: 0.280)');
  });

  it('respects custom topN parameter', () => {
    const scores = [
      { agentSlug: 'a', score: 0.9 },
      { agentSlug: 'b', score: 0.8 },
    ];
    const hints = buildCandidateHints(scores, 1);
    expect(hints.split('\n')).toHaveLength(1);
  });
});

describe('buildClassificationPrompt()', () => {
  it('includes task description, capability index, and candidate hints', () => {
    const prompt = buildClassificationPrompt(
      'deploy to production',
      'coder: implementation\nreviewer: review',
      '- coder (similarity: 0.5)'
    );
    expect(prompt).toContain('deploy to production');
    expect(prompt).toContain('coder: implementation');
    expect(prompt).toContain('- coder (similarity: 0.5)');
    expect(prompt).toContain('Agent slug:');
  });
});

describe('RouteLayer LLM fallback integration', () => {
  it('calls LLM when confidence is below threshold', async () => {
    const llmCaller = vi.fn().mockResolvedValue('tester');
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
      llmFallback: { llmCaller },
    });

    const result = await layer.route('do something vague');

    expect(result.method).toBe('llm_fallback');
    expect(llmCaller).toHaveBeenCalledTimes(1);
    expect(result.agentSlug).toBe('tester');
  });

  it('does NOT call LLM when confidence is above threshold', async () => {
    const llmCaller = vi.fn().mockResolvedValue('tester');
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.0 })),
      llmFallback: { llmCaller },
    });

    const result = await layer.route('implement the feature');

    expect(result.method).toBe('semantic');
    expect(llmCaller).not.toHaveBeenCalled();
  });

  it('includes allScores in debug mode with LLM fallback', async () => {
    const llmCaller = vi.fn().mockResolvedValue('coder');
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
      llmFallback: { llmCaller },
      debug: true,
    });

    const result = await layer.route('some task');

    expect(result.allScores).toBeDefined();
    expect(result.allScores!.length).toBeGreaterThan(0);
  });

  it('still sets method=llm_fallback without llmFallback config (original behavior)', async () => {
    const layer = new RouteLayer({
      routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
    });

    const result = await layer.route('do something vague');

    expect(result.method).toBe('llm_fallback');
  });
});
