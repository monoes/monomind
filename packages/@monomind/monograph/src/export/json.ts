import type { MonographNode, MonographEdge } from '../types.js';

export function toJson(nodes: MonographNode[], edges: MonographEdge[]): string {
  return JSON.stringify(
    {
      nodes: nodes.map(n => ({
        id: n.id,
        label: n.label,
        name: n.name,
        norm_label: n.normLabel,
        source_file: n.filePath ?? null,
        start_line: n.startLine ?? null,
        end_line: n.endLine ?? null,
        community: n.communityId ?? null,
        is_exported: n.isExported,
        language: n.language ?? null,
        properties: n.properties ?? null,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        relation: e.relation,
        confidence: e.confidence,
        confidence_score: e.confidenceScore,
      })),
      links: edges.map(e => ({
        source: e.sourceId,
        target: e.targetId,
        relation: e.relation,
      })),
    },
    null,
    2
  );
}
