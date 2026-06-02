import { join } from 'path';
import { openDb, closeDb } from '../storage/db.js';
import { hybridQuery } from '../search/hybrid-query.js';
import type { MonographDb } from '../storage/db.js';

export interface QueryResult {
  id: string;
  label: string;
  name: string;
  filePath?: string;
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
    'Process-aware hybrid search across the monograph knowledge graph. Returns symbols and process nodes ranked by relevance.',
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
      const hits = await hybridQuery(db, query, { limit: topK * 3 });
      const results: QueryResult[] = hits
        .filter(h => includeProcesses || h.label !== 'Process')
        .map(h => ({
          id: h.id,
          label: h.label ?? 'Symbol',
          name: h.name ?? h.id,
          filePath: h.filePath ?? undefined,
          score: h.score,
          isProcess: h.label === 'Process',
        }));

      return {
        query,
        results,
        processCount: results.filter(r => r.isProcess).length,
        symbolCount: results.filter(r => !r.isProcess).length,
      };
    } finally {
      if (shouldClose && db) closeDb(db);
    }
  },
};
