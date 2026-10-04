import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/orgrt/documents/canonical.js';
import {
  contractRevision,
  effectiveContract,
  validateContract,
} from '../../../src/orgrt/documents/contract.js';
import { DocError } from '../../../src/orgrt/documents/errors.js';

const findings = {
  type: 'findings',
  schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', minLength: 1 } } },
};
const sheets = {
  type: 'sheets-w1',
  schema: {
    type: 'object',
    title: 'Ünïcödé ☃ 😀',
    required: ['a'],
    properties: { a: { type: 'integer', minimum: -5, maximum: 1000000 } },
  },
  evidence: [{ kind: 'command', verify: 'reported', min: 2 }, { kind: 'diff' }, { kind: 'source' }],
  checks: [{ type: 'value_type', is: 'integer' }, { type: 'unique_across_sheets' }],
  deliverable_files: [
    { file: 'out/m1/answers.json', select: { array: 'sheets', key: 'module', value: 'm1' }, compare: ['module', 'answers[].q'] },
  ],
  visibility: 'org',
  max_publish_attempts: 4,
  max_consistency_refusals: 7,
  max_bytes: 30000,
};

// Shuffles key order at every depth (deterministically).
const shuffled = (v: unknown, salt = 1): unknown => {
  if (Array.isArray(v)) return v.map((x) => shuffled(x, salt));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    keys.sort((a, b) => ((a.charCodeAt(0) * salt) % 7) - ((b.charCodeAt(0) * salt) % 7) || b.localeCompare(a));
    return Object.fromEntries(keys.map((k) => [k, shuffled((v as Record<string, unknown>)[k], salt + 1)]));
  }
  return v;
};

describe('canonicalJson (RFC 8785 over the dialect value space)', () => {
  it('sorts keys by UTF-16 code unit, drops whitespace, nests', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }], B: 0 })).toBe('{"B":0,"a":[{"c":2,"d":1}],"b":1}');
    // astral characters sort by their surrogate (0xD83D), before U+FF5E and after U+E000 only as code units
    expect(canonicalJson({ '～': 1, '😀': 2, '': 3 })).toBe('{"😀":2,"":3,"～":1}');
  });

  it('is stable under key order and under whitespace/escape spelling of the source text', () => {
    const doc = { z: [1, { y: 'é', x: null }], a: { c: true, b: 'q' } };
    const text = '{ "a" : { "b":"q", "c":true } ,\n "z":[1,{"x":null,"y":"\\u00e9"}] }';
    expect(canonicalJson(JSON.parse(text))).toBe(canonicalJson(doc));
    expect(canonicalJson(doc)).toBe('{"a":{"b":"q","c":true},"z":[1,{"x":null,"y":"é"}]}');
  });

  it('does not normalize Unicode: precomposed and decomposed spellings differ; list order matters', () => {
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('escapes as JSON.stringify does: controls, quotes, lone surrogates', () => {
    expect(canonicalJson('a"b\\c\n\u0001')).toBe('"a\\"b\\\\c\\n\\u0001"');
    expect(canonicalJson('\ud800')).toBe('"\\ud800"');
  });

  it('numbers use the ECMAScript form: no plus on small exponents, -0 is 0, 1.0 is 1', () => {
    const n = (x: number) => canonicalJson(x);
    expect([n(1), n(1.0), n(-0), n(0.1), n(1e21), n(1e-7), n(123456789012345680000), n(0.000001), n(-5.5e-10)]).toEqual([
      '1', '1', '0', '0.1', '1e+21', '1e-7', '123456789012345680000', '0.000001', '-5.5e-10',
    ]);
  });

  it('absent and undefined members are the same thing', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('refuses what has no JSON form, with a typed error and a path', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const bad: [unknown, string][] = [
      [undefined, '$'], [Number.NaN, '$'], [Number.POSITIVE_INFINITY, '$'], [1n, '$'], [() => 1, '$'], [Symbol('s'), '$'],
      [new Date(0), '$'], [new Map(), '$'], [new (class A { x = 1 })(), '$'], [[1, undefined], '$[1]'],
      [[undefined, 1], '$[0]'], [{ a: { b: [Number.NaN] } }, '$.a.b[0]'], [cyc, '$.self.self.self'],
    ];
    for (const [v, pathStart] of bad) {
      try {
        canonicalJson(v);
        throw new Error(`no throw for ${String(v)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(DocError);
        expect((e as DocError).code).toBe('CANONICAL_UNSUPPORTED_VALUE');
        if (v !== cyc) expect((e as DocError).problems[0].path).toBe(pathStart);
      }
    }
  });

  it('property: parse(canonical(v)) equals v, canonical is idempotent and independent of key order (seeded)', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const str = () => Array.from({ length: Math.floor(rnd() * 5) }, () => String.fromCodePoint(0x20 + Math.floor(rnd() * 0x2500))).join('');
    const gen = (d: number): unknown => {
      const r = rnd();
      if (d > 3 || r < 0.3) return [Math.floor(rnd() * 1e6) - 5e5, rnd() * 100, str(), null, true][Math.floor(rnd() * 5)];
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
      return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 5) }, () => [str() || 'k', gen(d + 1)]));
    };
    for (let i = 0; i < 300; i++) {
      const v = gen(0);
      const c = canonicalJson(v);
      expect(JSON.parse(c)).toEqual(v);
      expect(canonicalJson(JSON.parse(c))).toBe(c);
      expect(canonicalJson(shuffled(v, i + 1))).toBe(c);
    }
  });
});

describe('effectiveContract', () => {
  it('fills every default and does not change the input', () => {
    const input = structuredClone(findings);
    const c = effectiveContract(input);
    expect(input).toEqual(findings);
    expect(c).toEqual({
      type: 'findings',
      schema: findings.schema,
      evidence: [],
      checks: [],
      deliverable_files: [],
      acceptance: 'each',
      visibility: 'consumers',
      on_stale: 'hold',
      gates: [],
      max_publish_attempts: 3,
      max_consistency_refusals: 5,
      max_bytes: 1048576,
    });
    expect(c.schema).not.toBe(input.schema);
  });

  it('fills evidence defaults per kind (verify only where a kind has one, min 1)', () => {
    expect(effectiveContract(sheets).evidence).toEqual([
      { kind: 'command', verify: 'reported', min: 2 },
      { kind: 'diff', min: 1 },
      { kind: 'source', verify: 'cited', min: 1 },
    ]);
  });
});

describe('validateContract: fail-closed, all problems at once, with paths', () => {
  const bad = (patch: Record<string, unknown>) => validateContract({ ...findings, ...patch }).map((p) => `${p.code}@${p.path}`);

  it('accepts the plain and the fully loaded contract', () => {
    expect(validateContract(findings)).toEqual([]);
    expect(validateContract(sheets)).toEqual([]);
  });

  it('refuses non-objects and unknown or deferred fields', () => {
    for (const v of [null, 3, 'x', [], undefined]) expect(validateContract(v).map((p) => p.code)).toEqual(['CONTRACT_NOT_OBJECT']);
    for (const f of ['owner', 'provisional', 'confidential', 'change', 'rerun_allow', 'deadline', 'unknown'])
      expect(bad({ [f]: 1 })).toEqual([`CONTRACT_UNKNOWN_FIELD@contract.${f}`]);
  });

  it('type names: pattern, length, reserved built-ins', () => {
    for (const t of ['Findings', '1a', 'a_b', '', 'x'.repeat(41), 3, '../x', 'a/b'])
      expect(bad({ type: t })).toEqual(['CONTRACT_INVALID_FIELD@contract.type']);
    expect(bad({ type: 'x'.repeat(40) })).toEqual([]);
    expect(bad({ type: 'request' })).toEqual(['CONTRACT_INVALID_FIELD@contract.type']);
    expect(bad({ type: 'answer' })).toEqual(['CONTRACT_INVALID_FIELD@contract.type']);
  });

  it('schema problems are prefixed with contract.schema; a $ref schema must be resolved first', () => {
    expect(bad({ schema: { type: 'object', properties: { a: { pattern: 'x' } } } })).toEqual([
      'SCHEMA_UNSUPPORTED_KEYWORD@contract.schema.properties.a.pattern',
    ]);
    expect(bad({ schema: { $ref: 'a.json' } })).toEqual(['SCHEMA_UNSUPPORTED_KEYWORD@contract.schema.$ref']);
    expect(validateContract({ type: 'a' }).map((p) => p.code)).toEqual(['SCHEMA_NOT_OBJECT']);
  });

  it('checks: unknown type or parameter makes the contract invalid', () => {
    expect(bad({ checks: [{ type: 'sum_equals' }] })).toEqual(['CHECK_UNKNOWN_TYPE@contract.checks[0]']);
    expect(bad({ checks: [{ type: 'files_in_module', n: 1 }] })).toEqual(['CHECK_UNKNOWN_PARAM@contract.checks[0]']);
    expect(bad({ checks: 'x' })).toEqual(['CHECK_NOT_LIST@contract.checks']);
  });

  it('evidence: kinds, verify per kind, min, duplicates, parameters', () => {
    const e = (x: unknown) => bad({ evidence: x });
    expect(e('x')).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence']);
    expect(e([{ kind: 'opinion' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'human' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'command', verify: 'rerun' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'source', verify: 'fetch' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'diff', verify: 'reported' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'document', verify: 'cited' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    for (const m of [0, -1, 1.5, '1']) expect(e([{ kind: 'diff', min: m }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
    expect(e([{ kind: 'diff' }, { kind: 'diff' }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[1]']);
    expect(e([{ kind: 'diff', extra: 1 }])).toEqual(['CONTRACT_INVALID_FIELD@contract.evidence[0]']);
  });

  it('deliverable_files: workspace-relative, well-formed', () => {
    const sel = { array: 'sheets', key: 'module', value: 'm1' };
    const d = (x: unknown) => bad({ deliverable_files: x });
    expect(d([{ file: 'out/a.json', select: sel, compare: ['q'] }])).toEqual([]);
    for (const file of ['/etc/passwd', '../x.json', 'a/../../x', '', 'a\0b', 3])
      expect(d([{ file, select: sel, compare: ['q'] }])).toEqual(['CONTRACT_INVALID_FIELD@contract.deliverable_files[0]']);
    expect(d([{ file: 'a', select: { array: 'x' }, compare: ['q'] }])).toEqual(['CONTRACT_INVALID_FIELD@contract.deliverable_files[0]']);
    expect(d([{ file: 'a', select: sel, compare: [] }])).toEqual(['CONTRACT_INVALID_FIELD@contract.deliverable_files[0]']);
    expect(d([{ file: 'a', select: sel, compare: ['q'], extra: 1 }])).toEqual(['CONTRACT_INVALID_FIELD@contract.deliverable_files[0]']);
    expect(d('x')).toEqual(['CONTRACT_INVALID_FIELD@contract.deliverable_files']);
  });

  it('deferred values are refused, not ignored; limits are bounded', () => {
    expect(bad({ acceptance: 'owner' })).toEqual(['CONTRACT_INVALID_FIELD@contract.acceptance']);
    expect(bad({ acceptance: 'any' })).toEqual(['CONTRACT_INVALID_FIELD@contract.acceptance']);
    expect(bad({ visibility: 'public' })).toEqual(['CONTRACT_INVALID_FIELD@contract.visibility']);
    expect(bad({ on_stale: 'keep' })).toEqual(['CONTRACT_INVALID_FIELD@contract.on_stale']);
    expect(bad({ on_stale: 'rebase-queued' })).toEqual(['CONTRACT_INVALID_FIELD@contract.on_stale']);
    expect(bad({ gates: ['human'] })).toEqual(['CONTRACT_INVALID_FIELD@contract.gates']);
    expect(bad({ gates: [] })).toEqual([]);
    for (const k of ['max_publish_attempts', 'max_consistency_refusals', 'max_bytes'])
      for (const v of [0, -1, 1.5, '3', null]) expect(bad({ [k]: v })).toEqual([`CONTRACT_INVALID_FIELD@contract.${k}`]);
    expect(bad({ max_bytes: 1048576 })).toEqual([]);
    expect(bad({ max_bytes: 1048577 })).toEqual(['CONTRACT_INVALID_FIELD@contract.max_bytes']);
  });

  it('reports every problem at once; effectiveContract throws them as a DocError', () => {
    const c = { type: 'Bad', schema: { oneOf: [] }, checks: [{ type: 'x' }], gates: ['human'] };
    expect(validateContract(c).map((p) => p.code)).toEqual([
      'CONTRACT_INVALID_FIELD', 'SCHEMA_UNSUPPORTED_KEYWORD', 'CHECK_UNKNOWN_TYPE', 'CONTRACT_INVALID_FIELD',
    ]);
    try {
      effectiveContract(c);
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DocError);
      expect((e as DocError).problems).toHaveLength(4);
      expect((e as DocError).code).toBe('CONTRACT_INVALID_FIELD');
    }
  });
});

describe('contractRevision', () => {
  it('golden values (cross-checked against an independent canonicalisation and sha-256)', () => {
    const a = contractRevision(findings);
    expect(a.revision).toBe('2739793d60dc967d40a9289c351ac3b5af891ee93441064226ff664a93762cf4');
    expect(a.canonical).toBe(
      '{"checks_dialect":"org-checks-v1","contract":{"acceptance":"each","checks":[],"deliverable_files":[],"evidence":[],"gates":[],"max_bytes":1048576,"max_consistency_refusals":5,"max_publish_attempts":3,"on_stale":"hold","schema":{"properties":{"summary":{"minLength":1,"type":"string"}},"required":["summary"],"type":"object"},"type":"findings","visibility":"consumers"},"dialect":"org-schema-v1"}',
    );
    expect(contractRevision(sheets).revision).toBe('8ef5561c5af621a37508d8a598c6dfd4699c8c3f9b2416cbb91a190129bbf200');
    expect(a.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable under key order and under writing the defaults out', () => {
    const r = contractRevision(findings).revision;
    for (let s = 1; s < 20; s++) expect(contractRevision(shuffled(findings, s)).revision).toBe(r);
    for (let s = 1; s < 20; s++) expect(contractRevision(shuffled(sheets, s)).revision).toBe(contractRevision(sheets).revision);
    expect(contractRevision({ ...findings, ...effectiveContract(findings) }).revision).toBe(r);
    expect(contractRevision(contractRevision(sheets).contract).revision).toBe(contractRevision(sheets).revision);
    expect(contractRevision({ ...findings, evidence: undefined }).revision).toBe(r);
  });

  it('changes with every part of the contract', () => {
    const base = contractRevision(sheets).revision;
    const variants: Record<string, unknown> = {
      'schema keyword': { ...sheets, schema: { ...sheets.schema, required: [] } },
      'schema title': { ...sheets, schema: { ...sheets.schema, title: 'other' } },
      type: { ...sheets, type: 'sheets-w2' },
      'check added': { ...sheets, checks: [...sheets.checks, { type: 'files_in_module' }] },
      'check order': { ...sheets, checks: [...sheets.checks].reverse() },
      'check param': { ...sheets, checks: [{ type: 'unique_across_sheets' }] },
      'deliverable file': { ...sheets, deliverable_files: [{ ...sheets.deliverable_files[0], file: 'out/m2/answers.json' }] },
      'deliverable compare': { ...sheets, deliverable_files: [{ ...sheets.deliverable_files[0], compare: ['module'] }] },
      'deliverable removed': { ...sheets, deliverable_files: [] },
      'evidence min': { ...sheets, evidence: [{ kind: 'command', verify: 'reported', min: 3 }, { kind: 'diff' }, { kind: 'source' }] },
      'evidence removed': { ...sheets, evidence: [] },
      visibility: { ...sheets, visibility: 'consumers' },
      attempts: { ...sheets, max_publish_attempts: 5 },
      refusals: { ...sheets, max_consistency_refusals: 8 },
      bytes: { ...sheets, max_bytes: 30001 },
    };
    const seen = new Set([base]);
    for (const [name, v] of Object.entries(variants)) {
      const r = contractRevision(v).revision;
      expect(r, name).not.toBe(base);
      seen.add(r);
    }
    expect(seen.size).toBe(Object.keys(variants).length + 1);
  });

  it('moves with the schema contents (not a path) and ignores spellings that mean the same thing', () => {
    expect(contractRevision({ ...findings, schema: { ...findings.schema, description: 'x' } }).revision).not.toBe(contractRevision(findings).revision);
    expect(contractRevision({ ...findings, evidence: [{ kind: 'diff', min: 1 }] }).revision).toBe(
      contractRevision({ ...findings, evidence: [{ kind: 'diff' }] }).revision,
    );
    expect(contractRevision({ ...findings, evidence: [{ kind: 'source', verify: 'cited' }] }).revision).toBe(
      contractRevision({ ...findings, evidence: [{ kind: 'source' }] }).revision,
    );
  });

  it('refuses an invalid contract with the DocError of validateContract', () => {
    expect(() => contractRevision({ ...findings, checks: [{ type: 'nope' }] })).toThrow(DocError);
    expect(() => contractRevision({ ...findings, checks: [{ type: 'nope' }] })).toThrow(/unknown check type/);
  });
});
