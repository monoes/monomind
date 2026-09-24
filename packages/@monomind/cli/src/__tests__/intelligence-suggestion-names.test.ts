/**
 * The prompt hook's intelligence suggestion (suggestAgentsFromIntelligence)
 * keeps only pattern types that are registry agent names — spawnable Task
 * subagent_types, deprecated ones included — and drops old names and
 * structural labels.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../memory/intelligence.js', () => ({
  initializeIntelligence: async () => ({}),
  findSimilarPatterns: async () => [
    { type: 'security-architect', similarity: 0.99 },
    { type: 'Security Engineer', similarity: 0.9 },
    { type: 'action', similarity: 0.95 },
    { type: 'mobile-dev', similarity: 0.5 },
    { type: 'backend-dev', similarity: 0.97 },
  ],
}));

const { suggestAgentsFromIntelligence } = await import('../mcp-tools/hooks-embedding.js');

describe('suggestAgentsFromIntelligence', () => {
  it('suggests registry agent names only', async () => {
    const r = await suggestAgentsFromIntelligence('secure the login');
    expect(r?.agents).toEqual(['Security Engineer', 'mobile-dev']);
  });
});
