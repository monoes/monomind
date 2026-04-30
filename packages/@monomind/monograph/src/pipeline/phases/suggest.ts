import type { PipelinePhase, PipelineContext } from '../types.js';
import type { SuggestedQuestion } from '../../types.js';
import type { ParseOutput } from './parse.js';
import type { CommunitiesOutput } from './communities.js';

export interface SuggestOutput {
  questions: SuggestedQuestion[];
}

export const suggestPhase: PipelinePhase<SuggestOutput> = {
  name: 'suggest',
  deps: ['parse', 'cross-file', 'mro', 'communities', 'god-nodes', 'surprises'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;
    const { memberships } = deps.get('communities') as CommunitiesOutput;
    const questions: SuggestedQuestion[] = [];

    // Signal 1: ambiguous edges
    for (const edge of allEdges) {
      if (edge.confidence === 'AMBIGUOUS') {
        questions.push({ type: 'ambiguous_edge', edge, reason: 'Dynamic dispatch or unresolved target' });
      }
    }

    // Signal 2: bridge nodes
    const nodeCommSet = new Map<string, Set<number>>();
    for (const edge of allEdges) {
      const srcComm = memberships.get(edge.sourceId);
      const tgtComm = memberships.get(edge.targetId);
      if (srcComm !== undefined && tgtComm !== undefined && srcComm !== tgtComm) {
        for (const [nid, comm] of [[edge.sourceId, srcComm], [edge.targetId, tgtComm]] as const) {
          const s = nodeCommSet.get(nid) ?? new Set();
          s.add(comm);
          nodeCommSet.set(nid, s);
        }
      }
    }
    for (const [nodeId, comms] of nodeCommSet) {
      if (comms.size >= 2) {
        const node = symbolNodes.find(n => n.id === nodeId);
        if (!node) continue;
        const [commA, commB] = [...comms];
        questions.push({ type: 'bridge_node', node, commA, commB });
      }
    }

    // Signal 3: verify_inferred
    for (const edge of allEdges) {
      if (edge.confidence === 'INFERRED') {
        questions.push({ type: 'verify_inferred', edge, inferredFrom: 'type inference / alias resolution' });
      }
    }

    // Signal 4: isolated nodes
    const connectedIds = new Set<string>();
    for (const e of allEdges) { connectedIds.add(e.sourceId); connectedIds.add(e.targetId); }
    const isolated = symbolNodes.filter(n =>
      !connectedIds.has(n.id) && n.label !== 'File' && n.label !== 'Folder'
    );
    if (isolated.length > 0) {
      questions.push({ type: 'isolated_nodes', nodes: isolated.slice(0, 10), reason: 'No edges found' });
    }

    const PRIORITY: Record<string, number> = {
      bridge_node: 5, ambiguous_edge: 4, verify_inferred: 3, low_cohesion: 2, isolated_nodes: 1
    };
    questions.sort((a, b) => (PRIORITY[b.type] ?? 0) - (PRIORITY[a.type] ?? 0));

    return { questions };
  },
};
