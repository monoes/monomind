/**
 * ContextualMemory — Compressed session summaries (Task 09)
 *
 * Wraps an IMemoryBackend to persist session summaries and
 * provides token-budget-aware retrieval of relevant context.
 *
 * @module v1/memory/tiers/contextual
 */

import type { IMemoryBackend, MemoryEntryInput } from '../types.js';
import { createDefaultEntry } from '../types.js';

export interface SessionSummary {
  sessionId: string;
  agentSlugs: string[];
  summary: string;
  tokenCount: number;
  createdAt: number;
}

export class ContextualMemory {
  private summaries: Map<string, SessionSummary> = new Map();
  private readonly namespace: string;
  private warmed = false;
  /** Cached newest-first sorted summary list. Invalidated on store. */
  private sortedCache: SessionSummary[] | null = null;

  constructor(
    private readonly backend: IMemoryBackend,
    namespace = 'contextual-summaries',
  ) {
    this.namespace = namespace;
  }

  /**
   * Load persisted summaries from the backend into the in-memory cache.
   * Called automatically before the first read so cross-session summaries
   * are visible without an explicit initialization step.
   */
  async warm(): Promise<void> {
    if (this.warmed) return;
    this.warmed = true;

    try {
      const entries = await this.backend.query({
        type: 'hybrid',
        namespace: this.namespace,
        tags: ['session-summary'],
        limit: 10000,
      });

      for (const entry of entries) {
        const sessionId = entry.metadata?.sessionId as string | undefined;
        if (!sessionId || this.summaries.has(sessionId)) continue;

        this.summaries.set(sessionId, {
          sessionId,
          agentSlugs: (entry.metadata?.agentSlugs as string[]) ?? [],
          summary: entry.content,
          tokenCount: (entry.metadata?.tokenCount as number) ?? 0,
          createdAt: entry.createdAt,
        });
      }
      this.sortedCache = null;
    } catch {
      // Backend unavailable — proceed with empty cache
    }
  }

  /**
   * Persist a session summary both in the local map and the
   * backing memory store.
   */
  async storeSummary(summary: SessionSummary): Promise<void> {
    this.summaries.set(summary.sessionId, summary);
    this.sortedCache = null; // invalidate sort cache

    const input: MemoryEntryInput = {
      key: `ctx-summary:${summary.sessionId}`,
      content: summary.summary,
      namespace: this.namespace,
      tags: ['session-summary', ...summary.agentSlugs],
      metadata: {
        sessionId: summary.sessionId,
        agentSlugs: summary.agentSlugs,
        tokenCount: summary.tokenCount,
      },
    };

    const entry = createDefaultEntry(input);
    entry.createdAt = summary.createdAt;
    entry.updatedAt = summary.createdAt;
    await this.backend.store(entry);
  }

  /**
   * Retrieve summaries whose content matches the query (simple
   * substring match over the local cache), respecting a maximum
   * token budget. Summaries are returned newest-first.
   */
  async retrieveContext(query: string, maxTokens = 2000): Promise<string> {
    await this.warm();
    const lowerQuery = query.toLowerCase();
    if (!this.sortedCache) {
      this.sortedCache = Array.from(this.summaries.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    }
    const sorted = this.sortedCache;

    const parts: string[] = [];
    let budget = maxTokens;

    for (const s of sorted) {
      if (budget <= 0) break;
      if (s.summary.toLowerCase().includes(lowerQuery) || lowerQuery === '') {
        if (s.tokenCount <= budget) {
          parts.push(s.summary);
          budget -= s.tokenCount;
        }
      }
    }

    return parts.join('\n\n');
  }

  /** Look up a summary by session ID (local cache only). */
  getSummary(sessionId: string): SessionSummary | undefined {
    return this.summaries.get(sessionId);
  }
}
