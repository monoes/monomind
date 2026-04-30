import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
import { toNormLabel } from '../types.js';

export function insertNode(db: Database.Database, node: MonographNode): void {
  db.prepare(`
    INSERT OR REPLACE INTO nodes
      (id, label, name, norm_label, file_path, start_line, end_line,
       community_id, is_exported, language, properties)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id,
    node.label,
    node.name,
    node.normLabel ?? toNormLabel(node.name),
    node.filePath ?? null,
    node.startLine ?? null,
    node.endLine ?? null,
    node.communityId ?? null,
    node.isExported ? 1 : 0,
    node.language ?? null,
    node.properties ? JSON.stringify(node.properties) : null,
  );
}

export function insertNodes(db: Database.Database, nodes: MonographNode[]): void {
  const insertMany = db.transaction((rows: MonographNode[]) => {
    for (const n of rows) {
      insertNode(db, n);
    }
  });
  insertMany(nodes);
}

export function getNode(db: Database.Database, id: string): MonographNode | undefined {
  const row = db
    .prepare('SELECT * FROM nodes WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToNode(row) : undefined;
}

export function getNodesForFile(db: Database.Database, filePath: string): MonographNode[] {
  const rows = db
    .prepare('SELECT * FROM nodes WHERE file_path = ?')
    .all(filePath) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

export function deleteNodesForFile(db: Database.Database, filePath: string): void {
  db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
}

export function countNodes(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM nodes').get() as { n: number };
  return row.n;
}

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row.id as string,
    label: row.label as MonographNode['label'],
    name: row.name as string,
    normLabel: row.norm_label as string,
    filePath: row.file_path as string | undefined,
    startLine: row.start_line as number | undefined,
    endLine: row.end_line as number | undefined,
    communityId: row.community_id as number | undefined,
    isExported: (row.is_exported as number) === 1,
    language: row.language as string | undefined,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
  };
}
