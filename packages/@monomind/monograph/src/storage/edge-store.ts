import type Database from 'better-sqlite3';
import type { EvidenceEntry, MonographEdge } from '../types.js';

export function insertEdge(db: Database.Database, edge: MonographEdge): void {
  db.prepare(`
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id,
    edge.sourceId,
    edge.targetId,
    edge.relation,
    edge.confidence,
    edge.confidenceScore,
    edge.reason ?? null,
    edge.evidence != null ? JSON.stringify(edge.evidence) : null,
  );
}

const INSERT_EDGE_SQL = `
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

export function insertEdges(db: Database.Database, edges: MonographEdge[]): void {
  if (edges.length === 0) return;
  // Prepare once and reuse across all rows — avoids N redundant prepare calls
  const stmt = db.prepare(INSERT_EDGE_SQL);
  const insertMany = db.transaction((rows: MonographEdge[]) => {
    for (const e of rows) {
      stmt.run(
        e.id,
        e.sourceId,
        e.targetId,
        e.relation,
        e.confidence,
        e.confidenceScore,
        e.reason ?? null,
        e.evidence != null ? JSON.stringify(e.evidence) : null,
      );
    }
  });
  insertMany(edges);
}

/** Batch-fetch edges for multiple source IDs using a single SQL IN query. Batches at 50 IDs. */
export function getEdgesForSources(db: Database.Database, sourceIds: string[]): MonographEdge[] {
  if (sourceIds.length === 0) return [];
  const BATCH = 50;
  const results: MonographEdge[] = [];
  for (let i = 0; i < sourceIds.length; i += BATCH) {
    const chunk = sourceIds.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM edges WHERE source_id IN (${placeholders})`)
      .all(...chunk) as Record<string, unknown>[];
    for (const row of rows) results.push(rowToEdge(row));
  }
  return results;
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
    reason: row.reason as string | undefined,
    evidence: row.evidence ? JSON.parse(row.evidence as string) as EvidenceEntry[] : undefined,
  };
}
