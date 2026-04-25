import { Route, RouteResult, LLMFallbackConfig } from './types.js';
import { buildCapabilityIndex, buildCandidateHints } from './capability-index.js';
import { buildClassificationPrompt } from './prompts/classify.js';

/** Slug validation regex — must match ALLOWED_AGENT_TYPES pattern */
const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export class LLMFallbackRouter {
  private config: LLMFallbackConfig;
  /** Session-scoped fallback counter per route name */
  private fallbackCounts = new Map<string, number>();

  constructor(config: LLMFallbackConfig) {
    this.config = config;
  }

  /**
   * Classify a task description using an LLM when semantic routing confidence is too low.
   */
  async classify(
    taskDescription: string,
    routes: Route[],
    scores: Array<{ routeName: string; agentSlug: string; score: number }>
  ): Promise<RouteResult> {
    const nearestRoute = scores[0];

    // Log the fallback event
    const onFallback = this.config.onFallback ?? defaultFallbackLogger;
    onFallback(nearestRoute.routeName, taskDescription, nearestRoute.score);
    this.fallbackCounts.set(
      nearestRoute.routeName,
      (this.fallbackCounts.get(nearestRoute.routeName) ?? 0) + 1
    );

    // Build prompt
    const capabilityIndex = buildCapabilityIndex(routes);
    const candidateHints = buildCandidateHints(scores);
    const prompt = buildClassificationPrompt(taskDescription, capabilityIndex, candidateHints);

    // Call LLM
    let rawResponse: string;
    try {
      rawResponse = await this.config.llmCaller(prompt);
    } catch (err) {
      console.error('[LLMFallback] LLM call failed, using best semantic match:', err);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    // Parse and validate the slug
    const slug = rawResponse.trim().replace(/[`'"]/g, '').toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      console.error(`[LLMFallback] Invalid slug in LLM response: "${slug}"`);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    // Verify slug exists in routes — compare case-insensitively since slug is lowercased
    const matchedRoute = routes.find(r => r.agentSlug.toLowerCase() === slug);
    if (!matchedRoute) {
      console.error(`[LLMFallback] LLM returned unknown slug: "${slug}"`);
      return {
        agentSlug: nearestRoute.agentSlug,
        confidence: nearestRoute.score,
        method: 'llm_fallback',
        routeName: nearestRoute.routeName,
      };
    }

    return {
      agentSlug: matchedRoute.agentSlug,  // use canonical casing from route definition
      confidence: 0.85,
      method: 'llm_fallback',
      routeName: matchedRoute.name,
    };
  }

  /** Returns a snapshot of fallback counts for this session */
  getFallbackStats(): Record<string, number> {
    return Object.fromEntries(this.fallbackCounts.entries());
  }
}

function defaultFallbackLogger(routeName: string, task: string, confidence: number): void {
  console.warn(
    `[LLMFallback] Route "${routeName}" confidence ${confidence.toFixed(3)} below threshold for task: "${task.slice(0, 80)}..."`
  );
}
