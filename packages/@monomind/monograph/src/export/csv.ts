import type { MonographNode, MonographEdge } from '../types.js';

export interface CsvExport {
  nodes: string;
  edges: string;
}

function escape(v: string | number | boolean | undefined | null): string {
  const s = String(v ?? '');
  // Prefix formula-injection characters to prevent spreadsheet execution
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return safe.includes(',') || safe.includes('"') || safe.includes('\n')
    ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(nodes: MonographNode[], edges: MonographEdge[]): CsvExport {
  const nodeHeader = 'id,label,name,filePath,isExported,startLine,endLine';
  const nodeRows = nodes.map(n =>
    [n.id, n.label, n.name, n.filePath ?? '', n.isExported, n.startLine ?? '', n.endLine ?? '']
      .map(escape).join(',')
  );

  const edgeHeader = 'id,sourceId,targetId,relation,confidence,confidenceScore';
  const edgeRows = edges.map(e =>
    [e.id, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore]
      .map(escape).join(',')
  );

  return {
    nodes: [nodeHeader, ...nodeRows].join('\n'),
    edges: [edgeHeader, ...edgeRows].join('\n'),
  };
}
