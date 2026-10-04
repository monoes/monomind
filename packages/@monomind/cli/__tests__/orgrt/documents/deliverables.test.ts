// P3.10: the comparison half of deliverable consistency: what a file and a document must agree on, and the
// containment rules for reading the producer's files (read-only, inside the workspace, regular, bounded).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../../../src/orgrt/documents/contract.js';
import { deliverableMismatches, readWorkspaceJson } from '../../../src/orgrt/documents/deliverables.js';
import type { DeliverableFile } from '../../../src/orgrt/documents/types.js';

const tmp = (n = 'p310-') => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), n));
const put = (ws: string, rel: string, v: unknown) => {
  mkdirSync(join(ws, rel, '..'), { recursive: true });
  writeFileSync(join(ws, rel), typeof v === 'string' ? v : JSON.stringify(v));
};

const sweep = (m: string): DeliverableFile => ({
  file: `out/${m}/answers.json`,
  select: { array: 'sheets', key: 'module', value: m },
  compare: ['module', 'answers[].q', 'answers[].value', 'answers[].files'],
});
const sheet = (m: string) => ({
  module: m,
  answers: [
    { q: 'q01', value: 11, files: ['a.js', 'b.js'] },
    { q: 'q02', value: 22, files: ['c.js'] },
  ],
});
const withEvidence = (m: string) => ({
  ...sheet(m),
  answers: sheet(m).answers.map((a) => ({ ...a, evidence: [{ file: a.files[0], in: 1, out: a.value }] })),
});
const doc = (...ms: string[]) => ({ worker: 'worker-1', sheets: ms.map(withEvidence) });

describe('compare shapes', () => {
  it('a file equal to its part passes; the document-only evidence and the file own extra keys are ignored', () => {
    const ws = tmp();
    put(ws, 'out/m1/answers.json', { ...sheet('m1'), note: 'extra', answers: sheet('m1').answers.map((a) => ({ ...a, extra: 1 })) });
    expect(deliverableMismatches(ws, [sweep('m1')], doc('m1'))).toEqual([]);
  });

  it('names the file and the first differing path for a value, for a reordered files list and for a q', () => {
    const ws = tmp();
    put(ws, 'out/m1/answers.json', sheet('m1'));
    const value = doc('m1');
    value.sheets[0].answers[1].value += 1;
    expect(deliverableMismatches(ws, [sweep('m1')], value)[0].problem).toBe(
      "out/m1/answers.json differs from the document's sheets entry m1 at $.answers[1].value: the file has 22, the document has 23",
    );
    const order = doc('m1');
    order.sheets[0].answers[0].files.reverse();
    expect(deliverableMismatches(ws, [sweep('m1')], order)[0].problem).toMatch(/at \$\.answers\[0\]\.files\[0\]: the file has "a\.js", the document has "b\.js"/);
    const q = doc('m1');
    q.sheets[0].answers[0].q = 'q99';
    expect(deliverableMismatches(ws, [sweep('m1')], q)[0].problem).toMatch(/at \$\.answers\[0\]\.q:/);
  });

  it('a shorter or longer list differs where the lists stop agreeing', () => {
    const ws = tmp();
    put(ws, 'out/m1/answers.json', sheet('m1'));
    const d = doc('m1');
    d.sheets[0].answers.pop();
    expect(deliverableMismatches(ws, [sweep('m1')], d)[0].problem).toMatch(/at \$\.answers\[1\]:/);
  });

  it('a file with different key order is the same value', () => {
    const ws = tmp();
    put(ws, 'out/m1/answers.json', '{"answers":[{"files":["a.js","b.js"],"value":11,"q":"q01"},{"files":["c.js"],"value":22,"q":"q02"}],"module":"m1"}');
    expect(deliverableMismatches(ws, [sweep('m1')], doc('m1'))).toEqual([]);
  });

  it('a missing file, invalid JSON and a document without the entry are each named', () => {
    const ws = tmp();
    put(ws, 'out/m2/answers.json', 'not json');
    const bad = deliverableMismatches(ws, [sweep('m1'), sweep('m2'), sweep('m3')], doc('m1', 'm2'));
    expect(bad.map((b) => b.file)).toEqual(['out/m1/answers.json', 'out/m2/answers.json', 'out/m3/answers.json']);
    expect(bad[0].problem).toBe('out/m1/answers.json does not exist; write it before publishing');
    expect(bad[1].problem).toBe('out/m2/answers.json is not valid JSON; write it before publishing');
    put(ws, 'out/m3/answers.json', sheet('m3'));
    expect(deliverableMismatches(ws, [sweep('m3')], doc('m1'))[0].problem).toBe('the document has no sheets entry with module m3 for out/m3/answers.json');
    expect(deliverableMismatches(ws, [sweep('m3')], 'not an object')[0].problem).toMatch(/no sheets entry/);
  });

  it('a whole-element compare (a bare field list item) and nested paths work', () => {
    const ws = tmp();
    put(ws, 'a.json', { tags: ['x', 'y'], meta: { n: 1, other: 2 } });
    const d: DeliverableFile = { file: 'a.json', select: { array: 'items', key: 'id', value: 'i1' }, compare: ['tags', 'meta.n'] };
    expect(deliverableMismatches(ws, [d], { items: [{ id: 'i1', tags: ['x', 'y'], meta: { n: 1, other: 9 } }] })).toEqual([]);
    expect(deliverableMismatches(ws, [d], { items: [{ id: 'i1', tags: ['x', 'y'], meta: { n: 2 } }] })[0].problem).toMatch(/at \$\.meta\.n: the file has 1, the document has 2/);
  });
});

describe('containment: the producer files are read read-only and only from inside the workspace', () => {
  it('refuses a traversal or absolute path, even though contracts also refuse them', () => {
    const ws = tmp();
    const outside = tmp('p310-out-');
    put(outside, 'secret.json', { s: 1 });
    for (const f of ['../secret.json', 'out/../../x.json', join(outside, 'secret.json'), 'a\0b'])
      expect(readWorkspaceJson(ws, f)).toMatchObject({ ok: false, problem: expect.stringMatching(/not a path inside your workspace/) });
  });

  it('refuses a file symlink and a directory symlink that leave the workspace, and does not read through them', () => {
    const ws = tmp();
    const outside = tmp('p310-out-');
    put(outside, 'secret.json', { s: 1 });
    symlinkSync(join(outside, 'secret.json'), join(ws, 'link.json'));
    symlinkSync(outside, join(ws, 'dir'));
    for (const f of ['link.json', 'dir/secret.json'])
      expect(readWorkspaceJson(ws, f)).toEqual({ ok: false, problem: `${f} resolves outside your workspace` });
  });

  it('a symlink that stays inside the workspace is followed', () => {
    const ws = tmp();
    put(ws, 'real/a.json', { ok: true });
    symlinkSync(join(ws, 'real', 'a.json'), join(ws, 'alias.json'));
    expect(readWorkspaceJson(ws, 'alias.json')).toEqual({ ok: true, value: { ok: true } });
  });

  it('refuses a directory and a fifo (not regular files) without blocking', () => {
    const ws = tmp();
    mkdirSync(join(ws, 'd.json'));
    execFileSync('mkfifo', [join(ws, 'pipe.json')]);
    expect(readWorkspaceJson(ws, 'd.json')).toMatchObject({ ok: false, problem: 'd.json is not a regular file' });
    expect(readWorkspaceJson(ws, 'pipe.json')).toMatchObject({ ok: false, problem: 'pipe.json is not a regular file' });
  });

  it('refuses a file over the document size limit, and a workspace that does not exist', () => {
    const ws = tmp();
    put(ws, 'big.json', JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }));
    expect(readWorkspaceJson(ws, 'big.json')).toMatchObject({ ok: false, problem: expect.stringMatching(/^big\.json is over the 1048576 byte limit/) });
    expect(readWorkspaceJson(join(ws, 'nope'), 'a.json')).toMatchObject({ ok: false, problem: expect.stringMatching(/workspace is not available/) });
  });

  it('the message never shows the workspace path', () => {
    const ws = tmp();
    expect(JSON.stringify(readWorkspaceJson(ws, 'missing.json'))).not.toContain(ws);
  });
});

describe('the deliverable_files contract field (P3.4 validation, plus the compare path syntax)', () => {
  const base = { type: 'sheets', schema: { type: 'object' } };
  const bad = (compare: unknown[]) =>
    validateContract({ ...base, deliverable_files: [{ file: 'a.json', select: { array: 'x', key: 'k', value: 'v' }, compare }] }).map((p) => p.path);
  it('accepts dotted names with [] and refuses anything else', () => {
    expect(bad(['module', 'answers[].q', 'a.b[].c'])).toEqual([]);
    for (const c of ['answers[0].q', 'a..b', '.a', 'a.', 'a[]x', '$.a', 'a b', '[]'])
      expect(bad([c]), c).toEqual(['contract.deliverable_files[0]']);
  });
  it('still refuses an unknown key, an absolute path and a traversal', () => {
    const e = (d: unknown) => validateContract({ ...base, deliverable_files: [d] }).map((p) => p.code);
    const ok = { file: 'a.json', select: { array: 'x', key: 'k', value: 'v' }, compare: ['q'] };
    expect(e({ ...ok, extra: 1 })).toEqual(['CONTRACT_INVALID_FIELD']);
    expect(e({ ...ok, file: '/etc/passwd' })).toEqual(['CONTRACT_INVALID_FIELD']);
    expect(e({ ...ok, file: 'a/../../b' })).toEqual(['CONTRACT_INVALID_FIELD']);
  });
});
