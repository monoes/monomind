import { SYMBOL_ID_VERSION } from '../types.js';
import type { MonographDb } from '../storage/db.js';
import type { IndexScope } from './index-scope.js';

const MANIFEST_KEY = 'manifest';
const MAX_LISTED_WARNINGS = 20;

/**
 * What the last build actually produced — the one place an agent (or doctor)
 * can learn how complete the index is without inferring it from query results.
 */
export interface IndexManifest {
  /** Increments on every committed build; lets a cache tie itself to one build. */
  generation: number;
  builtAt: string;
  durationMs: number;
  scope: IndexScope;
  commit: string | null;
  /** Version of the symbol-id scheme; ids from different versions are not comparable. */
  identityVersion: number;
  nodes: Record<string, number>;
  edges: Record<string, number>;
  /** Code symbols and files with a natural-language summary indexed. */
  summarized: number;
  /** Files the parser skipped or recovered from, with the first few named. */
  parseWarnings: { count: number; sample: string[] };
}

export function readManifest(db: MonographDb): IndexManifest | null {
  try {
    const row = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(MANIFEST_KEY) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as IndexManifest) : null;
  } catch {
    return null;
  }
}

function countBy(db: MonographDb, table: 'nodes' | 'edges', column: string): Record<string, number> {
  const rows = db
    .prepare(`SELECT ${column} AS k, COUNT(*) AS n FROM ${table} GROUP BY ${column}`)
    .all() as { k: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}

export function writeManifest(
  db: MonographDb,
  input: {
    startedAt: number;
    scope: IndexScope;
    commit: string | null;
    summarized: number;
    parseErrors: string[];
  },
): IndexManifest {
  const manifest: IndexManifest = {
    generation: (readManifest(db)?.generation ?? 0) + 1,
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    scope: input.scope,
    commit: input.commit,
    identityVersion: SYMBOL_ID_VERSION,
    nodes: countBy(db, 'nodes', 'label'),
    edges: countBy(db, 'edges', 'relation'),
    summarized: input.summarized,
    parseWarnings: {
      count: input.parseErrors.length,
      sample: input.parseErrors.slice(0, MAX_LISTED_WARNINGS),
    },
  };
  db.prepare('INSERT OR REPLACE INTO index_meta VALUES (?, ?)').run(
    MANIFEST_KEY,
    JSON.stringify(manifest),
  );
  return manifest;
}
