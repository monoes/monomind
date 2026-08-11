import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
import { rowToNode } from '../storage/node-store.js';

export interface ExplainResult {
  node: MonographNode | null;
  explanation: string | null;
  connectionCount: number;
}

export function explainNode(db: Database.Database, name: string): ExplainResult {
  const nodeRow = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(name) as
    | Record<string, unknown>
    | undefined;
  if (!nodeRow) return { node: null, explanation: null, connectionCount: 0 };

  const node = rowToNode(nodeRow);

  // Get outbound connections
  const outRows = db
    .prepare(
      `SELECT n.name, e.relation FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 10`,
    )
    .all(node.id) as { name: string; relation: string }[];

  // Get inbound connections
  const inRows = db
    .prepare(
      `SELECT n.name, e.relation FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? LIMIT 10`,
    )
    .all(node.id) as { name: string; relation: string }[];

  const connectionCount = outRows.length + inRows.length;
  const fileRef = node.filePath
    ? node.startLine != null
      ? `${node.filePath}:${node.startLine}`
      : node.filePath
    : null;
  const fileLine = fileRef ? ` defined in \`${fileRef}\`` : '';

  let explanation = `**${node.name}** is a ${node.label}${fileLine}.`;

  if (outRows.length > 0) {
    const outList = outRows.map((r) => `\`${r.name}\` (${r.relation})`).join(', ');
    explanation += ` It connects to: ${outList}.`;
  }

  if (inRows.length > 0) {
    const inList = inRows
      .map((r) => `\`${r.name}\``)
      .slice(0, 5)
      .join(', ');
    explanation += ` Referenced by: ${inList}.`;
  }

  if (node.communityId != null) {
    explanation += ` Part of community ${node.communityId}.`;
  }

  return { node, explanation, connectionCount };
}
