/**
 * TierManager — Routes memory operations to the correct tier (Task 09)
 *
 * Coordinates short-term (in-memory), long-term (persistent backend),
 * entity (JSON-lines KV), and contextual (session summaries) tiers.
 *
 * @module v1/memory/tier-manager
 */

import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryTier,
  TierManagerConfig,
} from './types.js';
import { createDefaultEntry } from './types.js';
import { ShortTermMemory } from './tiers/short-term.js';
import { EntityMemory } from './tiers/entity.js';
import { ContextualMemory } from './tiers/contextual.js';

export class TierManager {
  readonly shortTerm: ShortTermMemory;
  readonly entity: EntityMemory;
  readonly contextual: ContextualMemory;

  private readonly longTermBackend: IMemoryBackend;
  private readonly config: TierManagerConfig;

  constructor(longTermBackend: IMemoryBackend, config: Partial<TierManagerConfig> = {}) {
    this.config = {
      shortTermCapacity: config.shortTermCapacity ?? 500,
      entityStorePath: config.entityStorePath ?? './data/memory/entities.jsonl',
      contextualNamespace: config.contextualNamespace ?? 'contextual-summaries',
      autoFlushOnSessionEnd: config.autoFlushOnSessionEnd ?? true,
    };

    this.longTermBackend = longTermBackend;
    this.shortTerm = new ShortTermMemory(this.config.shortTermCapacity);
    this.entity = new EntityMemory(this.config.entityStorePath);
    this.contextual = new ContextualMemory(
      longTermBackend,
      this.config.contextualNamespace,
    );
  }

  /**
   * Store a memory entry, routing to the correct tier.
   *
   * - `short-term` goes to the in-memory buffer
   * - `long-term` (or unspecified) goes to the persistent backend
   *
   * Returns the generated entry ID.
   */
  async store(input: MemoryEntryInput & { tier?: MemoryTier }): Promise<string> {
    const entry = createDefaultEntry(input);
    const tier = input.tier ?? 'long-term';

    if (tier === 'short-term') {
      this.shortTerm.store(entry);
    } else {
      await this.longTermBackend.store(entry);
    }

    return entry.id;
  }

  /**
   * Merged search across short-term buffer and long-term backend.
   * Results are deduplicated by entry ID.
   */
  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    // Short-term results (synchronous)
    const shortResults = this.shortTerm.search(query, limit);

    // Long-term results via the backend query interface
    const longResults = await this.longTermBackend.query({
      type: 'hybrid',
      content: query,
      limit,
    });

    // Deduplicate by id, preferring short-term entries
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const entry of [...shortResults, ...longResults]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
      if (merged.length >= limit) break;
    }

    return merged;
  }

  /**
   * Flush the short-term buffer into the long-term backend.
   * Returns the number of entries promoted.
   */
  async flushShortTerm(): Promise<number> {
    return this.shortTerm.flush(this.longTermBackend);
  }
}
