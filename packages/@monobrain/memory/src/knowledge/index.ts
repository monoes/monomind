/**
 * Per-Agent Knowledge Base module.
 *
 * @module @monobrain/memory/knowledge
 */

export { chunkDocument } from './document-chunker.js';
export type { TextChunk } from './document-chunker.js';

export { KnowledgeStore } from './knowledge-store.js';
export type { MetadataRecord, ChunkRecord } from './knowledge-store.js';

export { KnowledgeRetriever } from './knowledge-retriever.js';
export type {
  KnowledgeExcerpt,
  RetrievalResult,
  SearchFn,
} from './knowledge-retriever.js';
