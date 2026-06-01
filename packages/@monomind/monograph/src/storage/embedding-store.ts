import type Database from 'better-sqlite3';

/**
 * CRUD operations for the embeddings table.
 *
 * Vectors are stored as BLOBs (raw Float32Array bytes) and reconstructed on read.
 */

export function upsertEmbedding(
  db: Database.Database,
  nodeId: string,
  vector: Float32Array,
  contentHash?: string,
): void {
  // Migrate existing DBs that may not have the content_hash column yet.
  try {
    db.exec('ALTER TABLE embeddings ADD COLUMN content_hash TEXT');
  } catch {
    // Column already exists — ignore.
  }
  const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db
    .prepare(
      'INSERT OR REPLACE INTO embeddings (node_id, vector, content_hash) VALUES (?, ?, ?)',
    )
    .run(nodeId, buf, contentHash ?? null);
}

export function getEmbeddingContentHash(db: Database.Database, nodeId: string): string | null {
  const row = db
    .prepare('SELECT content_hash FROM embeddings WHERE node_id = ?')
    .get(nodeId) as { content_hash: string | null } | undefined;
  return row?.content_hash ?? null;
}

export function isEmbeddingStale(
  db: Database.Database,
  nodeId: string,
  currentHash: string,
): boolean {
  const stored = getEmbeddingContentHash(db, nodeId);
  return stored !== currentHash;
}

export function getEmbedding(db: Database.Database, nodeId: string): Float32Array | null {
  const row = db.prepare('SELECT vector FROM embeddings WHERE node_id = ?').get(nodeId) as
    | { vector: Buffer }
    | undefined;
  if (!row) return null;
  return bufToFloat32(row.vector);
}

export function getAllEmbeddings(db: Database.Database): Map<string, Float32Array> {
  const rows = db.prepare('SELECT node_id, vector FROM embeddings').all() as {
    node_id: string;
    vector: Buffer;
  }[];
  const result = new Map<string, Float32Array>();
  for (const row of rows) {
    result.set(row.node_id, bufToFloat32(row.vector));
  }
  return result;
}

export function countEmbeddings(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number };
  return row.n;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function bufToFloat32(buf: Buffer): Float32Array {
  // Copy to a fresh ArrayBuffer so slice offset doesn't cause issues
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}
