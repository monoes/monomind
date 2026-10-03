// The harness's fault hook (parallel-sweep-3): a plan is a pure function of its seed, each fault is a different class,
// every mutation keeps the document valid for its contract, the store applies it once per document and records it, a
// republish is untouched, the reader never sees a flag, and nothing is injected without a plan.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAULT_CLASSES, faultInjector, planFaults } from './fault-injection.js';
import { attachPilot } from './harness.js';
import { checkAgainstSchema } from './schema.js';
import { HandoffStore } from './store.js';

const pilot = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'parallel-sweep-3.pilot.json'),
    'utf8',
  ),
);
const DOCS: string[] = pilot.contracts.map((c: { id: string }) => c.id);
const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'fault-'));

/** A schema-valid document of worker k with made-up answers (module files named after the module). */
const doc = (k: number) => ({
  worker: `worker-${k}`,
  sheets: [4 * k - 3, 4 * k - 2, 4 * k - 1, 4 * k].map((i) => ({
    module: `m${i}`,
    answers: Array.from({ length: 12 }, (_, n) => ({
      q: `q${String(n + 1).padStart(2, '0')}`,
      value: 100 * i + n,
      files: ['a', 'b', 'c', 'd', 'e'].map((f) => `m${i}/${f}.mjs`),
    })),
  })),
});
const docOf = (id: string) => doc(Number(id.at(-1)));

describe('planFaults', () => {
  it('is a pure function of the seed: 4 distinct documents, each class once, delta 3 to 19', () => {
    for (const seed of [1, 20261004, 20261005, 99999]) {
      const a = planFaults(seed, DOCS);
      expect(a).toEqual(planFaults(seed, DOCS));
      expect(new Set(a.faults.map((f) => f.doc)).size).toBe(4);
      expect(a.faults.map((f) => f.class)).toEqual([...FAULT_CLASSES]);
      for (const f of a.faults) {
        expect(DOCS).toContain(f.doc);
        expect(f.delta).toBeGreaterThanOrEqual(3);
        expect(f.delta).toBeLessThanOrEqual(19);
      }
    }
  });

  it('differs between seeds (trial 1 and trial 2 get different placements) and refuses more classes than documents', () => {
    const placements = new Set(
      Array.from({ length: 40 }, (_, i) =>
        planFaults(20261003 + i, DOCS)
          .faults.map((f) => f.doc)
          .join(','),
      ),
    );
    expect(placements.size).toBeGreaterThan(10);
    expect(planFaults(20261004, DOCS)).not.toEqual(planFaults(20261005, DOCS));
    expect(() => planFaults(1, DOCS.slice(0, 3))).toThrow(/at least that many/);
  });

  it('the committed manifest asks for four classes over the eight contracts and the seed rule', () => {
    expect(pilot.fault_injection).toMatchObject({ seed_base: 20261003, documents: 4 });
    expect(pilot.fault_injection.classes).toEqual([...FAULT_CLASSES]);
    expect(DOCS).toHaveLength(8);
  });
});

describe('faultInjector: what each class changes', () => {
  const plan = planFaults(20261004, DOCS);
  const inj = faultInjector(plan);
  const spec = (c: string) => plan.faults.find((f) => f.class === c) as (typeof plan.faults)[0];

  it("wrong-value-q05 adds the delta to the first sheet's q05 (it feeds s5) and nothing else", () => {
    const f = spec('wrong-value-q05');
    const before = docOf(f.doc);
    const r = inj.apply(f.doc, before) as any;
    const after = r.content;
    expect(after.sheets[0].answers.find((a: any) => a.q === 'q05').value).toBe(
      before.sheets[0].answers.find((a: any) => a.q === 'q05').value + f.delta,
    );
    expect(JSON.stringify({ ...after, sheets: after.sheets.slice(1) })).toBe(
      JSON.stringify({ ...before, sheets: before.sheets.slice(1) }),
    );
    expect(r.record).toMatchObject({ class: 'wrong-value-q05', qs: ['q05'] });
    expect(before).toEqual(docOf(f.doc)); // the producer's object is not modified
  });

  it('wrong-value-q07 changes q07 of the first module in the s2 subset (m2, m5, m8, ...)', () => {
    const f = spec('wrong-value-q07');
    const r = inj.apply(f.doc, docOf(f.doc)) as any;
    const mod = r.record.module as string;
    expect((Number(mod.slice(1)) - 1) % 3).toBe(1);
    const sheet = r.content.sheets.find((s: any) => s.module === mod);
    const was = docOf(f.doc).sheets.find((s: any) => s.module === mod);
    expect(sheet.answers.find((a: any) => a.q === 'q07').value).toBe(
      was.answers.find((a: any) => a.q === 'q07').value + f.delta,
    );
  });

  it('files-order reverses the files lists of q01 and q02 of the first sheet (no entry file first any more)', () => {
    const f = spec('files-order');
    const r = inj.apply(f.doc, docOf(f.doc)) as any;
    const was = docOf(f.doc).sheets[0].answers;
    const now = r.content.sheets[0].answers;
    for (const q of ['q01', 'q02'])
      expect(now.find((a: any) => a.q === q).files).toEqual(
        [...was.find((a: any) => a.q === q).files].reverse(),
      );
    expect(now.find((a: any) => a.q === 'q03')).toEqual(was.find((a: any) => a.q === 'q03'));
    expect(r.record.qs).toEqual(['q01', 'q02']);
  });

  it("duplicate-sheet replaces the second sheet's answers with a copy of the first sheet's", () => {
    const f = spec('duplicate-sheet');
    const r = inj.apply(f.doc, docOf(f.doc)) as any;
    expect(r.content.sheets[1].answers).toEqual(r.content.sheets[0].answers);
    expect(r.content.sheets[1].module).toBe(docOf(f.doc).sheets[1].module); // the label stays; the answers are another module's
    expect(r.record.module).toBe(docOf(f.doc).sheets[1].module);
  });

  it('every seed and every document: the corrupted content still matches its own contract, and differs from the original', () => {
    for (let seed = 20261003; seed < 20261003 + 60; seed++)
      for (const f of planFaults(seed, DOCS).faults) {
        const contract = pilot.contracts.find((c: { id: string }) => c.id === f.doc);
        const r = faultInjector({ seed, faults: [f] }).apply(f.doc, docOf(f.doc)) as any;
        expect(checkAgainstSchema(contract.schema, r.content)).toEqual([]);
        expect(JSON.stringify(r.content)).not.toBe(JSON.stringify(docOf(f.doc)));
        expect(r.record.from_sha).not.toBe(r.record.to_sha);
      }
  });

  it('leaves a document that is not in the plan alone, and one whose shape the mutation cannot use', () => {
    const other = DOCS.find((d) => !plan.faults.some((f) => f.doc === d)) as string;
    expect(inj.apply(other, docOf(other))).toBeUndefined();
    expect(inj.apply(spec('files-order').doc, { sheets: [] })).toBeUndefined();
  });
});

describe('the store applies the hook once per document, records it, and the reader sees no flag', () => {
  const plan = planFaults(20261004, DOCS);
  const faulted = plan.faults[0];
  const make = () => {
    const dir = scratch();
    return { dir, store: new HandoffStore(dir, pilot.contracts, undefined, faultInjector(plan)) };
  };
  const producer = (id: string) => `worker-${id.at(-1)}`;

  it("the first publish stores the corrupted version; the republish is the producer's own content", () => {
    const { store } = make();
    const first = store.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc));
    expect(first).toMatchObject({ ok: true, version: 1, status: 'pending' }); // the producer cannot tell
    const read1 = store.read('synthesiser', faulted.doc) as any;
    expect(JSON.stringify(read1.doc.content)).not.toBe(JSON.stringify(docOf(faulted.doc)));
    expect(Object.keys(read1.doc).sort()).toEqual(
      ['at', 'by', 'content', 'decisions', 'id', 'status', 'version'].sort(),
    );
    expect(
      store.decide('synthesiser', faulted.doc, 1, 'reject', 'q05 of the first sheet is wrong'),
    ).toMatchObject({
      ok: true,
      status: 'rejected',
    });
    expect(store.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc))).toMatchObject({
      ok: true,
      version: 2,
    });
    const read2 = store.read('synthesiser', faulted.doc) as any;
    expect(read2.doc.content).toEqual(docOf(faulted.doc)); // once: the second version is untouched
    expect(read2.doc.version).toBe(2);
  });

  it('records a fault event with the class, what changed and the hashes, once, and not for other documents', () => {
    const { store } = make();
    for (const id of DOCS) store.publish(producer(id), id, docOf(id));
    store.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc)); // a republish
    const faults = store.events().filter((e) => e.kind === 'fault');
    expect(faults).toHaveLength(4);
    expect(faults.map((e) => e.doc).sort()).toEqual(plan.faults.map((f) => f.doc).sort());
    for (const e of faults) {
      expect(e).toMatchObject({ ok: true, role: 'harness', version: 1 });
      const d = JSON.parse(e.detail as string);
      expect(d).toMatchObject({ class: expect.any(String), changed: expect.any(String) });
      expect(d.from_sha).toHaveLength(12);
    }
    // 8 first publishes + 1 republish are ordinary publish events, the faults extra
    expect(store.events().filter((e) => e.kind === 'publish' && e.ok)).toHaveLength(9);
  });

  it('a publish refused by the schema is not corrupted and does not use up the fault; the next valid one is', () => {
    const { store } = make();
    const bad = store.publish(producer(faulted.doc), faulted.doc, { worker: 'x', sheets: [] });
    expect(bad.ok).toBe(false);
    expect(store.events().filter((e) => e.kind === 'fault')).toHaveLength(0);
    store.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc));
    expect(store.events().filter((e) => e.kind === 'fault')).toHaveLength(1);
  });

  it('is remembered across a reload of the store (the same file), so a restart does not corrupt a second time', () => {
    const { dir, store } = make();
    store.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc));
    const again = new HandoffStore(dir, pilot.contracts, undefined, faultInjector(plan));
    again.publish(producer(faulted.doc), faulted.doc, docOf(faulted.doc));
    expect(again.events().filter((e) => e.kind === 'fault')).toHaveLength(1);
    expect((again.read('synthesiser', faulted.doc, 2) as any).doc.content).toEqual(
      docOf(faulted.doc),
    );
  });

  it('with no injector (every other scenario and arm) nothing is changed and no fault event exists', () => {
    const store = new HandoffStore(scratch(), pilot.contracts);
    for (const id of DOCS) store.publish(producer(id), id, docOf(id));
    for (const id of DOCS)
      expect((store.read('synthesiser', id) as any).doc.content).toEqual(docOf(id));
    expect(store.events().filter((e) => e.kind === 'fault')).toHaveLength(0);
  });
});

describe('attachPilot wires the plan only when the trial carries one', () => {
  const fakeDaemon = () =>
    ({ toolProviders: { buildRoleTools: async () => ({}) }, deliver: async () => 'ok' }) as any;
  const trial = (extra: object) => ({
    runId: 'tok',
    dir: scratch(),
    routing: pilot.routing,
    contracts: pilot.contracts,
    ...extra,
  });

  it('with faults: the store it returns corrupts the planned documents; without: it does not', () => {
    const plan = planFaults(20261004, DOCS);
    const withPlan = attachPilot(fakeDaemon(), trial({ faults: plan }), 'tok');
    const without = attachPilot(fakeDaemon(), trial({}), 'tok');
    const f = plan.faults[0];
    for (const s of [withPlan, without]) s.publish(`worker-${f.doc.at(-1)}`, f.doc, docOf(f.doc));
    expect((without.read('synthesiser', f.doc) as any).doc.content).toEqual(docOf(f.doc));
    expect((withPlan.read('synthesiser', f.doc) as any).doc.content).not.toEqual(docOf(f.doc));
  });
});
