import fs from 'node:fs';
import path from 'node:path';
import type {
  CapabilityModule,
  DirectoryScan,
  FileEntry,
  HealthCheck,
  IndexResult,
  SearchResult,
} from './types.js';

/**
 * Root directory to search under, captured from activate(). The
 * CapabilityModule.search() signature takes only (query, limit) — no
 * rootDir — so it has to be stashed somewhere between activate() and
 * search() the same way cap-documents.ts stashes its in-memory index.
 */
let codeRootDir = '';

function getMonographDbPath(rootDir: string): string {
  return path.join(rootDir, '.monomind', 'monograph.db');
}

export const codeCapability: CapabilityModule = {
  name: 'code',

  detect(scan: DirectoryScan): number {
    // A built monograph index is proof there is code to search, even when the
    // fingerprint predates the code (e.g. the one `init` writes up front).
    if (scan.root && fs.existsSync(getMonographDbPath(scan.root))) return 1;
    return scan.capabilities.code.confidence;
  },

  async activate(rootDir: string): Promise<void> {
    // monolean: no separate index of our own — code content is indexed by
    // the existing monograph knowledge graph. search() below queries that
    // graph directly, so activate() only needs to remember where it lives.
    codeRootDir = rootDir;
  },

  async index(_files: FileEntry[]): Promise<IndexResult> {
    // monolean: existing monograph handles code indexing
    return { indexed: 0, skipped: 0, errors: [] };
  },

  /**
   * Delegates to monograph's FTS index rather than re-scanning files.
   *
   * Previously this method did not exist at all: CapabilityManager.search()
   * only calls `module.search()` when a module defines one (it's optional
   * on CapabilityModule), so the `code` capability silently contributed
   * zero results to every top-level `monomind search` — including
   * `--type code`, which is documented as a supported value — even though
   * `monomind monograph search` found the exact same symbol via the same
   * database.
   */
  async search(query: string, limit = 20): Promise<SearchResult[]> {
    if (!codeRootDir) return [];
    const dbPath = getMonographDbPath(codeRootDir);
    if (!fs.existsSync(dbPath)) return [];

    try {
      const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
      const db = openDb(dbPath);
      try {
        const rows = ftsSearch(db, query, limit);
        return rows
          .filter((r) => r.filePath)
          .map((r, idx) => ({
            path: r.filePath as string,
            // Rows arrive best-first. Raw FTS5 bm25 ranks are tiny on small
            // indexes (~1e-6), which sank every code hit below the 0.5..1
            // scores of other capabilities in CapabilityManager.search();
            // score by position instead, as cap-documents does.
            score: 1 / (idx + 1),
            snippet:
              r.startLine && r.startLine > 0
                ? `${r.label} ${r.name} (line ${r.startLine})`
                : `${r.label} ${r.name}`,
            type: 'code' as const,
            metadata: { label: r.label, startLine: r.startLine, endLine: r.endLine },
          }))
          .slice(0, limit);
      } finally {
        closeDb(db);
      }
    } catch {
      // monograph unavailable or the DB is unreadable — the code capability
      // just contributes no results rather than failing the whole search.
      return [];
    }
  },

  async healthChecks(): Promise<HealthCheck[]> {
    // monolean: delegates to existing doctor checks when cap/code is active
    // The doctor command checks isActive('code') to decide which checks to run
    return [];
  },
};
