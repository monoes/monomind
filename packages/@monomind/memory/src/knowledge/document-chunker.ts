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

/** The markdown heading line governing position `pos`, or null. */
function lastHeadingBefore(text: string, pos: number): string | null {
  let i = text.lastIndexOf('\n#', pos - 1);
  while (i !== -1) {
    const eol = text.indexOf('\n', i + 1);
    const line = text.slice(i + 1, eol === -1 ? undefined : eol);
    if (HEADING_LINE_RE.test(line)) return line.replace(/^#+ /, '').trim();
    i = text.lastIndexOf('\n#', i - 1);
  }
  const firstEol = text.indexOf('\n');
  const firstLine = firstEol === -1 ? text : text.slice(0, firstEol);
  return HEADING_LINE_RE.test(firstLine) && firstEol !== -1 && firstEol < pos
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
  if (text.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < text.length) {
    let endChar = Math.min(startChar + chunkSizeChars, text.length);
    let brokeAtHeading = false;

    if (endChar < text.length) {
      const windowStart = Math.max(startChar, endChar - Math.floor(chunkSizeChars * 0.2));
      const window = text.slice(windowStart, endChar);

      // Prefer breaking BEFORE a heading so the next section starts fresh
      let h = window.lastIndexOf('\n#');
      while (h !== -1) {
        const eol = window.indexOf('\n', h + 1);
        const line = window.slice(h + 1, eol === -1 ? undefined : eol);
        if (HEADING_LINE_RE.test(line) && windowStart + h > startChar) break;
        h = window.lastIndexOf('\n#', h - 1);
      }
      if (h !== -1 && windowStart + h > startChar) {
        endChar = windowStart + h + 1; // keep the \n; heading opens the next chunk
        brokeAtHeading = true;
      } else {
        const lastParagraph = window.lastIndexOf('\n\n');
        if (lastParagraph !== -1) {
          // Break right after the paragraph boundary
          endChar = windowStart + lastParagraph + 2;
        }
      }
    }

    let chunkText = text.slice(startChar, endChar);
    const heading = lastHeadingBefore(text, startChar + 1);
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
