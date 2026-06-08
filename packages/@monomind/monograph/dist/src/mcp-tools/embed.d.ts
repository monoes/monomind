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
export interface EmbedToolInput {
    codeOnly?: boolean;
    force?: boolean;
}
export interface EmbedToolResult {
    embedded: number;
    skipped: number;
    model: string;
}
/**
 * Run the embedding pipeline on the open database.
 * Exported so the CLI handler can call it after opening the DB.
 */
export declare function runEmbed(db: Database.Database, options?: EmbedToolInput): Promise<EmbedToolResult>;
//# sourceMappingURL=embed.d.ts.map