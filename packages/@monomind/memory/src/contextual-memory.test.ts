/**
 * Tests for ContextualMemory
 *
 * Covers: warm() lazy-loading from backend, storeSummary, retrieveContext.
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextualMemory } from './tiers/contextual.js';
import type { IMemoryBackend, MemoryEntry, MemoryQuery } from './types.js';
import type { SessionSummary } from './tiers/contextual.js';

function makeSummary(sessionId: string, text = 'test summary', tokens = 10): SessionSummary {
  return { sessionId, agentSlugs: ['agent'], summary: text, tokenCount: tokens, createdAt: Date.now() };
}

function makeBackend(entries: MemoryEntry[] = []): IMemoryBackend {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getByKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(false),
    query: vi.fn().mockResolvedValue(entries),
    search: vi.fn().mockResolvedValue([]),
    bulkInsert: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(entries.length),
    listNamespaces: vi.fn().mockResolvedValue([]),
    clearNamespace: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({}),
    healthCheck: vi.fn().mockResolvedValue({ status: 'healthy', issues: [], recommendations: [], components: {}, timestamp: Date.now() }),
  } as unknown as IMemoryBackend;
}

describe('ContextualMemory', () => {
  describe('warm() lazy-loading from backend', () => {
    it('loads summaries from backend on first retrieveContext', async () => {
      const backendEntry = {
        id: 'entry1',
        key: 'ctx-summary:s1',
        content: 'loaded from backend',
        namespace: 'contextual-summaries',
        type: 'semantic',
        tags: ['session-summary'],
        metadata: { sessionId: 's1', agentSlugs: ['bot'], tokenCount: 5 },
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
        accessLevel: 'private',
        version: 1,
        references: [],
        accessCount: 0,
        lastAccessedAt: Date.now() - 1000,
      } as unknown as MemoryEntry;

      const backend = makeBackend([backendEntry]);
      const ctx = new ContextualMemory(backend);

      // Before warm: summaries map is empty
      expect(ctx.getSummary('s1')).toBeUndefined();

      // retrieveContext triggers warm()
      const result = await ctx.retrieveContext('');
      expect(result).toContain('loaded from backend');
      expect(ctx.getSummary('s1')).toBeDefined();
      // backend.query should have been called exactly once
      expect((backend.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('warm() is idempotent — backend.query called only once', async () => {
      const backend = makeBackend([]);
      const ctx = new ContextualMemory(backend);

      await ctx.retrieveContext('');
      await ctx.retrieveContext('');
      await ctx.warm(); // explicit call

      expect((backend.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
  });

  describe('storeSummary', () => {
    it('persists to backend and populates local cache', async () => {
      const backend = makeBackend([]);
      const ctx = new ContextualMemory(backend);

      const summary = makeSummary('sess1', 'important context', 20);
      await ctx.storeSummary(summary);

      expect((backend.store as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect(ctx.getSummary('sess1')).toEqual(summary);
    });
  });

  describe('retrieveContext with token budget', () => {
    it('respects maxTokens budget', async () => {
      const backend = makeBackend([]);
      const ctx = new ContextualMemory(backend);

      await ctx.storeSummary(makeSummary('s1', 'first summary', 15));
      await ctx.storeSummary(makeSummary('s2', 'second summary', 15));

      // Budget of 20 tokens — only one summary fits (each costs 15)
      const result = await ctx.retrieveContext('', 20);
      const parts = result.split('\n\n').filter(Boolean);
      expect(parts.length).toBe(1);
    });

    it('returns empty string when no summaries match query', async () => {
      const backend = makeBackend([]);
      const ctx = new ContextualMemory(backend);
      await ctx.storeSummary(makeSummary('s1', 'cats and dogs', 5));

      const result = await ctx.retrieveContext('space travel');
      expect(result).toBe('');
    });
  });
});
