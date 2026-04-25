/**
 * Flow Visualizer (Task 40)
 *
 * ASCII and DOT (Graphviz) renderers for communication flow edges.
 */

import type { FlowEdge } from '../../../shared/src/types/communication-flow.js';

/**
 * Render edges as human-readable ASCII art.
 * Empty edges produce a single-line "unrestricted" notice.
 */
export function toAscii(edges: FlowEdge[], title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`=== ${title} ===`);
    lines.push('');
  }

  if (edges.length === 0) {
    lines.push('(unrestricted — all agents may communicate freely)');
    return lines.join('\n');
  }

  for (const [from, to] of edges) {
    lines.push(`  ${from} --> ${to}`);
  }

  return lines.join('\n');
}

/**
 * Render edges as a DOT language digraph (Graphviz compatible).
 */
export function toDOT(edges: FlowEdge[], graphName?: string): string {
  const name = graphName ?? 'swarm_flow';
  const lines: string[] = [];

  lines.push(`digraph ${name} {`);
  lines.push('  rankdir=LR;');

  if (edges.length === 0) {
    lines.push('  // unrestricted — no explicit edges');
  } else {
    for (const [from, to] of edges) {
      lines.push(`  "${from}" -> "${to}";`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}
