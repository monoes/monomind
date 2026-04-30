import type { PipelinePhase, PipelineContext } from '../types.js';
import type { GodNode, MonographEdge } from '../../types.js';
import type { ParseOutput } from './parse.js';
import type { CrossFileOutput } from './cross-file.js';

const EXCLUDED_LABELS = new Set(['File', 'Folder', 'Community', 'Concept']);

export interface GodNodesOutput {
  godNodes: GodNode[];
}

export const godNodesPhase: PipelinePhase<GodNodesOutput> = {
  name: 'god-nodes',
  deps: ['cross-file', 'parse'],
  async execute(ctx, deps) {
    const { resolvedEdges } = deps.get('cross-file') as CrossFileOutput;
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;
    const allEdgesCombined: MonographEdge[] = [...allEdges, ...resolvedEdges];

    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    for (const e of allEdgesCombined) {
      outDeg.set(e.sourceId, (outDeg.get(e.sourceId) ?? 0) + 1);
      inDeg.set(e.targetId, (inDeg.get(e.targetId) ?? 0) + 1);
    }

    const godNodes: GodNode[] = symbolNodes
      .filter(n => !EXCLUDED_LABELS.has(n.label) && (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0) > 0)
      .map(n => ({
        ...n,
        inDegree: inDeg.get(n.id) ?? 0,
        outDegree: outDeg.get(n.id) ?? 0,
        degree: (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0),
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 20);

    return { godNodes };
  },
};
