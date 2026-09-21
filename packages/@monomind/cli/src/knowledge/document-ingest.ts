/**
 * Document ingest — the write side of the pipeline: a file on disk (or a
 * capture envelope) becomes an indexed, versioned, searchable document.
 *
 * One pass per document: guard the input, resolve the capture envelope's
 * identity, extract and hash the text, chunk and enrich it, store every chunk,
 * and only then commit the version record. An incomplete store commits
 * nothing, which is what makes a re-ingest repair it.
 *
 * Split out of document-pipeline.ts.
 *
 * @module v1/cli/knowledge/document-ingest
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DOC_EXTENSIONS, extractText } from '../capabilities/cap-documents.js';
import type { FileEntry } from '../capabilities/types.js';
// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import {
  captureIdentityUrl,
  ENVELOPE_DOCUMENTS,
  ENVELOPE_READABLE_FILE,
  envelopePrimaryDocument,
  readCaptureProvenance,
} from './capture-envelope.js';
import { spanTag } from './citation.js';
import { chunkDocument, enrichChunks, type TextChunk } from './document-chunking.js';
import {
  appendMetadata,
  createMetadataCache,
  isResourceFork,
  type MetadataCache,
  removeMetadataEntry,
} from './document-index.js';
import { contentHash, effectiveRoot, getBridge, namespace, storeDbPath } from './document-store.js';
import type { BatchIngestResult, IngestResult } from './document-types.js';
import { captureScope } from './profile-store.js';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.monomind',
  '.claude',
  '.next',
  '__pycache__',
  '.venv',
  'vendor',
]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/** @internal — shared with okf-bundle, which extracts text the same way. */
export function toFileEntry(filePath: string): FileEntry {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    absolutePath: path.resolve(filePath),
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    modified: stat.mtime,
    created: stat.birthtime,
  };
}

export async function ingestDocument(
  filePath: string,
  scope = 'shared',
  rootDir = getProjectRoot(),
  _metadataCache?: MetadataCache,
): Promise<IngestResult> {
  // Both are reassigned once, by the capture-envelope redirect below: an
  // archived `page.html` IS its envelope's `readable.md` as far as indexing is
  // concerned, so that is the path and the extension the rest of this function
  // works with.
  let resolved = path.resolve(filePath);
  let ext = path.extname(resolved).toLowerCase();

  // AppleDouble resource forks (`._name.md`) are binary macOS sidecars, not
  // documents. The directory walk has skipped dotfiles since 3e429194
  // (2026-07-19), but that walk is only ONE of six callers that reach this
  // function — the CLI `doc ingest`, the MCP `knowledge_ingest` tool, the
  // dashboard's live fs.watch and its polling sweep, the eval harness, and
  // `ingestDirectory` all land here, and four of them had no guard at all.
  //
  // Guarding at the boundary covers every caller at once, including callers
  // added later. Guarding at each call site covers only the ones we thought to
  // enumerate — which is how two `._` files reached the live index despite a
  // working guard in the walk.
  //
  // Measured on this repo 2026-07-28: 96 `._` entries in the live index, 91 of
  // them shadowing a real document of the same name and competing with it for
  // top-k slots. That is a direct Recall@5/MRR@10 loss, not wasted storage.
  if (isResourceFork(resolved)) {
    return {
      filePath: resolved,
      chunksIndexed: 0,
      scope,
      skipped: true,
      error: 'AppleDouble resource fork',
    };
  }

  if (!DOC_EXTENSIONS.has(ext)) {
    return {
      filePath: resolved,
      chunksIndexed: 0,
      scope,
      skipped: true,
      error: `unsupported extension: ${ext}`,
    };
  }

  if (!fs.existsSync(resolved)) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: 'file not found' };
  }

  // RCL-01/RCL-06: one capture envelope is ONE document, whichever of its
  // members the caller points at.
  //
  // `page.html`/`page.mhtml` are not refused, because extraction reads their
  // sibling `readable.md` anyway (see capture-text) — but the DOCUMENT they
  // produce is that readable.md, and the record has to say so. Recording the
  // archive's path instead named a file whose own text was never indexed, and
  // made the answer depend on readdir order: a directory sweep reaches
  // `page.html` before `readable.md` on ext4 and the other way round
  // elsewhere, so the same capture was filed under a different path per
  // machine. Redirecting here — rather than skipping the member — is also what
  // keeps `doc ingest .../page.html` on a fresh store indexing the capture
  // instead of silently doing nothing.
  //
  // `page.pdf` is refused outright: its text differs from the readable pass,
  // so ingesting it alongside would version-flip the same page back and forth
  // on every sweep.
  const envelopePrimary = envelopePrimaryDocument(path.dirname(resolved));
  if (envelopePrimary && envelopePrimary !== resolved) {
    const isMember = (ENVELOPE_DOCUMENTS as readonly string[]).includes(path.basename(resolved));
    const redirectsToPrimary =
      path.basename(envelopePrimary) === ENVELOPE_READABLE_FILE &&
      (ext === '.html' || ext === '.htm' || ext === '.xhtml' || ext === '.mhtml' || ext === '.mht');
    if (isMember && redirectsToPrimary) {
      resolved = envelopePrimary;
      ext = path.extname(resolved).toLowerCase();
    } else if (isMember) {
      return {
        filePath: resolved,
        chunksIndexed: 0,
        scope,
        skipped: true,
        error: `capture envelope: ${path.basename(envelopePrimary)} is this capture's document`,
      };
    }
  }

  // After the redirect: the size recorded on the version record is the size of
  // the file that was actually indexed.
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    return {
      filePath: resolved,
      chunksIndexed: 0,
      scope,
      skipped: true,
      error: 'file too large (>50MB)',
    };
  }

  // A capture that names a profile belongs to that profile's store, whoever
  // is ingesting it and whatever scope they reached for — see
  // knowledge/profile-store.ts. A no-op for everything else.
  scope = captureScope(scope, resolved);
  rootDir = effectiveRoot(scope, rootDir);
  // A batch passes its own cache so the files in it can see each other's
  // commits; a lone ingest gets a private one, which reads the log exactly
  // once for this call and is thrown away with it.
  const metaCache = _metadataCache ?? createMetadataCache();

  // RCL-07: provenance is read before extraction so it is recorded even when a
  // later step degrades. Absent, truncated or wrong-typed `meta.json` yields
  // null and never throws — see capture-envelope.
  const provenance = readCaptureProvenance(resolved);
  const canonicalUrl = captureIdentityUrl(provenance);

  // RCL-06: identity is the PAGE, not the path. A re-capture lands in a new
  // timestamped directory, so matching on filePath alone would file every
  // capture of one article as a separate document.
  const existing = metaCache.find(rootDir, resolved, scope, canonicalUrl);
  let fullContent: string;

  try {
    const entry = toFileEntry(resolved);
    fullContent = await extractText(entry);
  } catch (err) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: false, error: String(err) };
  }

  if (!fullContent || fullContent.trim().length === 0) {
    return {
      filePath: resolved,
      chunksIndexed: 0,
      scope,
      skipped: true,
      error: 'no text extracted',
    };
  }

  const hash = contentHash(fullContent);

  // RCL-06: same page, same extracted text — a no-op, not a duplicate row and
  // not an error. `unchanged` is what a caller reports to the user.
  if (existing && existing.contentHash === hash) {
    return {
      filePath: resolved,
      chunksIndexed: existing.chunkCount,
      scope,
      skipped: true,
      unchanged: true,
      ...(existing.version ? { version: existing.version } : {}),
      ...(provenance ? { provenance } : {}),
    };
  }

  const version = (existing?.version ?? (existing ? 1 : 0)) + 1;
  const supersedes = existing?.contentHash || undefined;

  // NOTE: the previous version's metadata record is deliberately NOT tombstoned
  // here. `readMetadata` is last-wins per (filePath, scope), so appending the
  // new record below already supersedes the old one — the tombstone was a no-op
  // on the success path and destructive on the failure path: it retired a
  // perfectly good previous index before knowing whether the replacement would
  // land, so a failed re-ingest left the document with NO live version at all.
  const docId = `${scope}:${resolved}`;
  const rawChunks: TextChunk[] = await chunkDocument(docId, fullContent);
  // monolean: [re-enabled] item 2 shipped 768d gte-modernbert-base — capacity handles enrichment
  const chunks = enrichChunks(rawChunks, fullContent, resolved);
  const bridge = await getBridge();
  let indexed = 0;
  let highlights: IngestResult['highlights'];

  for (const chunk of chunks) {
    const key = `doc:${hash}:${chunk.chunkIndex}`;

    if (bridge) {
      try {
        const storeResult = await bridge.bridgeStoreEntry({
          key,
          value: chunk.text,
          namespace: namespace(scope),
          generateEmbeddingFlag: true,
          tags: [
            'document',
            ext,
            `src:${resolved}`,
            // RCL-10: the chunk's span against the extracted text, so a search
            // hit can cite a passage without re-reading the document.
            spanTag(chunk.startChar, chunk.endChar),
            ...(canonicalUrl ? [`url:${canonicalUrl}`] : []),
          ],
          upsert: true,
          dbPath: storeDbPath(scope),
        });
        if (storeResult?.success) indexed++;
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error(
            `[ingestDocument] failed to store chunk ${chunk.chunkIndex} of ${resolved}:`,
            e,
          );
      }
    }
  }

  // Commit the document version ONLY when EVERY chunk stored. Recording the
  // content hash after a partial store was the worse half of this bug: the
  // hash check above then skipped the file on every future ingest, so the
  // chunks that failed were never retried — a permanently, silently
  // half-indexed document feeding knowledge retrieval with no signal at all.
  // (Total failure was already handled; partial success was not.)
  //
  // Not committing is what makes a retry work: chunk keys are
  // `doc:<contentHash>:<index>` and stores are upserts, so re-ingesting the
  // same bytes rewrites the same keys and fills the gaps. Until it succeeds the
  // partially-written chunks sit under a hash that is not live, and superseded
  // filtering keeps them out of search (see `liveContentHashes`).
  const complete = indexed === chunks.length;
  if (complete) {
    const record = {
      filePath: resolved,
      contentHash: hash,
      chunkCount: indexed,
      indexedAt: new Date().toISOString(),
      scope,
      size: stat.size,
      version,
      ...(supersedes ? { supersedes } : {}),
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(provenance ? { provenance } : {}),
    };
    appendMetadata(rootDir, record);
    // Into the caller's view of the log as well as the log itself, so the rest
    // of a batch sees this document as indexed. Without it the two members of
    // one capture envelope each looked new and both got indexed.
    metaCache.record(rootDir, record);

    // A re-capture of the same page arrives at a NEW path, so the previous
    // version's record is a different (filePath, scope) key and survives
    // last-wins — leaving its contentHash live and its chunks answering
    // searches forever. Tombstone it so it leaves the live-hash set, which is
    // exactly how a same-path re-ingest already retires its predecessor.
    //
    // AFTER the append, never before: retiring the old version before the
    // replacement is known to have landed is the failure mode the partial-store
    // fix above exists to prevent.
    if (existing && existing.filePath !== resolved) {
      removeMetadataEntry(rootDir, existing.filePath, scope);
      metaCache.forget(rootDir, existing.filePath, scope);
    }

    // RCL-04: the reader's own highlights, stored as notes linked to this
    // document — see knowledge/highlights.ts. AFTER the version is committed,
    // because a note pointing at an uncommitted version would be a citation
    // into something search cannot return.
    //
    // Wrapped, and never fatal: a malformed highlight, a failed note store,
    // anything at all here must not cost someone their capture. The page is
    // already committed above; the annotations are a bonus that reports its
    // own shortfall through `IngestResult.highlights`.
    try {
      const { ingestHighlights, readHighlightsFor } = await import('./highlights.js');
      const found = readHighlightsFor(resolved);
      if (found.length) {
        const result = await ingestHighlights(
          {
            filePath: resolved,
            scope,
            contentHash: hash,
            text: fullContent,
            ...(canonicalUrl ? { canonicalUrl } : {}),
            ...(provenance ? { provenance } : {}),
          },
          { highlights: found, ...(storeDbPath(scope) ? { dbPath: storeDbPath(scope) } : {}) },
        );
        highlights = {
          found: result.found,
          stored: result.stored,
          anchored: result.anchored,
          ...(result.error ? { error: result.error } : {}),
        };
      }
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error(`[ingestDocument] highlights for ${resolved}:`, e);
      highlights = { found: 0, stored: 0, anchored: 0, error: String(e) };
    }
  }

  return {
    filePath: resolved,
    chunksIndexed: indexed,
    scope,
    skipped: false,
    ...(complete ? { version, ...(supersedes ? { supersedes } : {}) } : {}),
    ...(provenance ? { provenance } : {}),
    ...(highlights ? { highlights } : {}),
    ...(complete
      ? {}
      : indexed > 0
        ? {
            partial: true,
            error: `partial store: ${indexed}/${chunks.length} chunks — version not committed, re-ingest to repair`,
          }
        : {
            error: bridge
              ? 'all chunk stores failed'
              : 'memory bridge unavailable — nothing indexed',
          }),
  };
}

export async function ingestDirectory(
  dirPath: string,
  scope = 'shared',
  opts?: { rootDir?: string; onProgress?: (file: string, done: number, total: number) => void },
): Promise<BatchIngestResult> {
  const scanDir = path.resolve(dirPath);
  // Through `effectiveRoot`, exactly as `ingestDocument` does one line after
  // it resolves the scope. The batch reads its metadata cache from this root
  // while every version record is written to the SCOPE's store — so a root
  // taken from the project alone meant a `global` or `profile:<id>` sweep read
  // a store nothing had ever been written to. `existing` was then never found,
  // `unchanged` could never fire, and every sweep re-indexed the whole tree at
  // a new version. `effectiveRoot` is idempotent, so applying it here and
  // again inside `ingestDocument` (where a capture may re-route the scope to a
  // profile) resolves to the same place.
  const rootDir = effectiveRoot(scope, path.resolve(opts?.rootDir ?? getProjectRoot()));
  const files: string[] = [];

  function walk(dir: string, depth = 0) {
    if (depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip dotfiles/dot-dirs (incl. exFAT `._*` junk) — except `.monodesign`,
      // whose critique snapshots are markdown worth surfacing in the Second Brain.
      if (entry.name.startsWith('.') && entry.name !== '.monodesign') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (DOC_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  }

  walk(scanDir);

  // One view of the log for the whole sweep, updated by each ingest that
  // commits — see `createMetadataCache`. Still one read per store, which is
  // what this cache was always for.
  const metadataCache = createMetadataCache();
  const result: BatchIngestResult = {
    filesProcessed: 0,
    filesSkipped: 0,
    totalChunks: 0,
    errors: [],
    results: [],
  };

  for (let i = 0; i < files.length; i++) {
    opts?.onProgress?.(files[i], i, files.length);
    const r = await ingestDocument(files[i], scope, rootDir, metadataCache);
    result.results.push(r);

    if (r.skipped) {
      result.filesSkipped++;
    } else {
      result.filesProcessed++;
      result.totalChunks += r.chunksIndexed;
    }

    if (r.error && !r.skipped) {
      result.errors.push(`${r.filePath}: ${r.error}`);
    }
  }

  return result;
}
