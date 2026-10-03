// parallel-sweep-2 fixture (approved staged plan 2026-10-03): a corpus with 32 independent modules and a synthesis
// that needs the module answers, built by parallel-sweep's generator with --modules 32. These tests show the corpus
// is reproducible and pinned, that the truth is what the code really returns, that the scorer accepts the complete
// reference (33 units) and rejects each degraded one for the right reason, that the synthesis cannot be answered
// from fewer than all 32 modules, the per-worker hand-off contracts, and what the workload is.
// The N=8 build staying byte-identical is proven by parallel-sweep/fixture.test.ts (its pinned hash). No model is called.
// @ts-nocheck: the fixture scripts are plain .mjs modules without type declarations
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deriveSynthesis,
  moduleIds,
  subsetFor,
  synthesisQuestions,
} from '../parallel-sweep/synthesis.mjs';
import { PARTIAL_PREFIX, referenceDeliverables } from './hidden/reference/write-answers.mjs';
import { checkDeliverables, scoreModule, summarize } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const generator = join(here, '../parallel-sweep/build-corpus.mjs');
const record = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));
const _pilot = JSON.parse(
  readFileSync(join(here, '../../pilot/parallel-sweep-2.pilot.json'), 'utf8'),
);
const MODULES = moduleIds(32);

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
const hashOf = (dir: string) => {
  const h = createHash('sha256');
  for (const f of walk(dir).sort())
    h.update(`${f}\0`)
      .update(readFileSync(join(dir, f)))
      .update('\0');
  return h.digest('hex');
};
const build = () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep2-'));
  const corpus = join(root, 'corpus');
  const truth = join(root, 'truth.json');
  const r = spawnSync('node', [generator, corpus, '--truth', truth, '--modules', '32'], {
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
const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep2-out-'));

let a: ReturnType<typeof build>;
let b: ReturnType<typeof build>;
beforeAll(() => {
  a = build();
  b = build();
});
const truth = () => a.truthDoc;

describe('the 32-module corpus builds reproducibly, without answers', () => {
  it('is byte for byte the same on every build, and matches the pinned hash', () => {
    expect(hashOf(a.corpus)).toBe(hashOf(b.corpus));
    expect(hashOf(a.corpus)).toBe(record.fixture.pinned_hash);
    expect(readFileSync(a.truth, 'utf8')).toBe(readFileSync(b.truth, 'utf8'));
  });

  it('has m1..m32, each 31 plain ESM files (30 plus config) of 60 to 100 lines, 12 questions naming only an entry function', () => {
    expect(
      readdirSync(a.corpus)
        .filter((d) => /^m\d+$/.test(d))
        .sort(),
    ).toEqual([...MODULES].sort());
    for (const m of MODULES) {
      const code = walk(join(a.corpus, m)).filter((f) => f.endsWith('.mjs'));
      expect(code).toHaveLength(31);
      for (const f of code.filter((f) => f !== 'config.mjs')) {
        const lines = readFileSync(join(a.corpus, m, f), 'utf8').split('\n').length - 1;
        expect(lines).toBeGreaterThanOrEqual(60);
        expect(lines).toBeLessThanOrEqual(100);
      }
      const qs = JSON.parse(readFileSync(join(a.corpus, m, 'questions.json'), 'utf8'));
      expect(qs).toHaveLength(12);
      for (const q of qs) expect(Object.keys(q).sort()).toEqual(['file', 'name', 'q']);
    }
  });

  it('holds no truth file and no chain listing; the truth path must be outside the corpus', () => {
    expect(walk(a.corpus).some((f) => /truth/i.test(f))).toBe(false);
    const all = walk(a.corpus)
      .map((f) => readFileSync(join(a.corpus, f), 'utf8'))
      .join('\n');
    expect(all).not.toMatch(/"files"|"value"|"chain"/);
    const out = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep2-bad-')), 'c');
    const r = spawnSync(
      'node',
      [generator, out, '--truth', join(out, 't.json'), '--modules', '32'],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/outside the corpus/);
  });

  it('refuses a module count that is not an integer from 4 to 99', () => {
    const r = spawnSync(
      'node',
      [generator, join(scratch(), 'c'), '--truth', join(scratch(), 't.json'), '--modules', '3'],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--modules must be an integer/);
  });
});

describe('the truth is computed from the code, not asserted', () => {
  it('12 chains per module of 4 to 7 distinct files of that module, entry first, the same lengths in every module', () => {
    const lengths = (m: string) =>
      Object.values(truth().modules[m])
        .map((c: any) => c.files.length)
        .sort();
    for (const m of MODULES) {
      expect(Object.keys(truth().modules[m])).toHaveLength(12);
      for (const c of Object.values(truth().modules[m]) as any[]) {
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

  it('every chain step imports the next step (static check of all 384 chains)', () => {
    for (const m of MODULES)
      for (const c of Object.values(truth().modules[m]) as any[])
        for (let i = 0; i < c.files.length - 1; i++)
          expect(readFileSync(join(a.corpus, c.files[i]), 'utf8')).toContain(
            `from './${c.files[i + 1].split('/')[1]}'`,
          );
  });

  it('re-executing a sample of 24 chains in a child process gives the recorded values', () => {
    const all = MODULES.flatMap((m) =>
      Object.entries(truth().modules[m]).map(([q, c]: [string, any]) => ({ m, q, c })),
    );
    const sample = all.filter((_, i) => i % 16 === 5).slice(0, 24);
    expect(sample).toHaveLength(24);
    expect(new Set(sample.map((s) => s.m)).size).toBeGreaterThan(16);
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
});

describe('the scorer: 32 module-sheet units + 1 synthesis unit = 33', () => {
  const sheet = (m: string, mutate?: (answers: any[]) => void) => {
    const doc = referenceDeliverables(truth(), 'complete')[`${m}/answers.json`] as any;
    mutate?.(doc.answers);
    return doc;
  };

  it('accepts the complete reference: 33 units accepted, every sheet 12 of 12, nothing critical', () => {
    const r = checkDeliverables(
      write(scratch(), referenceDeliverables(truth(), 'complete')),
      truth(),
    );
    expect(r.units).toHaveLength(33);
    expect(r.units.filter((u) => u.unit === 'module-sheet').map((u) => u.module)).toEqual(MODULES);
    expect(r.units.at(-1).unit).toBe('synthesis');
    expect(r.units.every((u) => u.accepted && u.evidence.failures.length === 0)).toBe(true);
    expect(
      r.units.filter((u) => u.unit === 'module-sheet').every((u) => u.evidence.exact === true),
    ).toBe(true);
    expect(r.critical).toEqual([]);
    expect(summarize(r.units)).toEqual({
      accepted: 33,
      total: 33,
      sheets_accepted: 32,
      sheets_exact: 32,
      sheets_written: 32,
      synthesis_accepted: true,
    });
  });

  it('the partial reference (a prefix of 26 modules, no synthesis) delivers 26 of 33, the rest "file is missing"', () => {
    expect(PARTIAL_PREFIX).toBe(26);
    const r = checkDeliverables(
      write(scratch(), referenceDeliverables(truth(), 'partial')),
      truth(),
    );
    const missing = r.units.filter((u) => !u.accepted);
    expect(summarize(r.units)).toMatchObject({
      accepted: 26,
      total: 33,
      sheets_written: 26,
      synthesis_accepted: false,
    });
    expect(missing).toHaveLength(7);
    expect(missing.map((u) => u.evidence.failures[0])).toEqual([
      ...MODULES.slice(26).map((m) => `${m}: file is missing`),
      'synthesis: file is missing',
    ]);
    expect(r.critical).toEqual([]);
  });

  it('a trial cut at the deadline is scored on the files present: 3 sheets written is 3 of 33', () => {
    const docs = referenceDeliverables(truth(), 'complete');
    const cut = Object.fromEntries(
      Object.entries(docs).filter(([p]) => ['m1', 'm2', 'm3'].some((m) => p.startsWith(`${m}/`))),
    );
    expect(summarize(checkDeliverables(write(scratch(), cut), truth()).units)).toMatchObject({
      accepted: 3,
      sheets_written: 3,
    });
    expect(summarize(checkDeliverables(scratch(), truth()).units)).toMatchObject({
      accepted: 0,
      sheets_written: 0,
    });
  });

  it('the wrong-values reference is rejected on all 33 units, naming wrong values and wrong file lists', () => {
    const r = checkDeliverables(write(scratch(), referenceDeliverables(truth(), 'wrong')), truth());
    expect(r.units).toHaveLength(33);
    expect(r.units.some((u) => u.accepted)).toBe(false);
    expect(r.units[0].evidence.failures).toHaveLength(12);
    expect(r.units[0].evidence.failures[0]).toBe('q01: wrong value and wrong file list');
    expect(JSON.stringify(r)).not.toMatch(/expected/);
  });

  it('accepts a sheet at 11 of 12 (not exact: the secondary metric) and refuses 10 of 12', () => {
    const ok = scoreModule(
      sheet('m17', (x) => (x[0].value += 1)),
      truth(),
      'm17',
    );
    expect(ok).toMatchObject({ accepted: true, correct: 11 });
    const dir = write(scratch(), {
      ...referenceDeliverables(truth(), 'complete'),
      'm17/answers.json': sheet('m17', (x) => (x[0].value += 1)),
    });
    const u = checkDeliverables(dir, truth()).units.find((x) => x.module === 'm17');
    expect(u).toMatchObject({ accepted: true, evidence: { correct: 11, exact: false } });
    expect(
      scoreModule(
        sheet('m17', (x) => ((x[0].value += 1), (x[1].value += 1))),
        truth(),
        'm17',
      ),
    ).toMatchObject({
      accepted: false,
      correct: 10,
    });
  });

  it('flags a fabricated question and a sheet copied between modules as critical', () => {
    const docs = referenceDeliverables(truth(), 'complete') as any;
    docs['m30/answers.json'].answers.push({ q: 'q13', value: 7, files: ['m30/a.mjs'] });
    docs['synthesis.json'].answers.push({ q: 's7', value: 1 });
    docs['m32/answers.json'] = { ...docs['m31/answers.json'], module: 'm32' };
    const r = checkDeliverables(write(scratch(), docs), truth());
    expect(r.critical).toEqual([
      'm30: an answer for q13, which is not a question',
      'm31 and m32 carry identical answer lists (copied)',
      'synthesis: an answer for s7, which is not a question',
    ]);
    expect(r.units.find((u) => u.module === 'm30').accepted).toBe(true);
    expect(r.units.find((u) => u.module === 'm32').accepted).toBe(false);
  });
});

describe('the synthesis needs all 32 modules', () => {
  const mods = () => truth().modules;
  const without = (m: string) =>
    Object.fromEntries(Object.entries(mods()).filter(([k]) => k !== m));
  const D = (m: any, o: any = {}) => deriveSynthesis(m, { n: 32, ...o });

  it('is derived exactly from the module truths: six questions, unique answers, no ties', () => {
    const d = D(mods());
    expect(Object.keys(d)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    for (const [q, s] of Object.entries(truth().synthesis)) expect(d[q]).toEqual((s as any).value);
    expect(truth().synthesis.s1.value).toMatch(/^m\d+$/);
    expect(d.s4).toHaveLength(3);
    const q12 = MODULES.map((m) => mods()[m].q12.value).sort((x, y) => x - y);
    expect(q12[2]).toBeLessThan(q12[3]);
    expect(q12[0]).toBeLessThan(q12[1]);
    expect(q12[1]).toBeLessThan(q12[2]);
    const longest = MODULES.map((m) => mods()[m].q01.files.length).sort((x, y) => y - x);
    expect(longest[0]).toBeGreaterThan(longest[1]);
  });

  it('defines the questions generally: the named subset is every third module from m2, the text lists it, and the N=8 text is unchanged', () => {
    expect(subsetFor(32)).toEqual([
      'm2',
      'm5',
      'm8',
      'm11',
      'm14',
      'm17',
      'm20',
      'm23',
      'm26',
      'm29',
      'm32',
    ]);
    const qs = synthesisQuestions(32);
    expect(qs.map((q) => q.q)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(qs[1].text).toBe(
      'What is the sum of the q07 values of modules m2, m5, m8, m11, m14, m17, m20, m23, m26, m29 and m32? Answer with an integer.',
    );
    expect(qs[4].text).toBe(
      'What is the sum of the q05 values of all 32 modules? Answer with an integer.',
    );
    expect(synthesisQuestions(8)[1].text).toBe(
      'What is the sum of the q07 values of modules m2, m5 and m8? Answer with an integer.',
    );
    expect(synthesisQuestions(8)[4].text).toBe(
      'What is the sum of the q05 values of all eight modules? Answer with an integer.',
    );
    expect(JSON.parse(readFileSync(join(a.corpus, 'synthesis-questions.json'), 'utf8'))).toEqual(
      qs,
    );
  });

  it.each(MODULES)(
    'without %s the synthesis is unanswerable, and computed over the rest the all-modules sum changes',
    (m) => {
      const strict = D(without(m));
      expect(['s1', 's3', 's4', 's5', 's6'].every((q) => strict[q] === null)).toBe(true);
      const partial = D(without(m), { allowPartial: true });
      expect(partial.s5).not.toBe(D(mods()).s5);
    },
  );

  it('a prefix of 26 modules (what a single agent may reach) cannot answer any of the all-module questions', () => {
    const prefix = Object.fromEntries(Object.entries(mods()).slice(0, PARTIAL_PREFIX));
    const d = D(prefix);
    expect(['s1', 's3', 's4', 's5', 's6'].every((q) => d[q] === null)).toBe(true);
    expect(d.s2).toBeNull(); // m29 and m32 are missing
  });
});

describe('the workload, computed by the generator', () => {
  it('has 32 independent parts with equal reads: 66 chain reads each (the minimum per module), 2112 in total', () => {
    const m = truth().metrics;
    expect(Object.keys(m.per_module)).toEqual(MODULES);
    for (const id of MODULES) {
      expect(m.per_module[id].chain_reads).toBe(66);
      expect(m.per_module[id].files).toBe(31);
    }
    expect(Math.min(...MODULES.map((id) => m.per_module[id].chain_reads))).toBe(66);
    expect(m.chain_reads_total).toBe(2112);
    expect(m.source_files).toBe(992);
    expect(m.corpus_files).toBe(1025);
    expect(m.estimated_tokens).toBe(m.lines * 12);
    for (const [k, v] of Object.entries({
      source_files: m.source_files,
      corpus_files: m.corpus_files,
      lines: m.lines,
      estimated_tokens: m.estimated_tokens,
      chain_reads_total: m.chain_reads_total,
      min_chain_reads_total: Math.min(m.chain_reads_total),
    }))
      expect(record.fixture.workload[k]).toBe(v);
    expect(record.fixture.workload.min_chain_reads_per_module).toBe(66);
  });

  it('the metrics match the corpus on disk (73k lines)', () => {
    const lines = walk(a.corpus)
      .filter((f) => f.endsWith('.mjs'))
      .reduce((n, f) => n + readFileSync(join(a.corpus, f), 'utf8').split('\n').length - 1, 0);
    expect(truth().metrics.lines).toBe(lines);
    expect(lines).toBeGreaterThan(70000);
  });
});

describe('the fixture record', () => {
  it('is approved, records the 1.5x harness-dollar question, the 600 s deadline, $30, three arms and a roster of ten', () => {
    expect(record.status).toMatch(/^APPROVED 2026-10-03/);
    expect(record.fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(record.cost_units_note).toMatch(/1\.5x the Sonnet 5\.5 list rates/);
    expect(record.cost_units_note).toMatch(/reconcile/);
    expect([record.fixture.wall_deadline_seconds, record.fixture.wall_deadline_minutes]).toEqual([
      600, 10,
    ]);
    expect([record.fixture.planning_allocation_usd_per_run, record.fixture.org_stop_usd]).toEqual([
      30, 30,
    ]);
    expect(record.fixture.arms.map((x: any) => x.id)).toEqual(['single', 'baseline', 'treatment']);
    expect(record.fixture.arms[1].roster).toHaveLength(10);
    expect(record.fixture.why_one_agent_cannot.status).toMatch(/NOT MEASURED/);
    expect(record.fixture.why_one_agent_cannot.weaknesses[0]).toMatch(/^CLOSED by enforcement/);
  });

  it('the task text states thirty-two modules, the exact shapes, the made-up example and the 600 second cut', () => {
    const t = record.fixture.tasks.common;
    expect(t).toMatch(/thirty-two modules, m1 to m32/);
    expect(t).toMatch(/600 seconds \(ten minutes\) of wall time/);
    expect(t).toMatch(/no node or other interpreter is available to any role/);
    expect(t).toMatch(/"module":"m99"/);
    expect(t).toMatch(/"q":"q99","value":12345/);
    expect(t).toMatch(/q01 to q12/);
    expect(t).toMatch(/s1 to s6/);
    expect(record.fixture.tasks.multi_role).toMatch(
      /worker-1: m1 to m4, worker-2: m5 to m8, worker-3: m9 to m12, worker-4: m13 to m16, worker-5: m17 to m20, worker-6: m21 to m24, worker-7: m25 to m28, worker-8: m29 to m32/,
    );
    expect(record.fixture.tasks.multi_role).toMatch(
      /writes out\/<module>\/answers\.json for each of them/,
    );
    expect(record.fixture.tasks.single).toMatch(/all thirty-two modules and the synthesis/);
  });
});
