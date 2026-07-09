import { describe, it, expect } from 'vitest';
import { buildCapabilityIndex, buildCandidateHints } from '../capability-index.js';
import type { Route } from '../types.js';

function makeRoute(overrides: Partial<Route> & { name: string; agentSlug: string }): Route {
  return {
    utterances: [],
    threshold: 0.5,
    fallbackToLLM: false,
    ...overrides,
  };
}

describe('buildCapabilityIndex', () => {
  it('uses description when available', () => {
    const routes = [makeRoute({ name: 'coder', agentSlug: 'coder', description: 'General code implementation' })];
    const index = buildCapabilityIndex(routes);
    expect(index).toBe('coder: General code implementation');
  });

  it('falls back to first utterance when no description', () => {
    const routes = [makeRoute({ name: 'coder', agentSlug: 'coder', utterances: ['write some code'] })];
    const index = buildCapabilityIndex(routes);
    expect(index).toBe('coder: write some code');
  });

  it('falls back to name when no description or utterances', () => {
    const routes = [makeRoute({ name: 'coder', agentSlug: 'coder', utterances: [] })];
    const index = buildCapabilityIndex(routes);
    expect(index).toBe('coder: coder');
  });

  it('joins multiple routes with newlines', () => {
    const routes = [
      makeRoute({ name: 'a', agentSlug: 'a', description: 'Agent A' }),
      makeRoute({ name: 'b', agentSlug: 'b', description: 'Agent B' }),
    ];
    const index = buildCapabilityIndex(routes);
    expect(index).toBe('a: Agent A\nb: Agent B');
  });

  it('truncates to MAX_INDEX_CHARS (8000) for very long descriptions', () => {
    const longDesc = 'x'.repeat(1000);
    const routes = Array.from({ length: 20 }, (_, i) =>
      makeRoute({ name: `agent-${i}`, agentSlug: `agent-${i}`, description: longDesc })
    );
    const index = buildCapabilityIndex(routes);
    expect(index.length).toBeLessThanOrEqual(8000);
  });

  it('truncates individual descriptions to 80 chars when total exceeds limit', () => {
    const longDesc = 'a'.repeat(500);
    const routes = Array.from({ length: 20 }, (_, i) =>
      makeRoute({ name: `agent-${i}`, agentSlug: `agent-${i}`, description: longDesc })
    );
    const index = buildCapabilityIndex(routes);
    // Each line should have at most 80-char description after truncation
    const lines = index.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(': ');
      if (colonIndex >= 0) {
        const desc = line.slice(colonIndex + 2);
        expect(desc.length).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('buildCandidateHints', () => {
  const scores = [
    { agentSlug: 'coder', score: 0.85 },
    { agentSlug: 'tester', score: 0.72 },
    { agentSlug: 'reviewer', score: 0.65 },
    { agentSlug: 'planner', score: 0.40 },
  ];

  it('returns top 3 by default', () => {
    const hints = buildCandidateHints(scores);
    const lines = hints.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('coder');
    expect(lines[1]).toContain('tester');
    expect(lines[2]).toContain('reviewer');
  });

  it('respects custom topN', () => {
    const hints = buildCandidateHints(scores, 2);
    const lines = hints.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('formats as bullet list with similarity score', () => {
    const hints = buildCandidateHints(scores, 1);
    expect(hints).toBe('- coder (similarity: 0.850)');
  });
});
