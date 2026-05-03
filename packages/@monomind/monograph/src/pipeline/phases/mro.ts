import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import type { ParseOutput } from './parse.js';

export interface MroOutput {
  mroEdges: MonographEdge[];
}

export const mroPhase: PipelinePhase<MroOutput> = {
  name: 'mro',
  deps: ['cross-file'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;

    const classMethodsIndex = new Map<string, string[]>();
    for (const edge of allEdges) {
      if (edge.relation === 'HAS_METHOD') {
        const methods = classMethodsIndex.get(edge.sourceId) ?? [];
        methods.push(edge.targetId);
        classMethodsIndex.set(edge.sourceId, methods);
      }
    }

    const nameIndex = new Map(symbolNodes.map(n => [n.id, n.name]));
    const mroEdges: MonographEdge[] = [];

    for (const edge of allEdges) {
      if (edge.relation !== 'EXTENDS' && edge.relation !== 'IMPLEMENTS') continue;

      const parentMethods = classMethodsIndex.get(edge.targetId) ?? [];
      const childMethods = classMethodsIndex.get(edge.sourceId) ?? [];
      const parentMethodNames = new Map(parentMethods.map(id => [nameIndex.get(id) ?? id, id]));

      for (const childMethodId of childMethods) {
        const childName = nameIndex.get(childMethodId);
        if (!childName) continue;
        const parentMethodId = parentMethodNames.get(childName);
        if (!parentMethodId) continue;

        const relation = edge.relation === 'IMPLEMENTS' ? 'METHOD_IMPLEMENTS' : 'METHOD_OVERRIDES';
        mroEdges.push({
          id: makeId(childMethodId, parentMethodId, relation.toLowerCase()),
          sourceId: childMethodId, targetId: parentMethodId,
          relation, confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
        });
      }
    }

    return { mroEdges };
  },
};
