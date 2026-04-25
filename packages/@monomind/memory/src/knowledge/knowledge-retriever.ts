/**
 * Knowledge retriever for per-agent knowledge base.
 *
 * Queries shared and agent-private partitions, deduplicates, and formats
 * excerpts as context for downstream LLM consumption.
 *
 * @module @monobrain/memory/knowledge/knowledge-retriever
 */

import type { KnowledgeStore } from './knowledge-store.js';

/** A single excerpt returned from retrieval. */
export interface KnowledgeExcerpt {
  chunkId: string;
  filePath: string;
  scope: string;
  text: string;
  similarity: number;
  chunkIndex: number;
}

/** Combined retrieval result with formatted context. */
export interface RetrievalResult {
  excerpts: KnowledgeExcerpt[];
  formattedContext: string;
}

/**
 * Signature for the vector search function injected into the retriever.
 */
export type SearchFn = (
  query: string,
  options: { namespace: string; limit: number; minScore: number },
) => Promise<
  Array<{
    key: string;
    value: string;
    score: number;
    metadata: Record<string, unknown>;
  }>
>;

const DEFAULT_MAX_CHUNKS = 10;
const DEFAULT_MIN_SCORE = 0.3;

export class KnowledgeRetriever {
  private readonly searchFn: SearchFn;
  private readonly store: KnowledgeStore;

  constructor(searchFn: SearchFn, store: KnowledgeStore) {
    this.searchFn = searchFn;
    this.store = store;
  }

  /**
   * Retrieve relevant knowledge excerpts for a task, merging shared and
   * agent-private partitions.
   */
  async retrieveForTask(
    agentSlug: string,
    query: string,
    maxChunks: number = DEFAULT_MAX_CHUNKS,
  ): Promise<RetrievalResult> {
    const halfLimit = Math.max(1, Math.ceil(maxChunks / 2));

    const sharedNamespace = this.store.getPartitionNamespace('shared');
    const privateNamespace = this.store.getPartitionNamespace(agentSlug);

    // Query both partitions concurrently
    const [sharedResults, privateResults] = await Promise.all([
      this.searchFn(query, {
        namespace: sharedNamespace,
        limit: halfLimit,
        minScore: DEFAULT_MIN_SCORE,
      }),
      this.searchFn(query, {
        namespace: privateNamespace,
        limit: halfLimit,
        minScore: DEFAULT_MIN_SCORE,
      }),
    ]);

    // Map raw results to excerpts
    const toExcerpt = (
      r: { key: string; value: string; score: number; metadata: Record<string, unknown> },
      scope: string,
    ): KnowledgeExcerpt => ({
      chunkId: r.key,
      filePath: (r.metadata.filePath as string) ?? '',
      scope,
      text: r.value,
      similarity: r.score,
      chunkIndex: (r.metadata.chunkIndex as number) ?? 0,
    });

    const allExcerpts: KnowledgeExcerpt[] = [
      ...sharedResults.map((r) => toExcerpt(r, 'shared')),
      ...privateResults.map((r) => toExcerpt(r, agentSlug)),
    ];

    // Deduplicate by chunkId (keep higher similarity)
    const seen = new Map<string, KnowledgeExcerpt>();
    for (const ex of allExcerpts) {
      const existing = seen.get(ex.chunkId);
      if (!existing || ex.similarity > existing.similarity) {
        seen.set(ex.chunkId, ex);
      }
    }

    // Sort descending by similarity, then cap at maxChunks
    const excerpts = [...seen.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxChunks);

    const formattedContext = this.formatContext(excerpts);

    return { excerpts, formattedContext };
  }

  private formatContext(excerpts: KnowledgeExcerpt[]): string {
    if (excerpts.length === 0) {
      return '';
    }

    const lines: string[] = ['## Relevant Knowledge Base Excerpts', ''];
    excerpts.forEach((ex, i) => {
      lines.push(
        `${i + 1}. **[${ex.scope}] ${ex.filePath}** (similarity: ${ex.similarity.toFixed(2)})`,
      );
      lines.push(ex.text);
      lines.push('');
    });

    return lines.join('\n');
  }
}
