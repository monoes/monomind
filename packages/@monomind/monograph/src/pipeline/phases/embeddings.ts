import type { PipelinePhase, PipelineContext } from '../types.js';
// buildEmbeddings is not yet in embedding-store; phase is a no-op until it's added
function buildEmbeddings(_db: unknown): void { /* placeholder */ }

export interface EmbeddingsOutput {
  embeddingsBuilt: number;
}

export const embeddingsPhase: PipelinePhase<EmbeddingsOutput> = {
  name: 'embeddings',
  deps: ['communities', 'docs-parse', 'pdf-parse', 'contextual-proximity', 'llm-extract'],
  async execute(ctx: PipelineContext) {
    buildEmbeddings(ctx.db);
    const row = ctx.db.prepare('SELECT COUNT(*) as n FROM nodes WHERE embedding IS NOT NULL').get() as { n: number };
    return { embeddingsBuilt: row.n };
  },
};
