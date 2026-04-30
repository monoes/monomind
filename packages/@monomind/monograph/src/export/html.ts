import type { MonographNode, MonographEdge } from '../types.js';

const MAX_NODES = 5000;

export function toHtml(nodes: MonographNode[], edges: MonographEdge[]): string {
  const visNodes = nodes.slice(0, MAX_NODES).map(n => ({
    id: n.id,
    label: n.name,
    title: `${n.label} in ${n.filePath ?? '?'}`,
    group: n.communityId ?? 0,
  }));

  const visEdges = edges
    .filter(
      e =>
        visNodes.some(n => n.id === e.sourceId) && visNodes.some(n => n.id === e.targetId)
    )
    .map(e => ({
      from: e.sourceId,
      to: e.targetId,
      title: e.relation,
    }));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Monograph</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #graph { width: 100vw; height: 100vh; }
    #search { position: fixed; top: 10px; left: 10px; z-index: 10; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
    #info { position: fixed; top: 10px; right: 10px; z-index: 10; background: rgba(255,255,255,0.9); padding: 10px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <input id="search" placeholder="Search nodes..." oninput="filterNodes(this.value)">
  <div id="info">Nodes: <span id="nodeCount">${visNodes.length}</span> | Edges: <span id="edgeCount">${visEdges.length}</span></div>
  <div id="graph"><\/div>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(visNodes)});
    const edges = new vis.DataSet(${JSON.stringify(visEdges)});
    const network = new vis.Network(document.getElementById('graph'), { nodes, edges }, {
      physics: { enabled: true, stabilization: { iterations: 100 } },
      interaction: { hover: true },
    });
    function filterNodes(q) {
      const originalNodes = ${JSON.stringify(visNodes)};
      if (!q) {
        nodes.update(originalNodes);
      } else {
        const lowerQ = q.toLowerCase();
        nodes.update(originalNodes.map(n => ({...n, hidden: !n.label.toLowerCase().includes(lowerQ)})));
      }
    }
  <\/script>
</body>
</html>`;
}
