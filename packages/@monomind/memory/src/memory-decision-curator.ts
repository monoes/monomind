/**
 * MemoryDecisionCurator — Curate good memory decisions from episode traces
 *
 * AutoMem outer loop #2 (arXiv:2607.01224, §3.3): select the best memory-operation
 * decisions from agent traces and store them for proficiency training.
 *
 * A decision is "good" when:
 *   1. The written entry was later accessed (not a wasted write)
 *   2. A search returned results that influenced the next action
 *   3. The session succeeded overall
 *
 * Curated decisions are stored in a dedicated namespace so the route hook
 * can bias pattern retrieval toward memory-proficiency patterns.
 *
 * @module @monomind/memory/memory-decision-curator
 */

import { EventEmitter } from 'node:events';
import type { IMemoryBackend, MemoryEntryInput, MemoryQuery } from './types.js';
import { createDefaultEntry } from './types.js';
import type { EpisodicStore } from './episodic-store.js';

// ===== Types =====

export interface CuratedDecision {
  id: string;
  op: 'write' | 'search' | 'read';
  detail: string;
  sessionOutcome: 'success' | 'failure';
  wasUseful: boolean;
  timestamp: number;
}

export interface CurationResult {
  total: number;
  curated: number;
  discarded: number;
  durationMs: number;
}

export interface MemoryDecisionCuratorConfig {
  /** Namespace for curated decisions (default: 'memory-training') */
  namespace?: string;
  /** Min confidence for curated entry (default: 0.7) */
  minConfidence?: number;
  /** Max curated decisions to keep (default: 2000) */
  maxCurated?: number;
}

// ===== Implementation =====

const DEFAULTS: Required<MemoryDecisionCuratorConfig> = {
  namespace: 'memory-training',
  minConfidence: 0.7,
  maxCurated: 2000,
};

const MEMORY_OP_RE = /^\[memory:(write|search|read|skip-duplicate|flag-stale)\]\s*(.+)$/;

export class MemoryDecisionCurator extends EventEmitter {
  private config: Required<MemoryDecisionCuratorConfig>;
  private backend: IMemoryBackend;

  constructor(backend: IMemoryBackend, config?: MemoryDecisionCuratorConfig) {
    super();
    this.backend = backend;
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Curate memory decisions from episodic traces.
   * Extracts [memory:*] log lines, scores them, stores the good ones.
   */
  async curateFromEpisodes(episodicStore: EpisodicStore): Promise<CurationResult> {
    const startTime = Date.now();
    const episodes = episodicStore.readAll();

    const decisions: CuratedDecision[] = [];

    for (const episode of episodes) {
      const lines = episode.summary.split('\n');
      const sessionOutcome = episode.taskTypes.includes('failed') ? 'failure' as const : 'success' as const;

      // Track writes/reads per-episode to avoid cross-episode contamination
      const writes = new Set<string>();
      const reads = new Set<string>();
      const episodeDecisions: CuratedDecision[] = [];

      for (const line of lines) {
        const match = MEMORY_OP_RE.exec(line.trim());
        if (!match) continue;

        const [, op, detail] = match;

        if (op === 'write') writes.add(detail);
        if (op === 'read' || op === 'search') reads.add(detail);

        if (op === 'write' || op === 'search' || op === 'read') {
          episodeDecisions.push({
            id: `curated_${episode.episodeId}_${decisions.length + episodeDecisions.length}`,
            op: op as 'write' | 'search' | 'read',
            detail,
            sessionOutcome,
            wasUseful: false,
            timestamp: episode.endedAt || Date.now(),
          });
        }
      }

      // Mark usefulness scoped to this episode only
      for (const d of episodeDecisions) {
        if (d.op === 'write') {
          d.wasUseful = reads.has(d.detail);
        } else if (d.op === 'search' || d.op === 'read') {
          d.wasUseful = d.sessionOutcome === 'success';
        }
      }

      decisions.push(...episodeDecisions);
    }

    // Filter to good decisions: useful ops from successful sessions
    const good = decisions.filter(d => d.wasUseful && d.sessionOutcome === 'success');
    const toStore = good.slice(-this.config.maxCurated);

    let stored = 0;
    for (const decision of toStore) {
      try {
        const input: MemoryEntryInput = {
          key: decision.id,
          content: `[${decision.op}] ${decision.detail}`,
          namespace: this.config.namespace,
          type: 'procedural',
          tags: ['curated', `op:${decision.op}`, `outcome:${decision.sessionOutcome}`],
          metadata: {
            op: decision.op,
            wasUseful: decision.wasUseful,
            sessionOutcome: decision.sessionOutcome,
            confidence: this.config.minConfidence,
          },
        };

        const entry = createDefaultEntry(input);
        await this.backend.store(entry);
        stored++;
      } catch {
        // Skip failed stores
      }
    }

    const result: CurationResult = {
      total: decisions.length,
      curated: stored,
      discarded: decisions.length - stored,
      durationMs: Date.now() - startTime,
    };

    this.emit('curation:completed', result);
    return result;
  }

  /**
   * Retrieve curated decisions for training or analysis.
   */
  async getCuratedDecisions(limit: number = 100): Promise<CuratedDecision[]> {
    const query: MemoryQuery = {
      type: 'hybrid',
      namespace: this.config.namespace,
      tags: ['curated'],
      limit,
    };

    try {
      const entries = await this.backend.query(query);
      return entries.map(e => ({
        id: e.key,
        op: (e.metadata?.op as 'write' | 'search' | 'read') || 'write',
        detail: e.content.replace(/^\[(write|search|read)\]\s*/, ''),
        sessionOutcome: (e.metadata?.sessionOutcome as 'success' | 'failure') || 'success',
        wasUseful: (e.metadata?.wasUseful as boolean) ?? true,
        timestamp: e.updatedAt,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Return curation stats: how many curated decisions exist.
   */
  async getStats(): Promise<{ total: number; byOp: Record<string, number> }> {
    try {
      const entries = await this.backend.query({
        type: 'hybrid',
        namespace: this.config.namespace,
        tags: ['curated'],
        limit: 10_000,
      });

      const byOp: Record<string, number> = {};
      for (const e of entries) {
        const op = (e.metadata?.op as string) || 'unknown';
        byOp[op] = (byOp[op] || 0) + 1;
      }

      return { total: entries.length, byOp };
    } catch {
      return { total: 0, byOp: {} };
    }
  }
}
