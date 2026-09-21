/**
 * GLU-07 — captured pages as MCP resources: the URI scheme and the listing.
 *
 * A tool call is something an agent must be told to make. A RESOURCE is
 * something a client can enumerate, attach and re-read on its own, which is
 * what "read from my brain without a bespoke integration" actually needs.
 *
 * THE URI: `capture://<scope>/<identity>`
 *
 *  - `<scope>` is the knowledge scope, which is also WHICH STORE to look in:
 *    `global` is the personal cross-project brain where `~/.monomind/inbox`
 *    captures land, anything else is this project's store.
 *  - `<identity>` is the capture's `canonicalUrl` — the same dedupe key the
 *    ingest uses (RCL-06) — percent-encoded, falling back to the absolute file
 *    path for an ordinary document. Keying on the PAGE and not the path is
 *    what makes the uri survive a re-capture: version 2 of an article lands in
 *    a new timestamped directory, and an agent that wrote the uri down last
 *    week must still reach the same page.
 *  - Percent-encoding leaves exactly one path segment, which matters: the MCP
 *    resource registry in `@monoes/mcp` matches templates with `[^/]+`, so a
 *    raw `https://…` in the path would make the uri unroutable.
 *  - Optional `?v=`, `?chunk=` and `?anchor=` address one VERSION or one
 *    PASSAGE — see `capture-resource-read.ts`.
 *  - `capture://<scope>` with no identity is the scope's library index: facet
 *    counts and the newest captures, so a client can orient before paging.
 *
 * Nothing here re-implements filtering, provenance or facets — `library.ts`
 * owns those and this module is the MCP-shaped view over them.
 *
 * @module v1/cli/mcp-tools/capture-resources
 */

import * as crypto from 'node:crypto';
import { type CaptureProvenance, captureIdentityUrl } from '../knowledge/capture-envelope.js';
import type { DocumentMeta } from '../knowledge/document-pipeline.js';
import {
  documentCapturedAt,
  filterDocuments,
  type LibraryEntry,
  type LibraryFilter,
  type LibrarySort,
  libraryEntry,
  libraryFacets,
  sortDocuments,
} from '../knowledge/library.js';

export const CAPTURE_URI_SCHEME = 'capture';
export const CAPTURE_MIME_TYPE = 'text/markdown';
export const CAPTURE_JSON_MIME_TYPE = 'application/json';
export const CAPTURE_URI_TEMPLATE = 'capture://{scope}/{identity}';
export const CAPTURE_INDEX_URI_TEMPLATE = 'capture://{scope}';
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** Newest captures carried inline on a library index read. */
const INDEX_LATEST = 25;
const DESCRIPTION_MAX = 400;

// ── URIs ───────────────────────────────────────────────────────────

const URI_RE = /^capture:\/\/([A-Za-z0-9._~-]+)(?:\/([^/?#\s]*))?(?:\?([^#\s]*))?$/;

export interface CaptureUriExtras {
  /** A specific stored version (RCL-06), rather than the current one. */
  version?: number;
  /** A single chunk, as reported on a search hit. */
  chunkIndex?: number;
  /** A citation anchor `<hash12>#<start>-<end>` (RCL-10). */
  anchor?: string;
}

export interface CaptureUri extends CaptureUriExtras {
  scope: string;
  /** Empty for the scope's library index. */
  identity: string;
}

export function buildCaptureUri(
  scope: string,
  identity: string,
  extras: CaptureUriExtras = {},
): string {
  const base = `capture://${encodeURIComponent(scope)}${
    identity ? `/${encodeURIComponent(identity)}` : ''
  }`;
  const query: string[] = [];
  if (extras.version !== undefined) query.push(`v=${extras.version}`);
  if (extras.chunkIndex !== undefined) query.push(`chunk=${extras.chunkIndex}`);
  if (extras.anchor !== undefined) query.push(`anchor=${encodeURIComponent(extras.anchor)}`);
  return query.length ? `${base}?${query.join('&')}` : base;
}

/** The page a document IS, for uri purposes: its dedupe key, else its path. */
export function captureIdentity(meta: {
  filePath: string;
  canonicalUrl?: string;
  provenance?: CaptureProvenance;
}): string {
  return meta.canonicalUrl ?? captureIdentityUrl(meta.provenance) ?? meta.filePath;
}

export function captureUriFor(meta: DocumentMeta, extras: CaptureUriExtras = {}): string {
  return buildCaptureUri(meta.scope, captureIdentity(meta), extras);
}

export function isCaptureUri(uri: string): boolean {
  return /^capture:\/\//i.test((uri ?? '').trim());
}

function intParam(params: URLSearchParams, name: string, min: number): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : Number.NaN;
}

/**
 * Parse a capture uri, or null when it is not one — including when it is
 * malformed. A caller distinguishes "not mine" from "mine but broken" by
 * checking `isCaptureUri` first, which is what the router does so a typo in a
 * capture uri reports itself instead of falling through to another scheme.
 */
export function parseCaptureUri(uri: string): CaptureUri | null {
  const match = URI_RE.exec((uri ?? '').trim());
  if (!match) return null;
  let scope: string;
  let identity: string;
  try {
    scope = decodeURIComponent(match[1]);
    identity = match[2] ? decodeURIComponent(match[2]) : '';
  } catch {
    return null; // malformed percent-escape
  }
  const out: CaptureUri = { scope, identity };
  if (match[3]) {
    const params = new URLSearchParams(match[3]);
    const version = intParam(params, 'v', 1);
    const chunkIndex = intParam(params, 'chunk', 0);
    if (Number.isNaN(version) || Number.isNaN(chunkIndex)) return null;
    if (version !== undefined) out.version = version;
    if (chunkIndex !== undefined) out.chunkIndex = chunkIndex;
    const anchor = params.get('anchor');
    if (anchor) out.anchor = anchor;
  }
  return out;
}

// ── Descriptors ────────────────────────────────────────────────────

export interface CaptureResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** The one-line description a client shows next to the name: where it came
 *  from, when it was captured, which version, and the facets it was filed
 *  under — enough to pick a resource without reading it. */
function describe(entry: LibraryEntry): string {
  const bits = [
    entry.url ?? entry.filePath,
    entry.capturedAt ? `captured ${entry.capturedAt.slice(0, 10)}` : '',
    entry.version ? `v${entry.version}` : '',
    entry.source ?? '',
    entry.collection ?? '',
    entry.tags.length ? `#${entry.tags.join(' #')}` : '',
    `${entry.chunkCount} chunk${entry.chunkCount === 1 ? '' : 's'}`,
  ].filter(Boolean);
  const text = bits.join(' · ');
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text;
}

export function captureResourceDescriptor(meta: DocumentMeta): CaptureResourceDescriptor {
  const entry = libraryEntry(meta);
  return {
    uri: captureUriFor(meta),
    name: entry.title || entry.url || entry.filePath,
    description: describe(entry),
    mimeType: CAPTURE_MIME_TYPE,
  };
}

export function captureIndexDescriptor(scope: string, count: number): CaptureResourceDescriptor {
  return {
    uri: buildCaptureUri(scope, ''),
    name: `Capture library (${scope})`,
    description:
      `${count} captured page${count === 1 ? '' : 's'} in the ${scope} brain — ` +
      `site/tag/collection/source facets and the newest captures. ` +
      `Read one with ${CAPTURE_URI_TEMPLATE}.`,
    mimeType: CAPTURE_JSON_MIME_TYPE,
  };
}

// ── Listing ────────────────────────────────────────────────────────

export interface ListCaptureResourcesOptions extends LibraryFilter {
  sort?: LibrarySort;
  order?: 'asc' | 'desc';
  /** Opaque, from a previous page's `nextCursor`. */
  cursor?: string;
  pageSize?: number;
  /** Also list ordinary indexed files, which are not captures. */
  includeLocal?: boolean;
  now?: number;
}

export interface CaptureRow extends LibraryEntry {
  uri: string;
}

export interface CaptureResourceListResult {
  /** MCP `resources/list` entries. */
  resources: CaptureResourceDescriptor[];
  /** The same page, as the structured rows a tool caller wants. */
  rows: CaptureRow[];
  total: number;
  nextCursor?: string;
}

/** Filtered and sorted, before paging. */
export function selectCaptureDocuments(
  docs: DocumentMeta[],
  opts: ListCaptureResourcesOptions = {},
): DocumentMeta[] {
  const now = opts.now ?? Date.now();
  const filter: LibraryFilter = { ...opts, capturedOnly: !opts.includeLocal };
  return sortDocuments(
    filterDocuments(docs, filter, now),
    opts.sort ?? 'captured',
    opts.order ?? 'desc',
  );
}

/** What a cursor is only valid against: change any of it and the offset it
 *  carries would point into a different list. */
function fingerprint(opts: ListCaptureResourcesOptions): string {
  const key = JSON.stringify({
    site: opts.site ?? null,
    tag: opts.tag ?? null,
    collection: opts.collection ?? null,
    source: opts.source ?? null,
    since: opts.since ?? null,
    until: opts.until ?? null,
    text: opts.text ?? null,
    scope: opts.scope ?? null,
    includeLocal: !!opts.includeLocal,
    sort: opts.sort ?? 'captured',
    order: opts.order ?? 'desc',
  });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function encodeCursor(offset: number, fp: string): string {
  return Buffer.from(`${fp}:${offset}`, 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string, fp: string): number {
  let decoded = '';
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
  } catch {
    throw new Error('invalid cursor');
  }
  const [seen, offset] = decoded.split(':');
  const n = Number(offset);
  if (seen !== fp || !Number.isInteger(n) || n < 0) {
    throw new Error('invalid cursor: it was issued for a different filter or sort order');
  }
  return n;
}

/**
 * One page of capture resources. Throws on a cursor that does not belong to
 * these options — paging on silently would hand back a window of a different
 * list, which is worse than an error the client can retry without a cursor.
 */
export function listCaptureResources(
  docs: DocumentMeta[],
  opts: ListCaptureResourcesOptions = {},
): CaptureResourceListResult {
  const selected = selectCaptureDocuments(docs, opts);
  const fp = fingerprint(opts);
  const offset = opts.cursor ? decodeCursor(opts.cursor, fp) : 0;
  const size = Math.min(Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const page = selected.slice(offset, offset + size);
  const end = offset + page.length;
  return {
    resources: page.map(captureResourceDescriptor),
    rows: page.map((meta) => ({ uri: captureUriFor(meta), ...libraryEntry(meta) })),
    total: selected.length,
    ...(end < selected.length ? { nextCursor: encodeCursor(end, fp) } : {}),
  };
}

/** Scopes that hold at least one capture, so the index resources match what
 *  is actually there rather than a hardcoded pair. */
export function captureScopes(docs: DocumentMeta[]): string[] {
  const scopes = new Set<string>();
  for (const meta of filterDocuments(docs, { capturedOnly: true })) scopes.add(meta.scope);
  return [...scopes].sort();
}

export interface CaptureLibraryIndex {
  scope: string;
  total: number;
  facets: ReturnType<typeof libraryFacets>;
  latest: CaptureRow[];
  uriTemplate: string;
  indexUriTemplate: string;
}

/** The payload behind `capture://<scope>`. */
export function captureLibraryIndex(
  docs: DocumentMeta[],
  scope: string,
  limit = INDEX_LATEST,
): CaptureLibraryIndex {
  const scoped = filterDocuments(docs, { scope, capturedOnly: true });
  const latest = sortDocuments(scoped, 'captured', 'desc').slice(0, Math.max(1, limit));
  return {
    scope,
    total: scoped.length,
    facets: libraryFacets(scoped),
    latest: latest.map((meta) => ({ uri: captureUriFor(meta), ...libraryEntry(meta) })),
    uriTemplate: CAPTURE_URI_TEMPLATE,
    indexUriTemplate: CAPTURE_INDEX_URI_TEMPLATE,
  };
}

// ── Stores ─────────────────────────────────────────────────────────

export interface CaptureStoreOptions {
  /** The project store root. Defaults to the resolved project root. */
  rootDir?: string;
  /** The personal cross-project brain. Defaults to `getGlobalBrainDir()`. */
  globalRoot?: string;
  store?: 'project' | 'global' | 'all';
}

/** The store root a scope's records live in. */
export async function captureStoreRoot(
  scope: string,
  opts: CaptureStoreOptions = {},
): Promise<string> {
  const { getGlobalBrainDir, getProjectRoot } = await import('../memory/memory-bridge.js');
  if (scope === 'global') return opts.globalRoot ?? getGlobalBrainDir();
  return opts.rootDir ?? getProjectRoot();
}

/**
 * Every indexed document, from both stores by default.
 *
 * Captures land in `~/.monomind/inbox`, which is outside any project, so
 * `doc ingest` files them in the GLOBAL brain — listing only the project store
 * would report an empty library to an agent whose user has captured hundreds
 * of pages. Ordinary project documents come along; `listCaptureResources`
 * drops them unless `includeLocal` is set.
 */
export async function loadCaptureDocuments(
  opts: CaptureStoreOptions = {},
): Promise<DocumentMeta[]> {
  const { listDocuments } = await import('../knowledge/document-pipeline.js');
  const { getGlobalBrainDir, getProjectRoot } = await import('../memory/memory-bridge.js');
  const path = await import('node:path');

  const store = opts.store ?? 'all';
  const roots: string[] = [];
  if (store !== 'global') roots.push(opts.rootDir ?? getProjectRoot());
  if (store !== 'project') roots.push(opts.globalRoot ?? getGlobalBrainDir());

  const seenRoots = new Set<string>();
  const seenDocs = new Set<string>();
  const out: DocumentMeta[] = [];
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (seenRoots.has(resolved)) continue;
    seenRoots.add(resolved);
    let docs: DocumentMeta[] = [];
    try {
      docs = listDocuments(resolved);
    } catch {
      continue; // a store that cannot be read is an empty one, not a failure
    }
    for (const meta of docs) {
      const key = `${meta.scope} ${meta.filePath}`;
      if (seenDocs.has(key)) continue;
      seenDocs.add(key);
      out.push(meta);
    }
  }
  return out;
}

/** Newest capture time in a set — what a client shows as "last updated". */
export function newestCaptureAt(docs: DocumentMeta[]): string | undefined {
  let newest = '';
  for (const meta of docs) {
    const at = documentCapturedAt(meta);
    if (at > newest) newest = at;
  }
  return newest || undefined;
}
