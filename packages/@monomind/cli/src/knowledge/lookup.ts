/**
 * "Have I already saved this?" (RCL-02) — one URL in, one answer out.
 *
 * The browser extension asks this on every navigation. That is the only
 * thing that shapes this module:
 *
 *  - it NEVER throws. An empty store, a store that has never been written,
 *    a URL that is not a URL — all of them are `{saved: false}`, because a
 *    page load must not be able to fail on a badge;
 *  - it is a pure read. No embedder, no subprocess, no index write. The
 *    answer comes off the metadata log, which is a file read;
 *  - it answers the WHOLE question in one call. `doc list` can already say
 *    that a URL is present, but not what note was written at save time —
 *    and "you saved this, and here is why you said you were saving it" is
 *    the entire value of the badge over a bookmark.
 *
 * Identity is `captureIdentityUrl`'s rule and nothing else: canonical URL
 * when the capturer resolved one, fragment stripped, nothing else rewritten.
 * Matching more loosely than the ingest side would make the badge claim
 * pages are saved that cannot actually be found again.
 *
 * @module v1/cli/knowledge/lookup
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CaptureProvenance, isCaptureEnvelope } from './capture-envelope.js';
import {
  type DocumentMeta,
  getKnowledgeRoot,
  listDocuments,
  listDocumentVersions,
} from './document-pipeline.js';
import { documentCapturedAt, documentSite } from './library.js';

/** What the badge and the "already saved" panel render. */
export interface UrlLookup {
  saved: boolean;
  /** The identity URL the lookup was performed against. */
  url: string;
  title?: string;
  site?: string;
  /** When the page was captured (not when it was indexed). */
  capturedAt?: string;
  /** RCL-06: 1 for a first save, +1 per stored revision. 0 when unsaved. */
  versions: number;
  /** The note written at save time (CLIP-07) — the reason it was kept. */
  note?: string;
  tags: string[];
  collection?: string;
  source?: string;
  /** The indexed file (`…/readable.md`). */
  filePath?: string;
  /** The capture envelope directory holding it — what "open the archived
   *  copy" opens. Absent when the document is an ordinary file on disk. */
  envelope?: string;
  scope?: string;
  contentHash?: string;
  /** RCL-04: how many highlight notes were saved on this page. */
  highlights?: number;
}

export interface LookupOptions {
  rootDir?: string;
  scope?: string;
  /** Skip the `highlights.json` read. The badge path does not need it. */
  withHighlights?: boolean;
}

const EMPTY = (url: string): UrlLookup => ({ saved: false, url, versions: 0, tags: [] });

/**
 * identityUrl mirrors `captureIdentityUrl` for a raw URL rather than a
 * provenance record: drop the fragment, trim, rewrite nothing else.
 *
 * Duplicated deliberately rather than reshaping the URL into a fake
 * `CaptureProvenance` to borrow that function — the two callers mean
 * different things ("the URL a tab is on" vs. "what this capture is of")
 * and only happen to agree on the rule.
 */
export function identityUrl(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  const hash = s.indexOf('#');
  return (hash === -1 ? s : s.slice(0, hash)).trim();
}

/** The identity URL a record is addressable by, or undefined. */
function recordUrl(meta: DocumentMeta): string | undefined {
  const url = meta.canonicalUrl ?? meta.provenance?.canonicalUrl ?? meta.provenance?.url;
  return url ? identityUrl(url) : undefined;
}

/**
 * countHighlights reads the `highlights.json` the extension wrote beside
 * the document (RCL-04). Silent on every failure: the count is decoration
 * on an answer that is already complete without it.
 */
function countHighlights(envelope: string): number {
  try {
    const file = path.join(envelope, 'highlights.json');
    if (!fs.existsSync(file)) return 0;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed?.highlights) ? parsed.highlights.length : 0;
  } catch {
    return 0;
  }
}

/** The envelope directory for an indexed file, or undefined when the file
 *  is not inside one. */
export function envelopeFor(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const dir = path.dirname(path.resolve(filePath));
  try {
    return isCaptureEnvelope(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

function provenanceOf(meta: DocumentMeta): CaptureProvenance {
  return meta.provenance ?? {};
}

/**
 * lookupUrl answers whether this URL is in the store, and what is known
 * about it. `rootDir` is the store to look in; pass the global brain's root
 * to ask the personal store.
 */
export function lookupUrl(rawUrl: string, opts: LookupOptions = {}): UrlLookup {
  const url = identityUrl(rawUrl);
  if (!url) return EMPTY('');

  // The SAME routing the ingest used: scope `global` lives in the personal
  // cross-project brain, not under `rootDir`. Reading the wrong store would
  // report every globally-captured page as unsaved.
  let root: string | undefined;
  let docs: DocumentMeta[];
  try {
    root = opts.scope ? getKnowledgeRoot(opts.scope, opts.rootDir) : opts.rootDir;
    docs = listDocuments(root, opts.scope);
  } catch {
    // A store that has never been written, or one this process cannot
    // read. Neither is an error worth failing a page load over.
    return EMPTY(url);
  }

  const matches = docs.filter((d) => recordUrl(d) === url);
  if (!matches.length) return EMPTY(url);

  // The live record with the highest version. A re-captured page lands at
  // a new path, so several records can match and only the newest is the
  // one the badge should describe.
  const best = matches.reduce((a, b) => ((b.version ?? 0) > (a.version ?? 0) ? b : a));
  const prov = provenanceOf(best);

  // The version COUNT is the larger of the record's own number and what
  // the append-only log still holds: the log is compacted past 1MB, and
  // the `version` field is the durable count. Reading only the log would
  // under-report a long-lived document.
  let logged = 0;
  try {
    logged = listDocumentVersions(root, best.canonicalUrl ?? url, opts.scope).length;
  } catch {
    logged = 0;
  }
  const versions = Math.max(best.version ?? 1, logged, 1);

  const envelope = envelopeFor(best.filePath);
  const answer: UrlLookup = {
    saved: true,
    url,
    versions,
    tags: prov.tags ?? [],
    ...(prov.title ? { title: prov.title } : {}),
    ...(documentSite(best) ? { site: documentSite(best) } : {}),
    ...(documentCapturedAt(best) ? { capturedAt: documentCapturedAt(best) } : {}),
    ...(prov.note ? { note: prov.note } : {}),
    ...(prov.collection ? { collection: prov.collection } : {}),
    ...(prov.source ? { source: prov.source } : {}),
    filePath: best.filePath,
    ...(envelope ? { envelope } : {}),
    scope: best.scope,
    ...(best.contentHash ? { contentHash: best.contentHash } : {}),
  };

  if (opts.withHighlights && envelope) {
    const count = countHighlights(envelope);
    if (count) answer.highlights = count;
  }
  return answer;
}

/**
 * lookupUrls answers a batch in one pass over the metadata, for a caller
 * with several tabs to ask about. Same rules, same guarantees.
 */
export function lookupUrls(urls: readonly string[], opts: LookupOptions = {}): UrlLookup[] {
  return urls.map((u) => lookupUrl(u, opts));
}
