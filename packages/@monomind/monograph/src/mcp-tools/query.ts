import { join } from 'node:path';
import type { MonographDb } from '../storage/db.js';
import { closeDb, openDb } from '../storage/db.js';
import { hybridSearch } from '../storage/fts-store.js';

export interface QueryResult {
  id: string;
  label: string;
  name: string;
  filePath?: string;
  /** Line number where the symbol is defined — enables direct file:line navigation. */
  startLine?: number | null;
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
    'Keyword + fuzzy + LIKE hybrid search across the monograph knowledge graph. ' +
    'Returns symbols and process nodes ranked by combined BM25 + subsequence + node-type bonus.',
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
    },
    required: ['query'],
  },
  async handler(args: {
    query: string;
    repoPath?: string;
    topK?: number;
    includeProcesses?: boolean;
    db?: MonographDb;
  }): Promise<MonographQueryOutput> {
    const { query, repoPath, topK = 20, includeProcesses = true } = args;

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
      // Route through hybridSearch (BM25 + LIKE + in-memory fuzzy + node-type bonus)
      // — the same ranker the CLI uses. The previous hybridQuery call was BM25-only,
      // so MCP users got weaker ranking than CLI users for the same graph.
      const hits = hybridSearch(db, query, topK * 3);
      const results: QueryResult[] = hits
        .filter((h) => includeProcesses || h.label !== 'Process')
        .map((h) => ({
          id: h.id,
          label: h.label ?? 'Symbol',
          name: h.name ?? h.id,
          filePath: h.filePath ?? undefined,
          startLine: h.startLine ?? null,
          score: h.combinedScore,
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
