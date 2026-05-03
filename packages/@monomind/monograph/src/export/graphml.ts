import type { MonographNode, MonographEdge } from '../types.js';

export function toGraphml(nodes: MonographNode[], edges: MonographEdge[]): string {
  const nodeXml = nodes
    .map(
      n =>
        `  <node id="${esc(n.id)}">` +
        `<data key="label">${esc(n.label)}</data>` +
        `<data key="name">${esc(n.name)}</data>` +
        `<data key="file">${esc(n.filePath ?? '')}</data>` +
        `<data key="exported">${n.isExported ? 'true' : 'false'}</data>` +
        `</node>`
    )
    .join('\n');

  const edgeXml = edges
    .map(
      e =>
        `  <edge id="${esc(e.id)}" source="${esc(e.sourceId)}" target="${esc(e.targetId)}">` +
        `<data key="relation">${esc(e.relation)}</data>` +
        `<data key="confidence">${esc(e.confidence)}</data>` +
        `</edge>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/graphml">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="name" for="node" attr.name="name" attr.type="string"/>
  <key id="file" for="node" attr.name="file" attr.type="string"/>
  <key id="exported" for="node" attr.name="exported" attr.type="boolean"/>
  <key id="relation" for="edge" attr.name="relation" attr.type="string"/>
  <key id="confidence" for="edge" attr.name="confidence" attr.type="string"/>
  <graph id="G" edgedefault="directed">
${nodeXml}
${edgeXml}
  </graph>
</graphml>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
