/**
 * Flow Visualizer (Task 40)
 *
 * ASCII and DOT (Graphviz) renderers for communication flow edges.
 */

import type { FlowEdge } from '../../../shared/src/types/communication-flow.js';

/** Escape a slug for safe DOT identifier interpolation. */
function dotEscape(s: string): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Strip newlines/CR for safe ASCII line emission (log-injection defense). */
function asciiSafe(s: string): string {
  return String(s ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, '?');
}

/** Restrict graph names to a safe DOT identifier — graph_name must be an ID. */
function safeGraphName(name: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) ? name : 'swarm_flow';
}

const MAX_DISPLAY_EDGES = 500;

/**
 * Render edges as human-readable ASCII art.
 * Empty edges produce a single-line "unrestricted" notice.
 */
export function toAscii(edges: FlowEdge[], title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`=== ${asciiSafe(title)} ===`);
    lines.push('');
  }

  if (edges.length === 0) {
    lines.push('(unrestricted — all agents may communicate freely)');
    return lines.join('\n');
  }

  const capped = edges.slice(0, MAX_DISPLAY_EDGES);
  for (const [from, to] of capped) {
    lines.push(`  ${asciiSafe(from)} --> ${asciiSafe(to)}`);
  }
  if (edges.length > MAX_DISPLAY_EDGES) {
    lines.push(`  ... (${edges.length - MAX_DISPLAY_EDGES} more edges omitted)`);
  }

  return lines.join('\n');
}

/**
 * Render edges as a DOT language digraph (Graphviz compatible).
 * Slugs are escaped so a malicious slug cannot inject DOT attributes
 * (e.g., URL="javascript:..." would be rendered as a clickable link
 * by Graphviz's SVG output without escaping).
 */
export function toDOT(edges: FlowEdge[], graphName?: string): string {
  const name = safeGraphName(graphName ?? 'swarm_flow');
  const lines: string[] = [];

  lines.push(`digraph ${name} {`);
  lines.push('  rankdir=LR;');

  if (edges.length === 0) {
    lines.push('  // unrestricted — no explicit edges');
  } else {
    const capped = edges.slice(0, MAX_DISPLAY_EDGES);
    for (const [from, to] of capped) {
      lines.push(`  "${dotEscape(from)}" -> "${dotEscape(to)}";`);
    }
    if (edges.length > MAX_DISPLAY_EDGES) {
      lines.push(`  // ... (${edges.length - MAX_DISPLAY_EDGES} more edges omitted)`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}
