import type { MonographNode, MonographEdge } from '../types.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Export nodes and edges to GEXF (Graph Exchange XML Format) string.
 *
 * GEXF is the format used by Gephi and similar graph visualization tools.
 *
 * @param nodes - Array of MonographNode objects
 * @param edges - Array of MonographEdge objects
 * @returns A GEXF XML string
 */
export function toGexf(nodes: MonographNode[], edges: MonographEdge[]): string {
  const nodeXml = nodes
    .map(n =>
      `    <node id="${esc(n.id)}" label="${esc(n.name)}">` +
      `<attvalues>` +
      `<attvalue for="0" value="${esc(n.label)}"/>` +
      `<attvalue for="1" value="${n.isExported ? 'true' : 'false'}"/>` +
      (n.filePath ? `<attvalue for="2" value="${esc(n.filePath)}"/>` : '') +
      `</attvalues>` +
      `</node>`
    )
    .join('\n');

  const edgeXml = edges
    .map(e =>
      `    <edge id="${esc(e.id)}" source="${esc(e.sourceId)}" target="${esc(e.targetId)}" label="${esc(e.relation)}" weight="${e.confidenceScore}"/>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://gexf.net/1.3" version="1.3">
  <meta>
    <creator>@monomind/monograph</creator>
    <description>Knowledge graph export</description>
  </meta>
  <graph defaultedgetype="directed">
    <attributes class="node">
      <attribute id="0" title="label" type="string"/>
      <attribute id="1" title="isExported" type="boolean"/>
      <attribute id="2" title="filePath" type="string"/>
    </attributes>
    <nodes>
${nodeXml}
    </nodes>
    <edges>
${edgeXml}
    </edges>
  </graph>
</gexf>`;
}
