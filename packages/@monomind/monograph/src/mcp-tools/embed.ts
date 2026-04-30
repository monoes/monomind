/**
 * monograph_embed MCP tool
 *
 * Embeds all symbol nodes in the Monograph knowledge graph using
 * Snowflake/snowflake-arctic-embed-xs (384 dimensions).
 *
 * Requires @huggingface/transformers to be installed.
 * Returns { embedded, skipped, model } on success or an error message.
 */

import type Database from 'better-sqlite3';
import type { EmbedAllResult } from '../search/embed-batch.js';

export interface EmbedToolInput {
  codeOnly?: boolean;
  force?: boolean;
}

export interface EmbedToolResult {
  embedded: number;
  skipped: number;
  model: string;
}

const MODEL = 'Snowflake/snowflake-arctic-embed-xs';

/**
 * Run the embedding pipeline on the open database.
 * Exported so the CLI handler can call it after opening the DB.
 */
export async function runEmbed(
  db: Database.Database,
  options: EmbedToolInput = {},
): Promise<EmbedToolResult> {
  const { force = false, codeOnly = false } = options;

  let getEmbedder: () => Promise<unknown>;
  let embedAll: (db: Database.Database, embedder: unknown, force: boolean, codeOnly: boolean) => Promise<EmbedAllResult>;

  try {
    const embedderMod = await import('../search/embedder.js');
    const batchMod = await import('../search/embed-batch.js');
    getEmbedder = embedderMod.getEmbedder;
    embedAll = batchMod.embedAll as typeof embedAll;
  } catch {
    throw new Error(
      '@huggingface/transformers is required for embedding. ' +
        'Install it with: npm install @huggingface/transformers',
    );
  }

  const embedder = await getEmbedder();
  const result = await embedAll(db, embedder as Parameters<typeof embedAll>[1], force, codeOnly);

  return { ...result, model: MODEL };
}
