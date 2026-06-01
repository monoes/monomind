import type Database from 'better-sqlite3';

export interface ExactSearchResult {
  id: string;
  score: number;
}

export interface ExactSearchOptions {
  limit?: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function exactVectorSearch(
  db: Database.Database,
  queryVector: Float32Array,
  options: ExactSearchOptions = {},
): ExactSearchResult[] {
  const { limit = 10 } = options;

  const rows = db.prepare(`
    SELECT e.node_id as id, e.vector FROM embeddings e
    INNER JOIN nodes n ON n.id = e.node_id
  `).all() as { id: string; vector: Buffer }[];

  if (rows.length === 0) return [];

  return rows
    .map(row => {
      const vec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
      return { id: row.id, score: cosineSimilarity(queryVector, vec) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
