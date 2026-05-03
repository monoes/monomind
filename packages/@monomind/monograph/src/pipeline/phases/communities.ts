import louvain from 'graphology-communities-louvain';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { loadGraphFromEdges } from '../../graph/loader.js';
import type { CrossFileOutput } from './cross-file.js';
import type { ParseOutput } from './parse.js';

export interface CommunitiesOutput {
  memberships: Map<string, number>;
  communityLabels: Map<number, string>;
}

export const communitiesPhase: PipelinePhase<CommunitiesOutput> = {
  name: 'communities',
  deps: ['cross-file', 'mro'],
  async execute(_ctx, deps) {
    const { resolvedEdges } = deps.get('cross-file') as CrossFileOutput;
    const { allEdges } = deps.get('parse') as ParseOutput;
    const allUsedEdges: MonographEdge[] = [...allEdges, ...resolvedEdges];

    const graph = loadGraphFromEdges(allUsedEdges);
    let communities: Record<string, number> = {};
    try {
      communities = louvain(graph);
    } catch {
      // Empty or disconnected graph
    }

    const memberships = new Map<string, number>(Object.entries(communities).map(([k, v]) => [k, v]));
    const communityLabels = new Map<number, string>();

    const communityDegrees = new Map<number, Map<string, number>>();
    for (const [nodeId, commId] of memberships) {
      if (!communityDegrees.has(commId)) communityDegrees.set(commId, new Map());
      const deg = graph.degree(nodeId) ?? 0;
      communityDegrees.get(commId)!.set(nodeId, deg);
    }
    for (const [commId, nodeDegs] of communityDegrees) {
      const topNode = [...nodeDegs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      communityLabels.set(commId, `community-${commId}(${topNode.slice(0, 20)})`);
    }

    return { memberships, communityLabels };
  },
};
