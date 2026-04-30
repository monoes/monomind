/**
 * Batch-embed all symbol nodes that don't yet have an embedding stored.
 */

import type Database from 'better-sqlite3';
import type { EmbedderFn } from './embedder.js';
import { upsertEmbedding, countEmbeddings } from '../storage/embedding-store.js';
import { embedText } from './embedder.js';

const BATCH_SIZE = 32;

export interface EmbedAllResult {
  embedded: number;
  skipped: number;
}

/**
 * Embed all nodes that are missing embeddings.
 *
 * Nodes are fetched in batches of BATCH_SIZE to avoid loading the entire DB
 * into memory at once.
 *
 * @param db       - Open monograph database
 * @param embedder - Feature extraction pipeline function
 * @param force    - When true, re-embed nodes even if they already have an embedding
 */
const CODE_LABELS = new Set(['Function', 'Method', 'Class', 'Module', 'Interface', 'Enum', 'Struct', 'Constructor', 'Variable', 'Constant', 'Type']);

export async function embedAll(
  db: Database.Database,
  embedder: EmbedderFn,
  force = false,
  codeOnly = false,
): Promise<EmbedAllResult> {
  let embedded = 0;
  let skipped = 0;

  // Fetch all node IDs and their name+normLabel (used as the text to embed)
  const rows = db
    .prepare(
      `SELECT id, name, norm_label, label, file_path
       FROM nodes
       ORDER BY rowid`,
    )
    .all() as { id: string; name: string; norm_label: string; label: string; file_path: string | null }[];

  const filteredRows = codeOnly ? rows.filter((r) => CODE_LABELS.has(r.label)) : rows;

  // Build set of node IDs that already have embeddings
  const existingIds = force
    ? new Set<string>()
    : new Set(
        (
          db.prepare('SELECT node_id FROM embeddings').all() as { node_id: string }[]
        ).map((r) => r.node_id),
      );

  // Filter to only rows that need embedding
  const toEmbed = filteredRows.filter((r) => !existingIds.has(r.id));
  skipped = filteredRows.length - toEmbed.length;

  // Process in batches
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        const text = buildNodeText(row);
        try {
          const vector = await embedText(text, embedder);
          upsertEmbedding(db, row.id, vector);
          embedded++;
        } catch {
          // Skip nodes that fail to embed (e.g. empty name)
          skipped++;
        }
      }),
    );
  }

  return { embedded, skipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNodeText(row: {
  name: string;
  norm_label: string;
  label: string;
  file_path: string | null;
}): string {
  const parts: string[] = [row.name, row.label];
  if (row.norm_label && row.norm_label !== row.name) parts.push(row.norm_label);
  if (row.file_path) parts.push(row.file_path);
  return parts.join(' ');
}

export { countEmbeddings };
