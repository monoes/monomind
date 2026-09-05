import { extname } from 'node:path';
import { isSupportedExtension } from '../parsers/loader.js';
import type { MonographDb } from '../storage/db.js';

/**
 * The source-selection domain a graph was built with. `code` is what a
 * `codeOnly: true` scan looks at (files with a parseable code extension);
 * `all` additionally covers documents, markdown, config and other text files.
 *
 * The scope is persisted with the index so a later refresh reuses it instead of
 * silently narrowing coverage, and so the orphan sweep can tell "this file was
 * deleted" apart from "this file was never in the scan's domain".
 */
export type IndexScope = 'code' | 'all';

const INDEX_SCOPE_KEY = 'source_scope';

export function scopeForOptions(codeOnly: boolean): IndexScope {
  return codeOnly ? 'code' : 'all';
}

/** The scope the stored graph was last built with, or null if never recorded. */
export function readIndexScope(db: MonographDb): IndexScope | null {
  try {
    const row = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(INDEX_SCOPE_KEY) as
      | { value: string }
      | undefined;
    if (row?.value === 'code' || row?.value === 'all') return row.value;
    return null;
  } catch {
    return null;
  }
}

export function writeIndexScope(db: MonographDb, scope: IndexScope): void {
  db.prepare('INSERT OR REPLACE INTO index_meta VALUES (?, ?)').run(INDEX_SCOPE_KEY, scope);
}

/**
 * Whether `filePath` belongs to the source domain a build at `scope` actually
 * scans. Rows outside the current scope's domain were produced by a wider
 * earlier build and must be left alone — a code-only refresh never looked at
 * those files, so their absence from its file list is not evidence of deletion.
 */
export function isWithinScope(filePath: string, scope: IndexScope): boolean {
  if (scope === 'all') return true;
  return isSupportedExtension(extname(filePath).toLowerCase());
}
