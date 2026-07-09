import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMFallbackRouter } from '../llm-fallback.js';
import type { Route, LLMFallbackConfig } from '../types.js';

const testRoutes: Route[] = [
  {
    name: 'coder',
    agentSlug: 'coder',
    utterances: ['write code'],
    threshold: 0.5,
    fallbackToLLM: true,
    description: 'General code implementation',
  },
  {
    name: 'tester',
    agentSlug: 'tester',
    utterances: ['write tests'],
    threshold: 0.5,
    fallbackToLLM: true,
    description: 'Testing specialist',
  },
  {
    name: 'reviewer',
    agentSlug: 'reviewer',
    utterances: ['review code'],
    threshold: 0.5,
    fallbackToLLM: true,
    description: 'Code review',
  },
];

const defaultScores = [
  { routeName: 'coder', agentSlug: 'coder', score: 0.3 },
  { routeName: 'tester', agentSlug: 'tester', score: 0.2 },
  { routeName: 'reviewer', agentSlug: 'reviewer', score: 0.1 },
];

function makeFallback(
  llmResponse: string | Error,
  onFallback?: LLMFallbackConfig['onFallback']
): LLMFallbackRouter {
  const llmCaller = typeof llmResponse === 'string'
    ? vi.fn().mockResolvedValue(llmResponse)
    : vi.fn().mockRejectedValue(llmResponse);
  return new LLMFallbackRouter({ llmCaller, onFallback });
}

describe('LLMFallbackRouter', () => {
  it('returns LLM-classified slug when valid', async () => {
    const router = makeFallback('tester');
    const result = await router.classify('write tests for auth', testRoutes, defaultScores);
    expect(result.agentSlug).toBe('tester');
    expect(result.routeName).toBe('tester');
    expect(result.method).toBe('llm_fallback');
    expect(result.confidence).toBe(0.85);
  });

  it('trims and normalizes LLM response', async () => {
    const router = makeFallback('  `Tester`  ');
    const result = await router.classify('test task', testRoutes, defaultScores);
    expect(result.agentSlug).toBe('tester');
  });

  it('falls back to nearest semantic match on LLM error', async () => {
    const router = makeFallback(new Error('API timeout'));
    const result = await router.classify('some task', testRoutes, defaultScores);
    expect(result.agentSlug).toBe('coder'); // nearest from scores[0]
    expect(result.confidence).toBe(0.3);
    expect(result.method).toBe('llm_fallback');
  });

  it('falls back on invalid slug format', async () => {
    const router = makeFallback('not a valid slug!!!');
    const result = await router.classify('some task', testRoutes, defaultScores);
    expect(result.agentSlug).toBe('coder'); // falls back to nearest
  });

  it('falls back on unknown slug', async () => {
    const router = makeFallback('nonexistent-agent');
    const result = await router.classify('some task', testRoutes, defaultScores);
    expect(result.agentSlug).toBe('coder'); // falls back to nearest
  });

  it('tracks fallback counts', async () => {
    const router = makeFallback('tester');
    await router.classify('task 1', testRoutes, defaultScores);
    await router.classify('task 2', testRoutes, defaultScores);
    const stats = router.getFallbackStats();
    expect(stats['coder']).toBe(2); // nearest route name from scores[0]
  });

  it('logs fallback events via onFallback callback', async () => {
    const onFallback = vi.fn();
    const router = makeFallback('tester', onFallback);
    await router.classify('test task', testRoutes, defaultScores);
    expect(onFallback).toHaveBeenCalledWith('coder', 'test task', 0.3);
  });

  it('uses default logger when no onFallback provided', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const router = makeFallback('tester');
    await router.classify('test task', testRoutes, defaultScores);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns canonical casing from route definition', async () => {
    const routes: Route[] = [{
      name: 'MyAgent',
      agentSlug: 'MyAgent',
      utterances: ['do stuff'],
      threshold: 0.5,
      fallbackToLLM: true,
    }];
    const scores = [{ routeName: 'MyAgent', agentSlug: 'MyAgent', score: 0.3 }];
    const router = makeFallback('myagent'); // lowercase response
    const result = await router.classify('task', routes, scores);
    expect(result.agentSlug).toBe('MyAgent'); // canonical casing
  });
});
