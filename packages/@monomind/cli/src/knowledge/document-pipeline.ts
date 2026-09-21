/**
 * Document Pipeline — the Second Brain's end-to-end ingest/search/export path,
 * and the single import point for it.
 *
 * The implementation lives in focused modules; this file is the public surface
 * every caller (CLI commands, MCP tools, the dashboard, the eval harness)
 * imports from, so the map is here:
 *
 *  - `document-types.ts`    the shapes: IngestResult, KnowledgeExcerpt,
 *                           DocumentMeta, ReconcileReport.
 *  - `document-store.ts`    which store a scope writes to, and the lazy memory
 *                           bridge that reaches it.
 *  - `document-chunking.ts` text → heading-anchored, context-enriched chunks
 *                           (and the spans that make one citable).
 *  - `document-index.ts`    the append-only metadata log: versions,
 *                           tombstones, lookups, superseded filtering,
 *                           filesystem reconciliation.
 *  - `document-ingest.ts`   file → extracted → chunked → stored → committed.
 *  - `document-search.ts`   query → live chunks, decorated for citation.
 *  - `okf-bundle.ts`        export to / import from a portable OKF bundle.
 *
 * @module v1/cli/knowledge/document-pipeline
 */

export { chunkSpans } from './document-chunking.js';
export {
  findDocumentRecord,
  hasKnowledgeMetadata,
  isResourceFork,
  isSupersededKey,
  listDocuments,
  listDocumentVersions,
  liveContentHashes,
  reconcileIndex,
  removeDocument,
  supersededOverfetchLimit,
} from './document-index.js';
export { ingestDirectory, ingestDocument } from './document-ingest.js';
export { searchKnowledge } from './document-search.js';
export { getKnowledgeRoot } from './document-store.js';
export type {
  BatchIngestResult,
  DocumentMeta,
  IngestResult,
  KnowledgeExcerpt,
  ReconcileReport,
} from './document-types.js';
export { exportToOKF, importFromOKF } from './okf-bundle.js';
