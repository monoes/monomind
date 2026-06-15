/**
 * augmentContext — Graph-RAG context augmentation
 *
 * Given a query string, retrieves the top-K relevant nodes from the
 * monograph knowledge graph using hybrid BM25+vector search (falls back
 * to BM25 when embeddings are unavailable) and returns a formatted
 * context block suitable for injection into an AI prompt.
 *
 * Usable from both CLI entry points and the monograph_augment MCP tool.
 */

import { join } from 'path';
import { openDb, closeDb } from '../storage/db.js';
import { hybridQuery, type HybridResult } from '../search/hybrid-query.js';
import { globalAugmentCache } from '../cache/augment-cache.js';

export interface AugmentContextOptions {
  /** The search query or task description */
  query: string;
  /** Absolute path to the repository root */
  repoPath: string;
  /** Number of results to retrieve (default: 10) */
  topK?: number;
  /** Output format (default: 'markdown') */
  format?: 'markdown' | 'json';
}

export interface AugmentContextResult {
  query: string;
  topK: number;
  format: 'markdown' | 'json';
  results: HybridResult[];
  context: string;
}

/**
 * Retrieve the top-K relevant code nodes for a query and return a
 * formatted context string.
 */
export async function augmentContext(options: AugmentContextOptions): Promise<string> {
  const { query, repoPath, topK = 10, format = 'markdown' } = options;

  if (!query || query.trim().length === 0) {
    return format === 'json'
      ? JSON.stringify({ query, results: [], context: '' }, null, 2)
      : '';
  }

  if (topK === 0) {
    return format === 'json'
      ? JSON.stringify({ query, results: [], context: '' }, null, 2)
      : '';
  }

  const cacheKey = globalAugmentCache.makeKey(query, repoPath, topK, format);
  const cached = globalAugmentCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  const db = openDb(dbPath);

  let results: HybridResult[];
  try {
    results = await hybridQuery(db, query, { limit: topK });
  } finally {
    closeDb(db);
  }

  if (results.length === 0) {
    return format === 'json'
      ? JSON.stringify({ query, results: [], context: 'No relevant code context found.' }, null, 2)
      : 'No relevant code context found.';
  }

  if (format === 'json') {
    return JSON.stringify(
      {
        query,
        results: results.map((r) => ({
          id: r.id,
          label: r.label ?? null,
          name: r.name ?? r.id,
          filePath: r.filePath ?? null,
          score: r.score,
        })),
      },
      null,
      2,
    );
  }

  // Markdown format — include file:line navigation hints so LLMs can jump directly to code.
  const lines: string[] = ['## Relevant Code Context', ''];

  for (const r of results) {
    const label = r.label ?? 'Symbol';
    const name = r.name ?? r.id;
    // Build a file:line reference when available so the LLM can navigate directly.
    let location: string | null = null;
    if (r.filePath) {
      location = r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath;
    }
    const scoreHint = `score=${r.score.toFixed(3)}`;
    const heading = location
      ? `### ${label}: \`${name}\` — \`${location}\` (${scoreHint})`
      : `### ${label}: \`${name}\` (${scoreHint})`;
    lines.push(heading);
    lines.push('');
  }

  const output = lines.join('\n').trimEnd();
  globalAugmentCache.set(cacheKey, output);
  return output;
}
