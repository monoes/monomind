// orgrt/documents/check-result.ts
//
// How org_doc_check shapes the outcome of the contract's checks into a bounded, paged result (org sections plan
// P3.11, in step with org_doc_read, host-read.ts): every complete result is at most RESULT_MAX characters. The
// flagged answers and the document-level failures are the paged list; they are packed greedily into pages of at
// most ITEMS_MAX serialized characters, so the cut points depend on the check outcome alone and every call for
// the same version agrees on them. Page 1 carries the summary (counts per check, the verdict, the note).
import type { CheckResult } from './checks.js';
import { RESULT_MAX } from './host-read.js';
import type { ReadResult } from './store-types.js';

export const CHECK_NOTE =
  'necessary but not sufficient: these checks test the document against its own evidence, so a passing answer may still be wrong; verify what you rely on against the source';

const ITEMS_MAX = 5000;
const DETAIL_MAX = 300;
const FAILED_PER_ANSWER_MAX = 8;

const cut = (s: string): string => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX)}...` : s);

type Item =
  | { kind: 'doc'; v: { check: string; message: string } }
  | {
      kind: 'answer';
      v: {
        answer: string;
        sheet: string;
        q: string;
        failed: { check: string; message: string }[];
        more_failed?: number;
      };
    };

const itemsOf = (r: CheckResult): Item[] => [
  ...r.doc_level.map((d): Item => ({ kind: 'doc', v: { check: d.check, message: cut(d.detail) } })),
  ...r.flagged.map(
    (f): Item => ({
      kind: 'answer',
      v: {
        answer: `${f.sheet}/${f.q}`,
        sheet: f.sheet,
        q: f.q,
        failed: f.failed
          .slice(0, FAILED_PER_ANSWER_MAX)
          .map((x) => ({ check: x.check, message: cut(x.detail) })),
        ...(f.failed.length > FAILED_PER_ANSWER_MAX
          ? { more_failed: f.failed.length - FAILED_PER_ANSWER_MAX }
          : {}),
      },
    }),
  ),
];

/** The items cut into pages of at most ITEMS_MAX serialized characters (an empty list is one empty page). */
function pagesOf(items: Item[]): Item[][] {
  const pages: Item[][] = [[]];
  let used = 0;
  for (const it of items) {
    const w = JSON.stringify(it.v).length + 1;
    if (used + w > ITEMS_MAX && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(it);
    used += w;
  }
  return pages;
}

const pageBody = (page: Item[]) => ({
  flagged: page.filter((i) => i.kind === 'answer').map((i) => i.v),
  document_failures: page.filter((i) => i.kind === 'doc').map((i) => i.v),
});

export interface CheckOutcome {
  /** Counts after the run; flagged answers and document failures are listed in `parts`. */
  answers: number;
  flagged_total: number;
  document_failures_total: number;
  per_check: Record<string, number>;
  passed: boolean;
}

export function summarize(r: CheckResult, declared: string[]): CheckOutcome {
  return {
    answers: r.answers,
    flagged_total: r.flagged.length,
    document_failures_total: r.doc_level.length,
    per_check: Object.fromEntries(declared.map((c) => [c, r.by_check[c] ?? 0])),
    passed: r.flagged.length === 0 && r.doc_level.length === 0,
  };
}

/** What the publish argument's evidence entries hold, so a consumer sees what was attached (the entries
 *  themselves are in org_doc_read). */
function evidenceOf(v: ReadResult): Record<string, unknown> | undefined {
  if (!v.evidence.length) return undefined;
  const kinds: Record<string, number> = {};
  for (const e of v.evidence) {
    const k =
      typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string'
        ? (e as { kind: string }).kind
        : 'unknown';
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  return { published_evidence: { entries: v.evidence.length, kinds } };
}

/** The result for `part` of a check run, or `{outOfRange: parts}`. */
export function shapeCheck(
  v: ReadResult,
  r: CheckResult,
  declared: string[],
  part: number,
): Record<string, unknown> | { outOfRange: number } {
  const pages = pagesOf(itemsOf(r));
  if (part > pages.length) return { outOfRange: pages.length };
  const body = pageBody(pages[part - 1]);
  if (part > 1) return { ok: true, ref: v.ref, part, parts: pages.length, ...body };
  const s = summarize(r, declared);
  const out: Record<string, unknown> = {
    ok: true,
    ref: v.ref,
    version: v.version,
    type: v.type,
    status: v.status,
    contract_revision: v.contract_revision,
    passed: s.passed,
    answers: s.answers,
    flagged_count: s.flagged_total,
    document_failure_count: s.document_failures_total,
    per_check: s.per_check,
    ...evidenceOf(v),
    part: 1,
    parts: pages.length,
    ...body,
    note: CHECK_NOTE,
  };
  if (JSON.stringify(out).length > RESULT_MAX) {
    delete out.per_check;
    delete out.published_evidence;
  }
  return out;
}
