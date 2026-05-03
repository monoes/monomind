import type Database from 'better-sqlite3';
import type { MonographEdge } from '../types.js';

export function insertEdge(db: Database.Database, edge: MonographEdge): void {
  db.prepare(`
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id,
    edge.sourceId,
    edge.targetId,
    edge.relation,
    edge.confidence,
    edge.confidenceScore,
    edge.weight ?? 1.0,
  );
}

export function insertEdges(db: Database.Database, edges: MonographEdge[]): void {
  const insertMany = db.transaction((rows: MonographEdge[]) => {
    for (const e of rows) {
      insertEdge(db, e);
    }
  });
  insertMany(edges);
}

export function getEdgesForSource(db: Database.Database, sourceId: string): MonographEdge[] {
  const rows = db
    .prepare('SELECT * FROM edges WHERE source_id = ?')
    .all(sourceId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

export function getEdgesForTarget(db: Database.Database, targetId: string): MonographEdge[] {
  const rows = db
    .prepare('SELECT * FROM edges WHERE target_id = ?')
    .all(targetId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

export function deleteEdgesForFile(db: Database.Database, filePath: string): void {
  db.prepare(`
    DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)
  `).run(filePath);
}

export function countEdges(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number };
  return row.n;
}

function rowToEdge(row: Record<string, unknown>): MonographEdge {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    relation: row.relation as MonographEdge['relation'],
    confidence: row.confidence as MonographEdge['confidence'],
    confidenceScore: row.confidence_score as number,
    weight: (row.weight as number | undefined) ?? 1.0,
  };
}
