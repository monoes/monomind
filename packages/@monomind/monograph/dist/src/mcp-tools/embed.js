/**
 * monograph_embed MCP tool
 *
 * Embeds all symbol nodes in the Monograph knowledge graph using
 * Snowflake/snowflake-arctic-embed-xs (384 dimensions).
 *
 * Requires @huggingface/transformers to be installed.
 * Returns { embedded, skipped, model } on success or an error message.
 */
const MODEL = 'Snowflake/snowflake-arctic-embed-xs';
/**
 * Run the embedding pipeline on the open database.
 * Exported so the CLI handler can call it after opening the DB.
 */
export async function runEmbed(db, options = {}) {
    const { force = false, codeOnly = false } = options;
    let getEmbedder;
    let embedAll;
    try {
        const embedderMod = await import('../search/embedder.js');
        const batchMod = await import('../search/embed-batch.js');
        getEmbedder = embedderMod.getEmbedder;
        embedAll = batchMod.embedAll;
    }
    catch {
        throw new Error('@huggingface/transformers is required for embedding. ' +
            'Install it with: npm install @huggingface/transformers');
    }
    const embedder = await getEmbedder();
    const result = await embedAll(db, embedder, force, codeOnly);
    return { ...result, model: MODEL };
}
//# sourceMappingURL=embed.js.map