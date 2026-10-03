// parallel-sweep fixture (approved 2026-10-03): a corpus with eight independent parts and a synthesis that needs
// all of them. These tests show the corpus is reproducible, that the truth is what the code really returns,
// that the scorer accepts the complete reference and rejects each degraded one for the right reason, that
// the synthesis cannot be answered from fewer than all eight modules, and what the workload is.
// No model is called anywhere.
// @ts-nocheck: the fixture scripts are plain .mjs modules without type declarations
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertSupportedSchema, checkAgainstSchema } from '../../pilot/schema.js';
import { referenceDeliverables } from './hidden/reference/write-answers.mjs';
import { checkDeliverables, scoreModule, scoreSynthesis } from './score.mjs';
import { MODULE_IDS, deriveSynthesis } from './synthesis.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));
const pilot = JSON.parse(
  readFileSync(join(here, '../../pilot/parallel-sweep.pilot.json'), 'utf8'),
);

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
const hashOf = (dir: string) => {
  const h = createHash('sha256');
  for (const f of walk(dir).sort()) h.update(`${f}\0`).update(readFileSync(join(dir, f))).update('\0');
  return h.digest('hex');
};
const build = () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-'));
  const corpus = join(root, 'corpus');
  const truth = join(root, 'truth.json');
  const r = spawnSync('node', [join(here, 'build-corpus.mjs'), corpus, '--truth', truth], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return { root, corpus, truth, truthDoc: JSON.parse(readFileSync(truth, 'utf8')) };
};
const write = (dir: string, deliverables: Record<string, unknown>) => {
  for (const [p, doc] of Object.entries(deliverables)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), JSON.stringify(doc));
  }
  return dir;
};
const scratch = () => mkdtempSync(join(tmpdir(), 'sweep-out-'));

let a: ReturnType<typeof build>;
let b: ReturnType<typeof build>;
beforeAll(() => {
  a = build();
  b = build();
});

describe('the corpus builds reproducibly, without answers', () => {
  it('is byte for byte the same on every build, and matches the pinned hash', () => {
    expect(hashOf(a.corpus)).toBe(hashOf(b.corpus));
    expect(hashOf(a.corpus)).toBe(record.fixture.pinned_hash);
    expect(readFileSync(a.truth, 'utf8')).toBe(readFileSync(b.truth, 'utf8'));
  });

  it('holds no truth file and no chain listing: questions name only an entry function', () => {
    const files = walk(a.corpus);
    expect(files.some((f) => /truth/i.test(f))).toBe(false);
    for (const m of MODULE_IDS) {
      const qs = JSON.parse(readFileSync(join(a.corpus, m, 'questions.json'), 'utf8'));
      expect(qs).toHaveLength(12);
      for (const q of qs) expect(Object.keys(q).sort()).toEqual(['file', 'name', 'q']);
    }
    const all = files.map((f) => readFileSync(join(a.corpus, f), 'utf8')).join('\n');
    expect(all).not.toMatch(/"files"|"value"|"chain"/);
  });

  it('refuses a truth path inside the corpus directory', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'sweep-bad-')), 'c');
    const r = spawnSync('node', [join(here, 'build-corpus.mjs'), out, '--truth', join(out, 't.json')], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/outside the corpus/);
  });

  it('has 8 modules of 30 files plus a config, each file 30 to 100 lines, plain ESM', () => {
    for (const m of MODULE_IDS) {
      const code = walk(join(a.corpus, m)).filter((f) => f.endsWith('.mjs'));
      expect(code).toHaveLength(31);
      expect(code).toContain('config.mjs');
      for (const f of code.filter((f) => f !== 'config.mjs')) {
        const text = readFileSync(join(a.corpus, m, f), 'utf8');
        const lines = text.split('\n').length - 1;
        expect(lines).toBeGreaterThanOrEqual(60);
        expect(lines).toBeLessThanOrEqual(100);
        expect(text).toMatch(/^export /m);
      }
    }
  });

  it('keeps the config tricky: a stale default is overridden later in the same file', () => {
    const cfg = readFileSync(join(a.corpus, 'm1', 'config.mjs'), 'utf8');
    expect(cfg).toMatch(/const defaults = \{/);
    expect(cfg).toMatch(/const overrides = \{/);
    expect(cfg).toMatch(/CONFIG = \{ \.\.\.defaults, \.\.\.overrides \}/);
  });
});

describe('the truth is computed from the code, not asserted', () => {
  const t = () => a.truthDoc;

  it('every chain is 4 to 7 distinct files of its own module, starting at the entry file; 12 per module with the same lengths in each', () => {
    const lengths = (m: string) =>
      Object.values(t().modules[m])
        .map((c: any) => c.files.length)
        .sort();
    for (const m of MODULE_IDS) {
      expect(Object.keys(t().modules[m])).toHaveLength(12);
      for (const c of Object.values(t().modules[m]) as any[]) {
        expect(c.files.length).toBeGreaterThanOrEqual(4);
        expect(c.files.length).toBeLessThanOrEqual(7);
        expect(new Set(c.files).size).toBe(c.files.length);
        expect(c.files.every((f: string) => f.startsWith(`${m}/`))).toBe(true);
        expect(c.files[0]).toBe(c.entry.file);
        expect(Number.isInteger(c.value)).toBe(true);
      }
      expect(lengths(m)).toEqual(lengths('m1'));
    }
  });

  it('every chain step imports the next step (static check of all 96 chains)', () => {
    for (const m of MODULE_IDS)
      for (const c of Object.values(t().modules[m]) as any[])
        for (let i = 0; i < c.files.length - 1; i++) {
          const src = readFileSync(join(a.corpus, c.files[i]), 'utf8');
          expect(src).toContain(`from './${c.files[i + 1].split('/')[1]}'`);
        }
  });

  it('re-executing a sample of 10 chains in a child process gives the recorded values', () => {
    const all = MODULE_IDS.flatMap((m) =>
      Object.entries(t().modules[m]).map(([q, c]: [string, any]) => ({ m, q, c })),
    );
    const sample = all.filter((_, i) => i % 10 === 3).slice(0, 10);
    expect(sample).toHaveLength(10);
    const script = `
      const { pathToFileURL } = await import('node:url');
      const { join } = await import('node:path');
      const out = [];
      for (const e of ${JSON.stringify(sample.map((s) => s.c.entry))}) {
        const m = await import(pathToFileURL(join(${JSON.stringify(a.corpus)}, e.file)).href);
        out.push(m[e.name]());
      }
      console.log(JSON.stringify(out));`;
    const r = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(sample.map((s) => s.c.value));
  });

  it('decoys exist: near-identical function names are defined in the module and not in any chain', () => {
    const chainNames = new Set(
      MODULE_IDS.flatMap((m) =>
        Object.values(t().modules[m]).map((c: any) => `${m}/${c.entry.name}`),
      ),
    );
    const m1 = walk(join(a.corpus, 'm1'))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => readFileSync(join(a.corpus, 'm1', f), 'utf8'))
      .join('\n');
    const entry = t().modules.m1.q01.entry.name;
    expect(chainNames.has(`m1/${entry}`)).toBe(true);
    const near = [...m1.matchAll(/export function (\w+)/g)]
      .map((x) => x[1])
      .filter((n) => n !== entry && n.includes(entry));
    expect(near.length + (m1.match(new RegExp(`Preferred over ${entry}|of ${entry}`, 'g')) ?? []).length).toBeGreaterThan(0);
  });
});

describe('the scorer', () => {
  const truth = () => a.truthDoc;
  const sheet = (m: string, mutate?: (answers: any[]) => void) => {
    const doc = referenceDeliverables(truth(), 'complete')[`${m}/answers.json`] as any;
    mutate?.(doc.answers);
    return doc;
  };

  it('accepts the complete reference: 8 module sheets and the synthesis, nothing critical', () => {
    const dir = write(scratch(), referenceDeliverables(truth(), 'complete'));
    const r = checkDeliverables(dir, truth());
    expect(r.units.filter((u) => u.unit === 'module-sheet')).toHaveLength(8);
    expect(r.units.filter((u) => u.unit === 'synthesis')).toHaveLength(1);
    expect(r.units.every((u) => u.accepted && u.evidence.failures.length === 0)).toBe(true);
    expect(r.critical).toEqual([]);
  });

  it('the partial reference (3 modules, what a time-limited serial agent reaches) gets 3 of 8 sheets and no synthesis', () => {
    const dir = write(scratch(), referenceDeliverables(truth(), 'partial'));
    const r = checkDeliverables(dir, truth());
    const sheets = r.units.filter((u) => u.unit === 'module-sheet');
    expect(sheets.filter((u) => u.accepted).map((u) => u.module)).toEqual(['m1', 'm2', 'm3']);
    expect(sheets.filter((u) => !u.accepted).map((u) => u.evidence.failures[0])).toEqual(
      ['m4', 'm5', 'm6', 'm7', 'm8'].map((m) => `${m}: file is missing`),
    );
    const syn = r.units.find((u) => u.unit === 'synthesis');
    expect(syn.accepted).toBe(false);
    expect(syn.evidence.failures).toEqual(['synthesis: file is missing']);
  });

  it('the wrong-values reference is rejected on every sheet and on the synthesis, naming wrong values and wrong file lists', () => {
    const dir = write(scratch(), referenceDeliverables(truth(), 'wrong'));
    const r = checkDeliverables(dir, truth());
    expect(r.units.some((u) => u.accepted)).toBe(false);
    const first = r.units[0].evidence.failures;
    expect(first).toHaveLength(12);
    expect(first[0]).toBe('q01: wrong value and wrong file list');
    expect(r.units.at(-1).evidence.failures.length).toBeGreaterThan(0);
  });

  it('accepts a sheet with 11 of 12 right and refuses 10 of 12; a right value with a wrong file order is wrong', () => {
    const ok = scoreModule(sheet('m4', (a) => (a[0].value += 1)), truth(), 'm4');
    expect(ok).toMatchObject({ accepted: true, correct: 11 });
    expect(ok.failures).toEqual(['q01: wrong value']);
    const no = scoreModule(
      sheet('m4', (a) => {
        a[0].value += 1;
        a[1].files = [...a[1].files].reverse();
      }),
      truth(),
      'm4',
    );
    expect(no).toMatchObject({ accepted: false, correct: 10 });
    expect(no.failures).toEqual(['q01: wrong value', 'q02: wrong file list']);
  });

  it('a sheet that names the wrong module is not accepted, a missing answer counts against it', () => {
    const wrong = scoreModule(sheet('m4'), truth(), 'm5');
    expect(wrong.accepted).toBe(false);
    expect(wrong.failures).toContain('m5: the sheet names module m4');
    const short = scoreModule(sheet('m4', (a) => a.pop()), truth(), 'm4');
    expect(short).toMatchObject({ accepted: true, correct: 11 });
    expect(short.failures).toEqual(['q12: not answered']);
  });

  it('synthesis is accepted only when all 6 are exact', () => {
    const doc = referenceDeliverables(truth(), 'complete')['synthesis.json'] as any;
    expect(scoreSynthesis(doc, truth())).toMatchObject({ accepted: true, correct: 6 });
    doc.answers[1].value += 1;
    const r = scoreSynthesis(doc, truth());
    expect(r).toMatchObject({ accepted: false, correct: 5 });
    expect(r.failures).toEqual(['s2: wrong value']);
  });

  it('flags a fabricated answer for a question that does not exist as critical', () => {
    const complete = referenceDeliverables(truth(), 'complete') as any;
    complete['m2/answers.json'].answers.push({ q: 'q13', value: 7, files: ['m2/a.mjs'] });
    complete['synthesis.json'].answers.push({ q: 's7', value: 1 });
    const r = checkDeliverables(write(scratch(), complete), truth());
    expect(r.critical).toEqual([
      'm2: an answer for q13, which is not a question',
      'synthesis: an answer for s7, which is not a question',
    ]);
    // the sheet itself still scores on its 12 real answers
    expect(r.units.find((u) => u.module === 'm2').accepted).toBe(true);
  });

  it('flags identical answer lists across two modules (a copied sheet) as critical', () => {
    const complete = referenceDeliverables(truth(), 'complete') as any;
    complete['m6/answers.json'] = { ...complete['m5/answers.json'], module: 'm6' };
    const r = checkDeliverables(write(scratch(), complete), truth());
    expect(r.critical).toEqual(['m5 and m6 carry identical answer lists (copied)']);
    expect(r.units.find((u) => u.module === 'm6').accepted).toBe(false);
  });

  it('reports an unreadable sheet as a failure, not a crash', () => {
    const dir = write(scratch(), referenceDeliverables(truth(), 'complete'));
    writeFileSync(join(dir, 'm3', 'answers.json'), '{not json');
    const r = checkDeliverables(dir, truth());
    const m3 = r.units.find((u) => u.module === 'm3');
    expect(m3).toMatchObject({ accepted: false, evidence: { failures: ['m3: file is not valid JSON'] } });
  });
});

describe('the module-sheet hand-off contracts (treatment arm)', () => {
  const contract = (m: string) => pilot.contracts.find((c: any) => c.id === `module-sheet-${m}`);

  it('are 8, one per module, each a worker producing for the synthesiser, in the fail-closed dialect', () => {
    expect(pilot.contracts.map((c: any) => c.id)).toEqual(MODULE_IDS.map((m) => `module-sheet-${m}`));
    for (const c of pilot.contracts) {
      expect(c.consumers).toEqual(['synthesiser']);
      expect(c.producer).toMatch(/^worker-[1-4]$/);
      expect(() => assertSupportedSchema(c.schema)).not.toThrow();
    }
  });

  it('every reference sheet validates against its contract', () => {
    const docs = referenceDeliverables(a.truthDoc, 'complete');
    for (const m of MODULE_IDS)
      expect(checkAgainstSchema(contract(m).schema, docs[`${m}/answers.json`])).toEqual([]);
  });

  it('refuses a sheet with a missing field, an extra field or a wrong type', () => {
    const good = () => referenceDeliverables(a.truthDoc, 'complete')['m1/answers.json'] as any;
    const schema = contract('m1').schema;
    const missing = good();
    delete missing.answers[0].files;
    expect(checkAgainstSchema(schema, missing)).toEqual(['$.answers[0].files: required']);
    const extra = good();
    extra.note = 'done';
    expect(checkAgainstSchema(schema, extra)).toEqual(['$.note: not allowed']);
    const extraInner = good();
    extraInner.answers[3].confidence = 0.9;
    expect(checkAgainstSchema(schema, extraInner)).toEqual(['$.answers[3].confidence: not allowed']);
    const wrongType = good();
    wrongType.answers[2].value = '42';
    expect(checkAgainstSchema(schema, wrongType)).toEqual(['$.answers[2].value: expected integer, got string']);
    const wrongModule = good();
    wrongModule.module = 'm2';
    expect(checkAgainstSchema(schema, wrongModule)).toHaveLength(1);
    const short = good();
    short.answers.pop();
    expect(checkAgainstSchema(schema, short)).toEqual(['$.answers: fewer than 12 items']);
  });
});

describe('the synthesis needs all eight modules', () => {
  const mods = () => a.truthDoc.modules;
  const without = (m: string) => Object.fromEntries(Object.entries(mods()).filter(([k]) => k !== m));

  it('derives exactly the truth file from the module truths', () => {
    const d = deriveSynthesis(mods());
    for (const [q, s] of Object.entries(a.truthDoc.synthesis)) expect(d[q]).toEqual((s as any).value);
  });

  it.each(MODULE_IDS)('without %s, an answer is unanswerable and another changes if computed over the rest', (m) => {
    const full = deriveSynthesis(mods());
    const strict = deriveSynthesis(without(m));
    expect(Object.values(strict).some((v) => v === null)).toBe(true);
    const partial = deriveSynthesis(without(m), { allowPartial: true });
    const changed = Object.keys(full).filter((q) => JSON.stringify(partial[q]) !== JSON.stringify(full[q]));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed).toContain('s5'); // the all-modules sum moves whichever module is dropped
  });
});

describe('the workload, computed by the generator, shows the parallelism', () => {
  it('has 8 independent parts with equal reads, plus a synthesis that depends on all 8', () => {
    const m = a.truthDoc.metrics;
    expect(m.source_files).toBe(248);
    expect(m.corpus_files).toBe(257); // + 8 questions.json + synthesis-questions.json
    expect(m.chain_reads_total).toBe(528);
    expect(Object.keys(m.per_module)).toEqual(MODULE_IDS);
    for (const id of MODULE_IDS) {
      expect(m.per_module[id].chain_reads).toBe(66);
      expect(m.per_module[id].files).toBe(31);
      expect(m.per_module[id].distinct_chain_files).toBeLessThanOrEqual(31);
    }
    expect(m.estimated_tokens).toBe(m.lines * 12);
  });

  it('the metrics match the corpus on disk', () => {
    const lines = walk(a.corpus)
      .filter((f) => f.endsWith('.mjs'))
      .reduce((n, f) => n + readFileSync(join(a.corpus, f), 'utf8').split('\n').length - 1, 0);
    expect(a.truthDoc.metrics.lines).toBe(lines);
    expect(lines).toBeGreaterThan(15000);
  });

  it('no chain crosses modules (the parts are independent) and the sheets cover all 8 modules for the synthesis', () => {
    for (const m of MODULE_IDS)
      for (const c of Object.values(a.truthDoc.modules[m]) as any[])
        expect(c.files.every((f: string) => f.startsWith(`${m}/`))).toBe(true);
    const strict = deriveSynthesis(Object.fromEntries(Object.entries(a.truthDoc.modules).slice(0, 7)));
    expect(['s1', 's3', 's4', 's5', 's6'].every((q) => strict[q] === null)).toBe(true);
  });
});

describe('the fixture record', () => {
  it('is approved, names the no-node sandbox in its text and weaknesses, and keeps the other holes stated', () => {
    expect(record.status).toMatch(/^APPROVED 2026-10-03/);
    expect(record.fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(record.notice).toBeUndefined();
    expect(record.fixture.tasks.common).toMatch(/no node or other interpreter is available to any role/);
    expect(record.fixture.tasks.common).not.toMatch(/do not execute any file/);
    expect(record.fixture.sandbox.mechanism).toMatch(/denyExec/);
    const w = record.fixture.why_one_agent_cannot.weaknesses as string[];
    expect(w[0]).toMatch(/^CLOSED by enforcement/);
    expect(w.slice(1).every((x) => x.startsWith('REMAINS'))).toBe(true);
    expect(w.join(' ')).toMatch(/python and every other interpreter are denied too/i);
    expect(w.join(' ')).toMatch(/statically/);
  });

  it('has the deadline, allocation, three arms and an unmeasured claim', () => {
    expect(record.fixture.wall_deadline_minutes).toBe(35);
    expect(record.fixture.planning_allocation_usd_per_run).toBe(12);
    expect(record.fixture.org_stop_usd).toBe(12);
    expect(record.fixture.arms.map((x: any) => x.id)).toEqual(['single', 'baseline', 'treatment']);
    expect(record.fixture.arms[1].roster).toEqual([
      'lead', 'worker-1', 'worker-2', 'worker-3', 'worker-4', 'synthesiser',
    ]);
    expect(record.fixture.tasks.single).toBeTruthy();
    expect(record.fixture.tasks.multi_role).toMatch(/lead coordinates and does not answer/);
    expect(record.fixture.why_one_agent_cannot.status).toMatch(/NOT MEASURED/);
    expect(record.fixture.workload.chain_reads_total).toBe(a.truthDoc.metrics.chain_reads_total);
  });
});
