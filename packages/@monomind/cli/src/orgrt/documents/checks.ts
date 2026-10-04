// orgrt/documents/checks.ts
//
// The contract-declared document checks (org sections spec 13.1, ported from the measured prototype): a small,
// deterministic dialect that fails closed, run over a document body by the consumer's org_doc_check tool (a later
// piece). A check is arithmetic or structure over the document's own fields; it never reads a file outside the
// document and never runs any code. An unknown check type, or a parameter a check does not take, makes the
// contract invalid when it loads (the same rule as the schema dialect): a check that is silently skipped would
// let a bad document through under a "checked" label.
//
// The dialect is shaped for answer-sheet documents, { sheets: [{ module, answers: [{ q, value, files,
// evidence: [{ file, in, out }] }] }] }, exactly as measured; the check names and field names are the
// prototype's, ported unchanged (the spec asks for it). `evidence` is the producer's own trace of the call
// chain, entry file first. Honest evidence makes the value checkable without running anything; fabricated but
// self-consistent evidence passes every check here. The checks are necessary, not sufficient.
import { type DocProblem, throwIfProblems } from './errors.js';
import { deepEqual, isObj, type JsonObject } from './json.js';

export const CHECKS_DIALECT = 'org-checks-v1';

export type Check =
  | { type: 'value_type'; is: 'integer' }
  | { type: 'files_match_evidence' }
  | { type: 'value_matches_chain' }
  | { type: 'files_in_module' }
  | { type: 'unique_across_sheets' };

const PARAMS: Record<string, string[]> = {
  value_type: ['type', 'is'],
  files_match_evidence: ['type'],
  value_matches_chain: ['type'],
  files_in_module: ['type'],
  unique_across_sheets: ['type'],
};
export const CHECK_TYPES = Object.keys(PARAMS);
const DOC_LEVEL = new Set(['unique_across_sheets']);

/** Every reason the check list is invalid (all of them); empty when it is supported. */
export function validateChecks(checks: unknown, where = 'checks'): DocProblem[] {
  if (!Array.isArray(checks))
    return [{ code: 'CHECK_NOT_LIST', path: where, message: 'must be a list' }];
  const out: DocProblem[] = [];
  checks.forEach((c, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(c) || typeof c.type !== 'string') {
      out.push({ code: 'CHECK_NEEDS_TYPE', path: at, message: 'needs a type' });
      return;
    }
    const allowed = PARAMS[c.type];
    if (!allowed || !Object.hasOwn(PARAMS, c.type)) {
      out.push({
        code: 'CHECK_UNKNOWN_TYPE',
        path: at,
        message: `unknown check type "${c.type}" (contract invalid)`,
        remedy: `one of ${CHECK_TYPES.join(', ')}`,
      });
      return;
    }
    for (const k of Object.keys(c))
      if (!allowed.includes(k))
        out.push({
          code: 'CHECK_UNKNOWN_PARAM',
          path: at,
          message: `parameter "${k}" is not supported by ${c.type}`,
        });
    if (c.type === 'value_type' && c.is !== 'integer')
      out.push({
        code: 'CHECK_BAD_PARAM',
        path: at,
        message: 'value_type supports only is: "integer"',
      });
  });
  return out;
}

/** Throws a DocError on an unknown check type or parameter, naming where it is. */
export function assertSupportedChecks(checks: unknown, where = 'checks'): void {
  throwIfProblems(validateChecks(checks, where));
}

export interface CheckResult {
  answers: number;
  /** Answers failing at least one check, with the failing checks named. */
  flagged: { sheet: string; q: string; failed: { check: string; detail: string }[] }[];
  /** Failures of checks over the whole document (a copied sheet). */
  doc_level: { check: string; detail: string }[];
  by_check: Record<string, number>;
}

function answerCheck(c: Check, sheet: JsonObject, a: JsonObject): string | undefined {
  const ev = Array.isArray(a.evidence) ? (a.evidence as unknown[]) : undefined;
  const entry = (i: number) => (isObj(ev?.[i]) ? (ev?.[i] as JsonObject) : undefined);
  switch (c.type) {
    case 'value_type':
      return Number.isInteger(a.value)
        ? undefined
        : `value ${JSON.stringify(a.value)} is not an integer`;
    case 'files_match_evidence': {
      if (!ev) return 'no evidence to compare the files list with';
      const fromEvidence = ev.map((e) => (isObj(e) ? e.file : undefined));
      return deepEqual(a.files, fromEvidence)
        ? undefined
        : `files ${JSON.stringify(a.files)} differ from the evidence files ${JSON.stringify(fromEvidence)}`;
    }
    case 'value_matches_chain': {
      if (!ev?.length) return 'no evidence to check the value against';
      return a.value === entry(0)?.out
        ? undefined
        : `value ${JSON.stringify(a.value)} is not what the entry file's evidence returns (${JSON.stringify(entry(0)?.out)})`;
    }
    case 'files_in_module': {
      const bad = (Array.isArray(a.files) ? a.files : []).filter(
        (f: unknown) => typeof f !== 'string' || !f.startsWith(`${String(sheet.module)}/`),
      );
      return bad.length
        ? `files outside module ${String(sheet.module)}: ${bad.slice(0, 2).join(', ')}`
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Evaluates the checks over a document body (the version a consumer reads). Total: any JSON body gives a
 * result; an answer that is not an object fails every per-answer check rather than throwing.
 */
export function runChecks(checks: Check[], content: unknown): CheckResult {
  const sheets: unknown[] = isObj(content) && Array.isArray(content.sheets) ? content.sheets : [];
  const result: CheckResult = { answers: 0, flagged: [], doc_level: [], by_check: {} };
  const bump = (k: string) => {
    result.by_check[k] = (result.by_check[k] ?? 0) + 1;
  };
  for (const s of sheets) {
    const sheet: JsonObject = isObj(s) ? s : {};
    for (const a of Array.isArray(sheet.answers) ? (sheet.answers as unknown[]) : []) {
      result.answers++;
      const failed: { check: string; detail: string }[] = [];
      for (const c of checks) {
        if (DOC_LEVEL.has(c.type)) continue;
        const d = isObj(a) ? answerCheck(c, sheet, a) : 'answer is not an object';
        if (d) {
          failed.push({ check: c.type, detail: d });
          bump(c.type);
        }
      }
      if (failed.length)
        result.flagged.push({
          sheet: String(sheet.module),
          q: String(isObj(a) ? a.q : undefined),
          failed,
        });
    }
  }
  if (checks.some((c) => c.type === 'unique_across_sheets')) {
    const key = (s: unknown) =>
      JSON.stringify(
        (isObj(s) && Array.isArray(s.answers) ? (s.answers as unknown[]) : []).map((a) =>
          isObj(a) ? [a.q, a.value, a.files] : null,
        ),
      );
    const mod = (s: unknown) => String(isObj(s) ? s.module : undefined);
    for (let i = 1; i < sheets.length; i++)
      for (let j = 0; j < i; j++)
        if (key(sheets[i]) === key(sheets[j])) {
          result.doc_level.push({
            check: 'unique_across_sheets',
            detail: `sheet ${mod(sheets[i])} has the same answers as sheet ${mod(sheets[j])}`,
          });
          bump('unique_across_sheets');
          break;
        }
  }
  return result;
}
