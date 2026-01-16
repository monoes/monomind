/**
 * Document chunker for per-agent knowledge base.
 * Splits documents into overlapping text chunks, preferring paragraph boundaries.
 *
 * @module @monobrain/memory/knowledge/document-chunker
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

/**
 * Chunk a document into overlapping text segments.
 *
 * Tries to break at paragraph boundaries (\n\n) within 20% of the nominal
 * chunk end to produce more natural splits.
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

    // If we haven't reached the end, try to snap to a paragraph boundary
    if (endChar < text.length) {
      const windowStart = Math.max(startChar, endChar - Math.floor(chunkSizeChars * 0.2));
      const window = text.slice(windowStart, endChar);
      const lastParagraph = window.lastIndexOf('\n\n');

      if (lastParagraph !== -1) {
        // Break right after the paragraph boundary
        endChar = windowStart + lastParagraph + 2;
      }
    }

    chunks.push({
      chunkId: `${docId}:${chunkIndex}`,
      docId,
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      chunkIndex,
    });

    chunkIndex++;

    // If this chunk reached the end of the document, stop
    if (endChar >= text.length) break;

    // Advance by (endChar - startChar - overlap), but at least 1 char to avoid infinite loops
    const advance = Math.max(1, endChar - startChar - overlapChars);
    startChar = startChar + advance;
  }

  return chunks;
}
