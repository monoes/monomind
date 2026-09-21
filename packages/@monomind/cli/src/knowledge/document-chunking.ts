/**
 * Document chunking — turning a document's extracted text into the enriched
 * chunks that get embedded and stored.
 *
 * Two passes, in this order:
 *  1. CHUNK — split on heading/paragraph boundaries (shared `@monoes/memory`
 *     chunker, with an inline fallback kept byte-identical to it).
 *  2. ENRICH — replace each chunk's leaf-heading prefix with a situating blurb
 *     (doc title + full heading path + summary) so the embedding model can tell
 *     two identically-titled sections of different documents apart.
 *
 * Split out of document-pipeline.ts. Pure string work: no fs, no network, no
 * store access — which is what makes chunk spans reproducible at citation time
 * (`chunkSpans`) without re-reading anything.
 *
 * @module v1/cli/knowledge/document-chunking
 */

import * as path from 'node:path';
import type { ChunkSpan } from './citation.js';

export interface TextChunk {
  chunkId: string;
  docId: string;
  text: string;
  startChar: number;
  endChar: number;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 3200;
const DEFAULT_OVERLAP = 400;

// Inline fallback identical to @monoes/memory's knowledge/document-chunker.ts —
// used only if the dynamic import below fails (package not installed/built).
// Keep in sync if the shared chunker's boundary-snapping logic changes.
const HEADING_LINE_RE = /^#{1,6} /;
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;
function fenceTogglesInline(text: string): number[] {
  const toggles: number[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const eol = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, eol === -1 ? undefined : eol);
    if (FENCE_LINE_RE.test(line)) toggles.push(lineStart);
    if (eol === -1) break;
    lineStart = eol + 1;
  }
  return toggles;
}
function inFenceInline(toggles: number[], pos: number): boolean {
  let lo = 0,
    hi = toggles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toggles[mid] <= pos) lo = mid + 1;
    else hi = mid;
  }
  return (lo & 1) === 1;
}
function lastHeadingBefore(text: string, pos: number, toggles: number[]): string | null {
  let i = text.lastIndexOf('\n#', pos - 1);
  while (i !== -1) {
    const eol = text.indexOf('\n', i + 1);
    const line = text.slice(i + 1, eol === -1 ? undefined : eol);
    if (HEADING_LINE_RE.test(line) && !inFenceInline(toggles, i + 1))
      return line.replace(/^#+ /, '').trim();
    i = i > 0 ? text.lastIndexOf('\n#', i - 1) : -1; // fromIndex -1 clamps to 0 — would loop on a match at 0
  }
  const firstEol = text.indexOf('\n');
  const firstLine = firstEol === -1 ? text : text.slice(0, firstEol);
  return HEADING_LINE_RE.test(firstLine) &&
    !inFenceInline(toggles, 0) &&
    firstEol !== -1 &&
    firstEol < pos
    ? firstLine.replace(/^#+ /, '').trim()
    : null;
}
function chunkDocumentInline(docId: string, text: string): TextChunk[] {
  if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
  if (text.length === 0) return [];
  const toggles = fenceTogglesInline(text);
  const chunks: TextChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < text.length) {
    let endChar = Math.min(startChar + DEFAULT_CHUNK_SIZE, text.length);
    let brokeAtHeading = false;
    if (endChar < text.length) {
      const windowStart = Math.max(startChar, endChar - Math.floor(DEFAULT_CHUNK_SIZE * 0.2));
      const window = text.slice(windowStart, endChar);
      let h = window.lastIndexOf('\n#');
      while (h !== -1) {
        const eol = window.indexOf('\n', h + 1);
        const line = window.slice(h + 1, eol === -1 ? undefined : eol);
        if (
          HEADING_LINE_RE.test(line) &&
          windowStart + h > startChar &&
          !inFenceInline(toggles, windowStart + h + 1)
        )
          break;
        h = h > 0 ? window.lastIndexOf('\n#', h - 1) : -1;
      }
      if (h !== -1 && windowStart + h > startChar) {
        endChar = windowStart + h + 1;
        brokeAtHeading = true;
      } else {
        let lastParagraph = window.lastIndexOf('\n\n');
        while (lastParagraph > 0 && inFenceInline(toggles, windowStart + lastParagraph + 1)) {
          lastParagraph = window.lastIndexOf('\n\n', lastParagraph - 1);
        }
        if (lastParagraph === 0 && inFenceInline(toggles, windowStart + 1)) lastParagraph = -1;
        if (lastParagraph !== -1) endChar = windowStart + lastParagraph + 2;
      }
    }
    let chunkText = text.slice(startChar, endChar);
    const heading = lastHeadingBefore(text, startChar + 1, toggles);
    if (heading && !HEADING_LINE_RE.test(chunkText.trimStart()))
      chunkText = `§ ${heading}\n${chunkText}`;
    chunks.push({
      chunkId: `${docId}:${chunkIndex}`,
      docId,
      text: chunkText,
      startChar,
      endChar,
      chunkIndex,
    });
    chunkIndex++;
    if (endChar >= text.length) break;
    startChar += brokeAtHeading
      ? Math.max(1, endChar - startChar)
      : Math.max(1, endChar - startChar - DEFAULT_OVERLAP);
  }
  return chunks;
}

export async function chunkDocument(docId: string, text: string): Promise<TextChunk[]> {
  try {
    const mod = await import('@monoes/memory' as string);
    return mod.chunkDocument(docId, text, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);
  } catch {
    return chunkDocumentInline(docId, text);
  }
}

// ── Contextual chunk enrichment (item 6a) ─────────────────────────
// Prepend a situating blurb per chunk before embedding: full heading
// path + doc title + doc summary. No LLM, no network.
//
// The `§ heading` prefix `chunkDocumentInline` writes provides only the nearest
// leaf heading. This replaces it with doc-level context so the embedding
// model can distinguish "Memory Coordination" in a hooks doc from
// "Memory Coordination" in a concepts doc.
//
// Applied at INGEST TIME (after chunking, before embedding), so:
//  - Works identically regardless of which chunker ran (inline or @monoes/memory)
//  - Works identically for both better-sqlite3 and sql.js (pure string ops)
//  - Zero dependencies, zero network

const SECTION_PREFIX_RE = /^§ [^\n]+\n/;
/** Cap on the situating summary prepended to each chunk, ellipsis included. */
const SUMMARY_MAX_CHARS = 120;

function extractDocTitle(text: string, filePath: string): string {
  const eol = text.indexOf('\n');
  const first = eol === -1 ? text : text.slice(0, eol);
  return HEADING_LINE_RE.test(first)
    ? first.replace(/^#+ /, '').trim()
    : path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, ' ');
}

function extractDocSummary(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  const parts: string[] = [];
  for (const line of lines) {
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (HEADING_LINE_RE.test(line)) {
      if (parts.length > 0) break;
      continue;
    }
    const t = line.trim();
    if (!t || /^[|=-]/.test(t)) {
      if (parts.length > 0) break;
      continue;
    }
    parts.push(t.startsWith('>') ? t.replace(/^>\s*/, '') : t);
  }
  const joined = parts.join(' ');
  // Truncate with an ellipsis so a clipped summary is visibly clipped. The bare
  // 150-char slice this replaces gave no signal that anything was cut, which
  // read as a complete sentence to both a human and the embedding model.
  return joined.length > SUMMARY_MAX_CHARS
    ? `${joined.slice(0, SUMMARY_MAX_CHARS - 3).trimEnd()}...`
    : joined;
}

function buildHeadingHierarchy(
  text: string,
  toggles: number[],
): Array<{ level: number; text: string; offset: number }> {
  const out: Array<{ level: number; text: string; offset: number }> = [];
  const eol0 = text.indexOf('\n');
  const line0 = eol0 === -1 ? text : text.slice(0, eol0);
  const firstLevel = line0.match(/^(#{1,6}) /)?.[1]?.length;
  if (firstLevel !== undefined && !inFenceInline(toggles, 0)) {
    out.push({
      level: firstLevel,
      text: line0.replace(/^#+ /, '').trim(),
      offset: 0,
    });
  }
  let i = text.indexOf('\n#', 0);
  while (i !== -1) {
    const ls = i + 1;
    const e = text.indexOf('\n', ls);
    const line = text.slice(ls, e === -1 ? undefined : e);
    const level = line.match(/^(#{1,6}) /)?.[1]?.length;
    if (level !== undefined && !inFenceInline(toggles, ls)) {
      out.push({
        level,
        text: line.replace(/^#+ /, '').trim(),
        offset: ls,
      });
    }
    i = text.indexOf('\n#', ls);
  }
  return out;
}

function headingPathAt(
  hierarchy: Array<{ level: number; text: string; offset: number }>,
  pos: number,
): string[] {
  const stack: Array<{ level: number; text: string }> = [];
  for (const h of hierarchy) {
    if (h.offset >= pos) break;
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack.map((s) => s.text);
}

/**
 * Replace each chunk's `§ heading` prefix with a richer situating blurb:
 *   § <doc title> · <full heading path>
 *   <doc summary for non-first chunks>
 *
 * First chunks that start with their own heading are left untouched (the
 * heading IS the context). The summary line is omitted for the first
 * chunk since it is adjacent to the summary text anyway.
 */
export function enrichChunks(chunks: TextChunk[], fullText: string, filePath: string): TextChunk[] {
  if (chunks.length === 0) return chunks;
  const toggles = fenceTogglesInline(fullText);
  const hierarchy = buildHeadingHierarchy(fullText, toggles);
  const title = extractDocTitle(fullText, filePath);
  const summary = extractDocSummary(fullText);

  return chunks.map((c) => {
    let text = c.text;

    // First chunk starting with its own heading — the heading IS the context
    if (c.chunkIndex === 0 && HEADING_LINE_RE.test(text.trimStart())) return c;

    // Strip the old § leaf-heading prefix; we replace it with a richer one
    text = text.replace(SECTION_PREFIX_RE, '');

    const hpath = headingPathAt(hierarchy, c.startChar + 1);
    const parts: string[] = [];

    // Title + full heading path
    if (hpath.length > 0 && hpath[0] !== title) {
      parts.push(`§ ${title} · ${hpath.join(' > ')}`);
    } else if (hpath.length > 1) {
      parts.push(`§ ${hpath.join(' > ')}`);
    } else {
      parts.push(`§ ${title}`);
    }

    // Summary for non-first chunks — they are far from the doc intro
    if (c.chunkIndex > 0 && summary) {
      const snip = summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
      parts.push(snip);
    }

    return { ...c, text: `${parts.join('\n')}\n${text}` };
  });
}

/** Chunk spans for a text, using the SAME chunker the ingest used — this is
 *  what makes a chunk index resolvable back to a character range without
 *  storing the text twice. */
export async function chunkSpans(text: string): Promise<ChunkSpan[]> {
  const chunks = await chunkDocument('cite', text);
  return chunks.map((c) => ({
    chunkIndex: c.chunkIndex,
    startChar: c.startChar,
    endChar: c.endChar,
  }));
}
