/**
 * Paragraph-level citation (RCL-10).
 *
 * A search hit already knows WHICH document it came from. A citation has to
 * know WHERE IN IT: the character span of the chunk against the extracted
 * text, an anchor that survives being written down, and a way back to the
 * live page at that passage.
 *
 * Three pieces, deliberately separate:
 *
 *  - `span:<start>-<end>` — a tag written next to every chunk at ingest, so a
 *    search result carries offsets without re-reading the document.
 *  - the ANCHOR `<hash12>#<start>-<end>` — offsets bound to the content hash
 *    of the exact version they were measured against. Quoting an offset range
 *    without the version it belongs to is how citations rot: the document is
 *    re-captured, the text shifts, and the quote silently points at other
 *    words. A stale anchor here is DETECTED (`stale: true`), never served as
 *    if it were still true.
 *  - a W3C text fragment (`#:~:text=`) — the link a human clicks, which lands
 *    on the sentence even though the site never had an id there.
 *
 * Everything above `resolveCitation` is pure and synchronous so the pipeline
 * can use it while ingesting. `resolveCitation` reaches back into the
 * document-pipeline through a DYNAMIC import: the pipeline imports this
 * module statically, and a static import back would close the cycle.
 *
 * @module v1/cli/knowledge/citation
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CaptureProvenance } from './capture-envelope.js';

export const SPAN_TAG_PREFIX = 'span:';

export interface ChunkSpan {
  chunkIndex: number;
  startChar: number;
  endChar: number;
}

/** The tag written beside a chunk at ingest: `span:<start>-<end>`. */
export function spanTag(startChar: number, endChar: number): string {
  return `${SPAN_TAG_PREFIX}${startChar}-${endChar}`;
}

/** Offsets from a chunk's tag list, or null when it predates span tags. */
export function parseSpanTag(tags: readonly string[] | undefined): {
  startChar: number;
  endChar: number;
} | null {
  for (const tag of tags ?? []) {
    if (typeof tag !== 'string' || !tag.startsWith(SPAN_TAG_PREFIX)) continue;
    const m = /^span:(\d+)-(\d+)$/.exec(tag);
    if (!m) continue;
    const startChar = Number(m[1]);
    const endChar = Number(m[2]);
    if (endChar < startChar) continue;
    return { startChar, endChar };
  }
  return null;
}

const ANCHOR_HASH_CHARS = 12;

/** `<hash12>#<start>-<end>` — offsets bound to the version they were measured against. */
export function citationAnchor(contentHash: string, startChar: number, endChar: number): string {
  return `${(contentHash || '').slice(0, ANCHOR_HASH_CHARS)}#${startChar}-${endChar}`;
}

export function parseCitationAnchor(
  anchor: string,
): { hashPrefix: string; startChar: number; endChar: number } | null {
  const m = /^([0-9a-f]{4,64})#(\d+)-(\d+)$/.exec((anchor || '').trim());
  if (!m) return null;
  const startChar = Number(m[2]);
  const endChar = Number(m[3]);
  if (endChar < startChar) return null;
  return { hashPrefix: m[1], startChar, endChar };
}

/** True when the anchor was cut against this document version. */
export function anchorMatchesHash(anchor: string, contentHash: string): boolean {
  const parsed = parseCitationAnchor(anchor);
  if (!parsed) return false;
  return (contentHash || '').startsWith(parsed.hashPrefix);
}

// ── Quotes and links ───────────────────────────────────────────────

const QUOTE_MAX_CHARS = 320;

const CONTEXT_PREFIX_RE = /^(§ [^\n]*\n)+/;
const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s+/;

/**
 * One line of markdown as the words a reader sees.
 *
 * This matters more than it looks: a text fragment built from `# Pricing ##
 * Starter Nine dollars` matches NOTHING on the live page, because the page
 * never contained a `#`. The link is only worth having if it is made of the
 * prose the site actually renders.
 */
function stripMarkdown(line: string): string {
  return line
    .replace(HEADING_LINE_RE, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .trim();
}

/**
 * The prose of a passage: § context prefixes gone, markdown syntax gone,
 * whitespace collapsed.
 *
 * `skipHeadings` drops heading lines as well, which is what a text fragment
 * wants — a heading is usually its own element on the page, so starting a
 * range there matches less reliably than starting at the paragraph. It falls
 * back to including them when the passage is nothing but headings.
 */
export function passageProse(passage: string, skipHeadings = false): string {
  const lines = String(passage ?? '')
    .replace(CONTEXT_PREFIX_RE, '')
    .split('\n');
  const keep = (only: boolean) =>
    lines
      .filter((l) => !only || !HEADING_LINE_RE.test(l))
      .map(stripMarkdown)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const body = keep(skipHeadings);
  return body || keep(false);
}

/** The head of a passage as a quotable sentence or two — the words a reader
 *  would see on the page, not the markdown we stored. */
export function passageQuote(passage: string, maxChars = QUOTE_MAX_CHARS): string {
  const text = passageProse(passage);
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const stop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
  );
  return stop > maxChars * 0.4 ? window.slice(0, stop + 1) : `${window.trimEnd()}…`;
}

/** `,` and `-` are syntax inside a text fragment, so they cannot be left raw. */
function encodeFragmentPart(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D').replace(/,/g, '%2C');
}

const FRAGMENT_WORDS = 8;

/**
 * A W3C scroll-to-text fragment for this passage.
 *
 * Long passages use the `textStart,textEnd` form rather than the whole
 * paragraph: the spec matches across the range, and a shorter pair survives
 * the site re-flowing its markup between capture and click.
 */
export function textFragment(passage: string): string {
  const text = passageProse(passage, true).slice(0, 2000);
  if (!text) return '';
  const words = text.split(' ').filter(Boolean);
  if (words.length <= FRAGMENT_WORDS * 2) return `:~:text=${encodeFragmentPart(text)}`;
  const start = words.slice(0, FRAGMENT_WORDS).join(' ');
  const end = words.slice(-FRAGMENT_WORDS).join(' ');
  return `:~:text=${encodeFragmentPart(start)},${encodeFragmentPart(end)}`;
}

/** The captured page's URL, pointed at the passage. Returns undefined when
 *  there is no URL — a citation into a local file has no link to give. */
export function citationUrl(url: string | undefined, passage: string): string | undefined {
  if (!url) return undefined;
  const fragment = textFragment(passage);
  if (!fragment) return url;
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  return `${base}#${fragment}`;
}

// ── Resolution ─────────────────────────────────────────────────────

export interface Citation {
  /** `<scope>:<filePath>` — the pipeline's own document id. */
  docId: string;
  filePath: string;
  scope: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  /** Hash of the text the offsets were cut against, i.e. the file as it is NOW. */
  contentHash: string;
  anchor: string;
  /** The cited text itself, straight out of the extracted document. */
  passage: string;
  /** The head of the passage, collapsed — what an agent puts in quotes. */
  quote: string;
  /** Present only when the anchor asked for a version this file no longer is. */
  stale?: boolean;
  version?: number;
  title?: string;
  url?: string;
  /** `url` with a text fragment appended: the link that lands on the passage. */
  citeUrl?: string;
  capturedAt?: string;
  source?: string;
  provenance?: CaptureProvenance;
}

export interface ResolveCitationOptions {
  rootDir?: string;
  scope?: string;
  /** Chunk index, as reported on a search hit. */
  chunkIndex?: number;
  /** An anchor string from a previous citation — resolved by offsets, and
   *  flagged `stale` when it names a version this document no longer is. */
  anchor?: string;
}

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

/**
 * Resolve a citation back to the passage it came from.
 *
 * `target` is whatever the caller has written down: an indexed file path, a
 * capture's `canonicalUrl`, or the `<scope>:<path>` docId. Throws with a
 * message meant for a human when the document is not indexed, its file is
 * gone, or the chunk does not exist — a citation that cannot be checked must
 * fail loudly, not resolve to an empty string.
 */
export async function resolveCitation(
  target: string,
  opts: ResolveCitationOptions = {},
): Promise<Citation> {
  const pipeline = await import('./document-pipeline.js');
  const { extractText } = await import('../capabilities/cap-documents.js');
  const rootDir = opts.rootDir ?? pipeline.getKnowledgeRoot(opts.scope);
  const scope = opts.scope;

  const record = pipeline.findDocumentRecord(rootDir, target, scope);
  if (!record) throw new Error(`not indexed: ${target}`);
  if (!fs.existsSync(record.filePath)) {
    throw new Error(`source file is gone: ${record.filePath} (re-ingest the capture to cite it)`);
  }

  const text = await extractText(fileEntry(record.filePath));
  if (!text) throw new Error(`no text could be extracted from ${record.filePath}`);
  const hash = crypto.createHash('sha256').update(text).digest('hex');

  let startChar: number;
  let endChar: number;
  let chunkIndex: number;
  const parsedAnchor = opts.anchor ? parseCitationAnchor(opts.anchor) : null;
  if (opts.anchor && !parsedAnchor) throw new Error(`malformed citation anchor: ${opts.anchor}`);

  if (parsedAnchor) {
    startChar = Math.min(parsedAnchor.startChar, text.length);
    endChar = Math.min(parsedAnchor.endChar, text.length);
    const spans = await pipeline.chunkSpans(text);
    chunkIndex = spans.findIndex((s) => s.startChar === startChar);
    if (chunkIndex === -1) {
      chunkIndex = spans.findIndex((s) => s.startChar <= startChar && startChar < s.endChar);
    }
  } else {
    chunkIndex = opts.chunkIndex ?? 0;
    const spans = await pipeline.chunkSpans(text);
    const span = spans[chunkIndex];
    if (!span) {
      throw new Error(
        `chunk ${chunkIndex} is out of range: ${path.basename(record.filePath)} has ${spans.length} chunk(s)`,
      );
    }
    startChar = span.startChar;
    endChar = span.endChar;
  }

  const passage = text.slice(startChar, endChar);
  const url = record.canonicalUrl ?? record.provenance?.canonicalUrl ?? record.provenance?.url;
  const stale = parsedAnchor
    ? !anchorMatchesHash(opts.anchor as string, hash)
    : hash !== record.contentHash;

  return {
    docId: `${record.scope}:${record.filePath}`,
    filePath: record.filePath,
    scope: record.scope,
    chunkIndex: chunkIndex === -1 ? 0 : chunkIndex,
    startChar,
    endChar,
    contentHash: hash,
    anchor: citationAnchor(hash, startChar, endChar),
    passage,
    quote: passageQuote(passage),
    ...(stale ? { stale: true } : {}),
    ...(record.version ? { version: record.version } : {}),
    ...(record.provenance?.title ? { title: record.provenance.title } : {}),
    ...(url ? { url, citeUrl: citationUrl(url, passage) } : {}),
    ...(record.provenance?.capturedAt ? { capturedAt: record.provenance.capturedAt } : {}),
    ...(record.provenance?.source ? { source: record.provenance.source } : {}),
    ...(record.provenance ? { provenance: record.provenance } : {}),
  };
}
