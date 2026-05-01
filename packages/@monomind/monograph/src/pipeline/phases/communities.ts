import louvain from 'graphology-communities-louvain';
import { leiden } from './leiden.js';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { loadGraphFromEdges } from '../../graph/loader.js';
import type { CrossFileOutput } from './cross-file.js';
import type { ParseOutput } from './parse.js';

export interface CommunitiesOutput {
  memberships: Map<string, number>;
  communityLabels: Map<number, string>;
  cohesionScores: Map<number, number>;
}

export function computeCohesion(
  communityId: number,
  memberships: Map<string, number>,
  edges: Array<{ sourceId: string; targetId: string }>,
): number {
  const members = [...memberships.entries()].filter(([, c]) => c === communityId).map(([id]) => id);
  const n = members.length;
  if (n <= 1) return 1;

  const memberSet = new Set(members);
  const maxEdges = (n * (n - 1)) / 2; // undirected: n*(n-1)/2
  if (maxEdges === 0) return 1;

  // Count unique undirected internal edges
  const seen = new Set<string>();
  let internalCount = 0;
  for (const e of edges) {
    if (memberSet.has(e.sourceId) && memberSet.has(e.targetId)) {
      const key = [e.sourceId, e.targetId].sort().join('\0');
      if (!seen.has(key)) {
        seen.add(key);
        internalCount++;
      }
    }
  }
  return internalCount / maxEdges;
}

export const communitiesPhase: PipelinePhase<CommunitiesOutput> = {
  name: 'communities',
  deps: ['parse', 'cross-file', 'mro'],
  async execute(_ctx, deps) {
    const { resolvedEdges } = deps.get('cross-file') as CrossFileOutput;
    const { allEdges } = deps.get('parse') as ParseOutput;
    const allUsedEdges: MonographEdge[] = [...allEdges, ...resolvedEdges];

    const graph = loadGraphFromEdges(allUsedEdges);
    let communities: Record<string, number> = {};
    try {
      communities = leiden(graph, { seed: 42 });
    } catch (e) {
      console.warn('[monograph] Leiden failed, falling back to Louvain:', e);
      try {
        communities = louvain(graph, { randomWalk: false });
      } catch {
        // Empty or disconnected graph
      }
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

    const communityIds = new Set([...memberships.values()]);
    const cohesionScores = new Map<number, number>();
    for (const cid of communityIds) {
      cohesionScores.set(cid, computeCohesion(cid, memberships, allUsedEdges));
    }

    return { memberships, communityLabels, cohesionScores };
  },
};
