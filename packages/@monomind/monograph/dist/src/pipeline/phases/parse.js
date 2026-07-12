import { readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { parseFile } from '../../parsers/loader.js';
import { insertNodes, deleteNodesForFile } from '../../storage/node-store.js';
import { insertEdges, deleteEdgesForFile } from '../../storage/edge-store.js';
import { extractVariables, variableToNode } from './variables.js';
import { ExtractionCache } from '../../cache/extraction-cache.js';
export const parsePhase = {
    name: 'parse',
    deps: ['structure'],
    async execute(ctx, deps) {
        const { fileNodes } = deps.get('structure');
        const symbolNodes = [];
        const allEdges = [];
        // freshNodes/freshEdges (the cache-miss-only subset) are NOT accumulated in a
        // parallel array during the loop — that duplicated every fresh node/edge object
        // in memory for the entire pipeline run. Instead we record the [start, end)
        // slice of symbolNodes/allEdges that each cache-miss file contributed, and
        // materialize the fresh subset via a single slice pass at the end, only when
        // it's actually needed (cacheHits > 0). On a cold build (cacheHits === 0) the
        // fresh subset is never materialized at all, since nodesToInsert falls back to
        // symbolNodes/allEdges directly in that case — eliminating the redundant
        // allocation entirely for the memory-heaviest scenario.
        const freshNodeRanges = [];
        const freshEdgeRanges = [];
        const staleFilePaths = [];
        const parseErrors = [];
        const fileContents = new Map();
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
            }
            else {
                let source;
                try {
                    const stat = statSync(absPath);
                    if (stat.size > ctx.options.maxFileSizeBytes) {
                        parseErrors.push(`${fileNode.filePath}: skipped (too large)`);
                        continue;
                    }
                    source = readFileSync(absPath, 'utf-8');
                }
                catch (err) {
                    const code = err?.code;
                    const detail = code || (err instanceof Error ? err.message : String(err));
                    parseErrors.push(`${fileNode.filePath}: unreadable (${detail})`);
                    continue;
                }
                fileContents.set(fileNode.filePath ?? absPath, source);
                const result = await parseFile(absPath, source, fileNode.filePath ?? '');
                const fileSymbols = [...result.nodes];
                const fileEdges = [...result.edges];
                parseErrors.push(...result.parseErrors);
                if (ext === '.cs') {
                    const csNamespaces = extractCsharpNamespaces(source, fileNode.filePath ?? '');
                    for (const ns of csNamespaces) {
                        fileSymbols.push({
                            id: `${ns.filePath}::namespace::${ns.name}`,
                            name: ns.name,
                            label: 'Namespace',
                            normLabel: 'namespace',
                            filePath: ns.filePath,
                            line: ns.line,
                            isExported: true,
                        });
                    }
                }
                if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                    const varInfos = extractVariables(source, fileNode.filePath ?? '');
                    fileSymbols.push(...varInfos.map(v => variableToNode(v)));
                    const arrowFns = extractArrowFunctions(source, fileNode.filePath ?? '');
                    for (const fn of arrowFns) {
                        fileSymbols.push({
                            id: `${fn.filePath}::fn::${fn.name}`,
                            name: fn.name,
                            label: 'Function',
                            normLabel: 'function',
                            filePath: fn.filePath,
                            line: fn.line,
                            isExported: fn.isExported,
                        });
                    }
                }
                try {
                    const fileHash = cache.hashContent(source);
                    cache.setDeferred(absPath, fileHash, fileSymbols, fileEdges);
                }
                catch { /* non-fatal */ }
                const nodeStart = symbolNodes.length;
                const edgeStart = allEdges.length;
                symbolNodes.push(...fileSymbols);
                allEdges.push(...fileEdges);
                freshNodeRanges.push([nodeStart, symbolNodes.length]);
                freshEdgeRanges.push([edgeStart, allEdges.length]);
                // This file was re-parsed (cache miss) — its OLD node/edge set (from the
                // previous build) must be deleted before the fresh rows are inserted below,
                // otherwise a renamed/removed symbol's old row survives forever (ghost rows).
                if (fileNode.filePath)
                    staleFilePaths.push(fileNode.filePath);
                cacheMisses++;
            }
            processed++;
            if (processed % 50 === 0) {
                ctx.onProgress?.({ phase: 'parse', filesProcessed: processed, totalFiles: fileNodes.length });
            }
        }
        cache.flush();
        if (ctx.db) {
            const db = ctx.db;
            // Only insert freshly-parsed nodes — cached nodes are already in the DB
            // from the previous build (node IDs are deterministic from file_path + symbol).
            // On first build (no cache hits), freshNodes === symbolNodes, so the fresh
            // subset is never materialized — symbolNodes/allEdges are used directly.
            const freshNodes = cacheHits > 0
                ? freshNodeRanges.flatMap(([s, e]) => symbolNodes.slice(s, e))
                : symbolNodes;
            const freshEdges = cacheHits > 0
                ? freshEdgeRanges.flatMap(([s, e]) => allEdges.slice(s, e))
                : allEdges;
            const nodesToInsert = freshNodes;
            const knownIds = new Set(symbolNodes.map(n => n.id));
            const edgesToInsert = freshEdges.filter(e => knownIds.has(e.targetId));
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
            const freshNodeCount = freshNodeRanges.reduce((sum, [s, e]) => sum + (e - s), 0);
            ctx.onProgress?.({ phase: 'parse', filesProcessed: processed, totalFiles: fileNodes.length,
                message: `cache: ${cacheHits} hits, ${cacheMisses} misses (${freshNodeCount} nodes inserted)` });
        }
        return { symbolNodes, allEdges, parseErrors, fileContents, cacheStats: { hits: cacheHits, misses: cacheMisses } };
    },
};
export function extractCsharpNamespaces(source, filePath) {
    const results = [];
    const re = /^[ \t]*namespace\s+([\w.]+)\s*[\{;]/gm;
    let m;
    while ((m = re.exec(source)) !== null) {
        const charsBefore = source.slice(0, m.index);
        const line = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
        results.push({ name: m[1], label: 'Namespace', filePath, line });
    }
    return results;
}
export function extractArrowFunctions(source, filePath) {
    const results = [];
    // Match: (export)? const/let NAME = (async)? (...) =>
    const re = /^([ \t]*)(export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(source)) !== null) {
        const charsBefore = source.slice(0, m.index);
        const lineNum = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
        results.push({
            name: m[3],
            isExported: !!(m[2]?.trim()),
            line: lineNum,
            filePath,
        });
    }
    return results;
}
//# sourceMappingURL=parse.js.map