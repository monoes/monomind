/**
 * Lexical + semantic retrieval, fused.
 *
 * Lexical search (names, stemmed summaries) is exact and fast but only finds
 * what shares words with the query. Embeddings find "which agent should handle
 * a task" -> `pickAgents` but blur exact identifiers. Reciprocal-rank fusion
 * keeps the strengths of both; the weights follow the query's style, and an
 * exact name match is always pinned first.
 *
 * Degrades to plain lexical search when no embedder is supplied, nothing has
 * been embedded yet, or the query only concerns documentation.
 */

import type Database from 'better-sqlite3';
import { type Embedder, type SemanticHit, semanticSearch } from '../embeddings/store.js';
import {
  AGENT_SCOPE_LABELS,
  CODE_SCOPE_LABELS,
  type GraphSearchOptions,
  type GraphSearchResult,
  searchGraph,
  TEST_FACTOR,
  TEST_INTENT,
  TEST_PATH,
} from './hybrid-query.js';

const RRF_K = 60;
/** How many of keyword search's top hits are never dropped by fusion. */
const PROTECTED_LEXICAL = 2;
/** [lexical, semantic] weights. */
const WEIGHTS_IDENTIFIER: readonly [number, number] = [2, 1];
const WEIGHTS_NATURAL: readonly [number, number] = [1, 2];

export interface FusedSearchOptions extends GraphSearchOptions {
  embedder?: Embedder | null;
}

/** A single token (`UserService`, `agent-pick`, `fts-store.ts`) is a name, not a question. */
export function isIdentifierQuery(query: string): boolean {
  return !/\s/.test(query.trim());
}

function semanticLabels(options: GraphSearchOptions): readonly string[] | string | undefined {
  if (options.label) return options.label;
  if (options.scope === 'code') return CODE_SCOPE_LABELS;
  if (options.scope === 'agents') return AGENT_SCOPE_LABELS;
  if (options.scope === 'docs') return ['Document'];
  return undefined;
}

export async function searchGraphFused(
  db: Database.Database,
  query: string,
  options: FusedSearchOptions = {},
): Promise<GraphSearchResult[]> {
  const { embedder, ...base } = options;
  const limit = base.limit ?? 20;
  const q = (query ?? '').trim();
  if (limit <= 0 || !q) return [];

  const pool = Math.max(limit * 5, 50);
  const lexical = searchGraph(db, q, { ...base, limit: pool });

  if (!embedder) return lexical.slice(0, limit);

  let sem: SemanticHit[] = [];
  try {
    sem = semanticSearch(db, await embedder.embedQuery(q), pool, semanticLabels(base));
  } catch {
    return lexical.slice(0, limit);
  }
  if (sem.length === 0) return lexical.slice(0, limit);

  const [wl, ws] = isIdentifierQuery(q) ? WEIGHTS_IDENTIFIER : WEIGHTS_NATURAL;
  const wantsTests = TEST_INTENT.test(q);
  const fused = new Map<string, { hit: GraphSearchResult; score: number }>();
  const add = (hit: GraphSearchResult, rank: number, weight: number): void => {
    const penalty = !wantsTests && hit.filePath && TEST_PATH.test(hit.filePath) ? TEST_FACTOR : 1;
    const entry = fused.get(hit.id) ?? { hit, score: 0 };
    entry.score += (weight * penalty) / (RRF_K + rank + 1);
    fused.set(hit.id, entry);
  };
  lexical.forEach((hit, i) => add(hit, i, wl));
  sem.forEach((s, i) =>
    add(
      {
        id: s.id,
        name: s.name,
        normLabel: s.normLabel,
        filePath: s.filePath,
        label: s.label,
        relevance: 0,
        startLine: s.startLine,
        endLine: s.endLine,
        matchStrategy: 'semantic',
      },
      i,
      ws,
    ),
  );

  const ceiling = (wl + ws) / (RRF_K + 1);
  const ranked = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ hit, score }) => ({ ...hit, relevance: score / ceiling }));

  // An exact name match is what the caller typed; nothing the fusion adds outranks it.
  const lower = q.toLowerCase();
  const exact = ranked.filter((r) => r.name.toLowerCase() === lower);
  const rest = ranked.filter((r) => r.name.toLowerCase() !== lower);
  const final = [...exact, ...rest].slice(0, limit);

  // Keyword search's two best hits stay in the results even when the semantic lane crowds
  // them out (a sentence that contains a real name — "share a meeting" -> shareRoutes —
  // is exactly where a keyword hit is right and the embedding is only roughly so).
  const present = new Set(final.map((r) => r.id));
  const protectedHits = lexical.slice(0, PROTECTED_LEXICAL).filter((h) => !present.has(h.id));
  for (const hit of protectedHits) {
    if (final.length >= limit) {
      if (final.length <= exact.length) break; // never evict an exact name match
      final.pop();
    }
    final.push({
      ...(ranked.find((r) => r.id === hit.id) ?? hit),
      relevance: final.at(-1)?.relevance ?? 0,
    });
  }
  return final;
}
