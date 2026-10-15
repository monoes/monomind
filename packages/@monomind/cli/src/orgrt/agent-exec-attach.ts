// packages/@monomind/cli/src/orgrt/agent-exec-attach.ts
/**
 * `agent exec --attach FILE` (doc/agent-exec-protocol.md §3.1, rev 31,
 * capability `agent-exec-attachments`): files that go with the prompt.
 *
 * The command layer validates the flag (parseAttachFlags: usage error, exit
 * 2); the engine builds the turn's one user message (execPrompt), per runtime:
 *  - claude: content blocks — an `image` block (base64) per PNG/JPEG/GIF/WebP
 *    and a `document` block per PDF, then the prompt text. Any other file, or
 *    one past the API's limits (bytes below, 8000 px a side, a size that
 *    cannot be read), is listed by path in that text.
 *  - codex: images go to `codex exec --image` (AgentRunArgs.images, the
 *    turn's first exec only); other files are listed by path.
 *  - every other runtime: an "Attached files:" block of absolute paths after
 *    the prompt; the agent opens them with its own file tools.
 * The type comes from the file's first bytes, never its extension. Without
 * `--attach` the message is the prompt string, exactly as before.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const ATTACH_MAX_FILES = 10;
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
/** The Claude API's limit per image. */
const CLAUDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Raw bytes sent as blocks in one message: base64 (×4/3) stays under the
 *  API's 32 MB request limit with room for the prompt and history. */
const CLAUDE_INLINE_MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Parse repeatable `--attach` into absolute paths, or a usage error: each
 *  must be an existing regular file of at most 20 MB, at most 10 files. */
export function parseAttachFlags(raw: unknown): { paths: string[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  if (list.length > ATTACH_MAX_FILES) {
    return { error: `--attach takes at most ${ATTACH_MAX_FILES} files (got ${list.length})` };
  }
  const paths: string[] = [];
  for (const item of list) {
    const path = resolve(String(item));
    let size: number;
    try {
      const st = statSync(path);
      if (!st.isFile()) return { error: `--attach ${item}: not a regular file` };
      size = st.size;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return { error: `--attach ${item}: ${code === 'ENOENT' ? 'no such file' : String(e)}` };
    }
    if (size > ATTACH_MAX_BYTES) {
      const mb = (size / 1024 / 1024).toFixed(1);
      return { error: `--attach ${item}: ${mb} MB is over the 20 MB limit` };
    }
    paths.push(path);
  }
  return { paths };
}

/** The media type a file's first bytes announce, for the types sent natively. */
export function sniffMediaType(head: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return undefined;
}

/** Whether the file is a PNG/JPEG/GIF/WebP image (unreadable: no). */
function isImageFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    try {
      const head = Buffer.alloc(12);
      return IMAGE_TYPES.has(sniffMediaType(head.subarray(0, readSync(fd, head, 0, 12, 0))) ?? '');
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** An image's pixel size from its header bytes (PNG IHDR, JPEG SOFn, GIF
 *  logical screen, WebP VP8/VP8L/VP8X); undefined when it cannot be read. */
export function imageSize(d: Buffer): { width: number; height: number } | undefined {
  const ascii = (from: number, to: number) => d.toString('latin1', from, to);
  switch (sniffMediaType(d)) {
    case 'image/png':
      if (d.length < 24 || ascii(12, 16) !== 'IHDR') return undefined;
      return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
    case 'image/gif':
      if (d.length < 10) return undefined;
      return { width: d.readUInt16LE(6), height: d.readUInt16LE(8) };
    case 'image/webp': {
      const chunk = ascii(12, 16);
      if (chunk === 'VP8X' && d.length >= 30)
        return { width: d.readUIntLE(24, 3) + 1, height: d.readUIntLE(27, 3) + 1 };
      if (chunk === 'VP8 ' && d.length >= 30 && d.readUIntBE(23, 3) === 0x9d012a)
        return { width: d.readUInt16LE(26) & 0x3fff, height: d.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L' && d.length >= 25 && d[20] === 0x2f) {
        const bits = d.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      return undefined;
    }
    case 'image/jpeg':
      return jpegSize(d);
    default:
      return undefined;
  }
}

/** Walk the JPEG markers to the first SOFn (C0–CF but DHT C4, JPG C8, DAC CC). */
function jpegSize(d: Buffer): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 <= d.length) {
    if (d[i] !== 0xff) return undefined;
    const marker = d[i + 1];
    if (marker === 0xff)
      i += 1; // fill byte
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8))
      i += 2; // no length
    else if (marker === 0xd9 || marker === 0xda)
      return undefined; // EOI/SOS before a frame
    else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: d.readUInt16BE(i + 5), width: d.readUInt16BE(i + 7) };
    else i += 2 + d.readUInt16BE(i + 2);
  }
  return undefined;
}

/** The Claude API rejects an image wider or taller than 8000 px (the whole
 *  request fails), so one that is, or whose size is unknown, is listed. */
function fitsClaudeImage(size: { width: number; height: number } | undefined): boolean {
  return !!size && size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= 8000;
}

/** The prompt followed by an "Attached files:" block (no paths: the prompt). */
export function withFileList(prompt: string, paths: string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\nAttached files:\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

/** Claude content blocks: images and PDFs as base64 blocks, then the text. */
export function claudeContent(prompt: string, paths: string[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const listed: string[] = [];
  let inline = 0;
  for (const path of paths) {
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      listed.push(path);
      continue;
    }
    const type = sniffMediaType(data);
    const image = type !== undefined && IMAGE_TYPES.has(type);
    if (
      !type ||
      (image && (data.length > CLAUDE_IMAGE_MAX_BYTES || !fitsClaudeImage(imageSize(data)))) ||
      inline + data.length > CLAUDE_INLINE_MAX_BYTES
    ) {
      listed.push(path);
      continue;
    }
    inline += data.length;
    blocks.push({
      type: image ? 'image' : 'document',
      source: { type: 'base64', media_type: type, data: data.toString('base64') },
    });
  }
  const text = withFileList(prompt, listed);
  return text ? [...blocks, { type: 'text', text }] : blocks;
}

/**
 * The turn's single-message prompt stream (the AgentRunArgs.prompt contract)
 * and, for codex, the images it passes natively.
 */
export function execPrompt(opts: { runtime: string; prompt: string; attachments?: string[] }): {
  stream: AsyncIterable<unknown>;
  images?: string[];
} {
  const paths = opts.attachments ?? [];
  const images = opts.runtime === 'codex' ? paths.filter(isImageFile) : [];
  const content =
    opts.runtime === 'claude' && paths.length > 0
      ? claudeContent(opts.prompt, paths)
      : withFileList(
          opts.prompt,
          paths.filter((p) => !images.includes(p)),
        );
  const stream = (async function* () {
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: undefined,
    };
  })();
  return { stream, ...(images.length ? { images } : {}) };
}
