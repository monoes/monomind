// buildEmbeddings is not yet in embedding-store; phase is a no-op until it's added
function buildEmbeddings(_db) { }
export const embeddingsPhase = {
    name: 'embeddings',
    deps: ['communities', 'docs-parse', 'pdf-parse', 'contextual-proximity', 'llm-extract'],
    async execute(ctx) {
        buildEmbeddings(ctx.db);
        const row = ctx.db.prepare('SELECT COUNT(*) as n FROM nodes WHERE embedding IS NOT NULL').get();
        return { embeddingsBuilt: row.n };
    },
};
//# sourceMappingURL=embeddings.js.map