import { readFileSync, statSync } from 'fs';
import { extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { parseFile } from '../../parsers/loader.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';
import { extractVariables, variableToNode } from './variables.js';

export interface ParseOutput {
  symbolNodes: MonographNode[];
  allEdges: MonographEdge[];
  parseErrors: string[];
  fileContents: Map<string, string>;
}

export const parsePhase: PipelinePhase<ParseOutput> = {
  name: 'parse',
  deps: ['structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const symbolNodes: MonographNode[] = [];
    const allEdges: MonographEdge[] = [];
    const parseErrors: string[] = [];
    const fileContents = new Map<string, string>();
    let processed = 0;

    for (const fileNode of fileNodes) {
      const absPath = fileNode.filePath ? `${ctx.repoPath}/${fileNode.filePath}` : '';
      const ext = extname(absPath).toLowerCase();
      let source: string;
      try {
        const stat = statSync(absPath);
        if (stat.size > ctx.options.maxFileSizeBytes) {
          parseErrors.push(`${fileNode.filePath}: skipped (too large)`);
          continue;
        }
        source = readFileSync(absPath, 'utf-8');
        fileContents.set(fileNode.filePath ?? absPath, source);
      } catch { continue; }

      const result = await parseFile(absPath, source, fileNode.filePath ?? '');
      symbolNodes.push(...result.nodes);
      allEdges.push(...result.edges);
      parseErrors.push(...result.parseErrors);

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
            kind: 'Function',
            filePath: fn.filePath,
            line: fn.line,
            isExported: fn.isExported,
          } as import('../../types.js').MonographNode);
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
      isExported: !!(m[2]?.trim()),
      line: lineNum,
      filePath,
    });
  }

  return results;
}
