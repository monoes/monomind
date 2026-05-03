import type { MonographNode, MonographEdge } from '../types.js';

export function toCanvas(nodes: MonographNode[], edges: MonographEdge[]): string {
  const canvasNodes = nodes.map((n, i) => ({
    id: n.id,
    type: 'text',
    text: `**${n.label}**\n${n.name}`,
    x: (i % 20) * 200,
    y: Math.floor(i / 20) * 120,
    width: 180,
    height: 80,
    color: labelColor(n.label),
  }));

  const canvasEdges = edges.map(e => ({
    id: e.id,
    fromNode: e.sourceId,
    toNode: e.targetId,
    label: e.relation,
    color: confidenceColor(e.confidence),
  }));

  return JSON.stringify({ nodes: canvasNodes, edges: canvasEdges }, null, 2);
}

function labelColor(label: string): string {
  const map: Record<string, string> = {
    Class: '1',
    Function: '2',
    Interface: '3',
    Module: '4',
    Namespace: '5',
    Method: '6',
  };
  return map[label] ?? '6';
}

function confidenceColor(c: string): string {
  if (c === 'EXTRACTED') return '#22c55e';
  if (c === 'INFERRED') return '#f59e0b';
  return '#ef4444';
}
