// P3.10 parity: the runtime deliverable comparison (packages/@monomind/cli/src/orgrt/documents/deliverables.ts)
// against the harness prototype that was measured (deliverables.ts, the sweep-3 v2 cases of handoff-v2.test.ts)
// on the committed v2 contracts. Same files, same document, same mismatch list and the same message text.
// Intended differences are listed in the last block. No model, no corpus build.
// @ts-nocheck: plain .mjs modules and fixtures
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverableGuard } from '../../../../packages/@monomind/cli/src/orgrt/documents/deliverable-guards.js';
import { deliverableMismatches as runtimeMismatches } from '../../../../packages/@monomind/cli/src/orgrt/documents/deliverables.js';
import { DocumentStore } from '../../../../packages/@monomind/cli/src/orgrt/documents/store.js';
import { applyContractTemplate } from './contract-template.js';
import { deliverableMismatches as protoMismatches } from './deliverables.js';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const V2 = applyContractTemplate(
  pilot.contracts,
  pilot.variants.find((v) => v.id === 'v2').contract_template,
);
const c1 = V2[0];
const mods = ['m1', 'm2', 'm3', 'm4'];

const fileSheet = (m) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => ({
    q: `q${String(qi + 1).padStart(2, '0')}`,
    value: 1000 + 10 * qi + Number(m.slice(1)),
    files: Array.from({ length: 4 + (qi % 4) }, (_, i) => `${m}/f${(qi * 7 + i * 3) % 50}.js`),
  })),
});
const withEvidence = (sheet) => ({
  ...sheet,
  answers: sheet.answers.map((a) => ({
    ...a,
    evidence: a.files.map((file, i) => ({
      file,
      in: 7 + i,
      out: i === 0 ? a.value : 100 + 13 * i,
    })),
  })),
});
const docSheet = (m) => withEvidence(fileSheet(m));
const doc = () => ({ worker: 'worker-1', sheets: mods.map(docSheet) });

let ws;
const put = (m, v) => {
  mkdirSync(join(ws, 'out', m), { recursive: true });
  writeFileSync(join(ws, 'out', m, 'answers.json'), typeof v === 'string' ? v : JSON.stringify(v));
};
beforeAll(() => {
  ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p310-parity-'));
});
afterAll(() => rmSync(ws, { recursive: true, force: true }));
const resetFiles = () => mods.forEach((m) => put(m, fileSheet(m)));
const same = (body) => {
  const p = protoMismatches(ws, c1.deliverables, body);
  const r = runtimeMismatches(ws, c1.deliverables, body);
  expect(r).toEqual(p);
  return r;
};

describe('the runtime comparison gives the prototype answer on every sweep-3 v2 case', () => {
  it('the committed v2 contract declares four files compared on module, q, value and files', () => {
    expect(c1.deliverables.map((d) => d.file)).toEqual(mods.map((m) => `out/${m}/answers.json`));
    expect(c1.deliverables[0].compare).toEqual([
      'module',
      'answers[].q',
      'answers[].value',
      'answers[].files',
    ]);
  });

  it('a consistent document passes; evidence and the files extra keys are ignored', () => {
    resetFiles();
    expect(same(doc())).toEqual([]);
    put('m1', {
      ...fileSheet('m1'),
      note: 'extra',
      answers: fileSheet('m1').answers.map((a) => ({ ...a, extra: 1 })),
    });
    expect(same(doc())).toEqual([]);
    const d = doc();
    d.sheets[0].answers[0].evidence[1].out += 5;
    expect(same(d)).toEqual([]);
  });

  it('a wrong value names the third sheet file and $.answers[3].value', () => {
    resetFiles();
    const d = doc();
    d.sheets[2].answers[3].value += 1;
    const r = same(d);
    expect(r).toHaveLength(1);
    expect(r[0].problem).toMatch(
      /out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[3\]\.value/,
    );
  });

  it('reversed files name $.answers[0].files[0]', () => {
    resetFiles();
    const d = doc();
    d.sheets[1].answers[0].files.reverse();
    expect(same(d)[0].problem).toMatch(/out\/m2\/answers\.json .* at \$\.answers\[0\]\.files\[0\]/);
  });

  it('a missing file, invalid JSON, and a document missing a sheet', () => {
    resetFiles();
    rmSync(join(ws, 'out/m2/answers.json'));
    put('m4', 'not json');
    const r = same(doc());
    expect(r.map((m) => m.problem)).toEqual([
      'out/m2/answers.json does not exist; write it before publishing',
      'out/m4/answers.json is not valid JSON; write it before publishing',
    ]);
    resetFiles();
    const d = doc();
    d.sheets[0].module = 'm6';
    expect(same(d).map((m) => m.file)).toContain('out/m1/answers.json');
  });
});

describe('the guards give the harness flows: publish refusal then fix, cap then fail closed, accept refused after a change', () => {
  const open = () => {
    const store = new DocumentStore({
      dir: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p310-store-')),
      run: 'r',
      bindings: [
        {
          contract: {
            type: c1.id,
            schema: c1.schema,
            deliverable_files: c1.deliverables,
            max_publish_attempts: c1.max_attempts,
            max_consistency_refusals: c1.max_refusals,
            max_bytes: c1.max_chars,
          },
          section: 'sweep-1',
          producers: ['worker-1'],
          consumers: [{ id: 'synthesis', deciders: ['synthesiser'] }],
        },
      ],
    });
    store.addGuard(deliverableGuard({ workspaceOf: () => ws }));
    return store;
  };
  const body = () => ({ worker: 'worker-1', sheets: mods.map(docSheet) });
  let k = 0;
  const pub = (store, b) =>
    store.publish({ role: 'worker-1', type: c1.id, body: b, idempotency_key: `k${++k}` });

  it('a refusal names the file, is not an attempt, and the corrected document commits', () => {
    resetFiles();
    const store = open();
    const bad = body();
    bad.sheets[2].answers[3].value += 1;
    const r = pub(store, bad);
    expect(r).toMatchObject({ ok: false, guard_code: 'DELIVERABLE_MISMATCH' });
    expect(r.message).toMatch(
      /out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[3\]\.value/,
    );
    expect(r.message).not.toMatch(/out\/m1\/|out\/m2\//);
    expect(store.attempts(c1.id)).toMatchObject({ used: 0, refusals_used: 1 });
    expect(pub(store, body())).toMatchObject({ ok: true, version: 1 });
  });

  it('five consistency refusals, then the store fails closed even for a consistent document', () => {
    resetFiles();
    const store = open();
    const bad = body();
    bad.sheets[0].answers[0].value += 1;
    for (let i = 0; i < 5; i++) expect(pub(store, bad).ok).toBe(false);
    expect(pub(store, body())).toMatchObject({ ok: false, code: 'CONSISTENCY_EXHAUSTED' });
    expect(store.attempts(c1.id)).toMatchObject({ used: 0 });
  });

  it('an accept after a changed file is refused naming the file; the republish is accepted', () => {
    resetFiles();
    const store = open();
    const v1 = pub(store, body());
    const f = fileSheet('m3');
    f.answers[2].value += 1;
    put('m3', f);
    const r = store.decide({
      role: 'synthesiser',
      id: v1.id,
      version: 1,
      decision: 'accept',
      idempotency_key: 'd1',
    });
    expect(r).toMatchObject({ ok: false, guard_code: 'DELIVERABLE_CHANGED' });
    expect(r.message).toMatch(
      /deliverable files changed after it was published.*out\/m3\/answers\.json differs/,
    );
    const fixed = body();
    fixed.sheets[2] = withEvidence(f);
    const rev = store.publish({
      role: 'worker-1',
      type: c1.id,
      body: fixed,
      supersedes: `${v1.id}@v1`,
      idempotency_key: 'rev',
    });
    expect(rev).toMatchObject({ ok: true, version: 2 });
    expect(
      store.decide({
        role: 'synthesiser',
        id: v1.id,
        version: 2,
        decision: 'accept',
        idempotency_key: 'd2',
      }),
    ).toMatchObject({ ok: true, status: 'accepted' });
  });
});

// Other intended differences, not testable as parity: the harness counts consistency refusals per document and
// relays a changed-file accept itself; the runtime counts per type (the store's P3.5 budget) and exposes the facts
// to the relay of P3.9 through the guard's onChanged option.
describe('where the runtime intentionally differs from the harness', () => {
  it('the runtime refuses a path or link that leaves the workspace; the harness reads it', () => {
    const outside = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p310-out-'));
    writeFileSync(join(outside, 'answers.json'), JSON.stringify(fileSheet('m1')));
    const d = {
      file: `../${outside.split('/').at(-1)}/answers.json`,
      select: c1.deliverables[0].select,
      compare: c1.deliverables[0].compare,
    };
    expect(runtimeMismatches(ws, [d], doc())[0].problem).toMatch(
      /not a path inside your workspace/,
    );
    rmSync(outside, { recursive: true, force: true });
  });
});
