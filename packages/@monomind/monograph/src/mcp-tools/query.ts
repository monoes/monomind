import { join } from 'node:path';
import type { RetrievalMode } from '../search/hybrid-query.js';
import { searchGraph } from '../search/hybrid-query.js';
import type { MonographDb } from '../storage/db.js';
import { closeDb, openDb } from '../storage/db.js';

export interface QueryResult {
  id: string;
  label: string;
  name: string;
  filePath?: string;
  /** Line number where the symbol is defined — enables direct file:line navigation. */
  startLine?: number | null;
  /** Higher is better, always ≥ 0 (monograph's single score convention). */
  score: number;
  isProcess: boolean;
}

export interface MonographQueryOutput {
  query: string;
  results: QueryResult[];
  processCount: number;
  symbolCount: number;
}

export const monographQueryTool = {
  name: 'monograph_query',
  description:
    'Lexical keyword search across the monograph knowledge graph. ' +
    'mode=hybrid (default) ranks by BM25 + LIKE fallback + subsequence fuzzy + node-type bonus; ' +
    'mode=bm25 is BM25 only. Higher score = better match.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query' },
      repoPath: { type: 'string', description: 'Absolute path to the repository root' },
      topK: { type: 'number', description: 'Max results to return (default: 20)' },
      includeProcesses: {
        type: 'boolean',
        description: 'Include Process nodes in results (default: true)',
      },
      mode: {
        type: 'string',
        enum: ['bm25', 'hybrid'],
        description: 'Retrieval mode (default: hybrid)',
      },
    },
    required: ['query'],
  },
  async handler(args: {
    query: string;
    repoPath?: string;
    topK?: number;
    includeProcesses?: boolean;
    mode?: RetrievalMode;
    db?: MonographDb;
  }): Promise<MonographQueryOutput> {
    const { query, repoPath, topK = 20, includeProcesses = true, mode = 'hybrid' } = args;

    let db: MonographDb | null = null;
    let shouldClose = false;

    if (args.db) {
      db = args.db;
    } else if (repoPath) {
      db = openDb(join(repoPath, '.monomind', 'monograph.db'));
      shouldClose = true;
    } else {
      return { query, results: [], processCount: 0, symbolCount: 0 };
    }

    try {
      // Route through the shared searchGraph service — the same retrieval the
      // CLI-hosted monograph_query tool uses, so both adapters answer the same
      // question the same way.
      const hits = searchGraph(db, query, { limit: topK * 3, mode });
      const results: QueryResult[] = hits
        .filter((h) => includeProcesses || h.label !== 'Process')
        .map((h) => ({
          id: h.id,
          label: h.label ?? 'Symbol',
          name: h.name ?? h.id,
          filePath: h.filePath ?? undefined,
          startLine: h.startLine ?? null,
          score: h.relevance,
          isProcess: h.label === 'Process',
        }))
        .slice(0, topK);

      return {
        query,
        results,
        processCount: results.filter((r) => r.isProcess).length,
        symbolCount: results.filter((r) => !r.isProcess).length,
      };
    } finally {
      if (shouldClose && db) closeDb(db);
    }
  },
};
