/**
 * Absolute relevance check for natural-language task queries.
 *
 * Ranked retrieval always returns its best N, even when nothing matches: fusion
 * scores are relative to the pool, so a nonexistent concept still "scores 0.96".
 * {@link assessRelevance} asks the absolute question instead — does any top hit
 * share enough of the query's content words (or sit close enough in embedding
 * space) to be about it at all? — so `suggest` and `brief` can say "no relevant
 * match" rather than hand back ten unrelated nodes.
 */

import type Database from 'better-sqlite3';
import { contentWords } from '../storage/summary-search.js';
import type { GraphSearchResult } from './hybrid-query.js';

/** Cosine similarity at which an embedding neighbour counts as on-topic without shared words. */
export const SEMANTIC_RELEVANT_SIMILARITY = 0.55;
/** How many of the best hits are inspected. */
const INSPECTED_HITS = 10;

export interface RelevanceVerdict {
  relevant: boolean;
  /** Content words of the query the on-topic hits cover. */
  bestCoverage: number;
  /** Content words of the query. */
  words: number;
}

/** Lowercased word tokens, splitting camelCase, snake_case, kebab-case and paths. */
function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Equal, or one is the stem of the other (`schedule`/`scheduler`, `index`/`indexes`). */
function sameWord(token: string, word: string): boolean {
  if (token === word) return true;
  if (token.length < 4 || word.length < 4) return false;
  return token.startsWith(word) || word.startsWith(token);
}

function summaryText(db: Database.Database, id: string): string {
  try {
    const row = db.prepare('SELECT text FROM node_summaries_fts WHERE node_id = ?').get(id) as
      | { text: string }
      | undefined;
    return row?.text ?? '';
  } catch {
    return ''; // index built before summaries existed
  }
}

/** Query words found in the hit's name, path and summary, and the share of its name that is query words. */
function match(
  db: Database.Database,
  hit: GraphSearchResult,
  words: string[],
): { covered: Set<string>; nameShare: number } {
  const nameTokens = tokens(hit.name);
  const bag = tokens(`${hit.name} ${hit.filePath ?? ''} ${summaryText(db, hit.id)}`);
  const covered = new Set(words.filter((w) => bag.some((t) => sameWord(t, w))));
  const inName = nameTokens.filter((t) => words.some((w) => sameWord(t, w))).length;
  return { covered, nameShare: nameTokens.length ? inName / nameTokens.length : 0 };
}

/**
 * Whether `hits` plausibly answer `query`. Only multi-word queries are judged: a bare
 * identifier is a name lookup, where "no hit" already means no match and a typo should
 * still return its fuzzy neighbours. A question needs on-topic hits that together cover at
 * least half of its content words (and never fewer than one).
 */
export function assessRelevance(
  db: Database.Database,
  query: string,
  hits: readonly GraphSearchResult[],
): RelevanceVerdict {
  const words = contentWords(query);
  if (hits.length === 0) return { relevant: false, bestCoverage: 0, words: words.length };
  if (!/\s/.test(query.trim()) || words.length < 2) {
    return { relevant: true, bestCoverage: words.length, words: words.length };
  }
  // A name typed into the question ("fix PaymentProcessor logging") is a direct reference.
  const typed = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((w) => w.length > 2),
  );
  if (hits.slice(0, INSPECTED_HITS).some((h) => typed.has(h.name.toLowerCase()))) {
    return { relevant: true, bestCoverage: words.length, words: words.length };
  }
  const need = Math.ceil(words.length / 2);
  // A hit is on topic when it covers `need` words alone, or is named mostly in the query's
  // own words (`greet`, `helper`) — a long constant that merely contains "org" is not. The
  // task is answered when the on-topic hits together cover `need` of its words.
  const covered = new Set<string>();
  for (const hit of hits.slice(0, INSPECTED_HITS)) {
    if ((hit.similarity ?? 0) >= SEMANTIC_RELEVANT_SIMILARITY) {
      return { relevant: true, bestCoverage: words.length, words: words.length };
    }
    const m = match(db, hit, words);
    if (m.covered.size >= need || m.nameShare >= 0.5) for (const w of m.covered) covered.add(w);
  }
  return { relevant: covered.size >= need, bestCoverage: covered.size, words: words.length };
}
