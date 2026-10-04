// packages/@monomind/cli/src/orgrt/documents/host-read.ts
//
// How org_doc_read shapes a version into a bounded result (spec 6.1): each complete result is at most
// RESULT_MAX characters including metadata. The document's content (body, plus evidence and inputs when it has
// any) is serialized once and cut into parts by ESCAPED size, so a part always fits inside the result envelope
// and the cut points depend on the content alone (every call agrees on them). A one-part document comes back
// inline; a longer one comes back as `content_part`, page 1 carrying the outline, the digest and the part count.
import type { ReadResult } from './store-types.js';

export const RESULT_MAX = 8000;
/** Size, as written inside a JSON string, of one part of the content. The rest of the budget is metadata. */
export const PART_ESCAPED_MAX = 6800;
const OUTLINE_MAX = 30;

/** Width of one character inside a JSON string literal (worst case for control characters and lone surrogates). */
const width = (ch: string): number => {
  if (ch === '"' || ch === '\\') return 2;
  const c = ch.codePointAt(0) as number;
  if (c < 0x20) return 6;
  if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return 6;
  return ch.length;
};

/** The content text cut into parts of at most PART_ESCAPED_MAX escaped characters; never splits a code point. */
export function paginate(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let pos = 0;
  let used = 0;
  for (const ch of text) {
    const w = width(ch);
    if (used + w > PART_ESCAPED_MAX) {
      parts.push(text.slice(start, pos));
      start = pos;
      used = 0;
    }
    used += w;
    pos += ch.length;
  }
  parts.push(text.slice(start));
  return parts;
}

export interface OutlineEntry {
  key: string;
  kind: string;
  items?: number;
  keys?: number;
  chars?: number;
}

/** The top-level shape of the body, so a reader can fetch only the part it needs. */
export function outlineOf(body: unknown): OutlineEntry[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
  return Object.entries(body as Record<string, unknown>)
    .slice(0, OUTLINE_MAX)
    .map(([key, v]) =>
      Array.isArray(v)
        ? { key, kind: 'array', items: v.length }
        : v === null
          ? { key, kind: 'null' }
          : typeof v === 'object'
            ? { key, kind: 'object', keys: Object.keys(v).length }
            : typeof v === 'string'
              ? { key, kind: 'string', chars: v.length }
              : { key, kind: typeof v },
    );
}

const content = (r: ReadResult): Record<string, unknown> => ({
  body: r.body,
  ...(r.evidence.length ? { evidence: r.evidence } : {}),
  ...(r.inputs.length ? { inputs: r.inputs } : {}),
});

/** Metadata a reader needs on part 1 (everything but the content itself). */
function meta(r: ReadResult): Record<string, unknown> {
  return {
    ok: true,
    ref: r.ref,
    id: r.id,
    version: r.version,
    type: r.type,
    section: r.section,
    by: r.by,
    at: r.at,
    status: r.status,
    contract_revision: r.contract_revision,
    body_sha256: r.body_sha256,
    state_seq: r.state_seq,
    decisions: r.decisions,
    ...(r.note !== undefined ? { note: r.note } : {}),
  };
}

/** Keep a first page inside RESULT_MAX when its metadata is unusually large: drop the outline, then shorten
 *  decision reasons, then drop them. The part itself is never cut. */
function bounded(result: Record<string, unknown>): Record<string, unknown> {
  const len = (): number => JSON.stringify(result).length;
  if (len() <= RESULT_MAX) return result;
  delete result.outline;
  if (len() <= RESULT_MAX) return result;
  const d = result.decisions as Record<string, { reason?: string }>;
  for (const x of Object.values(d))
    if (x.reason && x.reason.length > 120) x.reason = `${x.reason.slice(0, 120)}...`;
  if (len() <= RESULT_MAX) return result;
  for (const x of Object.values(d)) delete x.reason;
  return result;
}

/** Number of parts of a version's content. */
export const partsOf = (r: ReadResult): number => paginate(JSON.stringify(content(r))).length;

/** The result for `part` of `r`, or `{outOfRange: parts}`. */
export function shapeRead(
  r: ReadResult,
  part: number,
): Record<string, unknown> | { outOfRange: number } {
  const c = content(r);
  const pages = paginate(JSON.stringify(c));
  if (part > pages.length) return { outOfRange: pages.length };
  if (pages.length === 1) return bounded({ ...meta(r), part: 1, parts: 1, ...c });
  if (part === 1)
    return bounded({
      ...meta(r),
      part: 1,
      parts: pages.length,
      outline: outlineOf(r.body),
      content_part: pages[0],
    });
  return { ok: true, ref: r.ref, part, parts: pages.length, content_part: pages[part - 1] };
}
