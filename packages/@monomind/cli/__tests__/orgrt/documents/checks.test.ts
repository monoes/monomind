import { describe, expect, it } from 'vitest';
import {
  assertSupportedChecks,
  CHECK_TYPES,
  type Check,
  runChecks,
  validateChecks,
} from '../../../src/orgrt/documents/checks.js';
import { DocError } from '../../../src/orgrt/documents/errors.js';

// The measured sweep-3 v2 shape: sheets of answers, each answer with the producer's evidence trace.
const SWEEP: Check[] = [
  { type: 'value_type', is: 'integer' },
  { type: 'files_match_evidence' },
  { type: 'value_matches_chain' },
  { type: 'files_in_module' },
  { type: 'unique_across_sheets' },
];
const modules = (w: number) => [1, 2, 3, 4].map((i) => `m${4 * (w - 1) + i}`);
const answer = (m: string, qi: number, salt: number) => {
  const files = Array.from({ length: 4 + (qi % 4) }, (_, i) => `${m}/f${(qi * 7 + i * 3 + salt) % 50}.js`);
  const value = 1000 * salt + 10 * qi + m.length;
  return {
    q: `q${String(qi + 1).padStart(2, '0')}`,
    value,
    files,
    evidence: files.map((file, i) => ({ file, in: 7 + i, out: i === 0 ? value : 100 + 13 * i })),
  };
};
const sheet = (m: string, salt: number) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => answer(m, qi, salt + Number(m.slice(1)))),
});
const correctDoc = (w = 1) => ({ worker: `worker-${w}`, sheets: modules(w).map((m) => sheet(m, w)) });

describe('checks dialect: fails closed, deterministic, nothing executed', () => {
  it('lists exactly the five ported checks', () => {
    expect(CHECK_TYPES).toEqual(['value_type', 'files_match_evidence', 'value_matches_chain', 'files_in_module', 'unique_across_sheets']);
    expect(validateChecks(SWEEP)).toEqual([]);
    expect(validateChecks([])).toEqual([]);
  });

  it('refuses an unknown check type or parameter, naming where, with a stable code', () => {
    expect(validateChecks([{ type: 'sum_equals' }], 'c')).toEqual([
      expect.objectContaining({ code: 'CHECK_UNKNOWN_TYPE', path: 'c[0]', message: expect.stringMatching(/unknown check type "sum_equals" \(contract invalid\)/) }),
    ]);
    expect(validateChecks([{ type: 'files_match_evidence', x: 1 }], 'c')).toEqual([
      expect.objectContaining({ code: 'CHECK_UNKNOWN_PARAM', path: 'c[0]', message: expect.stringMatching(/parameter "x"/) }),
    ]);
    expect(validateChecks([{ type: 'value_type', is: 'string' }], 'c').map((p) => p.code)).toEqual(['CHECK_BAD_PARAM']);
    expect(validateChecks([{ type: 'value_type' }], 'c').map((p) => p.code)).toEqual(['CHECK_BAD_PARAM']);
    expect(validateChecks([{ type: 'value_type', is: 'integer', min: 1 }], 'c').map((p) => p.code)).toEqual(['CHECK_UNKNOWN_PARAM']);
  });

  it('refuses a malformed list and malformed entries, and reports every bad entry', () => {
    for (const bad of [undefined, null, {}, 'checks', 3]) expect(validateChecks(bad).map((p) => p.code)).toEqual(['CHECK_NOT_LIST']);
    for (const bad of [null, 3, 'x', [], {}, { type: 3 }]) expect(validateChecks([bad]).map((p) => p.code)).toEqual(['CHECK_NEEDS_TYPE']);
    expect(validateChecks([{ type: 'nope' }, { type: 'value_type', is: 'x' }, { type: 'files_in_module' }, { type: 'zzz' }]).map((p) => `${p.code}@${p.path}`)).toEqual([
      'CHECK_UNKNOWN_TYPE@checks[0]',
      'CHECK_BAD_PARAM@checks[1]',
      'CHECK_UNKNOWN_TYPE@checks[3]',
    ]);
    // names on the Object prototype are not check types
    for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(validateChecks([{ type: t }]).map((p) => p.code)).toEqual(['CHECK_UNKNOWN_TYPE']);
  });

  it('assertSupportedChecks throws a DocError carrying the problems', () => {
    expect(() => assertSupportedChecks([{ type: 'nope' }], 'contract x checks')).toThrow(DocError);
    expect(() => assertSupportedChecks([{ type: 'nope' }], 'contract x checks')).toThrow(/contract x checks\[0\]: unknown check type/);
    expect(() => assertSupportedChecks(SWEEP)).not.toThrow();
  });
});

describe('runChecks over the measured sweep documents (ported v2 cases)', () => {
  it('passes an honest document: 48 answers, nothing flagged', () => {
    expect(runChecks(SWEEP, correctDoc())).toEqual({ answers: 48, flagged: [], doc_level: [], by_check: {} });
  });

  it('names each failing answer and check: wrong value, reversed files, duplicate sheet', () => {
    const d = correctDoc();
    d.sheets[1].answers[4].value += 9;
    d.sheets[0].answers[0].files.reverse();
    d.sheets[3].answers = structuredClone(d.sheets[2].answers);
    const r = runChecks(SWEEP, d);
    const by = (s: string, q: string) => r.flagged.find((f) => f.sheet === s && f.q === q)?.failed.map((x) => x.check);
    expect(by('m2', 'q05')).toEqual(['value_matches_chain']);
    expect(by('m1', 'q01')).toEqual(['files_match_evidence']);
    expect(by('m4', 'q01')).toEqual(['files_in_module']);
    expect(r.doc_level).toEqual([
      { check: 'unique_across_sheets', detail: 'sheet m4 has the same answers as sheet m3' },
    ]);
    expect(r.by_check).toEqual({ value_matches_chain: 1, files_match_evidence: 1, files_in_module: 12, unique_across_sheets: 1 });
  });

  it('the details say what differed', () => {
    const d = correctDoc();
    d.sheets[0].answers[0].value += 1;
    const f = runChecks(SWEEP, d).flagged[0].failed[0];
    expect(f.check).toBe('value_matches_chain');
    expect(f.detail).toMatch(/value \d+ is not what the entry file's evidence returns \(\d+\)/);
  });

  it('a missing evidence list, a non-integer value and wrong files flag several checks at once', () => {
    const r = runChecks(SWEEP, { sheets: [{ module: 'm1', answers: [{ q: 'q01', value: 'x', files: [] }] }] });
    expect(r.flagged[0].failed.map((f) => f.check)).toEqual(['value_type', 'files_match_evidence', 'value_matches_chain']);
  });

  it('a producer who fabricates consistent evidence is not caught (the honest limit)', () => {
    const d = correctDoc();
    const a = d.sheets[0].answers[4];
    a.value += 9;
    a.evidence[0].out = a.value;
    expect(runChecks(SWEEP, d)).toMatchObject({ flagged: [], doc_level: [] });
  });

  it('runs only the declared checks, and an empty list flags nothing', () => {
    const d = correctDoc();
    d.sheets[0].answers[0].value += 1;
    expect(runChecks([], d)).toEqual({ answers: 48, flagged: [], doc_level: [], by_check: {} });
    expect(runChecks([{ type: 'value_type', is: 'integer' }], d).flagged).toEqual([]);
  });

  it('unique_across_sheets finds every later sheet equal to an earlier one, once each', () => {
    const d = correctDoc();
    d.sheets[1].answers = structuredClone(d.sheets[0].answers);
    d.sheets[2].answers = structuredClone(d.sheets[0].answers);
    expect(runChecks([{ type: 'unique_across_sheets' }], d).doc_level.map((x) => x.detail)).toEqual([
      'sheet m2 has the same answers as sheet m1',
      'sheet m3 has the same answers as sheet m1',
    ]);
  });

  it('is total: odd bodies give a result and never throw', () => {
    for (const body of [null, 3, 'x', [], {}, { sheets: 'no' }, { sheets: [null, 3, { answers: 'x' }, { answers: [null, 5, []] }] }]) {
      const r = runChecks(SWEEP, body);
      expect(r.answers).toBeGreaterThanOrEqual(0);
    }
    const r = runChecks(SWEEP, { sheets: [{ module: 'm1', answers: [null] }] });
    expect(r.flagged[0]).toMatchObject({ sheet: 'm1', q: 'undefined' });
    expect(r.flagged[0].failed.map((f) => f.detail)).toEqual(Array(4).fill('answer is not an object'));
  });

  it('is deterministic and does not modify the body', () => {
    const d = correctDoc();
    d.sheets[0].answers[2].value += 3;
    const before = JSON.stringify(d);
    const a = runChecks(SWEEP, d);
    expect(runChecks(SWEEP, d)).toEqual(a);
    expect(JSON.stringify(d)).toBe(before);
  });
});
