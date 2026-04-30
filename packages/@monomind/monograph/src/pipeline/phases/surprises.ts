import type { PipelinePhase, PipelineContext } from '../types.js';
import type { SurprisingConnection } from '../../types.js';
import type { ParseOutput } from './parse.js';
import type { CrossFileOutput } from './cross-file.js';
import type { CommunitiesOutput } from './communities.js';

const WEIGHTS = {
  confidence: 0.30,
  crossType: 0.20,
  crossRepo: 0.15,
  crossCommunity: 0.25,
  peripheral: 0.10,
};

export interface SurprisesOutput {
  surprises: SurprisingConnection[];
}

export const surprisesPhase: PipelinePhase<SurprisesOutput> = {
  name: 'surprises',
  deps: ['cross-file', 'communities', 'parse'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;
    const { resolvedEdges } = deps.get('cross-file') as CrossFileOutput;
    const { memberships } = deps.get('communities') as CommunitiesOutput;

    const edges = [...allEdges, ...resolvedEdges];
    const labelIndex = new Map(symbolNodes.map(n => [n.id, n.label]));
    const inDeg = new Map<string, number>();
    for (const e of edges) inDeg.set(e.targetId, (inDeg.get(e.targetId) ?? 0) + 1);
    const maxDeg = Math.max(...inDeg.values(), 1);
    const peripheralThreshold = maxDeg * 0.1;

    const surprises: SurprisingConnection[] = edges
      .filter(e => e.confidence !== 'EXTRACTED')
      .map(e => {
        const reasons: string[] = [];
        let score = 0;

        const conf = 1 - e.confidenceScore;
        score += WEIGHTS.confidence * conf;
        if (conf > 0) reasons.push(`${e.confidence} confidence`);

        const srcLabel = labelIndex.get(e.sourceId);
        const tgtLabel = labelIndex.get(e.targetId);
        if (srcLabel && tgtLabel && srcLabel !== tgtLabel) {
          score += WEIGHTS.crossType;
          reasons.push(`cross-type (${srcLabel}→${tgtLabel})`);
        }

        const srcComm = memberships.get(e.sourceId);
        const tgtComm = memberships.get(e.targetId);
        if (srcComm !== undefined && tgtComm !== undefined && srcComm !== tgtComm) {
          score += WEIGHTS.crossCommunity;
          reasons.push('cross-community');
        }

        if ((inDeg.get(e.targetId) ?? 0) < peripheralThreshold) {
          score += WEIGHTS.peripheral;
          reasons.push('peripheral target');
        }

        return { edge: e, score, reasons };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return { surprises };
  },
};
