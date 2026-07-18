/**
 * Document chunker for per-agent knowledge base.
 * Splits documents into overlapping text chunks, preferring paragraph boundaries.
 *
 * @module @monomind/memory/knowledge/document-chunker
 */

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

const HEADING_LINE_RE = /^#{1,6} /;
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Start offsets of code-fence delimiter lines, in order. A position is inside
 *  a fence iff an odd number of delimiters precede it. */
function fenceToggles(text: string): number[] {
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

function inFence(toggles: number[], pos: number): boolean {
  // count toggles at or before pos (binary search)
  let lo = 0, hi = toggles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toggles[mid] <= pos) lo = mid + 1; else hi = mid;
  }
  return (lo & 1) === 1;
}

/** The markdown heading line governing position `pos`, or null. Lines inside
 *  code fences are never headings (a `# comment` in a ```sh block is code). */
function lastHeadingBefore(text: string, pos: number, toggles: number[]): string | null {
  let i = text.lastIndexOf('\n#', pos - 1);
  while (i !== -1) {
    const eol = text.indexOf('\n', i + 1);
    const line = text.slice(i + 1, eol === -1 ? undefined : eol);
    if (HEADING_LINE_RE.test(line) && !inFence(toggles, i + 1)) return line.replace(/^#+ /, '').trim();
    i = i > 0 ? text.lastIndexOf('\n#', i - 1) : -1; // lastIndexOf clamps fromIndex -1 to 0 — would loop forever on a match at 0
  }
  const firstEol = text.indexOf('\n');
  const firstLine = firstEol === -1 ? text : text.slice(0, firstEol);
  return HEADING_LINE_RE.test(firstLine) && !inFence(toggles, 0) && firstEol !== -1 && firstEol < pos
    ? firstLine.replace(/^#+ /, '').trim() : null;
}

/**
 * Chunk a document into overlapping text segments.
 *
 * Boundary preference within 20% of the nominal chunk end:
 * markdown heading (section starts a fresh chunk, no overlap back across it)
 * > paragraph boundary (\n\n) > hard cut.
 *
 * Chunks that don't begin with a heading are prefixed with their governing
 * section heading (`§ <heading>`) so both keyword and semantic retrieval see
 * the section topic — startChar/endChar always refer to the raw source text,
 * never to the prefix.
 */
export function chunkDocument(
  docId: string,
  text: string,
  chunkSizeChars: number = DEFAULT_CHUNK_SIZE,
  overlapChars: number = DEFAULT_OVERLAP,
): TextChunk[] {
  // Normalize CRLF up front: every boundary heuristic below ('\n\n', '\n#')
  // is LF-based, so Windows documents previously never snapped to a paragraph
  // or heading and were hard-cut mid-word. startChar/endChar therefore refer
  // to the NORMALIZED text (which is also what gets stored and searched).
  if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
  if (text.length === 0) {
    return [];
  }

  const toggles = fenceToggles(text);
  const chunks: TextChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < text.length) {
    let endChar = Math.min(startChar + chunkSizeChars, text.length);
    let brokeAtHeading = false;

    if (endChar < text.length) {
      const windowStart = Math.max(startChar, endChar - Math.floor(chunkSizeChars * 0.2));
      const window = text.slice(windowStart, endChar);

      // Prefer breaking BEFORE a heading so the next section starts fresh —
      // but never treat a `# line` inside a code fence as a heading, and never
      // place a break point inside a fence (it would split the block).
      let h = window.lastIndexOf('\n#');
      while (h !== -1) {
        const eol = window.indexOf('\n', h + 1);
        const line = window.slice(h + 1, eol === -1 ? undefined : eol);
        if (HEADING_LINE_RE.test(line) && windowStart + h > startChar && !inFence(toggles, windowStart + h + 1)) break;
        h = h > 0 ? window.lastIndexOf('\n#', h - 1) : -1;
      }
      if (h !== -1 && windowStart + h > startChar) {
        endChar = windowStart + h + 1; // keep the \n; heading opens the next chunk
        brokeAtHeading = true;
      } else {
        let lastParagraph = window.lastIndexOf('\n\n');
        while (lastParagraph > 0 && inFence(toggles, windowStart + lastParagraph + 1)) {
          lastParagraph = window.lastIndexOf('\n\n', lastParagraph - 1);
        }
        if (lastParagraph === 0 && inFence(toggles, windowStart + 1)) lastParagraph = -1;
        if (lastParagraph !== -1) {
          // Break right after the paragraph boundary
          endChar = windowStart + lastParagraph + 2;
        }
      }
    }

    let chunkText = text.slice(startChar, endChar);
    const heading = lastHeadingBefore(text, startChar + 1, toggles);
    if (heading && !HEADING_LINE_RE.test(chunkText.trimStart())) {
      chunkText = `§ ${heading}\n${chunkText}`;
    }

    chunks.push({
      chunkId: `${docId}:${chunkIndex}`,
      docId,
      text: chunkText,
      startChar,
      endChar,
      chunkIndex,
    });

    chunkIndex++;

    // If this chunk reached the end of the document, stop
    if (endChar >= text.length) break;

    // Advance with overlap for prose continuity — but never overlap back
    // across a heading break, or the next chunk would re-open the previous
    // section mid-thought.
    const advance = brokeAtHeading
      ? Math.max(1, endChar - startChar)
      : Math.max(1, endChar - startChar - overlapChars);
    startChar = startChar + advance;
  }

  return chunks;
}
