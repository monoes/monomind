/**
 * Tests for .claude/helpers/router.cjs
 * Covers: routeTask (dev, non-dev, default, empty), matchSkills,
 *         matchExtras (category opt-in/default-exclude), scoreEntry,
 *         buildCategoryList, getAgentsInCategory, loadFeedbackWeights.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ROUTER_PATH = path.resolve(__dirname, '../../.claude/helpers/router.cjs');

function loadRouter() {
  delete require.cache[ROUTER_PATH];
  return require(ROUTER_PATH);
}

// ── routeTask — dev patterns ───────────────────────────────────────────────────

describe('routeTask — dev patterns', () => {
  it('routes "implement a new feature" to coder with confidence=0.8', () => {
    const r = loadRouter();
    const result = r.routeTask('implement a new feature');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBeCloseTo(0.8, 1);
  });

  it('routes "write unit tests for the auth module" to tester', () => {
    const r = loadRouter();
    expect(r.routeTask('write unit tests for the auth module').agentSlug).toBe('tester');
  });

  it('routes "review the pull request for security issues" to reviewer', () => {
    const r = loadRouter();
    expect(r.routeTask('review the pull request for security issues').agentSlug).toBe('reviewer');
  });

  it('routes "research best practices for caching" to researcher', () => {
    const r = loadRouter();
    expect(r.routeTask('research best practices for caching').agentSlug).toBe('researcher');
  });

  it('routes "design the system architecture" to architect', () => {
    const r = loadRouter();
    expect(r.routeTask('design the system architecture').agentSlug).toBe('architect');
  });

  it('routes "optimize the REST api endpoint" to backend-dev', () => {
    const r = loadRouter();
    expect(r.routeTask('optimize the REST api endpoint').agentSlug).toBe('backend-dev');
  });

  it('routes "style the react css component" to frontend-dev', () => {
    const r = loadRouter();
    expect(r.routeTask('style the react css component').agentSlug).toBe('frontend-dev');
  });

  it('routes "deploy to production with docker" to devops', () => {
    const r = loadRouter();
    expect(r.routeTask('deploy to production with docker').agentSlug).toBe('devops');
  });

  it('returns specificAgents array for matched dev pattern', () => {
    const r = loadRouter();
    const result = r.routeTask('implement the feature');
    expect(Array.isArray(result.specificAgents)).toBe(true);
    expect(result.specificAgents.length).toBeGreaterThan(0);
    expect(result.specificAgents[0]).toHaveProperty('slug');
  });

  it('includes skillMatches array (may be empty or not)', () => {
    const r = loadRouter();
    const result = r.routeTask('implement the feature');
    expect(Array.isArray(result.skillMatches)).toBe(true);
  });
});

// ── routeTask — non-dev patterns ───────────────────────────────────────────────

describe('routeTask — non-dev patterns', () => {
  it('routes "marketing campaign strategy" to a non-dev agent', () => {
    const r = loadRouter();
    const result = r.routeTask('marketing campaign strategy');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.extrasMatches.length).toBeGreaterThan(0);
  });

  it('routes "seo optimization for the website" via domain routing', () => {
    const r = loadRouter();
    const result = r.routeTask('seo optimization for the website');
    expect(result.agentSlug).not.toBe('coder');
    expect(result.extrasMatches.length).toBeGreaterThan(0);
  });

  it('routes "sales pipeline management" via domain routing', () => {
    const r = loadRouter();
    const result = r.routeTask('sales pipeline management');
    expect(result.extrasMatches.length).toBeGreaterThan(0);
  });

  it('non-dev result has empty skillMatches', () => {
    const r = loadRouter();
    const result = r.routeTask('tiktok content strategy');
    expect(result.skillMatches).toEqual([]);
  });

  it('reason field contains "Domain:" for non-dev tasks', () => {
    const r = loadRouter();
    const result = r.routeTask('marketing campaign');
    expect(result.reason).toMatch(/Domain:/);
  });
});

// ── routeTask — edge cases ────────────────────────────────────────────────────

describe('routeTask — edge cases', () => {
  it('returns coder with confidence=0 for empty string', () => {
    const r = loadRouter();
    const result = r.routeTask('');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBe(0);
  });

  it('returns coder with confidence=0 for null input', () => {
    const r = loadRouter();
    const result = r.routeTask(null);
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBe(0);
  });

  it('returns default coder with confidence=0.5 when no pattern matches', () => {
    const r = loadRouter();
    const result = r.routeTask('hello world');
    expect(result.agentSlug).toBe('coder');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.reason).toContain('Default');
  });

  it('result always has agent, agentSlug, confidence, reason fields', () => {
    const r = loadRouter();
    const result = r.routeTask('some random task description');
    expect(result).toHaveProperty('agent');
    expect(result).toHaveProperty('agentSlug');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reason');
  });
});

// ── matchSkills ────────────────────────────────────────────────────────────────

describe('matchSkills', () => {
  it('returns an array', () => {
    const r = loadRouter();
    expect(Array.isArray(r.matchSkills('implement a feature'))).toBe(true);
  });

  it('returns empty array for non-string input', () => {
    const r = loadRouter();
    expect(r.matchSkills(null)).toEqual([]);
    expect(r.matchSkills(42)).toEqual([]);
  });

  it('returns empty array when no skill keywords match', () => {
    const r = loadRouter();
    const results = r.matchSkills('zzzzz totally unrelated');
    expect(results).toEqual([]);
  });

  it('returns results sorted by score descending', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement build create feature');
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it('limits results to topN (default 5)', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement build create test review debug optimize research');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('each result has skill, invoke, description, score fields', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement the feature');
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('skill');
      expect(results[0]).toHaveProperty('invoke');
      expect(results[0]).toHaveProperty('score');
    }
  });
});

// ── matchExtras ────────────────────────────────────────────────────────────────

describe('matchExtras', () => {
  it('returns an array', () => {
    const r = loadRouter();
    expect(Array.isArray(r.matchExtras('marketing campaign'))).toBe(true);
  });

  it('returns empty array for non-string input', () => {
    const r = loadRouter();
    expect(r.matchExtras(null)).toEqual([]);
  });

  it('returns marketing agents for "marketing campaign"', () => {
    const r = loadRouter();
    const results = r.matchExtras('marketing campaign');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(e => e.category === 'marketing')).toBe(true);
  });

  it('excludes "marketing" category by default for unrelated tasks', () => {
    const r = loadRouter();
    // "caching" has no marketing opt-in keywords
    const results = r.matchExtras('caching strategy');
    expect(results.every(e => e.category !== 'marketing')).toBe(true);
  });

  it('includes "academic" category when prompt has academic keywords', () => {
    const r = loadRouter();
    const results = r.matchExtras('anthropological study of cultural rituals and kinship');
    expect(results.some(e => e.category === 'academic')).toBe(true);
  });

  it('excludes "academic" category for generic "community" mention', () => {
    const r = loadRouter();
    const results = r.matchExtras('community module documentation');
    expect(results.every(e => e.category !== 'academic')).toBe(true);
  });

  it('includes "game-development" when prompt has unity/godot keywords', () => {
    const r = loadRouter();
    const results = r.matchExtras('unity shader graph implementation');
    expect(results.some(e => e.category === 'game-development')).toBe(true);
  });

  it('limits results to topN (default 8)', () => {
    const r = loadRouter();
    const results = r.matchExtras('marketing sales advertising campaign social media seo brand content');
    expect(results.length).toBeLessThanOrEqual(8);
  });

  it('each result has slug, name, category, score fields', () => {
    const r = loadRouter();
    const results = r.matchExtras('marketing campaign');
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('slug');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('category');
      expect(results[0]).toHaveProperty('score');
    }
  });
});

// ── buildCategoryList / getAgentsInCategory ────────────────────────────────────

describe('buildCategoryList', () => {
  it('returns a non-empty array', () => {
    const r = loadRouter();
    const cats = r.buildCategoryList();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats.length).toBeGreaterThan(0);
  });

  it('each category entry has name, count, examples', () => {
    const r = loadRouter();
    const cats = r.buildCategoryList();
    expect(cats[0]).toHaveProperty('name');
    expect(cats[0]).toHaveProperty('count');
    expect(cats[0]).toHaveProperty('examples');
  });
});

describe('getAgentsInCategory', () => {
  it('returns agents in the "marketing" category', () => {
    const r = loadRouter();
    const agents = r.getAgentsInCategory('marketing');
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty('slug');
    expect(agents[0]).toHaveProperty('name');
  });

  it('returns empty array for unknown category', () => {
    const r = loadRouter();
    expect(r.getAgentsInCategory('nonexistent-xyz')).toEqual([]);
  });
});

// ── loadFeedbackWeights ───────────────────────────────────────────────────────

describe('loadFeedbackWeights (via routeTask confidence)', () => {
  // loadFeedbackWeights is not exported directly; we test its effect on routeTask.
  // A fresh module load resets the cache so the real .monomind/routing-feedback.jsonl
  // is used (or absent, giving an empty Map).
  it('routeTask returns result regardless of feedback file state', () => {
    const r = loadRouter();
    const result = r.routeTask('implement the feature');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it('confidence stays in [0, 1] range even with feedback weights applied', () => {
    const r = loadRouter();
    ['implement', 'test', 'review', 'research', 'design', 'api', 'frontend', 'deploy'].forEach(kw => {
      const result = r.routeTask(kw + ' something');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });
});

// ── AGENT_CAPABILITIES / TASK_PATTERNS exports ───────────────────────────────

describe('exported constants', () => {
  it('AGENT_CAPABILITIES has entries for all core roles', () => {
    const r = loadRouter();
    expect(r.AGENT_CAPABILITIES).toHaveProperty('coder');
    expect(r.AGENT_CAPABILITIES).toHaveProperty('tester');
    expect(r.AGENT_CAPABILITIES).toHaveProperty('reviewer');
    expect(r.AGENT_CAPABILITIES).toHaveProperty('researcher');
  });

  it('TASK_PATTERNS is a non-empty object', () => {
    const r = loadRouter();
    expect(typeof r.TASK_PATTERNS).toBe('object');
    expect(Object.keys(r.TASK_PATTERNS).length).toBeGreaterThan(0);
  });
});
