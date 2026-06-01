import type { MonographNode, MonographEdge } from '../types.js';

export interface DotOptions {
  graphName?: string;
}

function escapeDotString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Export nodes and edges to Graphviz DOT format.
 *
 * @param nodes - Array of MonographNode objects
 * @param edges - Array of MonographEdge objects
 * @param options - Optional configuration (graphName)
 * @returns A DOT format string suitable for Graphviz
 */
export function toDot(
  nodes: MonographNode[],
  edges: MonographEdge[],
  options: DotOptions = {},
): string {
  const graphName = options.graphName ?? 'monograph';

  const nodeLines = nodes.map(n => {
    const label = escapeDotString(`${n.name}\\n[${n.label}]`);
    return `  "${escapeDotString(n.id)}" [label="${label}"];`;
  });

  const edgeLines = edges.map(e => {
    const src = escapeDotString(e.sourceId);
    const tgt = escapeDotString(e.targetId);
    const rel = escapeDotString(e.relation);
    return `  "${src}" -> "${tgt}" [label="${rel}"];`;
  });

  const lines = [
    `digraph ${graphName} {`,
    '  rankdir=LR;',
    '  node [shape=box, fontsize=10];',
    ...nodeLines,
    ...edgeLines,
    '}',
  ];

  return lines.join('\n');
}
