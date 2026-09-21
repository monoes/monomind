/**
 * MHTML / MHT container parsing (RCL-01).
 *
 * An MHTML archive is an RFC 2557 `multipart/related` MIME message: the page
 * plus every subresource it referenced, each part carrying its own transfer
 * encoding and charset. Chrome's `Page.captureSnapshot` writes them
 * quoted-printable; Internet Explorer and most "save as web archive" tools
 * write base64.
 *
 * Only the ROOT frame is prose. Picking the first `text/html` part instead is
 * how an ad iframe ends up indexed as the article, so the root is resolved
 * from the container's `Snapshot-Content-Location` / `Content-Location` when
 * one is present.
 *
 * Read the file as `latin1` (or pass a Buffer): byte fidelity matters before
 * transfer decoding, and the real charset is only known per part.
 *
 * @module v1/cli/knowledge/mhtml
 */

export interface MhtmlPart {
  /** Lowercased MIME type without parameters, e.g. `text/html`. */
  contentType: string;
  /** Charset from the part's Content-Type, lowercased, or null. */
  charset: string | null;
  /** Content-Location, or null. */
  location: string | null;
  /** Lowercased Content-Transfer-Encoding; `binary` when unstated. */
  encoding: string;
  /** Raw bytes after transfer decoding. */
  body: Buffer;
  headers: Record<string, string>;
}

export interface ParsedMhtml {
  /** The part holding the page itself, or null when there is no HTML part. */
  root: MhtmlPart | null;
  parts: MhtmlPart[];
  /** Container `Snapshot-Content-Location`/`Content-Location` header. */
  snapshotLocation: string | null;
  /** Container `Subject` header — Chrome writes the page title here. */
  subject: string | null;
}

/** Decode a quoted-printable body to bytes: soft line breaks vanish, `=XX`
 *  becomes one byte, everything else is its own latin1 byte. */
export function decodeQuotedPrintable(input: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '=') {
      out.push(input.charCodeAt(i) & 0xff);
      continue;
    }
    if (input[i + 1] === '\r' && input[i + 2] === '\n') {
      i += 2; // soft line break
      continue;
    }
    if (input[i + 1] === '\n') {
      i += 1; // soft line break, LF-only file
      continue;
    }
    const hex = input.slice(i + 1, i + 3);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      out.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    out.push(0x3d); // a lone `=` — keep it
  }
  return Buffer.from(out);
}

function decodeBody(raw: string, encoding: string): Buffer {
  switch (encoding) {
    case 'quoted-printable':
      return decodeQuotedPrintable(raw);
    case 'base64':
      return Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    default:
      return Buffer.from(raw, 'latin1');
  }
}

/** Decode bytes under a MIME charset, falling back to UTF-8 (then latin1)
 *  rather than failing an ingest over an exotic label. */
export function decodeCharset(bytes: Buffer, charset: string | null): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase();
  for (const candidate of [label, 'utf-8']) {
    try {
      return new TextDecoder(candidate, { fatal: false }).decode(bytes);
    } catch {
      /* unknown label — try the next */
    }
  }
  return bytes.toString('latin1');
}

/** Split a MIME chunk into unfolded headers and the body after the first
 *  blank line. Continuation lines (leading space/tab) join their header. */
function splitHeaders(chunk: string): { headers: Record<string, string>; body: string } {
  const sep = /\r?\n\r?\n/.exec(chunk);
  const headerText = sep ? chunk.slice(0, sep.index) : chunk;
  const body = sep ? chunk.slice(sep.index + sep[0].length) : '';

  const headers: Record<string, string> = {};
  let current = '';
  for (const rawLine of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(rawLine) && current) {
      headers[current] += ` ${rawLine.trim()}`;
      continue;
    }
    const colon = rawLine.indexOf(':');
    if (colon === -1) continue;
    current = rawLine.slice(0, colon).trim().toLowerCase();
    headers[current] = rawLine.slice(colon + 1).trim();
  }
  return { headers, body };
}

function param(headerValue: string | undefined, name: string): string | null {
  if (!headerValue) return null;
  const m = new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^;\\s]+)`, 'i').exec(headerValue);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

function toPart(chunk: string): MhtmlPart {
  const { headers, body } = splitHeaders(chunk);
  const contentType = (headers['content-type'] ?? 'text/html').split(';')[0].trim().toLowerCase();
  const encoding = (headers['content-transfer-encoding'] ?? 'binary').trim().toLowerCase();
  return {
    contentType,
    charset: param(headers['content-type'], 'charset')?.toLowerCase() ?? null,
    location: headers['content-location'] ?? null,
    encoding,
    body: decodeBody(body, encoding),
    headers,
  };
}

/**
 * Parse an MHTML container. Anything that is not a well-formed multipart
 * message is treated as a single part, so a plain `.html` file renamed to
 * `.mhtml` still ingests.
 */
export function parseMhtml(raw: string | Buffer): ParsedMhtml {
  const text = typeof raw === 'string' ? raw : raw.toString('latin1');
  const { headers, body } = splitHeaders(text);
  const snapshotLocation =
    headers['snapshot-content-location'] ?? headers['content-location'] ?? null;
  const subject = headers.subject ?? null;
  const boundary = param(headers['content-type'], 'boundary');

  let parts: MhtmlPart[];
  if (!boundary) {
    // No boundary: either a single-part message or a bare HTML file. Feeding
    // the whole document through `toPart` covers both — an HTML file has no
    // header block, so everything lands in the body.
    parts = [toPart(/^[a-z-]+:/i.test(text) ? text : `Content-Type: text/html\r\n\r\n${text}`)];
  } else {
    const delimiter = `--${boundary}`;
    parts = body
      .split(delimiter)
      .slice(1) // text before the first delimiter is the MIME preamble
      .filter((chunk) => !chunk.startsWith('--')) // the closing `--boundary--`
      .map((chunk) => chunk.replace(/^\r?\n/, ''))
      .map(toPart);
  }

  const html = parts.filter(
    (p) => p.contentType === 'text/html' || p.contentType === 'application/xhtml+xml',
  );
  const root =
    (snapshotLocation ? html.find((p) => p.location === snapshotLocation) : undefined) ??
    html[0] ??
    null;

  return { root, parts, snapshotLocation, subject };
}

/** Parse a container and return its root frame decoded to a string. */
export function mhtmlToHtml(raw: string | Buffer): {
  html: string;
  location: string | null;
  subject: string | null;
} {
  const parsed = parseMhtml(raw);
  return {
    html: parsed.root ? decodeCharset(parsed.root.body, parsed.root.charset) : '',
    location: parsed.root?.location ?? parsed.snapshotLocation,
    subject: parsed.subject,
  };
}
