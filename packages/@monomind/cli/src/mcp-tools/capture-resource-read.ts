/**
 * GLU-07 — reading a capture as an MCP resource.
 *
 * A read has one job beyond handing over the text: make the text QUOTABLE.
 * A model that receives 8kB of markdown with no idea where it came from will
 * paraphrase it as its own; the same markdown with the url, the title, the
 * capture time and the version in front of it gets cited. So every read is
 * two parts —
 *
 *   contents[0]  text/markdown       provenance front matter, then the page
 *   contents[1]  application/json    the same provenance, structured, plus
 *                                    chunk spans and citation anchors
 *
 * — and `textStartsAt` says where the front matter ends, so the character
 * offsets in the chunk list still line up with the document itself.
 *
 * `?chunk=` / `?anchor=` read ONE PASSAGE instead, straight through
 * `resolveCitation` (RCL-10): same offsets, same anchor, same W3C text
 * fragment link, and the same `stale: true` when the anchor was cut against a
 * version this page no longer is. This module deliberately owns none of that
 * logic — a second implementation of "which passage is this" is how a citation
 * and its quote drift apart.
 *
 * @module v1/cli/mcp-tools/capture-resource-read
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CaptureProvenance } from '../knowledge/capture-envelope.js';
import type { DocumentMeta } from '../knowledge/document-pipeline.js';
import {
  buildCaptureUri,
  CAPTURE_JSON_MIME_TYPE,
  CAPTURE_MIME_TYPE,
  type CaptureStoreOptions,
  captureLibraryIndex,
  captureStoreRoot,
  isCaptureUri,
  loadCaptureDocuments,
  parseCaptureUri,
} from './capture-resources.js';

/** A document longer than this is served truncated: an MCP client pastes the
 *  whole resource into a context window, and a 5MB archive would blow it. */
const MAX_TEXT_CHARS = 200_000;
/** Chunk spans carried inline. Beyond this the list is cut and says so —
 *  `?chunk=` still addresses every one of them. */
const MAX_CHUNKS = 200;

export interface CaptureChunkRef {
  chunkIndex: number;
  startChar: number;
  endChar: number;
  /** `<hash12>#<start>-<end>` — bound to the version it was measured against. */
  anchor: string;
  uri: string;
}

export interface CaptureVersionRef {
  version: number;
  uri: string;
  indexedAt: string;
  contentHash: string;
  filePath: string;
}

export interface CaptureInfo {
  uri: string;
  scope: string;
  filePath: string;
  title?: string;
  url?: string;
  site?: string;
  capturedAt?: string;
  indexedAt: string;
  publishedAt?: string;
  byline?: string;
  httpStatus?: number;
  note?: string;
  source?: string;
  collection?: string;
  tags: string[];
  version?: number;
  versions?: CaptureVersionRef[];
  /** Hash of the text as it is NOW. */
  contentHash: string;
  /** Hash recorded when the document was indexed. */
  indexedContentHash: string;
  /** The file changed after it was indexed, or the anchor names another
   *  version — quote it knowing that, or re-ingest. */
  stale?: boolean;
  chunkCount: number;
  size: number;
  textChars: number;
  truncated?: boolean;
  /** Offset in `markdown` where the document itself starts. */
  textStartsAt: number;
  chunks: CaptureChunkRef[];
  chunksTruncated?: boolean;
  // Passage reads (`?chunk=` / `?anchor=`) only:
  chunkIndex?: number;
  startChar?: number;
  endChar?: number;
  anchor?: string;
  passage?: string;
  quote?: string;
  /** `url` with a text fragment: the link that lands on the passage. */
  citeUrl?: string;
}

export interface CaptureReadResult {
  uri: string;
  markdown: string;
  info: CaptureInfo;
}

export interface CaptureReadOptions extends CaptureStoreOptions {
  maxChars?: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function fileEntry(absolutePath: string) {
  const stat = fs.statSync(absolutePath);
  return {
    path: absolutePath,
    absolutePath,
    extension: path.extname(absolutePath).toLowerCase(),
    size: stat.size,
    modified: stat.mtime,
    created: stat.birthtime,
  };
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** YAML-safe scalar: quoted only when it would otherwise be ambiguous. */
function scalar(value: string): string {
  return /^\s|\s$|[\n\r"']|:\s|^[-?[\]{}#&*!|>%@`]/.test(value) ? JSON.stringify(value) : value;
}

function frontMatter(fields: Array<[string, string | number | undefined]>): string {
  const lines = fields
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : scalar(v as string)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

async function readText(filePath: string): Promise<string> {
  const { extractText } = await import('../capabilities/cap-documents.js');
  if (!fs.existsSync(filePath)) {
    throw new Error(`source file is gone: ${filePath} (re-ingest the capture to read it)`);
  }
  const text = await extractText(fileEntry(filePath));
  if (!text) throw new Error(`no text could be extracted from ${filePath}`);
  return text;
}

function provenanceOf(record: DocumentMeta): CaptureProvenance {
  return record.provenance ?? {};
}

function urlOf(record: DocumentMeta): string | undefined {
  const prov = provenanceOf(record);
  return record.canonicalUrl ?? prov.canonicalUrl ?? prov.url;
}

async function versionsOf(
  rootDir: string,
  identity: string,
  scope: string,
): Promise<CaptureVersionRef[]> {
  const { listDocumentVersions } = await import('../knowledge/document-pipeline.js');
  const seen = new Map<number, CaptureVersionRef>();
  for (const record of listDocumentVersions(rootDir, identity, scope)) {
    if (!record.version) continue;
    seen.set(record.version, {
      version: record.version,
      uri: buildCaptureUri(scope, identity, { version: record.version }),
      indexedAt: record.indexedAt,
      contentHash: record.contentHash,
      filePath: record.filePath,
    });
  }
  return [...seen.values()].sort((a, b) => a.version - b.version);
}

// ── Reads ──────────────────────────────────────────────────────────

/**
 * Read a capture: the whole page, one stored version, or one passage.
 *
 * Throws with a message meant for a human — an unknown page, a file that has
 * been deleted since it was indexed and a chunk that does not exist are all
 * things a caller must see, not silently get an empty document for.
 */
export async function readCapture(
  uri: string,
  opts: CaptureReadOptions = {},
): Promise<CaptureReadResult> {
  const parsed = parseCaptureUri(uri);
  if (!parsed) throw new Error(`not a capture uri: ${uri}`);
  if (!parsed.identity) {
    throw new Error(`${uri} is a library index, not a document — read it as JSON`);
  }
  if (parsed.version !== undefined && (parsed.chunkIndex !== undefined || parsed.anchor)) {
    throw new Error(
      'a passage read already names its version through the anchor: drop either v= or chunk=/anchor=',
    );
  }

  const { scope, identity } = parsed;
  const rootDir = await captureStoreRoot(scope, opts);
  const { findDocumentRecord } = await import('../knowledge/document-pipeline.js');

  if (parsed.chunkIndex !== undefined || parsed.anchor) {
    return readPassage(uri, parsed.scope, identity, rootDir, {
      ...(parsed.chunkIndex !== undefined ? { chunkIndex: parsed.chunkIndex } : {}),
      ...(parsed.anchor ? { anchor: parsed.anchor } : {}),
    });
  }

  let record = findDocumentRecord(rootDir, identity, scope);
  const versions = await versionsOf(rootDir, identity, scope);
  if (parsed.version !== undefined) {
    const wanted = versions.find((v) => v.version === parsed.version);
    if (!wanted) {
      throw new Error(
        `version ${parsed.version} is not recorded for ${identity}` +
          (versions.length ? ` (have ${versions.map((v) => v.version).join(', ')})` : ''),
      );
    }
    const { listDocumentVersions } = await import('../knowledge/document-pipeline.js');
    record = listDocumentVersions(rootDir, identity, scope).find(
      (m) => m.version === parsed.version,
    );
  }
  if (!record) throw new Error(`not indexed: ${identity} (nothing at ${uri})`);

  const text = await readText(record.filePath);
  const contentHash = sha256(text);
  const limit = Math.max(1, opts.maxChars ?? MAX_TEXT_CHARS);
  const body = text.length > limit ? text.slice(0, limit) : text;

  const { chunkSpans } = await import('../knowledge/document-pipeline.js');
  const { citationAnchor } = await import('../knowledge/citation.js');
  const spans = await chunkSpans(text);
  const chunks: CaptureChunkRef[] = spans.slice(0, MAX_CHUNKS).map((span) => ({
    chunkIndex: span.chunkIndex,
    startChar: span.startChar,
    endChar: span.endChar,
    anchor: citationAnchor(contentHash, span.startChar, span.endChar),
    uri: buildCaptureUri(scope, identity, { chunkIndex: span.chunkIndex }),
  }));

  const prov = provenanceOf(record);
  const url = urlOf(record);
  const { documentSite } = await import('../knowledge/library.js');
  const stale = contentHash !== record.contentHash;

  const matter = frontMatter([
    ['uri', uri],
    ['title', prov.title],
    ['url', url],
    ['byline', prov.byline],
    ['capturedAt', prov.capturedAt],
    ['publishedAt', prov.publishedAt],
    ['version', record.version],
    ['source', prov.source],
    ['collection', prov.collection],
    ['tags', prov.tags?.join(', ')],
    ['contentHash', contentHash.slice(0, 12)],
    ['scope', scope],
    ['stale', stale ? 'true' : undefined],
    ['truncated', text.length > limit ? 'true' : undefined],
  ]);

  const info: CaptureInfo = {
    uri,
    scope,
    filePath: record.filePath,
    ...(prov.title ? { title: prov.title } : {}),
    ...(url ? { url } : {}),
    ...(documentSite(record) ? { site: documentSite(record) } : {}),
    ...(prov.capturedAt ? { capturedAt: prov.capturedAt } : {}),
    indexedAt: record.indexedAt,
    ...(prov.publishedAt ? { publishedAt: prov.publishedAt } : {}),
    ...(prov.byline ? { byline: prov.byline } : {}),
    ...(prov.httpStatus !== undefined ? { httpStatus: prov.httpStatus } : {}),
    ...(prov.note ? { note: prov.note } : {}),
    ...(prov.source ? { source: prov.source } : {}),
    ...(prov.collection ? { collection: prov.collection } : {}),
    tags: prov.tags ?? [],
    ...(record.version ? { version: record.version } : {}),
    ...(versions.length > 1 ? { versions } : {}),
    contentHash,
    indexedContentHash: record.contentHash,
    ...(stale ? { stale: true } : {}),
    chunkCount: record.chunkCount,
    size: record.size,
    textChars: text.length,
    ...(text.length > limit ? { truncated: true } : {}),
    textStartsAt: matter.length,
    chunks,
    ...(spans.length > chunks.length ? { chunksTruncated: true } : {}),
  };

  return { uri, markdown: `${matter}${body}`, info };
}

/** One passage, through `resolveCitation` so the quote, the anchor, the link
 *  and the staleness verdict are the same ones `monomind doc cite` gives. */
async function readPassage(
  uri: string,
  scope: string,
  identity: string,
  rootDir: string,
  where: { chunkIndex?: number; anchor?: string },
): Promise<CaptureReadResult> {
  const { resolveCitation } = await import('../knowledge/citation.js');
  const citation = await resolveCitation(identity, { rootDir, scope, ...where });

  const matter = frontMatter([
    ['uri', uri],
    ['title', citation.title],
    ['url', citation.url],
    ['capturedAt', citation.capturedAt],
    ['version', citation.version],
    ['source', citation.source],
    ['chunk', citation.chunkIndex],
    ['anchor', citation.anchor],
    ['citeUrl', citation.citeUrl],
    ['scope', citation.scope],
    ['stale', citation.stale ? 'true' : undefined],
  ]);
  const markdown = `${matter}> ${citation.quote}\n\n${citation.passage}`;

  const prov = citation.provenance ?? {};
  return {
    uri,
    markdown,
    info: {
      uri,
      scope: citation.scope,
      filePath: citation.filePath,
      ...(citation.title ? { title: citation.title } : {}),
      ...(citation.url ? { url: citation.url } : {}),
      ...(citation.capturedAt ? { capturedAt: citation.capturedAt } : {}),
      indexedAt: '',
      ...(prov.byline ? { byline: prov.byline } : {}),
      ...(citation.source ? { source: citation.source } : {}),
      ...(prov.collection ? { collection: prov.collection } : {}),
      tags: prov.tags ?? [],
      ...(citation.version ? { version: citation.version } : {}),
      contentHash: citation.contentHash,
      indexedContentHash: citation.contentHash,
      ...(citation.stale ? { stale: true } : {}),
      chunkCount: 0,
      size: citation.passage.length,
      textChars: citation.passage.length,
      textStartsAt: matter.length,
      chunks: [],
      chunkIndex: citation.chunkIndex,
      startChar: citation.startChar,
      endChar: citation.endChar,
      anchor: citation.anchor,
      passage: citation.passage,
      quote: citation.quote,
      ...(citation.citeUrl ? { citeUrl: citation.citeUrl } : {}),
    },
  };
}

/**
 * MCP `resources/read` contents for any `capture://` uri: the scope's library
 * index as JSON, or a document as markdown plus its provenance.
 */
export async function captureResourceContents(
  uri: string,
  opts: CaptureReadOptions = {},
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  if (!isCaptureUri(uri)) throw new Error(`not a capture uri: ${uri}`);
  const parsed = parseCaptureUri(uri);
  if (!parsed) throw new Error(`malformed capture uri: ${uri}`);

  if (!parsed.identity) {
    const docs = await loadCaptureDocuments(opts);
    const index = captureLibraryIndex(docs, parsed.scope);
    return {
      contents: [{ uri, mimeType: CAPTURE_JSON_MIME_TYPE, text: JSON.stringify(index, null, 2) }],
    };
  }

  const read = await readCapture(uri, opts);
  return {
    contents: [
      { uri, mimeType: CAPTURE_MIME_TYPE, text: read.markdown },
      { uri, mimeType: CAPTURE_JSON_MIME_TYPE, text: JSON.stringify(read.info, null, 2) },
    ],
  };
}

/** The uri for a page a caller names by url or path, searching both stores —
 *  captures live in the global brain, so a project-only lookup would deny
 *  knowing a page the user saved minutes ago. */
export async function resolveCaptureUri(
  target: string,
  opts: CaptureStoreOptions = {},
): Promise<string | undefined> {
  const { findDocumentRecord } = await import('../knowledge/document-pipeline.js');
  const { captureUriFor } = await import('./capture-resources.js');
  const { getGlobalBrainDir, getProjectRoot } = await import('../memory/memory-bridge.js');
  const store = opts.store ?? 'all';
  const roots: string[] = [];
  if (store !== 'global') roots.push(opts.rootDir ?? getProjectRoot());
  if (store !== 'project') roots.push(opts.globalRoot ?? getGlobalBrainDir());
  for (const root of roots) {
    const record = findDocumentRecord(root, target);
    if (record) return captureUriFor(record);
  }
  return undefined;
}
