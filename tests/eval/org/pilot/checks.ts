// tests/eval/org/pilot/checks.ts
//
// The pilot's contract-declared document checks (parallel-sweep-3 variant v2, harness-only): a small,
// deterministic dialect that fails closed, evaluated by the consumer's `pilot__doc_check` tool. A check is
// arithmetic or structure over the document's own fields; it never reads a file outside the document and
// never runs corpus code, so the no-node layer is unchanged. An unknown check type, or a parameter a check
// does not take, makes the contract invalid when it loads (the same rule as schema.ts): a check that is
// silently skipped would let a bad document through under a "checked" label.
//
// The dialect is shaped for answer-sheet documents, { sheets: [{ module, answers: [{ q, value, files,
// evidence: [{ file, in, out }] }] }] }. `evidence` is the producer's own trace of the call chain, entry file
// first: per file the argument it received (`in`) and what it returned (`out`), so the entry file's `out` is the
// answer's value. Honest evidence makes the value checkable without running anything; fabricated but
// self-consistent evidence passes every check here. The checks are necessary, not sufficient.
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
const DOC_LEVEL = new Set(['unique_across_sheets']);

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Throws on an unknown check type or parameter, naming where it is. */
export function assertSupportedChecks(checks: unknown, where = 'checks'): void {
  if (!Array.isArray(checks)) throw new Error(`${where}: must be a list`);
  checks.forEach((c, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(c) || typeof c.type !== 'string') throw new Error(`${at}: needs a type`);
    const allowed = PARAMS[c.type];
    if (!allowed) throw new Error(`${at}: unknown check type "${c.type}" (contract invalid)`);
    for (const k of Object.keys(c))
      if (!allowed.includes(k))
        throw new Error(`${at}: parameter "${k}" is not supported by ${c.type}`);
    if (c.type === 'value_type' && c.is !== 'integer')
      throw new Error(`${at}: value_type supports only is: "integer"`);
  });
}

export interface CheckResult {
  answers: number;
  /** Answers failing at least one check, with the failing checks named. */
  flagged: { sheet: string; q: string; failed: { check: string; detail: string }[] }[];
  /** Failures of checks over the whole document (a copied sheet). */
  doc_level: { check: string; detail: string }[];
  by_check: Record<string, number>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function answerCheck(c: Check, sheet: Json, a: Json): string | undefined {
  const ev: any[] | undefined = Array.isArray(a.evidence) ? a.evidence : undefined;
  switch (c.type) {
    case 'value_type':
      return Number.isInteger(a.value)
        ? undefined
        : `value ${JSON.stringify(a.value)} is not an integer`;
    case 'files_match_evidence': {
      if (!ev) return 'no evidence to compare the files list with';
      const fromEvidence = ev.map((e) => e?.file);
      return same(a.files, fromEvidence)
        ? undefined
        : `files ${JSON.stringify(a.files)} differ from the evidence files ${JSON.stringify(fromEvidence)}`;
    }
    case 'value_matches_chain': {
      if (!ev?.length) return 'no evidence to check the value against';
      return a.value === ev[0]?.out
        ? undefined
        : `value ${JSON.stringify(a.value)} is not what the entry file's evidence returns (${JSON.stringify(ev[0]?.out)})`;
    }
    case 'files_in_module': {
      const bad = (Array.isArray(a.files) ? a.files : []).filter(
        (f: unknown) => typeof f !== 'string' || !f.startsWith(`${sheet.module}/`),
      );
      return bad.length
        ? `files outside module ${sheet.module}: ${bad.slice(0, 2).join(', ')}`
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Evaluates the checks over a document's content (the version a consumer reads). */
export function runChecks(checks: Check[], content: unknown): CheckResult {
  const sheets: Json[] = isObj(content) && Array.isArray(content.sheets) ? content.sheets : [];
  const result: CheckResult = { answers: 0, flagged: [], doc_level: [], by_check: {} };
  const bump = (k: string) => {
    result.by_check[k] = (result.by_check[k] ?? 0) + 1;
  };
  for (const s of sheets) {
    for (const a of Array.isArray(s?.answers) ? s.answers : []) {
      result.answers++;
      const failed: { check: string; detail: string }[] = [];
      for (const c of checks) {
        if (DOC_LEVEL.has(c.type)) continue;
        const d = answerCheck(c, s, a);
        if (d) {
          failed.push({ check: c.type, detail: d });
          bump(c.type);
        }
      }
      if (failed.length) result.flagged.push({ sheet: String(s.module), q: String(a?.q), failed });
    }
  }
  if (checks.some((c) => c.type === 'unique_across_sheets')) {
    const key = (s: Json) =>
      JSON.stringify(
        (Array.isArray(s?.answers) ? s.answers : []).map((a: Json) => [a?.q, a?.value, a?.files]),
      );
    for (let i = 1; i < sheets.length; i++)
      for (let j = 0; j < i; j++)
        if (key(sheets[i]) === key(sheets[j])) {
          result.doc_level.push({
            check: 'unique_across_sheets',
            detail: `sheet ${sheets[i].module} has the same answers as sheet ${sheets[j].module}`,
          });
          bump('unique_across_sheets');
          break;
        }
  }
  return result;
}
