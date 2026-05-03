import type { MonographNode, MonographEdge } from '../types.js';

const W = 1200;
const H = 800;

export function toSvg(nodes: MonographNode[], edges: MonographEdge[]): string {
  const positions = forceLayout(nodes.slice(0, 200));

  const edgeSvg = edges
    .filter(e => positions.has(e.sourceId) && positions.has(e.targetId))
    .map(e => {
      const s = positions.get(e.sourceId)!;
      const t = positions.get(e.targetId)!;
      return `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" stroke="#94a3b8" stroke-width="1" opacity="0.5"/>`;
    })
    .join('\n');

  const COMMUNITY_COLORS = [
    '#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6',
    '#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16',
  ];
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }

  const nodeSvg = [...positions.entries()]
    .map(([id, pos]) => {
      const node = nodes.find(n => n.id === id);
      const label = node?.name ?? id;
      const deg = degree.get(id) ?? 0;
      const r = Math.max(4, Math.min(16, 4 + deg));
      const color = COMMUNITY_COLORS[(node?.communityId ?? 0) % COMMUNITY_COLORS.length];
      return (
        `<circle cx="${pos.x}" cy="${pos.y}" r="${r}" fill="${color}" stroke="#1e293b" stroke-width="0.5" opacity="0.85"/>` +
        `<text x="${pos.x + r + 2}" y="${pos.y + 4}" font-size="10" fill="#1e293b">${sanitizeLabel(label)}</text>`
      );
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<style>
  text { font-family: system-ui, -apple-system, sans-serif; user-select: none; }
</style>
</defs>
<rect width="${W}" height="${H}" fill="#f8fafc"/>
${edgeSvg}
${nodeSvg}
</svg>`;
}

function forceLayout(nodes: MonographNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI;
    positions.set(n.id, {
      x: W / 2 + Math.cos(angle) * (W * 0.35),
      y: H / 2 + Math.sin(angle) * (H * 0.35),
    });
  });
  return positions;
}

function sanitizeLabel(s: string): string {
  return s.substring(0, 20).replace(/[&<>"']/g, '_');
}
