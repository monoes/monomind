/**
 * Related-at-save (RCL-03) — "3 things in your brain relate to this".
 *
 * The extension calls this on EVERY capture, while the user watches. That
 * single fact sets every design decision here:
 *
 *  - it never throws. An empty store, a missing embedder, a URL that was
 *    never captured — all of them are an empty list, because a capture must
 *    not fail because the sidebar had nothing to say;
 *  - it is bounded. The vector pass races a timeout (default 2s) and the
 *    cheap signals — same URL, same site, read straight off the metadata log —
 *    are computed first, so a slow or absent embedder degrades to a fast
 *    answer instead of no answer;
 *  - the target itself is never in its own results, by path AND by canonical
 *    URL, so a re-capture does not "relate" to the version it replaced.
 *
 * Three signals, combined: exact URL (the same page, captured before),
 * same site, and vector similarity over the chunks already embedded.
 *
 * @module v1/cli/knowledge/related
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureIdentityUrl, readCaptureProvenance } from './capture-envelope.js';
import { passageQuote } from './citation.js';
import type { DocumentMeta } from './document-pipeline.js';
import { documentCapturedAt, documentSite } from './library.js';

export type RelatedReason = 'same-url' | 'same-site' | 'similar';

export interface RelatedDocument {
  filePath: string;
  scope: string;
  title: string;
  url?: string;
  site?: string;
  /** 0–1. Exact-URL matches lead; similarity and site agreement compound. */
  score: number;
  reasons: RelatedReason[];
  capturedAt?: string;
  /** The most similar passage, when similarity is one of the reasons. */
  excerpt?: string;
  chunkIndex?: number;
  anchor?: string;
}

export interface RelatedOptions {
  rootDir?: string;
  scope?: string;
  limit?: number;
  /** Budget for the vector pass. The metadata signals ignore it: they are
   *  synchronous file reads. */
  timeoutMs?: number;
  minScore?: number;
  store?: 'project' | 'global' | 'all';
  /** Text to compare against, when the caller already has it (a capture that
   *  has not been ingested yet). */
  text?: string;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MIN_SCORE = 0.25;
const QUERY_CHARS = 1200;
const SAME_URL_SCORE = 1;
/** Ceiling for everything that is not literally the same page. */
const NEAR_SCORE_CAP = 0.95;
const SAME_SITE_SCORE = 0.45;
const BOTH_SIGNALS_BONUS = 0.1;
const EXCERPT_CHARS = 200;

function stripFragment(url: string): string {
  const hash = url.indexOf('#');
  return (hash === -1 ? url : url.slice(0, hash)).trim();
}

function looksLikeUrl(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Words a URL alone gives us — the fallback query when there is no text. */
function urlWords(url: string): string {
  try {
    const u = new URL(url);
    return [u.hostname.replace(/^www\./, ''), ...u.pathname.split(/[/\-_.]+/)]
      .filter((w) => w && !/^\d+$/.test(w) && w.length > 1)
      .join(' ');
  } catch {
    return url;
  }
}

async function queryText(
  record: { filePath: string; provenance?: { title?: string } } | undefined,
  target: string,
  provided?: string,
) {
  if (provided?.trim()) return provided.slice(0, QUERY_CHARS);
  const parts: string[] = [];
  if (record?.provenance?.title) parts.push(record.provenance.title);
  if (record && fs.existsSync(record.filePath)) {
    try {
      const { extractText } = await import('../capabilities/cap-documents.js');
      const stat = fs.statSync(record.filePath);
      const text = await extractText({
        path: record.filePath,
        absolutePath: record.filePath,
        extension: path.extname(record.filePath).toLowerCase(),
        size: stat.size,
        modified: stat.mtime,
        created: stat.birthtime,
      });
      if (text) parts.push(text.slice(0, QUERY_CHARS));
    } catch {
      /* fall through to the URL words */
    }
  }
  if (!parts.length) parts.push(urlWords(looksLikeUrl(target) ? target : path.basename(target)));
  return parts.join('\n').slice(0, QUERY_CHARS);
}

/** Resolve the vector pass or give up on time — whichever comes first. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * The documents most related to `target` (a URL, a docId, or an indexed path).
 *
 * Safe to call on every capture: bounded, and empty rather than thrown on any
 * failure.
 */
export async function relatedDocuments(
  target: string,
  opts: RelatedOptions = {},
): Promise<RelatedDocument[]> {
  try {
    const pipeline = await import('./document-pipeline.js');
    const scope = opts.scope;
    const rootDir = opts.rootDir ?? pipeline.getKnowledgeRoot(scope ?? 'shared');
    const limit = opts.limit ?? DEFAULT_LIMIT;

    const self = pipeline.findDocumentRecord(rootDir, target, scope);
    // A capture that has been written but not yet ingested is the case this
    // story exists for: the extension has the directory on disk and wants to
    // know what it relates to BEFORE the ingest finishes. Its identity comes
    // from the envelope's own meta.json.
    const pending = !self && !looksLikeUrl(target) ? readCaptureProvenance(target) : null;
    const selfUrl =
      self?.canonicalUrl ??
      (looksLikeUrl(target) ? stripFragment(target) : captureIdentityUrl(pending));
    const selfSite = hostOf(selfUrl);
    const selfPaths = new Set(
      [self?.filePath, looksLikeUrl(target) ? undefined : path.resolve(target)].filter(
        (p): p is string => !!p,
      ),
    );
    // Excluding by URL is right when the target IS that page — an indexed
    // document, or a caller asking about the URL itself. It is wrong for a
    // capture still sitting in the inbox: there the earlier capture of the
    // same page is the single most related thing in the brain.
    const excludeByUrl = !!self || looksLikeUrl(target);
    const isSelf = (doc: { filePath: string; canonicalUrl?: string }) =>
      selfPaths.has(doc.filePath) || (excludeByUrl && !!selfUrl && doc.canonicalUrl === selfUrl);

    const docs = pipeline.listDocuments(rootDir, scope).filter((d) => !isSelf(d));
    const byPath = new Map(docs.map((d) => [d.filePath, d]));

    const scored = new Map<string, RelatedDocument>();
    const put = (doc: DocumentMeta, reason: RelatedReason, score: number, extra = {}) => {
      const existing = scored.get(doc.filePath);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        // Agreeing signals compound, but only the same page itself reaches 1 —
        // otherwise a same-site neighbour that also embeds well would tie with
        // the earlier capture of this very page and win on sort order.
        const cap = existing.reasons.includes('same-url') ? SAME_URL_SCORE : NEAR_SCORE_CAP;
        existing.score = Math.min(cap, Math.max(existing.score, score) + BOTH_SIGNALS_BONUS);
        Object.assign(existing, extra);
        return;
      }
      const url = doc.canonicalUrl ?? doc.provenance?.canonicalUrl ?? doc.provenance?.url;
      scored.set(doc.filePath, {
        filePath: doc.filePath,
        scope: doc.scope,
        title: doc.provenance?.title ?? path.basename(doc.filePath),
        ...(url ? { url } : {}),
        ...(documentSite(doc) ? { site: documentSite(doc) } : {}),
        score,
        reasons: [reason],
        ...(documentCapturedAt(doc) ? { capturedAt: documentCapturedAt(doc) } : {}),
        ...extra,
      });
    };

    // 1 + 2 — the cheap signals, straight off the metadata log.
    for (const doc of docs) {
      const url = doc.canonicalUrl ?? doc.provenance?.canonicalUrl;
      if (selfUrl && url && stripFragment(url) === selfUrl) put(doc, 'same-url', SAME_URL_SCORE);
      else if (selfSite && documentSite(doc) === selfSite) put(doc, 'same-site', SAME_SITE_SCORE);
    }

    // 3 — similarity, bounded. A store with no embeddings comes back empty
    // here and the metadata signals still stand.
    // For a not-yet-ingested capture the text to compare against is the file
    // the caller pointed at, read through the same extraction the ingest uses.
    const queryRecord =
      self ?? (pending ? { filePath: path.resolve(target), provenance: pending } : undefined);
    const query = await queryText(queryRecord, target, opts.text);
    if (query.trim()) {
      const hits = await withTimeout(
        pipeline.searchKnowledge(query, {
          scope: scope ?? 'shared',
          rootDir,
          limit: Math.max(limit * 6, 12),
          minScore: opts.minScore ?? DEFAULT_MIN_SCORE,
          store: opts.store ?? 'all',
        }),
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        [],
      );
      const best = new Map<string, (typeof hits)[number]>();
      for (const hit of hits) {
        if (!hit.filePath || selfPaths.has(hit.filePath)) continue;
        const current = best.get(hit.filePath);
        if (!current || hit.similarity > current.similarity) best.set(hit.filePath, hit);
      }
      for (const [filePath, hit] of best) {
        const doc = byPath.get(filePath);
        if (!doc || isSelf(doc)) continue;
        put(doc, 'similar', Math.min(1, hit.similarity), {
          excerpt: passageQuote(hit.text ?? '', EXCERPT_CHARS),
          chunkIndex: hit.chunkIndex,
          ...(hit.anchor ? { anchor: hit.anchor } : {}),
        });
      }
    }

    return [...scored.values()]
      .sort((a, b) => b.score - a.score || (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''))
      .slice(0, limit);
  } catch (err) {
    // Called on every capture: an unexpected failure is "nothing related",
    // never a broken save. It is still a bug when it is one of ours, so it is
    // visible under DEBUG rather than only in an empty sidebar.
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      console.error(`[relatedDocuments] ${target}:`, err);
    }
    return [];
  }
}
