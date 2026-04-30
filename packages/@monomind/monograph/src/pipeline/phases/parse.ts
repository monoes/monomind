import { readFileSync, statSync } from 'fs';
import { extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { parseFile } from '../../parsers/loader.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

export interface ParseOutput {
  symbolNodes: MonographNode[];
  allEdges: MonographEdge[];
  parseErrors: string[];
}

export const parsePhase: PipelinePhase<ParseOutput> = {
  name: 'parse',
  deps: ['structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const symbolNodes: MonographNode[] = [];
    const allEdges: MonographEdge[] = [];
    const parseErrors: string[] = [];
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
      } catch { continue; }

      const result = await parseFile(absPath, source, fileNode.filePath ?? '');
      symbolNodes.push(...result.nodes);
      allEdges.push(...result.edges);
      parseErrors.push(...result.parseErrors);
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

    return { symbolNodes, allEdges, parseErrors };
  },
};
