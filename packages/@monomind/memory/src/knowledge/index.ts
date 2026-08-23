/**
 * Per-Agent Knowledge Base module.
 *
 * @module @monomind/memory/knowledge
 */

export type { TextChunk } from './document-chunker.js';
export { chunkDocument } from './document-chunker.js';
export type {
  KnowledgeExcerpt,
  RetrievalResult,
  SearchFn,
} from './knowledge-retriever.js';
export { KnowledgeRetriever } from './knowledge-retriever.js';
export type { ChunkRecord, MetadataRecord } from './knowledge-store.js';
export { KnowledgeStore } from './knowledge-store.js';
