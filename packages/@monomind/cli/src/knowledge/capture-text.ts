/**
 * Text extraction for web captures (RCL-01) — the HTML/MHTML arm of
 * `extractText`, kept here so `cap-documents.ts` stays a dispatch table.
 *
 * @module v1/cli/knowledge/capture-text
 */

import * as fs from 'node:fs';
import { readableSiblingFor } from './capture-envelope.js';
import { htmlToMarkdown } from './html-extract.js';
import { mhtmlToHtml } from './mhtml.js';

export const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);
export const MHTML_EXTENSIONS = new Set(['.mhtml', '.mht']);

export function isCaptureExtension(ext: string): boolean {
  return HTML_EXTENSIONS.has(ext) || MHTML_EXTENSIONS.has(ext);
}

/**
 * Clean text for an archived page.
 *
 * PRECEDENCE — when the file sits in a capture envelope, the sibling
 * `readable.md` wins. It was produced by Readability against the LIVE DOM,
 * with lazy images resolved, the consent modal dismissed and the site's own JS
 * finished; nothing derived from the archived markup can beat that. Our own
 * extractor is the fallback for archives nobody cleaned.
 *
 * Returns '' rather than throwing — an unreadable capture is a document with
 * no text, not a failed ingest.
 */
export function extractCaptureText(absolutePath: string, ext: string): string {
  try {
    const readable = readableSiblingFor(absolutePath);
    if (readable) return fs.readFileSync(readable, 'utf-8');
  } catch {
    /* no envelope, or an unreadable one — extract from the file itself */
  }
  try {
    if (MHTML_EXTENSIONS.has(ext)) {
      // latin1 preserves the raw bytes: transfer encoding comes off first, and
      // the real charset is only known per MIME part.
      return htmlToMarkdown(mhtmlToHtml(fs.readFileSync(absolutePath, 'latin1')).html);
    }
    return htmlToMarkdown(fs.readFileSync(absolutePath, 'utf-8'));
  } catch {
    return '';
  }
}
