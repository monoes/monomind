/**
 * The capture envelope (RCL-07) — provenance as a first-class record.
 *
 * Every capture, wherever it came from, lands in one directory:
 *
 *   page.mhtml       byte-fidelity archive (CDP Page.captureSnapshot)
 *   page.pdf         optional print fidelity
 *   readable.md      Readability-cleaned Markdown — what gets chunked
 *   screenshot.png   full-page, for the document card
 *   meta.json        provenance (this module)
 *
 * EVERYTHING HERE IS DEFENSIVE. `meta.json` is written by a browser extension
 * on a machine we do not control; it can be absent, truncated mid-write,
 * half-populated by an adapter that bailed, or carry a `tags` that is a string
 * instead of an array. None of that may fail an ingest: a document with no
 * provenance is worth indexing, a failed ingest is worth nothing. Every reader
 * below returns a value or null and never throws.
 *
 * @module v1/cli/knowledge/capture-envelope
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidProfileId } from './profile-store.js';

export const ENVELOPE_META_FILE = 'meta.json';
export const ENVELOPE_READABLE_FILE = 'readable.md';

/** Envelope members, best representation first. */
export const ENVELOPE_DOCUMENTS = [
  'readable.md',
  'page.html',
  'page.htm',
  'page.xhtml',
  'page.mhtml',
  'page.mht',
  'page.pdf',
] as const;

export interface CaptureProvenance {
  url?: string;
  canonicalUrl?: string;
  title?: string;
  byline?: string;
  publishedAt?: string;
  capturedAt?: string;
  httpStatus?: number;
  /** Hash of the captured RAW bytes, as written by the capturer. Document
   *  identity keys on the EXTRACTED text hash instead — see document-pipeline
   *  — because two byte-different archives of one unchanged article are the
   *  same document. */
  contentHash?: string;
  favicon?: string;
  note?: string;
  selection?: string;
  tags?: string[];
  collection?: string;
  /** `extension` | `monobrowse` | `crawl`, per the capture contract. */
  source?: string;
  /** The mono-agent profile this capture was filed into, when it named one.
   *  It decides which store ingests the capture (knowledge/profile-store),
   *  so an id that could not be a directory name is dropped here rather
   *  than carried into the index. */
  profile?: string;
}

const MAX_META_BYTES = 1024 * 1024;

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function strArray(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out = items.map(str).filter((v): v is string => v !== undefined);
  return out.length ? out : undefined;
}

function int(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Keep only keys we understand, coerced to the declared type. An unknown or
 *  wrong-typed field is dropped rather than carried into the index. */
export function normalizeProvenance(raw: unknown): CaptureProvenance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const meta: CaptureProvenance = {
    url: str(o.url),
    canonicalUrl: str(o.canonicalUrl),
    title: str(o.title),
    byline: str(o.byline),
    publishedAt: str(o.publishedAt),
    capturedAt: str(o.capturedAt),
    httpStatus: int(o.httpStatus),
    contentHash: str(o.contentHash),
    favicon: str(o.favicon),
    note: str(o.note),
    selection: str(o.selection),
    tags: strArray(o.tags),
    collection: str(o.collection),
    source: str(o.source),
    profile: isValidProfileId(o.profile) ? o.profile.trim() : undefined,
  };
  for (const key of Object.keys(meta) as Array<keyof CaptureProvenance>) {
    if (meta[key] === undefined) delete meta[key];
  }
  return Object.keys(meta).length ? meta : null;
}

/** Read and normalize the `meta.json` sitting next to `filePath`. Returns null
 *  when there is none, it is unreadable, oversized, or not valid JSON. */
export function readCaptureProvenance(filePath: string): CaptureProvenance | null {
  const metaPath = path.join(path.dirname(path.resolve(filePath)), ENVELOPE_META_FILE);
  try {
    if (!fs.existsSync(metaPath)) return null;
    if (fs.statSync(metaPath).size > MAX_META_BYTES) return null;
    return normalizeProvenance(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
  } catch {
    return null;
  }
}

/** True when `dir` looks like a capture envelope rather than an ordinary
 *  folder that happens to contain HTML. */
export function isCaptureEnvelope(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ENVELOPE_META_FILE));
  } catch {
    return false;
  }
}

/**
 * The `readable.md` that supersedes `filePath`, or null.
 *
 * WHY IT WINS — `readable.md` was produced by Readability against the LIVE
 * DOM, with lazy images resolved, the consent modal dismissed and the site's
 * own JS having finished. Re-deriving text from the archived markup can only
 * be worse. The archive is kept for fidelity; the readable pass is kept for
 * meaning, and meaning is what gets chunked.
 *
 * Guarded so a plain directory of HTML files that happens to hold one
 * `readable.md` does not collapse to a single document: either the directory
 * is a real envelope (it has `meta.json`) or the file is the envelope's
 * `page.*`.
 */
export function readableSiblingFor(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);
  if (base === ENVELOPE_READABLE_FILE) return null;
  if (!isCaptureEnvelope(dir) && path.basename(base, path.extname(base)) !== 'page') return null;
  const readable = path.join(dir, ENVELOPE_READABLE_FILE);
  try {
    return fs.existsSync(readable) && fs.statSync(readable).size > 0 ? readable : null;
  } catch {
    return null;
  }
}

/** The envelope member that should represent `dir` as a document, or null when
 *  `dir` is not an envelope. */
export function envelopePrimaryDocument(dir: string): string | null {
  if (!isCaptureEnvelope(dir)) return null;
  for (const name of ENVELOPE_DOCUMENTS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * The identity URL for dedupe: `canonicalUrl` when the capturer resolved one,
 * otherwise `url`. The fragment is dropped — `#section-3` is a scroll
 * position, not a different document — and nothing else is rewritten, because
 * query strings and trailing slashes DO distinguish pages on real sites.
 */
export function captureIdentityUrl(meta: CaptureProvenance | null | undefined): string | undefined {
  const url = meta?.canonicalUrl ?? meta?.url;
  if (!url) return undefined;
  const hash = url.indexOf('#');
  const trimmed = (hash === -1 ? url : url.slice(0, hash)).trim();
  return trimmed || undefined;
}
