/**
 * The capture library (RCL-09) — browsing what has been captured, rather than
 * searching it.
 *
 * `listDocuments` answers "what is indexed". A library answers a different
 * question: everything from this site, captured last week, tagged `reading`,
 * newest first. The facets come from the capture envelope's `meta.json`
 * (RCL-07), which is already on every record — this module is the query layer
 * over them, and the data layer the desktop GUI renders.
 *
 * Rules, once, here:
 *  - within a facet values are OR'd, across facets AND'd (`--site a --site b
 *    --tag x` = "from a or b, tagged x");
 *  - `--site example.com` matches `www.example.com` and `docs.example.com`,
 *    because nobody browsing their own library means the bare host only;
 *  - a document with no provenance (an ordinary file on disk) sorts by its
 *    index time and matches no capture facet — it is not a capture.
 *
 * @module v1/cli/knowledge/library
 */

import * as path from 'node:path';
import type { CaptureProvenance } from './capture-envelope.js';
import type { DocumentMeta } from './document-pipeline.js';

export interface LibraryFilter {
  /** Host, or a parent domain of it. */
  site?: string[];
  tag?: string[];
  collection?: string[];
  /** `extension` | `monobrowse` | `crawl`. */
  source?: string[];
  /** ISO date/time, or a relative age: `7d`, `24h`, `30m`. */
  since?: string;
  until?: string;
  /** Only documents that came from a capture envelope. */
  capturedOnly?: boolean;
  scope?: string;
  /** Substring over title, URL and path. */
  text?: string;
}

export type LibrarySort = 'captured' | 'indexed' | 'title' | 'path' | 'size';

export interface LibraryEntry {
  filePath: string;
  scope: string;
  title: string;
  url?: string;
  site?: string;
  capturedAt: string;
  indexedAt: string;
  source?: string;
  collection?: string;
  tags: string[];
  chunkCount: number;
  size: number;
  version?: number;
  /** False for ordinary files on disk: no capture envelope backed this one. */
  captured: boolean;
}

// ── Facet extraction ───────────────────────────────────────────────

/** The host a document was captured from, or undefined for a local file. */
export function documentSite(meta: {
  canonicalUrl?: string;
  provenance?: CaptureProvenance;
}): string | undefined {
  const url = meta.canonicalUrl ?? meta.provenance?.canonicalUrl ?? meta.provenance?.url;
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** When the page was captured; falls back to when it was indexed. */
export function documentCapturedAt(meta: {
  indexedAt?: string;
  provenance?: CaptureProvenance;
}): string {
  return meta.provenance?.capturedAt ?? meta.indexedAt ?? '';
}

const RELATIVE_RE = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i;
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * A point in time from `2026-09-01`, a full ISO stamp, or an AGE like `7d`
 * (meaning "7 days ago"). Returns null for anything unparseable so a typo
 * cannot silently filter the whole library away.
 */
export function parseWhen(value: string | undefined, now = Date.now()): number | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const rel = RELATIVE_RE.exec(raw);
  if (rel) return now - Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()];
  const parsed = Date.parse(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function siteMatches(host: string | undefined, wanted: string[]): boolean {
  if (!host) return false;
  return wanted.some((w) => {
    const want = w
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    return !!want && (host === want || host.endsWith(`.${want}`));
  });
}

function anyOf(values: string[] | undefined, wanted: string[]): boolean {
  const have = (values ?? []).map((v) => v.toLowerCase());
  return wanted.some((w) => have.includes(w.trim().toLowerCase()));
}

/** True when a document belongs in this view. */
export function matchesLibraryFilter(
  meta: DocumentMeta,
  filter: LibraryFilter = {},
  now = Date.now(),
): boolean {
  if (filter.scope && meta.scope !== filter.scope) return false;
  const prov = meta.provenance;
  const isCapture = !!prov || !!meta.canonicalUrl;
  if (filter.capturedOnly && !isCapture) return false;
  if (filter.site?.length && !siteMatches(documentSite(meta), filter.site)) return false;
  if (filter.tag?.length && !anyOf(prov?.tags, filter.tag)) return false;
  if (
    filter.collection?.length &&
    !anyOf(prov?.collection ? [prov.collection] : [], filter.collection)
  )
    return false;
  if (filter.source?.length && !anyOf(prov?.source ? [prov.source] : [], filter.source))
    return false;

  if (filter.since || filter.until) {
    const at = Date.parse(documentCapturedAt(meta));
    const since = parseWhen(filter.since, now);
    const until = parseWhen(filter.until, now);
    if (Number.isNaN(at)) return false;
    if (since !== null && at < since) return false;
    if (until !== null && at > until) return false;
  }

  if (filter.text) {
    const needle = filter.text.toLowerCase();
    const hay = [
      prov?.title ?? '',
      meta.canonicalUrl ?? prov?.url ?? '',
      meta.filePath,
      prov?.note ?? '',
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function filterDocuments(
  docs: DocumentMeta[],
  filter: LibraryFilter = {},
  now = Date.now(),
): DocumentMeta[] {
  return docs.filter((d) => matchesLibraryFilter(d, filter, now));
}

export function sortDocuments(
  docs: DocumentMeta[],
  sort: LibrarySort = 'captured',
  order: 'asc' | 'desc' = 'desc',
): DocumentMeta[] {
  const dir = order === 'asc' ? 1 : -1;
  const key = (d: DocumentMeta): string | number => {
    switch (sort) {
      case 'indexed':
        return d.indexedAt ?? '';
      case 'title':
        return (d.provenance?.title ?? path.basename(d.filePath)).toLowerCase();
      case 'path':
        return d.filePath;
      case 'size':
        return d.size ?? 0;
      default:
        return documentCapturedAt(d);
    }
  };
  return [...docs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return a.filePath.localeCompare(b.filePath);
    return ka < kb ? -dir : dir;
  });
}

/** The flat, JSON-friendly row the GUI and `--json` consumers read. */
export function libraryEntry(meta: DocumentMeta): LibraryEntry {
  const prov = meta.provenance;
  const url = meta.canonicalUrl ?? prov?.canonicalUrl ?? prov?.url;
  return {
    filePath: meta.filePath,
    scope: meta.scope,
    title: prov?.title ?? path.basename(meta.filePath),
    ...(url ? { url } : {}),
    ...(documentSite(meta) ? { site: documentSite(meta) } : {}),
    capturedAt: documentCapturedAt(meta),
    indexedAt: meta.indexedAt,
    ...(prov?.source ? { source: prov.source } : {}),
    ...(prov?.collection ? { collection: prov.collection } : {}),
    tags: prov?.tags ?? [],
    chunkCount: meta.chunkCount,
    size: meta.size,
    ...(meta.version ? { version: meta.version } : {}),
    captured: !!prov || !!meta.canonicalUrl,
  };
}

export interface ListLibraryOptions extends LibraryFilter {
  sort?: LibrarySort;
  order?: 'asc' | 'desc';
  limit?: number;
  now?: number;
}

/** Browse the library: filter, sort, cap. Never throws on an empty store. */
export function listLibrary(docs: DocumentMeta[], opts: ListLibraryOptions = {}): LibraryEntry[] {
  const now = opts.now ?? Date.now();
  const filtered = filterDocuments(docs, opts, now);
  const sorted = sortDocuments(filtered, opts.sort ?? 'captured', opts.order ?? 'desc');
  const capped = opts.limit && opts.limit > 0 ? sorted.slice(0, opts.limit) : sorted;
  return capped.map(libraryEntry);
}

/** Facet counts for the current view — what a sidebar renders. */
export function libraryFacets(docs: DocumentMeta[]): {
  sites: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
  collections: Array<{ value: string; count: number }>;
  sources: Array<{ value: string; count: number }>;
} {
  const tally = (values: Array<string | undefined>) => {
    const counts = new Map<string, number>();
    for (const v of values) {
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return {
    sites: tally(docs.map(documentSite)),
    tags: tally(docs.flatMap((d) => d.provenance?.tags ?? [])),
    collections: tally(docs.map((d) => d.provenance?.collection)),
    sources: tally(docs.map((d) => d.provenance?.source)),
  };
}
