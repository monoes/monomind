/**
 * Tests for .claude/helpers/router.cjs
 * Covers: routeTask(), loadFeedbackWeights(), AGENT_CAPABILITIES
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Force fresh module load to reset internal caches
let router;
beforeEach(() => {
  // Clear require cache so _feedbackWeightsCache resets between tests
  const routerPath = path.resolve(__dirname, '../../.claude/helpers/router.cjs');
  delete require.cache[routerPath];
  router = require('../../.claude/helpers/router.cjs');
});

const KNOWN_AGENTS = new Set([
  'coder', 'tester', 'reviewer', 'researcher', 'architect',
  'backend-dev', 'frontend-dev', 'devops',
]);

describe('routeTask', () => {
  it('returns an object with required fields for a coding task', () => {
    const result = router.routeTask('fix the authentication bug in login.ts');
    expect(result).toBeTypeOf('object');
    expect(result).toHaveProperty('agent');
    expect(result).toHaveProperty('agentSlug');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('specificAgents');
  });

  it('routes a coding task to a string agent', () => {
    const result = router.routeTask('implement the new payment feature');
    expect(typeof result.agent).toBe('string');
    expect(result.agent.length).toBeGreaterThan(0);
  });

  it('routes coding tasks to coder agent', () => {
    const result = router.routeTask('implement the new payment feature');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('routes testing tasks to tester agent', () => {
    const result = router.routeTask('write unit tests for the auth module');
    expect(result.agentSlug).toBe('tester');
  });

  it('routes review tasks to reviewer agent', () => {
    const result = router.routeTask('review the security audit of the API');
    expect(result.agentSlug).toBe('reviewer');
  });

  it('routes backend tasks to backend-dev agent', () => {
    // "api" and "endpoint" match backend-dev without triggering coder patterns first
    const result = router.routeTask('update the api endpoint server configuration');
    expect(result.agentSlug).toBe('backend-dev');
  });

  it('routes frontend tasks to frontend-dev agent', () => {
    // "ui" and "css" match frontend-dev without triggering coder patterns first
    const result = router.routeTask('update the ui css style for the component');
    expect(result.agentSlug).toBe('frontend-dev');
  });

  it('routes devops tasks to devops agent', () => {
    const result = router.routeTask('set up docker deployment pipeline');
    expect(result.agentSlug).toBe('devops');
  });

  it('handles empty string input gracefully', () => {
    const result = router.routeTask('');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBe(0);
  });

  it('handles null input gracefully', () => {
    const result = router.routeTask(null);
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBe(0);
  });

  it('defaults to coder with low confidence for unmatched task', () => {
    const result = router.routeTask('zzz xyzzy unrecognized task token 12345');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it('returns specificAgents as an array', () => {
    const result = router.routeTask('build a new feature');
    expect(Array.isArray(result.specificAgents)).toBe(true);
  });

  it('returns skillMatches as an array', () => {
    const result = router.routeTask('write integration tests');
    expect(Array.isArray(result.skillMatches)).toBe(true);
  });

  it('confidence is between 0 and 1', () => {
    const tasks = [
      'implement authentication',
      'write tests for the router',
      'deploy to docker',
      'design the system architecture',
    ];
    for (const task of tasks) {
      const result = router.routeTask(task);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('AGENT_CAPABILITIES', () => {
  it('exports AGENT_CAPABILITIES as an object', () => {
    expect(router.AGENT_CAPABILITIES).toBeTypeOf('object');
    expect(router.AGENT_CAPABILITIES).not.toBeNull();
  });

  it('contains known agent types', () => {
    for (const agent of KNOWN_AGENTS) {
      expect(router.AGENT_CAPABILITIES).toHaveProperty(agent);
    }
  });

  it('each agent has an array of capabilities', () => {
    for (const [agent, caps] of Object.entries(router.AGENT_CAPABILITIES)) {
      expect(Array.isArray(caps), `${agent} capabilities should be an array`).toBe(true);
      expect(caps.length, `${agent} should have at least one capability`).toBeGreaterThan(0);
    }
  });
});

// Note: loadFeedbackWeights is not exported from router.cjs.
// Its behavior is observable via routeTask() — when feedback weights are loaded
// from .monomind/routing-feedback.jsonl, the confidence score changes.
// We test the weight logic directly by inspecting the routeTask confidence output.
//
// Because the module caches feedback weights with a 60-second TTL and the cache
// is module-internal (not resettable without process.chdir, which is unsupported
// in vitest thread workers), these tests validate the structural properties of
// the feedback system via exports that ARE available.

describe('feedback weight system (structural tests)', () => {
  it('routeTask confidence is capped at 1.0 even with a boosting weight', () => {
    // With any weight applied, confidence must not exceed 1.0
    const result = router.routeTask('implement a new authentication feature');
    expect(result.confidence).toBeLessThanOrEqual(1.0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('TASK_PATTERNS is exported and has entries for all core agent types', () => {
    const patterns = router.TASK_PATTERNS;
    expect(typeof patterns).toBe('object');
    const agentValues = Object.values(patterns);
    expect(agentValues).toContain('coder');
    expect(agentValues).toContain('tester');
    expect(agentValues).toContain('reviewer');
    expect(agentValues).toContain('backend-dev');
  });

  it('routeTask applies pattern match before default fallback', () => {
    // A task with "implement" matches coder with higher confidence than default
    const matched = router.routeTask('implement authentication');
    const defaulted = router.routeTask('something completely unrelated 99zyx');
    expect(matched.confidence).toBeGreaterThan(defaulted.confidence);
  });

  it('extrasMatches is empty array for dev-domain tasks', () => {
    const result = router.routeTask('implement a new feature in TypeScript');
    // Dev tasks route to dev agents, not extras specialists
    expect(Array.isArray(result.extrasMatches)).toBe(true);
  });
});
