import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ExtractionCache } from '../../cache/extraction-cache.js';
import { parseFile } from '../../parsers/loader.js';
import { deleteEdgesForFile, insertEdges } from '../../storage/edge-store.js';
import { deleteNodesForFile, insertNodes } from '../../storage/node-store.js';
import type { MonographEdge, MonographNode } from '../../types.js';
import { symbolId } from '../../types.js';
import type { PipelinePhase } from '../types.js';
import type { StructureOutput } from './structure.js';
import { extractVariables, variableToNode } from './variables.js';

export interface ParseOutput {
  symbolNodes: MonographNode[];
  allEdges: MonographEdge[];
  parseErrors: string[];
  fileContents: Map<string, string>;
  cacheStats: { hits: number; misses: number };
}

export const parsePhase: PipelinePhase<ParseOutput> = {
  name: 'parse',
  deps: ['structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const symbolNodes: MonographNode[] = [];
    const allEdges: MonographEdge[] = [];
    const staleFilePaths: string[] = [];
    const parseErrors: string[] = [];
    const fileContents = new Map<string, string>();
    let processed = 0;
    let cacheHits = 0;
    let cacheMisses = 0;

    const cache = new ExtractionCache(join(ctx.repoPath, '.monomind', 'parse-cache'));

    for (const fileNode of fileNodes) {
      const absPath = fileNode.filePath ? `${ctx.repoPath}/${fileNode.filePath}` : '';
      const ext = extname(absPath).toLowerCase();
      if (ext === '.md' || ext === '.markdown') {
        processed++;
        continue;
      }

      // Fast path: mtime+size check avoids reading file content entirely.
      // Skipped entirely under --force so a force rebuild is a genuine from-scratch
      // parse, not a replay of whatever extraction the cache happens to hold.
      const cached = ctx.options.force ? null : cache.getWithStat(absPath);
      if (cached) {
        symbolNodes.push(...cached.nodes);
        allEdges.push(...cached.edges);
        cacheHits++;
      } else {
        let source: string;
        try {
          const stat = statSync(absPath);
          if (stat.size > ctx.options.maxFileSizeBytes) {
            parseErrors.push(`${fileNode.filePath}: skipped (too large)`);
            continue;
          }
          source = readFileSync(absPath, 'utf-8');
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          const detail = code || (err instanceof Error ? err.message : String(err));
          parseErrors.push(`${fileNode.filePath}: unreadable (${detail})`);
          continue;
        }
        fileContents.set(fileNode.filePath ?? absPath, source);
        const result = await parseFile(absPath, source, fileNode.filePath ?? '');
        const fileSymbols: MonographNode[] = [...result.nodes];
        const fileEdges: MonographEdge[] = [...result.edges];
        parseErrors.push(...result.parseErrors);

        if (ext === '.cs') {
          const csNamespaces = extractCsharpNamespaces(source, fileNode.filePath ?? '');
          for (const ns of csNamespaces) {
            fileSymbols.push({
              id: symbolId({
                filePath: ns.filePath,
                scope: [],
                name: ns.name,
                kind: 'Namespace',
              }),
              name: ns.name,
              label: 'Namespace',
              normLabel: 'namespace',
              filePath: ns.filePath,
              line: ns.line,
              isExported: true,
            } as import('../../types.js').MonographNode);
          }
        }

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          const varInfos = extractVariables(source, fileNode.filePath ?? '');
          fileSymbols.push(...varInfos.map((v) => variableToNode(v)));

          const arrowFns = extractArrowFunctions(source, fileNode.filePath ?? '');
          for (const fn of arrowFns) {
            fileSymbols.push({
              id: symbolId({ filePath: fn.filePath, scope: [], name: fn.name, kind: 'Function' }),
              name: fn.name,
              label: 'Function',
              normLabel: 'function',
              filePath: fn.filePath,
              line: fn.line,
              isExported: fn.isExported,
            } as import('../../types.js').MonographNode);
          }
        }

        try {
          const fileHash = cache.hashContent(source);
          cache.setDeferred(absPath, fileHash, fileSymbols, fileEdges);
        } catch {
          /* non-fatal */
        }
        symbolNodes.push(...fileSymbols);
        allEdges.push(...fileEdges);
        // This file was re-parsed (cache miss) — its OLD node/edge set (from the
        // previous build) must be deleted before the fresh rows are inserted below,
        // otherwise a renamed/removed symbol's old row survives forever (ghost rows).
        if (fileNode.filePath) staleFilePaths.push(fileNode.filePath);
        cacheMisses++;
      }
      processed++;

      if (processed % 50 === 0) {
        ctx.onProgress?.({
          phase: 'parse',
          filesProcessed: processed,
          totalFiles: fileNodes.length,
        });
      }
    }

    cache.flush();

    if (ctx.db) {
      const db = ctx.db;
      // Insert EVERY extracted node/edge, cache hits included. A cache hit used
      // to skip insertion on the assumption that those rows were already in
      // SQLite from a previous build — but the cache is flushed to disk before
      // the build's SQL transaction commits, so that assumption breaks the
      // moment the DB and the cache disagree: a build that rolls back (or a
      // deleted/replaced database file) leaves a fully-populated cache in front
      // of an empty database, and the next build then "succeeds" with zero
      // nodes. Treating cached extraction as reusable INPUT that can repopulate
      // storage on its own keeps the cache a pure parse accelerator instead of
      // a store that another store's contents silently depend on. Node IDs are
      // deterministic, so re-inserting an unchanged row is an idempotent upsert.
      const nodesToInsert = symbolNodes;
      const knownIds = new Set(symbolNodes.map((n) => n.id));
      const edgesToInsert = allEdges.filter((e) => knownIds.has(e.targetId));

      // For every cache-miss file, purge its OLD node/edge set BEFORE inserting the
      // fresh parse results, inside the same transaction — otherwise a renamed or
      // removed symbol's old row would survive forever (INSERT OR REPLACE only
      // overwrites rows whose id still matches; it never deletes rows whose id
      // disappeared because the symbol was renamed).
      const writeAll = db.transaction(() => {
        for (const filePath of staleFilePaths) {
          deleteEdgesForFile(db, filePath);
          deleteNodesForFile(db, filePath);
        }
        insertNodes(db, nodesToInsert);
        insertEdges(db, edgesToInsert);
      });
      writeAll();
    }

    if (cacheHits > 0 && cacheMisses === 0) {
      ctx.allFilesCached = true;
    }

    if (cacheHits > 0) {
      ctx.onProgress?.({
        phase: 'parse',
        filesProcessed: processed,
        totalFiles: fileNodes.length,
        message: `cache: ${cacheHits} hits, ${cacheMisses} misses (${symbolNodes.length} nodes inserted)`,
      });
    }

    return {
      symbolNodes,
      allEdges,
      parseErrors,
      fileContents,
      cacheStats: { hits: cacheHits, misses: cacheMisses },
    };
  },
};

export function extractCsharpNamespaces(
  source: string,
  filePath: string,
): Array<{ name: string; label: 'Namespace'; filePath: string; line: number }> {
  const results: Array<{ name: string; label: 'Namespace'; filePath: string; line: number }> = [];
  const re = /^[ \t]*namespace\s+([\w.]+)\s*[{;]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const charsBefore = source.slice(0, m.index);
    const line = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
    results.push({ name: m[1]!, label: 'Namespace', filePath, line });
  }
  return results;
}

export function extractArrowFunctions(
  source: string,
  filePath: string,
): Array<{ name: string; isExported: boolean; line: number; filePath: string }> {
  const results: Array<{ name: string; isExported: boolean; line: number; filePath: string }> = [];
  // Match: (export)? const/let NAME = (async)? (...) =>
  const re = /^([ \t]*)(export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm;

  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(source)) !== null) {
    const charsBefore = source.slice(0, m.index);
    const lineNum = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
    results.push({
      name: m[3]!,
      isExported: !!m[2]?.trim(),
      line: lineNum,
      filePath,
    });
  }

  return results;
}
