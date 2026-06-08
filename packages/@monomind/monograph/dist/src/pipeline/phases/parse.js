import { readFileSync, statSync } from 'fs';
import { extname } from 'path';
import { parseFile } from '../../parsers/loader.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import { extractVariables, variableToNode } from './variables.js';
export const parsePhase = {
    name: 'parse',
    deps: ['structure'],
    async execute(ctx, deps) {
        const { fileNodes } = deps.get('structure');
        const symbolNodes = [];
        const allEdges = [];
        const parseErrors = [];
        const fileContents = new Map();
        let processed = 0;
        for (const fileNode of fileNodes) {
            const absPath = fileNode.filePath ? `${ctx.repoPath}/${fileNode.filePath}` : '';
            const ext = extname(absPath).toLowerCase();
            let source;
            try {
                const stat = statSync(absPath);
                if (stat.size > ctx.options.maxFileSizeBytes) {
                    parseErrors.push(`${fileNode.filePath}: skipped (too large)`);
                    continue;
                }
                source = readFileSync(absPath, 'utf-8');
                fileContents.set(fileNode.filePath ?? absPath, source);
            }
            catch {
                continue;
            }
            const result = await parseFile(absPath, source, fileNode.filePath ?? '');
            symbolNodes.push(...result.nodes);
            allEdges.push(...result.edges);
            parseErrors.push(...result.parseErrors);
            // Extract C# namespace declarations
            if (ext === '.cs') {
                const csNamespaces = extractCsharpNamespaces(source, fileNode.filePath ?? '');
                for (const ns of csNamespaces) {
                    symbolNodes.push({
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
            // Extract top-level variable declarations for TS/JS files
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                const varInfos = extractVariables(source, fileNode.filePath ?? '');
                symbolNodes.push(...varInfos.map(v => variableToNode(v)));
                // Extract named arrow functions
                const arrowFns = extractArrowFunctions(source, fileNode.filePath ?? '');
                for (const fn of arrowFns) {
                    symbolNodes.push({
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
            processed++;
            if (processed % 50 === 0) {
                ctx.onProgress?.({ phase: 'parse', filesProcessed: processed, totalFiles: fileNodes.length });
            }
        }
        if (ctx.db) {
            insertNodes(ctx.db, symbolNodes);
            // Only insert edges whose target already exists in the DB (intra-file edges).
            // Cross-file import edges with unresolved targets are handled by crossFilePhase
            // after it resolves them to real node IDs.
            const knownIds = new Set(symbolNodes.map(n => n.id));
            const resolvableEdges = allEdges.filter(e => knownIds.has(e.targetId));
            insertEdges(ctx.db, resolvableEdges);
        }
        return { symbolNodes, allEdges, parseErrors, fileContents };
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