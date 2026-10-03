// A scripted (no model) end to end run of the parallel-sweep-3 decision loop through the REAL HandoffStore, the REAL
// pilot tools (pilot__doc_publish / doc_read / doc_decide) and the real fault injector: workers publish, the harness
// corrupts four documents, a scripted synthesiser reads, decides and has the producer republish, and the measures
// (fixtures/parallel-sweep-3/handoff-metrics.mjs) are computed from the files the run leaves. The synthesiser here is
// an oracle, a careless acceptor, an over-rejecter and an absent one: the measures must tell them apart.
// @ts-nocheck: plain .mjs modules
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveSynthesis } from '../fixtures/parallel-sweep/synthesis.mjs';
import { handoffMetrics, reasonPlausible } from '../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import { faultInjector, planFaults } from './fault-injection.js';
import { HandoffStore } from './store.js';
import { pilotTools } from './tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const DOCS: string[] = pilot.contracts.map((c: { id: string }) => c.id);
const worker = (doc: string) => `worker-${doc.at(-1)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let truth: any;
beforeAll(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'decisions-'));
  execFileSync(
    process.execPath,
    [
      join(here, '../fixtures/parallel-sweep/build-corpus.mjs'),
      join(tmp, 'corpus'),
      '--truth',
      join(tmp, 'truth.json'),
      '--modules',
      '32',
    ],
    { encoding: 'utf8' },
  );
  truth = JSON.parse(readFileSync(join(tmp, 'truth.json'), 'utf8'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** What worker k's own files hold: the truth, sheet by sheet. */
const sheet = (m: string) => ({
  module: m,
  answers: Object.entries(truth.modules[m]).map(([q, t]: [string, any]) => ({
    q,
    value: t.value,
    files: t.files,
  })),
});
const correctDoc = (doc: string) => {
  const k = Number(doc.at(-1));
  return {
    worker: `worker-${k}`,
    sheets: [4 * k - 3, 4 * k - 2, 4 * k - 1, 4 * k].map((i) => sheet(`m${i}`)),
  };
};
/** The first answer whose value or files differ from the truth, named the way a reviewer would. */
const firstDifference = (content: any): string | null => {
  for (const s of content.sheets)
    for (const a of s.answers) {
      const t = truth.modules[s.module][a.q];
      if (a.value !== t.value || JSON.stringify(a.files) !== JSON.stringify(t.files))
        return `${s.module} ${a.q} does not match the code`;
    }
  return null;
};

function trial(faultSeed: number | null) {
  const root = mkdtempSync(join(tmp, 't-'));
  mkdirSync(join(root, 'workspace/out'), { recursive: true });
  const plan = faultSeed === null ? undefined : planFaults(faultSeed, DOCS);
  const store = new HandoffStore(
    join(root, 'pilot-state'),
    pilot.contracts,
    undefined,
    plan ? faultInjector(plan) : undefined,
  );
  const as = (role: string) => {
    const tools = pilotTools(store, role);
    return async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(
        (await tools.find((t) => t.name === `pilot__${name}`)!.handler(args, {} as never)).text,
      );
  };
  return { root, plan, store, as };
}
type T = ReturnType<typeof trial>;

async function workersPublish(t: T) {
  for (const doc of DOCS)
    await t.as(worker(doc))('doc_publish', { doc_id: doc, content: correctDoc(doc) });
}

/** The synthesis a role would write from the contents of the versions it accepted. */
async function writeSynthesis(t: T, accepted: Record<string, any>) {
  const modules: Record<string, any> = {};
  for (const content of Object.values(accepted))
    for (const s of content.sheets)
      modules[s.module] = Object.fromEntries(
        s.answers.map((a: any) => [a.q, { value: a.value, files: a.files }]),
      );
  const d = deriveSynthesis(modules, { n: 32 });
  await sleep(60); // file times lag the clock: the synthesis is written after the decisions
  writeFileSync(
    join(t.root, 'workspace/out/synthesis.json'),
    JSON.stringify({ answers: Object.entries(d).map(([q, value]) => ({ q, value })) }),
  );
}

describe('an oracle synthesiser: reads, rejects what is wrong with a reason, the producer republishes, it accepts', () => {
  it('catches all four faults, no false reject, four republish cycles, a correct synthesis from accepted documents only', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const synth = t.as('synthesiser');
    const accepted: Record<string, any> = {};
    const rejected: string[] = [];
    for (const doc of DOCS) {
      const r = await synth('doc_read', { doc_id: doc });
      expect(r.ok).toBe(true);
      const why = firstDifference(r.doc.content);
      if (why) {
        expect(
          await synth('doc_decide', {
            doc_id: doc,
            version: r.doc.version,
            decision: 'reject',
            reason: why,
          }),
        ).toMatchObject({
          ok: true,
          status: 'rejected',
        });
        rejected.push(doc);
      } else {
        await synth('doc_decide', { doc_id: doc, version: r.doc.version, decision: 'accept' });
        accepted[doc] = r.doc.content;
      }
    }
    expect(rejected.sort()).toEqual(t.plan!.faults.map((f) => f.doc).sort());
    // the lead relays; each producer republishes from its own files
    for (const doc of rejected) {
      expect(
        await t.as(worker(doc))('doc_publish', { doc_id: doc, content: correctDoc(doc) }),
      ).toMatchObject({ ok: true, version: 2 });
      const r = await synth('doc_read', { doc_id: doc });
      expect(r.doc.version).toBe(2);
      expect(
        await synth('doc_decide', { doc_id: doc, version: 2, decision: 'accept' }),
      ).toMatchObject({ ok: true, status: 'accepted' });
      accepted[doc] = r.doc.content;
    }
    await writeSynthesis(t, accepted);

    const m = handoffMetrics({ root: t.root, truth });
    expect(m).toMatchObject({
      present: true,
      injected: 4,
      caught: 4,
      caught_plausible_reason: 4,
      missed: 0,
      undecided: 0,
      false_rejects: 0,
      rejects_of_natural_errors: 0,
      accepted_natural_errors: 0,
      republish_cycles: 4,
      republished_after_reject: 4,
      final_accepted_docs: 8,
      final_accepted_correct: 8,
      final_accepted_corrupted: 0,
      synthesis_written: true,
      synthesis_exact: true,
      synthesis_used_corrupted: false,
      synthesis_used_rejected: false,
      docs_without_accept_at_synthesis: [],
    });
    expect(m.calls.synthesiser.read.ok).toBe(12);
    expect(m.calls.synthesiser.decide.ok).toBe(12);
    expect(m.docs_read.synthesiser).toHaveLength(8);
    expect(m.docs_decided.synthesiser).toHaveLength(8);
    expect(m.calls['worker-1'].publish.ok + m.calls['worker-2'].publish.ok).toBeGreaterThanOrEqual(
      2,
    );
    expect(m.faults.map((f) => f.class).sort()).toEqual([
      'duplicate-sheet',
      'files-order',
      'wrong-value-q05',
      'wrong-value-q07',
    ]);
    // the poisoned classes name the synthesis answers they would have broken
    expect(m.faults.find((f) => f.class === 'wrong-value-q05').affects).toContain('s5');
    expect(m.faults.find((f) => f.class === 'wrong-value-q07').affects).toContain('s2');
    expect(m.faults.find((f) => f.class === 'files-order').affects).toEqual([]);
    expect(m.cost_usd.total).toBe(0);
  });
});

describe('a careless synthesiser accepts every document at once', () => {
  it('misses all four faults, the synthesis uses the corrupted documents and is wrong, and the corrupted versions stay accepted', async () => {
    const t = trial(20261005);
    await workersPublish(t);
    const synth = t.as('synthesiser');
    const accepted: Record<string, any> = {};
    for (const doc of DOCS) {
      const r = await synth('doc_read', { doc_id: doc });
      await synth('doc_decide', { doc_id: doc, version: r.doc.version, decision: 'accept' });
      accepted[doc] = r.doc.content;
    }
    await writeSynthesis(t, accepted);
    const m = handoffMetrics({ root: t.root, truth });
    expect(m).toMatchObject({
      injected: 4,
      caught: 0,
      missed: 4,
      undecided: 0,
      false_rejects: 0,
      republish_cycles: 0,
      final_accepted_docs: 8,
      final_accepted_correct: 4,
      final_accepted_corrupted: 4,
      synthesis_exact: false,
      synthesis_used_corrupted: true,
      synthesis_used_rejected: false, // used, but accepted: a miss, not a use of a rejected document
    });
    expect(m.faults.filter((f) => f.used_in_synthesis).map((f) => f.class)).toEqual(
      expect.arrayContaining(['wrong-value-q05', 'wrong-value-q07']),
    );
  });
});

describe('a synthesiser that rejects documents and then uses them anyway', () => {
  it('shows as synthesis_used_rejected: caught, yet the written synthesis equals what the rejected versions give', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const synth = t.as('synthesiser');
    const used: Record<string, any> = {};
    for (const doc of DOCS) {
      const r = await synth('doc_read', { doc_id: doc });
      const why = firstDifference(r.doc.content);
      if (why)
        await synth('doc_decide', { doc_id: doc, version: 1, decision: 'reject', reason: why });
      else await synth('doc_decide', { doc_id: doc, version: 1, decision: 'accept' });
      used[doc] = r.doc.content; // built from every version it read, rejected or not
    }
    await writeSynthesis(t, used);
    const m = handoffMetrics({ root: t.root, truth });
    expect(m).toMatchObject({
      caught: 4,
      synthesis_exact: false,
      synthesis_used_corrupted: true,
      synthesis_used_rejected: true,
      docs_without_accept_at_synthesis: expect.any(Array),
    });
    expect(m.docs_without_accept_at_synthesis).toHaveLength(4); // four documents had no accepted version when it wrote
  });
});

describe('a synthesiser that rejects a clean document, and one whose producers erred on their own', () => {
  it('counts a reject of a version equal to the truth as a false reject, and a reject of a natural error apart', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const clean = DOCS.find((d) => !t.plan!.faults.some((f) => f.doc === d))!;
    const synth = t.as('synthesiser');
    const r = await synth('doc_read', { doc_id: clean });
    await synth('doc_decide', {
      doc_id: clean,
      version: 1,
      decision: 'reject',
      reason: 'looks wrong to me',
    });
    // a producer's own error on a clean document: a wrong value it published itself, rejected for a reason
    const other = DOCS.find((d) => d !== clean && !t.plan!.faults.some((f) => f.doc === d))!;
    const own = correctDoc(other);
    own.sheets[0].answers[3].value += 1;
    await t.as(worker(other))('doc_publish', { doc_id: other, content: own }); // v2? no: v1 exists; this is v2
    await synth('doc_decide', {
      doc_id: other,
      version: 2,
      decision: 'reject',
      reason: `${own.sheets[0].module} q04 value is wrong`,
    });
    const m = handoffMetrics({ root: t.root, truth });
    expect(r.ok).toBe(true);
    expect(m.false_rejects).toBe(1);
    expect(m.rejects_of_natural_errors).toBe(1);
    expect(m.caught).toBe(0);
    expect(m.undecided).toBe(4);
    expect(m.docs[other].natural_errors).toEqual([2]);
  });

  it("reports a producer's own error in a version the injector also changed (p1t: worker-1 listed every chain leaf-first and the fault hid it)", async () => {
    const t = trial(20261004);
    const faulted = t.plan!.faults.map((f) => f.doc);
    for (const doc of DOCS) {
      const c = correctDoc(doc);
      // the producer's own mistake, in a question no fault class touches (q06), made before the harness changes the document
      if (faulted.includes(doc))
        c.sheets[3].answers[5].files = [...c.sheets[3].answers[5].files].reverse();
      await t.as(worker(doc))('doc_publish', { doc_id: doc, content: c });
    }
    const m = handoffMetrics({ root: t.root, truth });
    for (const doc of faulted) expect(m.docs[doc].natural_errors).toEqual([1]);
    for (const doc of DOCS.filter((d) => !faulted.includes(d)))
      expect(m.docs[doc].natural_errors).toEqual([]);
    expect(m.injected).toBe(4);
    // the consumer's read still shows the corrupted version only, never what the producer sent
    const r = await t.as('synthesiser')('doc_read', { doc_id: faulted[0] });
    expect(JSON.stringify(r)).not.toMatch(/original/);
  });

  it('counts an accept of a natural error as accepted_natural_errors, not as a missed fault', async () => {
    const t = trial(null);
    for (const doc of DOCS) {
      const c = correctDoc(doc);
      if (doc === DOCS[0]) c.sheets[2].answers[0].value += 5;
      await t.as(worker(doc))('doc_publish', { doc_id: doc, content: c });
    }
    for (const doc of DOCS)
      await t.as('synthesiser')('doc_decide', { doc_id: doc, version: 1, decision: 'accept' });
    const m = handoffMetrics({ root: t.root, truth });
    expect(m).toMatchObject({
      injected: 0,
      missed: 0,
      accepted_natural_errors: 1,
      final_accepted_correct: 7,
    });
  });
});

describe('the producer corrects before the consumer decides; the consumer never reads; a reject without a reason', () => {
  it('a corrupted version superseded before any decision is undecided (not caught, not missed), with republished true', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const f = t.plan!.faults[0];
    await t.as(worker(f.doc))('doc_publish', { doc_id: f.doc, content: correctDoc(f.doc) });
    const m = handoffMetrics({ root: t.root, truth });
    const mine = m.faults.find((x) => x.doc === f.doc);
    expect(mine).toMatchObject({ outcome: 'undecided', republished: true, status: 'superseded' });
    expect(m.republish_cycles).toBe(1);
  });

  it('a consumer that never reads: no reads, every fault undecided, no synthesis, no time and no decisions', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const m = handoffMetrics({ root: t.root, truth });
    expect(m.calls.synthesiser).toBeUndefined();
    expect(m).toMatchObject({
      injected: 4,
      undecided: 4,
      synthesis_written: false,
      final_accepted_docs: 0,
      docs_without_accept_at_synthesis: null,
    });
    expect(m.seconds.synthesis_file).toBeNull();
  });

  it('the store refuses a reject without a reason, and a fifth publish of a document; both are counted as refused', async () => {
    const t = trial(20261004);
    await workersPublish(t);
    const f = t.plan!.faults[0];
    const synth = t.as('synthesiser');
    expect((await synth('doc_decide', { doc_id: f.doc, version: 1, decision: 'reject' })).ok).toBe(
      false,
    );
    for (let i = 0; i < 3; i++)
      await t.as(worker(f.doc))('doc_publish', { doc_id: f.doc, content: correctDoc(f.doc) });
    expect(
      (await t.as(worker(f.doc))('doc_publish', { doc_id: f.doc, content: correctDoc(f.doc) })).ok,
    ).toBe(false);
    const m = handoffMetrics({ root: t.root, truth });
    expect(m.calls.synthesiser.decide).toEqual({ ok: 0, refused: 1 });
    expect(m.calls[worker(f.doc)].publish.refused).toBe(1);
  });
});

describe('reasonPlausible', () => {
  const fault = { class: 'files-order', module: 'm9', qs: ['q01', 'q02'] };
  it('accepts a reason that names the module, the question or the kind of fault, and refuses an empty or vague one', () => {
    expect(reasonPlausible(fault, 'm9 q01 lists the files backwards')).toBe(true);
    expect(reasonPlausible(fault, 'the first file is not the entry file')).toBe(true);
    expect(
      reasonPlausible(
        { class: 'duplicate-sheet', module: 'm2', qs: [] },
        'identical to the first sheet',
      ),
    ).toBe(true);
    expect(reasonPlausible(fault, '')).toBe(false);
    expect(reasonPlausible(fault, 'looks off')).toBe(false);
    expect(reasonPlausible({ class: 'wrong-value-q05', module: 'm1', qs: ['q05'] }, 'bad')).toBe(
      false,
    );
  });
});
