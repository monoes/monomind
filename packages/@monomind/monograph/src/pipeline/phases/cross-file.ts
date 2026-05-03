import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge, MonographNode } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ParseOutput } from './parse.js';
import type { StructureOutput } from './structure.js';

export interface CrossFileOutput {
  resolvedEdges: MonographEdge[];
}

export const crossFilePhase: PipelinePhase<CrossFileOutput> = {
  name: 'cross-file',
  deps: ['parse', 'structure'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;
    const { fileNodes } = deps.get('structure') as StructureOutput;

    // Symbol name → symbol node ID
    const nameIndex = new Map<string, string>();
    for (const node of symbolNodes) {
      nameIndex.set(node.name, node.id);
      if (node.normLabel) nameIndex.set(node.normLabel, node.id);
    }

    // Basename (without extension) → File node ID, for resolving RE_EXPORTS
    const fileBasenameIndex = new Map<string, string>();
    for (const fileNode of fileNodes) {
      const basename = (fileNode.filePath ?? '').split('/').pop() ?? '';
      const noExt = basename.replace(/\.[^.]+$/, '');
      fileBasenameIndex.set(noExt.toLowerCase(), fileNode.id);
      fileBasenameIndex.set(basename.toLowerCase(), fileNode.id);
    }

    const resolvedEdges: MonographEdge[] = [];

    for (const edge of allEdges) {
      if (edge.relation === 'IMPORTS') {
        const targetName = edge.targetId.replace(/^import_/, '').split('/').pop() ?? '';
        const resolvedId = nameIndex.get(targetName) ?? nameIndex.get(targetName.toLowerCase());

        if (resolvedId && resolvedId !== edge.targetId) {
          resolvedEdges.push({
            ...edge,
            id: makeId(edge.sourceId, resolvedId, 'resolved'),
            targetId: resolvedId,
            confidence: 'INFERRED',
            confidenceScore: CONFIDENCE_SCORE.INFERRED,
          });
        }
      } else if (edge.relation === 'RE_EXPORTS') {
        // Resolve to a File node ID
        const rawTarget = edge.targetId.replace(/^import_/, '');
        const basename = rawTarget.split('/').pop() ?? '';
        const noExt = basename.replace(/\.[^.]+$/, '');
        const resolvedId = fileBasenameIndex.get(basename.toLowerCase())
          ?? fileBasenameIndex.get(noExt.toLowerCase());

        if (resolvedId && resolvedId !== edge.targetId) {
          resolvedEdges.push({
            ...edge,
            id: makeId(edge.sourceId, resolvedId, 'reexports_resolved'),
            targetId: resolvedId,
            confidence: 'INFERRED',
            confidenceScore: CONFIDENCE_SCORE.INFERRED,
          });
        }
      }
    }

    if (_ctx.db && resolvedEdges.length > 0) {
      insertEdges(_ctx.db, resolvedEdges);
    }

    return { resolvedEdges };
  },
};
