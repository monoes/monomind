import type { PipelinePhase, PipelineContext } from '../types.js';
import type { ParseOutput } from './parse.js';
import type { CrossFileOutput } from './cross-file.js';
import { synthesizeWildcardImports } from './wildcard-synthesis.js';
import type { MonographNode, MonographEdge } from '../../types.js';

export interface WildcardSynthesisOutput {
  synthesizedCount: number;
}

export const wildcardSynthesisPhase: PipelinePhase<WildcardSynthesisOutput> = {
  name: 'wildcard-synthesis',
  deps: ['parse', 'cross-file'],
  async execute(ctx: PipelineContext, deps: Map<string, unknown>): Promise<WildcardSynthesisOutput> {
    const { symbolNodes: allNodes, allEdges, fileContents } = deps.get('parse') as ParseOutput;
    const { resolvedEdges } = deps.get('cross-file') as CrossFileOutput;

    const allKnownEdges: MonographEdge[] = [...allEdges, ...resolvedEdges];
    const allKnownNodes: MonographNode[] = allNodes;

    let synthesizedCount = 0;

    const fileNodeIndex = new Map<string, string>();
    for (const node of allKnownNodes) {
      if (node.filePath) fileNodeIndex.set(node.filePath, node.id);
    }

    const stmt = ctx.db.prepare(`
      INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [filePath, source] of fileContents) {
      const fileNodeId = fileNodeIndex.get(filePath) ?? `file:${filePath}`;
      const { synthesizedEdges } = synthesizeWildcardImports(fileNodeId, source, allKnownNodes, allKnownEdges);

      for (const edge of synthesizedEdges) {
        stmt.run(edge.id, edge.sourceId, edge.targetId, edge.relation, edge.confidence, edge.confidenceScore);
        synthesizedCount++;
      }
    }

    return { synthesizedCount };
  },
};
