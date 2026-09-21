/**
 * Document Pipeline — the public vocabulary: what an ingest reports, what a
 * search returns, and what the index records about a document.
 *
 * Split out of document-pipeline.ts so the pipeline's modules can share these
 * shapes without importing each other's implementations. Re-exported from
 * `document-pipeline.js`, which stays the public entry point.
 *
 * @module v1/cli/knowledge/document-types
 */

import type { CaptureProvenance } from './capture-envelope.js';

export interface IngestResult {
  filePath: string;
  chunksIndexed: number;
  scope: string;
  skipped: boolean;
  error?: string;
  /** True when SOME but not all chunks stored. The new version was NOT
   *  committed: the document keeps whatever version it had before (possibly
   *  none), and re-ingesting repairs it. Absent means the ingest was complete —
   *  a caller must not read `chunksIndexed > 0` alone as success. */
  partial?: boolean;
  /** RCL-06: the document was already indexed at this exact extracted-text
   *  hash, so nothing was written. Reported as "unchanged" rather than as a
   *  skip with an error, because nothing went wrong. */
  unchanged?: boolean;
  /** RCL-06: 1 for a first ingest, incremented for each stored revision. */
  version?: number;
  /** RCL-06: contentHash of the version this one replaced, when there was one. */
  supersedes?: string;
  /** RCL-07: provenance read from the capture envelope's `meta.json`. */
  provenance?: CaptureProvenance;
  /** RCL-04: the envelope's `highlights.json`, stored as notes against this
   *  document. Absent when the capture carried none. `stored < found` means
   *  some notes did not land — the DOCUMENT is still fully indexed. */
  highlights?: { found: number; stored: number; anchored: number; error?: string };
}

export interface BatchIngestResult {
  filesProcessed: number;
  filesSkipped: number;
  totalChunks: number;
  errors: string[];
  results: IngestResult[];
}

export interface KnowledgeExcerpt {
  /** Memory entry id — pass back to memory_feedback/bridgeApplyFeedback to rate usefulness. */
  id: string;
  filePath: string;
  text: string;
  similarity: number;
  chunkIndex: number;
  scope: string;
  /** True when this chunk belongs to a document version that has since been
   *  re-ingested (its contentHash is no longer the file's current one). Only
   *  ever set when the caller opted into `includeSuperseded`. */
  superseded?: boolean;
  /** RCL-07: capture provenance, when the document came from a capture
   *  envelope — this is what lets a result cite the page it came from
   *  instead of a path under `~/.monomind/inbox`. */
  provenance?: CaptureProvenance;
  /** RCL-10: the chunk's character span against the extracted text. Absent
   *  for chunks stored before span tags existed — re-ingest to get them. */
  startChar?: number;
  endChar?: number;
  /** RCL-10: `<hash12>#<start>-<end>`, resolvable with `monomind doc cite`. */
  anchor?: string;
}

export interface DocumentMeta {
  filePath: string;
  contentHash: string;
  chunkCount: number;
  indexedAt: string;
  scope: string;
  size: number;
  /** RCL-06: identity URL for a captured page (`canonicalUrl`, else `url`,
   *  fragment stripped). Absent for ordinary files on disk. */
  canonicalUrl?: string;
  /** RCL-06: 1 for a first ingest, +1 per stored revision. */
  version?: number;
  /** RCL-06: contentHash of the version this record replaced. Walk it back
   *  through `listDocumentVersions` to reach the older ones. */
  supersedes?: string;
  /** RCL-07: the capture envelope's `meta.json`, normalized. */
  provenance?: CaptureProvenance;
}

export interface ReconcileReport {
  /** Indexed documents whose source file is no longer on disk. */
  missing: DocumentMeta[];
  /** Total index entries examined. */
  scanned: number;
  /** False for a dry run — the default. */
  applied: boolean;
  /** Entries actually tombstoned. Always 0 when `applied` is false. */
  removed: number;
  /** Where removed records were archived, when anything was removed. */
  archivePath?: string;
}
