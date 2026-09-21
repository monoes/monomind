/**
 * Highlights as atomic notes (RCL-04) — the ingest half.
 *
 * The extension writes `highlights.json` into the capture envelope beside
 * `readable.md` (chrome-extension/highlights.js). This module turns each
 * entry into a NOTE IN ITS OWN RIGHT that points back at the document it
 * came from — searchable on its own terms, not buried inside a chunk of
 * the page it was taken from.
 *
 * WHY A CHILD NOTE AND NOT A TAG ON THE PARENT. A highlight is a claim
 * about what mattered, made by the reader, at a moment. Folding it into the
 * parent's chunks loses all three: it stops being separately findable, it
 * stops carrying its own comment, and it stops having a date. So each one
 * is stored as its own entry, keyed under the parent's content hash, and
 * linked back by `parent:` and `url:` tags.
 *
 * THE ANCHOR is the careful part. The extension measured its offsets
 * against the LIVE PAGE'S TEXT; what got indexed is `readable.md`, a
 * Readability pass over that same DOM. The two are close and not identical.
 * So the offsets that arrive are treated as a hint and the QUOTE is treated
 * as the truth: `locate` re-locates the quote in the extracted text and
 * cuts a real citation anchor (`<hash12>#<start>-<end>`, citation.ts's
 * shape) against the version it actually found. A highlight whose text is
 * not in the document at all gets NO anchor rather than a plausible wrong
 * one — the same rule citation.ts applies to a stale anchor, for the same
 * reason.
 *
 * Everything here is as defensive as capture-envelope.ts, and for the same
 * reason: `highlights.json` was written by a browser extension on a machine
 * we do not control, and a malformed one must cost the capture nothing.
 *
 * @module v1/cli/knowledge/highlights
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CaptureProvenance } from './capture-envelope.js';
import { citationAnchor, citationUrl, passageQuote } from './citation.js';

export const HIGHLIGHTS_FILE = 'highlights.json';

/** Tag namespaces, so a highlight is findable as one and traceable to its
 *  parent without parsing anything. */
export const HIGHLIGHT_TAG = 'highlight';
export const PARENT_TAG_PREFIX = 'parent:';
export const URL_TAG_PREFIX = 'url:';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_HIGHLIGHTS = 500;
const MAX_TEXT = 4000;
const MAX_COMMENT = 2000;

/** The anchor as the extension measured it — offsets against the page's
 *  visible text, plus the quote and its neighbourhood. */
export interface HighlightAnchor {
  /** A HINT. Measured against the live page, not the extracted text. */
  startChar?: number;
  endChar?: number;
  /** The truth. What the reader actually selected. */
  quote: string;
  prefix?: string;
  suffix?: string;
  /** W3C `:~:text=` fragment, as citation.ts builds one. */
  fragment?: string;
}

export interface Highlight {
  id: string;
  text: string;
  anchor: HighlightAnchor;
  createdAt?: string;
  comment?: string;
  color?: string;
  /** The page URL pointed at this passage, as the extension wrote it. */
  url?: string;
}

/** One highlight, resolved against the document it belongs to. */
export interface HighlightNote {
  id: string;
  /** `<scope>:<filePath>` — the parent document's own id. */
  parentDocId: string;
  parentPath: string;
  scope: string;
  /** The parent's identity URL. */
  parentUrl?: string;
  parentTitle?: string;
  text: string;
  quote: string;
  comment?: string;
  createdAt?: string;
  color?: string;
  /** `<hash12>#<start>-<end>` against the EXTRACTED text — present only
   *  when the quote was actually found there. */
  anchor?: string;
  startChar?: number;
  endChar?: number;
  /** The link that lands on the passage in the live page. */
  citeUrl?: string;
  capturedAt?: string;
  /** What gets stored and embedded: the highlight, its note, its source. */
  content: string;
  tags: string[];
}

// ── Reading ────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim().slice(0, max).trim();
  return trimmed ? trimmed : undefined;
};

const int = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** Keep only what we understand, coerced. An entry with no text is not a
 *  highlight and is dropped rather than carried through as an empty note. */
export function normalizeHighlight(raw: unknown, index = 0): Highlight | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text, MAX_TEXT);
  if (!text) return null;

  const rawAnchor =
    o.anchor && typeof o.anchor === 'object' && !Array.isArray(o.anchor)
      ? (o.anchor as Record<string, unknown>)
      : {};
  const quote = str(rawAnchor.quote, MAX_TEXT) ?? text;

  const anchor: HighlightAnchor = { quote };
  const start = int(rawAnchor.startChar);
  const end = int(rawAnchor.endChar);
  if (start !== undefined) anchor.startChar = start;
  if (end !== undefined && (start === undefined || end >= start)) anchor.endChar = end;
  const prefix = str(rawAnchor.prefix, 200);
  const suffix = str(rawAnchor.suffix, 200);
  const fragment = str(rawAnchor.fragment, 4000);
  if (prefix) anchor.prefix = prefix;
  if (suffix) anchor.suffix = suffix;
  if (fragment) anchor.fragment = fragment;

  return {
    id: str(o.id, 128) ?? `hl-${index}`,
    text,
    anchor,
    ...(str(o.createdAt, 64) ? { createdAt: str(o.createdAt, 64) } : {}),
    ...(str(o.comment, MAX_COMMENT) ? { comment: str(o.comment, MAX_COMMENT) } : {}),
    ...(str(o.color, 32) ? { color: str(o.color, 32) } : {}),
    ...(str(o.url, 4000) ? { url: str(o.url, 4000) } : {}),
  };
}

/**
 * readHighlights reads the `highlights.json` sitting in `dir`. Returns an
 * empty list — never throws — when there is none, it is unreadable,
 * oversized, not JSON, or the wrong shape entirely.
 */
export function readHighlights(dir: string): Highlight[] {
  const file = path.join(path.resolve(dir), HIGHLIGHTS_FILE);
  try {
    if (!fs.existsSync(file)) return [];
    if (fs.statSync(file).size > MAX_FILE_BYTES) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.highlights;
    if (!Array.isArray(list)) return [];

    const out: Highlight[] = [];
    const seen = new Set<string>();
    for (const [i, raw] of list.slice(0, MAX_HIGHLIGHTS).entries()) {
      const h = normalizeHighlight(raw, i);
      if (!h || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
    return out;
  } catch {
    return [];
  }
}

/** readHighlightsFor reads the highlights belonging to an indexed file,
 *  i.e. the ones in its envelope directory. */
export function readHighlightsFor(filePath: string): Highlight[] {
  return readHighlights(path.dirname(path.resolve(filePath)));
}

// ── Resolving ──────────────────────────────────────────────────────

/**
 * locate finds a highlight's quote in the extracted text and returns its
 * span there, or null.
 *
 * The order is the order of trustworthiness, and it is the SAME order the
 * extension's own restore path uses (chrome-extension/highlights.js
 * `relocate`), so a highlight that can be painted back onto the page can
 * also be cited out of the archive:
 *
 *  1. prefix + quote + suffix — the neighbourhood, which survives the
 *     Readability pass dropping a nav bar above it;
 *  2. the occurrence nearest the recorded offset, for a quote that appears
 *     more than once;
 *  3. nothing. A quote that is not in the document gets no anchor. It is
 *     still stored as a note — the reader did read it — but a citation
 *     that cannot be checked is not offered as if it could.
 */
export function locate(
  text: string,
  anchor: HighlightAnchor,
): { startChar: number; endChar: number } | null {
  const haystack = String(text ?? '');
  const quote = String(anchor?.quote ?? '');
  if (!quote || !haystack) return null;

  if (anchor.prefix || anchor.suffix) {
    const window = `${anchor.prefix ?? ''}${quote}${anchor.suffix ?? ''}`;
    const at = haystack.indexOf(window);
    if (at !== -1) {
      const start = at + (anchor.prefix ?? '').length;
      return { startChar: start, endChar: start + quote.length };
    }
  }

  const hint = anchor.startChar;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let at = haystack.indexOf(quote); at !== -1; at = haystack.indexOf(quote, at + 1)) {
    if (hint === undefined) {
      best = at;
      break;
    }
    const distance = Math.abs(at - hint);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
  }
  if (best === -1) return null;
  return { startChar: best, endChar: best + quote.length };
}

export interface ParentDocument {
  filePath: string;
  scope: string;
  /** Hash of the EXTRACTED text — the same one the anchor binds to. */
  contentHash: string;
  /** The extracted text itself, when the caller has it. Without it, no
   *  anchor can be cut and the notes are stored unanchored. */
  text?: string;
  canonicalUrl?: string;
  provenance?: CaptureProvenance;
}

/** A note's stored body: the passage, the reader's comment, and where it
 *  came from — so a search hit is legible without another lookup. */
function noteContent(note: {
  text: string;
  comment?: string;
  parentTitle?: string;
  parentUrl?: string;
}): string {
  const lines = [note.text];
  if (note.comment) lines.push('', `Note: ${note.comment}`);
  const source = note.parentTitle || note.parentUrl;
  if (source) lines.push('', `— ${source}`);
  return lines.join('\n');
}

/**
 * highlightNotes turns an envelope's highlights into notes against a parent
 * document. Pure: it reads nothing and writes nothing, so it is the whole
 * of the interesting behaviour and the whole of what is tested.
 */
export function highlightNotes(
  parent: ParentDocument,
  highlights: readonly Highlight[],
): HighlightNote[] {
  const parentDocId = `${parent.scope}:${parent.filePath}`;
  const parentUrl =
    parent.canonicalUrl ?? parent.provenance?.canonicalUrl ?? parent.provenance?.url;
  const parentTitle = parent.provenance?.title;
  const capturedAt = parent.provenance?.capturedAt;

  return highlights.map((h) => {
    const span = parent.text ? locate(parent.text, h.anchor) : null;
    const note: HighlightNote = {
      id: h.id,
      parentDocId,
      parentPath: parent.filePath,
      scope: parent.scope,
      ...(parentUrl ? { parentUrl } : {}),
      ...(parentTitle ? { parentTitle } : {}),
      text: h.text,
      quote: passageQuote(h.text),
      ...(h.comment ? { comment: h.comment } : {}),
      ...(h.createdAt ? { createdAt: h.createdAt } : {}),
      ...(h.color ? { color: h.color } : {}),
      ...(span
        ? {
            anchor: citationAnchor(parent.contentHash, span.startChar, span.endChar),
            startChar: span.startChar,
            endChar: span.endChar,
          }
        : {}),
      // The extension already built a text-fragment link; prefer it, and
      // fall back to building one the same way citation.ts does.
      ...(h.url
        ? { citeUrl: h.url }
        : parentUrl
          ? { citeUrl: citationUrl(parentUrl, h.text) }
          : {}),
      ...(capturedAt ? { capturedAt } : {}),
      content: '',
      tags: [
        HIGHLIGHT_TAG,
        `${PARENT_TAG_PREFIX}${parentDocId}`,
        ...(parentUrl ? [`${URL_TAG_PREFIX}${parentUrl}`] : []),
        ...(h.color ? [`color:${h.color}`] : []),
      ],
    };
    note.content = noteContent(note);
    return note;
  });
}

// ── Storing ────────────────────────────────────────────────────────

export interface IngestHighlightsResult {
  /** How many notes were stored. */
  stored: number;
  /** How many were found in the envelope at all. */
  found: number;
  /** How many resolved to a citable span in the extracted text. */
  anchored: number;
  notes: HighlightNote[];
  error?: string;
}

const KNOWLEDGE_NS_PREFIX = 'knowledge:';

/** The storage key for one highlight. Keyed under the PARENT'S content
 *  hash, so re-ingesting the same version upserts the same notes rather
 *  than accumulating a copy per ingest — the same discipline as the
 *  pipeline's `doc:<hash>:<index>` chunk keys. */
export function highlightKey(parentContentHash: string, id: string): string {
  return `highlight:${parentContentHash}:${id}`;
}

/** The memory bridge, or null when it is not available. Mirrors
 *  document-pipeline's own lazy import, which keeps this module usable in
 *  a process that has no store at all. */
type Bridge = {
  bridgeStoreEntry: (o: {
    key: string;
    value: string;
    namespace: string;
    generateEmbeddingFlag?: boolean;
    tags?: string[];
    upsert?: boolean;
    dbPath?: string;
  }) => Promise<{ success?: boolean } | undefined>;
};

async function getBridge(): Promise<Bridge | null> {
  try {
    return (await import('../memory/memory-bridge.js')) as unknown as Bridge;
  } catch {
    return null;
  }
}

/**
 * ingestHighlights stores an envelope's highlights as notes linked to the
 * parent document.
 *
 * Reports rather than throws: a capture whose highlights could not be
 * stored is still a perfectly good capture, and failing the whole ingest
 * over the annotations would lose the page as well as the notes.
 */
export async function ingestHighlights(
  parent: ParentDocument,
  opts: { highlights?: readonly Highlight[]; dbPath?: string } = {},
): Promise<IngestHighlightsResult> {
  const highlights = opts.highlights ?? readHighlightsFor(parent.filePath);
  const notes = highlightNotes(parent, highlights);
  const anchored = notes.filter((n) => n.anchor).length;
  const base: IngestHighlightsResult = {
    stored: 0,
    found: highlights.length,
    anchored,
    notes,
  };
  if (!notes.length) return base;

  const bridge = await getBridge();
  if (!bridge) return { ...base, error: 'memory bridge unavailable — no highlights stored' };

  let stored = 0;
  for (const note of notes) {
    try {
      const result = await bridge.bridgeStoreEntry({
        key: highlightKey(parent.contentHash, note.id),
        value: note.content,
        namespace: `${KNOWLEDGE_NS_PREFIX}${parent.scope}`,
        generateEmbeddingFlag: true,
        tags: note.tags,
        upsert: true,
        ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
      });
      if (result?.success) stored++;
    } catch {
      // One note failing is not the others' problem, and the count below
      // reports the shortfall honestly.
    }
  }
  return {
    ...base,
    stored,
    ...(stored === notes.length
      ? {}
      : { error: `stored ${stored}/${notes.length} highlights — re-ingest to repair` }),
  };
}
