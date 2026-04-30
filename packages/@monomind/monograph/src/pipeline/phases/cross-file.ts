import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ParseOutput } from './parse.js';

export interface CrossFileOutput {
  resolvedEdges: MonographEdge[];
}

export const crossFilePhase: PipelinePhase<CrossFileOutput> = {
  name: 'cross-file',
  deps: ['parse'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;

    const nameIndex = new Map<string, string>();
    for (const node of symbolNodes) {
      nameIndex.set(node.name, node.id);
      if (node.normLabel) nameIndex.set(node.normLabel, node.id);
    }

    const resolvedEdges: MonographEdge[] = [];

    for (const edge of allEdges) {
      if (edge.relation !== 'IMPORTS') continue;

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
    }

    if (_ctx.db && resolvedEdges.length > 0) {
      insertEdges(_ctx.db, resolvedEdges);
    }

    return { resolvedEdges };
  },
};
