import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { formatErrorWithCause } from '../utils/native-error.js';
import { getDbPath } from './monograph-shared.js';

// ── search subcommand ─────────────────────────────────────────────────────────

export const searchCommand: Command = {
  name: 'search',
  description: 'Search the knowledge graph (lexical: BM25 FTS, LIKE and fuzzy matching)',
  options: [
    { name: 'query', short: 'q', type: 'string', description: 'Search query', required: true },
    {
      name: 'limit',
      short: 'l',
      type: 'number',
      description: 'Max results (default 15)',
      default: '15',
    },
    {
      name: 'label',
      type: 'string',
      description: 'Filter by node type: Section, Function, Concept, File, etc.',
    },
    {
      name: 'mode',
      short: 'm',
      type: 'string',
      description:
        'Search mode: bm25 | semantic | hybrid (default: hybrid). All modes are lexical: the CLI loads no embedder, so semantic is FTS + LIKE + fuzzy matching',
      default: 'hybrid',
    },
    { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
  ],
  examples: [
    {
      command: 'monomind monograph search -q "authentication flow"',
      description: 'Hybrid search across all nodes',
    },
    {
      command: 'monomind monograph search -q "API design" --label Section',
      description: 'Search only doc sections',
    },
    {
      command: 'monomind monograph search -q "pipeline" --mode semantic',
      description: 'FTS + LIKE + fuzzy lexical match (no embeddings)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawQuery = ctx.flags.query as string;
    const rawLimit = parseInt((ctx.flags.limit as string) || '15', 10);
    const rawLabel = ctx.flags.label as string | undefined;
    const rawMode = (ctx.flags.mode as string | undefined) ?? 'hybrid';
    const root = resolve((ctx.flags.path as string | undefined) ?? process.cwd());
    const dbPath = getDbPath(root);

    // Cap query to prevent SQLite FTS DoS from multi-MB query strings
    const MAX_QUERY_LEN = 2048;
    const query = typeof rawQuery === 'string' ? rawQuery.slice(0, MAX_QUERY_LEN) : '';
    if (!query) {
      output.printError('--query is required');
      return { success: false, exitCode: 1 };
    }

    // Clamp limit to prevent huge result sets from causing OOM
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 15;

    // Validate mode to an explicit allowlist
    const VALID_MODES = new Set(['bm25', 'semantic', 'hybrid']);
    const mode = VALID_MODES.has(rawMode) ? rawMode : 'hybrid';

    // Cap label to prevent oversized SQL filter values
    const MAX_LABEL_LEN = 64;
    const label = typeof rawLabel === 'string' ? rawLabel.slice(0, MAX_LABEL_LEN) : undefined;

    if (!existsSync(dbPath)) {
      output.printWarning('No knowledge graph found. Run: monomind monograph build');
      return { success: false, exitCode: 1 };
    }

    const jsonOutput = ctx.flags.format === 'json';

    if (!jsonOutput) {
      output.writeln();
      output.writeln(output.bold(`Monograph Search — "${query}"`));
      output.writeln(
        output.dim(`  mode: ${mode}${label ? `  label: ${label}` : ''}  limit: ${limit}`),
      );
      output.writeln();
    }

    try {
      const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
      // At @monoes/monograph@1.1.0, semanticSearch is not exported. Import from compat.
      // With no embeddings at 1.1.0, --mode semantic and --mode hybrid both degrade to BM25
      // (the RRF block merges bm25 with a sem list that is itself BM25 — harmless).
      const { hybridSearch: semanticSearch } = await import('@monoes/monograph');
      const db = openDb(dbPath);

      type SearchResult = {
        id: string;
        label: string;
        name: string;
        normLabel: string;
        filePath: string | null;
        score?: number;
        rank?: number;
        // ftsSearch/hybridSearch both actually return these (FtsResult /
        // HybridSearchResult in @monoes/monograph) — this local type used to
        // omit them entirely, so the text-mode table below never read them
        // even though they were present on every result object at runtime
        // (confirmed by --format json, which passes the raw object through
        // and does show startLine/endLine).
        startLine?: number | null;
        endLine?: number | null;
      };
      let results: SearchResult[] = [];
      const K = 60;

      if (mode === 'semantic') {
        results = (semanticSearch(db, query, limit, label) as SearchResult[]).map((r) => ({
          ...r,
        }));
      } else if (mode === 'bm25') {
        results = (ftsSearch(db, query, limit, label) as SearchResult[]).map((r) => ({ ...r }));
      } else {
        // hybrid: RRF merge
        const bm25 = ftsSearch(db, query, limit * 2, label) as SearchResult[];
        const sem = semanticSearch(db, query, limit * 2, label) as SearchResult[];
        const scores = new Map<string, number>();
        const meta = new Map<string, SearchResult>();
        bm25.forEach((r, i) => {
          scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i));
          meta.set(r.id, r);
        });
        sem.forEach((r, i) => {
          scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i));
          if (!meta.has(r.id)) meta.set(r.id, r);
        });
        results = [...scores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, score]) => ({ ...meta.get(id)!, score }));
      }

      closeDb(db);

      if (jsonOutput) {
        output.printJson({ query, mode, label, limit, count: results.length, results });
        return { success: true, data: results };
      }

      if (results.length === 0) {
        output.printWarning('No results found.');
        output.writeln(
          output.dim('  Try other words  or  monomind monograph build to rebuild the index'),
        );
        return { success: true, data: [] };
      }

      output.printTable({
        columns: [
          { key: 'label', header: 'Type', width: 12 },
          { key: 'name', header: 'Name', width: 32 },
          { key: 'file', header: 'File', width: 24 },
          { key: 'line', header: 'Line', width: 6 },
          { key: 'score', header: 'Score', width: 8 },
        ],
        data: results.map((r) => ({
          label: output.dim(r.label),
          name: r.name.length > 30 ? `${r.name.slice(0, 27)}…` : r.name,
          file: r.filePath
            ? r.filePath.length > 22
              ? `…${r.filePath.slice(-21)}`
              : r.filePath
            : output.dim('—'),
          line: r.startLine != null && r.startLine > 0 ? String(r.startLine) : output.dim('—'),
          score: r.score != null ? output.dim(r.score.toFixed(4)) : output.dim('—'),
        })),
      });

      output.writeln(output.dim(`\n  ${results.length} results`));
      return { success: true, data: results };
    } catch (err) {
      output.printError(formatErrorWithCause(err));
      return { success: false, exitCode: 1 };
    }
  },
};
