// P3.15 parity (Phase 3 acceptance item 4): the SAME scripted producers and consumer, on the harness hand-off layer
// (HandoffStore, the prototype the pilots measured) and on the real runtime started through the switch (the translated
// sections definition, the eval gate, the runtime's own document tools), on the sweep-3 v2 miniature: the manifest's real
// routing and v2 contracts cut to three documents. No model, no network. The runtime side is the P3.14 scripted daemon.
// Where the spec means the two to differ (ids, sender, attempt accounting, the copy recipient, paging, ...), the table in
// handoff-runtime-differences.test.ts says so, with a reason and an executable check; everything else here must be equal.
// @ts-nocheck: loosely typed fixtures
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/cast.js';
import { writeFiles } from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/mini-org.js';
import {
  call,
  useWorld,
  waitFor,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js';
import {
  DOCS,
  honestDoc,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/support/check-defs.js';
import { handoffMetrics } from '../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import {
  byRef,
  HarnessWorld,
  harnessTools,
  honest,
  idOf,
  instrument,
  MINI_DOCS,
  runHarness,
  runRuntime,
  toldHarness,
  toldRuntime,
  W1,
  W2,
  W3,
  workerOfDoc,
} from './runtime-trial-support.js';
// @ts-expect-error plain .mjs module
import { trialView } from './runtime-view.mjs';

const world = useWorld('p315-parity');
const tmp = (tag: string) => mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', `${tag}-`));

/** The corpus truth for the metrics: every module's honest answers (the scripted honest document equals it). */
const truth = () => {
  const modules: Record<string, any> = {};
  for (const d of DOCS)
    for (const s of honestDoc(d).sheets)
      modules[s.module] = Object.fromEntries(
        s.answers.map((a) => [a.q, { value: a.value, files: a.files }]),
      );
  return { modules };
};
const count = (events: any[], kind: string, ok?: boolean) =>
  events.filter((e) => e.kind === kind && (ok === undefined || e.ok === ok)).length;
const sentTo = (events: any[], kind: string, to_kind: string) =>
  events.filter((e) => e.kind === kind && e.ok && JSON.parse(e.detail).to_kind === to_kind).length;
const statuses = (view) =>
  Object.fromEntries(
    Object.entries(view.state.versions).map(([d, vs]) => [
      d,
      vs.map((v) => `v${v.version}:${v.status}`),
    ]),
  );

describe('the sweep-3 v2 miniature with faulty producers: harness layer and runtime layer agree', () => {
  it('equal per-version call sequences, decisions, flagged answers, republish cycles and final accepted set', async () => {
    const h = await runHarness(tmp('p315-h'));
    const r = await runRuntime(world);
    expect([h.done, r.done]).toEqual([true, true]);
    expect([h.w.errors, r.runner.errors]).toEqual([[], []]);

    // every call, per document version: who did what, whether it was refused (and as what), what the checks flagged
    expect(byRef(r.trace)).toEqual(byRef(h.w.trace));
    // the checks flagged the same answers by the same checks, on the same versions
    const flaggedBy = (t) => byRef(t);
    expect(Object.keys(flaggedBy(r.trace))).toEqual([
      `${W1}@v1`,
      `${W1}@v2`,
      `${W1}@v3`,
      `${W2}!refused`,
      `${W2}@v1`,
      `${W2}@v2`,
      `${W3}@v1`,
    ]);
    // the records each layer left, in the one shape the report and the metrics read
    const hv = trialView(h.w.root);
    const rv = trialView(r.d.root);
    expect([hv.source, rv.source]).toEqual(['harness', 'runtime']);
    expect(statuses(rv)).toEqual(statuses(hv));
    expect(statuses(rv)).toEqual({
      [W1]: ['v1:rejected', 'v2:rejected', 'v3:accepted'],
      [W2]: ['v1:rejected', 'v2:accepted'],
      [W3]: ['v1:accepted'],
    });
    // document bodies are what the producers sent, on both layers (no injector on either)
    for (const doc of MINI_DOCS)
      expect(rv.state.versions[doc].map((v) => v.content)).toEqual(
        hv.state.versions[doc].map((v) => v.content),
      );
    // counts of publishes, reads, decides, checks, refusals, notices and relays
    for (const [kind, ok] of [
      ['publish', true],
      ['publish', false],
      ['decide', true],
      ['decide', false],
      ['check', true],
      ['read', true],
      ['send-refused', false],
    ] as const)
      expect(count(rv.events, kind, ok), `${kind} ok=${ok}`).toBe(count(hv.events, kind, ok));
    expect(count(rv.events, 'publish', true)).toBe(6); // three documents, six versions
    expect(count(rv.events, 'publish', false)).toBe(1); // worker-2's first document disagreed with its files
    expect(count(rv.events, 'decide', true)).toBe(6);
    expect(count(rv.events, 'check', true)).toBe(6);
    expect(count(rv.events, 'notice', true)).toBe(7); // six publish notices and the one all-available message
    expect(count(hv.events, 'notice', true)).toBe(7);
    for (const to_kind of ['producer', 'lead'])
      expect(sentTo(rv.events, 'relay', to_kind), to_kind).toBe(
        sentTo(hv.events, 'relay', to_kind),
      );
    expect(sentTo(rv.events, 'relay', 'producer')).toBe(3); // each of the three rejections reaches its producer directly ...
    expect(sentTo(rv.events, 'relay', 'lead')).toBe(3); // ... with one short copy
    // what each role was told: the same subjects, once each (ids and the copy marker aside)
    expect(
      toldRuntime(r.runner).filter(
        (s) =>
          !s.startsWith('lead: ') && !s.startsWith('worker-1: document rejected: module-sheets-w2'),
      ),
    ).toEqual(toldHarness(h.w).filter((s) => !s.startsWith('lead: ')));
    // the synthesis was built from the accepted versions alone, the same ones
    expect(r.cast.synthesis).toEqual(h.cast.synthesis);
    expect(r.cast.synthesis.inputs).toEqual({
      [idOf(W1)]: { version: 3, status: 'accepted' },
      [idOf(W2)]: { version: 2, status: 'accepted' },
      [idOf(W3)]: { version: 1, status: 'accepted' },
    });
  }, 60000);

  it('the metrics the reports read are equal on both layers; faults are n/a on the runtime (no fault record), republishes counted', async () => {
    const h = await runHarness(tmp('p315-hm'));
    const r = await runRuntime(world);
    const hm = handoffMetrics({ root: h.w.root, truth: truth() });
    const rm = handoffMetrics({ root: r.d.root, truth: truth() });
    expect(rm.handoff_layer).toBe('runtime');
    expect(hm.handoff_layer).toBeUndefined(); // the harness path reports exactly what it always did
    const same = [
      'calls',
      'docs_read',
      'docs_decided',
      'republish_cycles',
      'final_accepted_docs',
      'final_accepted_correct',
      'false_rejects',
      'rejects_of_natural_errors',
      'accepted_natural_errors',
    ];
    for (const k of same) expect(rm[k], k).toEqual(hm[k]);
    expect(rm.republish_cycles).toBe(3);
    expect(rm.final_accepted_docs).toBe(3);
    expect(rm.rejects_of_natural_errors).toBe(3);
    expect(rm.v2.doc_check.calls).toBe(hm.v2.doc_check.calls);
    expect(rm.v2.doc_check.flagged_answers).toBe(hm.v2.doc_check.flagged_answers);
    expect(rm.v2.doc_check.flagged_by_check).toEqual(hm.v2.doc_check.flagged_by_check);
    expect(rm.v2.consistency_refusals_at_publish.count).toBe(1);
    expect(rm.v2.consistency_refusals_at_publish.count).toBe(
      hm.v2.consistency_refusals_at_publish.count,
    );
    expect(rm.v2.producer_relay.sent_to_producer).toBe(hm.v2.producer_relay.sent_to_producer);
    expect(rm.v2.producer_relay.copies_to_lead).toBe(hm.v2.producer_relay.copies_to_lead);
    // the faults need the harness's fault record; the runtime has none, so they are n/a (never a zero that reads as "no fault")
    for (const k of [
      'injected',
      'caught',
      'missed',
      'undecided',
      'synthesis_used_corrupted',
      'final_accepted_corrupted',
    ])
      expect(rm[k], k).toBeNull();
    expect(rm.fault_record).toMatch(/^n\/a/);
    expect(hm.injected).toBe(0);
  }, 60000);

  it('a test-only fault record turns the fault measures on: the scripted faults are caught on the runtime as on the harness', async () => {
    const r = await runRuntime(world);
    const dir = join(r.d.root, 'pilot-state');
    mkdirSync(dir, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    const fault = (doc, version, cls, extra) =>
      JSON.stringify({
        kind: 'fault',
        at: new Date().toISOString(),
        ok: true,
        role: 'harness',
        doc,
        version,
        detail: JSON.stringify({ class: cls, ...extra }),
      });
    writeFileSync(
      join(dir, 'faults.jsonl'),
      `${[fault(W1, 1, 'wrong-value-q05', { module: 'm3', qs: ['q05'] }), fault(W1, 2, 'files-order', { module: 'm1', qs: ['q01', 'q02'] }), fault(W2, 1, 'duplicate-sheet', { module: 'm6' })].join('\n')}\n`,
    );
    const m = handoffMetrics({ root: r.d.root, truth: truth() });
    expect(m.fault_record).toBeUndefined();
    expect([m.injected, m.caught, m.missed, m.undecided]).toEqual([3, 3, 0, 0]);
    expect(m.v2.doc_check.faults_flagged).toBe(3);
    expect(m.republished_after_reject).toBe(3);
  }, 60000);
});

describe('a changed deliverable: the accept is refused, the producer is told, the republish is accepted', () => {
  const bumped = (doc: string) => {
    const b = honest(doc);
    const a = b.sheets[1].answers[3];
    a.value += 5;
    a.evidence[0].out += 5;
    return b;
  };
  const plans = () => ({ [W1]: { work: [{ body: honest(W1) }], relay: [{ body: bumped(W1) }] } });

  it('runtime and harness: one refused accept, one changed-deliverable relay (and a copy), two versions, the second accepted', async () => {
    // harness
    const root = tmp('p315-hc');
    const w = new HarnessWorld(root);
    const hc = new Cast(join(root, 'workspace'), plans()).bind(() => w).install(w);
    let release;
    hc.hold = new Promise((res) => (release = res));
    writeFiles(join(root, 'workspace'), honest(W1));
    const w1 = instrument(w.trace, 'worker-1', harnessTools(w.store, 'worker-1'));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({
      ok: true,
    });
    writeFiles(join(root, 'workspace'), bumped(W1));
    release();
    expect(
      await waitFor(
        () =>
          w.store.list('synthesiser')[0]?.latest?.version === 2 &&
          w.store.list('synthesiser')[0].latest.status === 'accepted',
      ),
    ).toBe(true);
    await w.idle();
    // runtime
    const runner = new (
      await import('../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js')
    ).Scripted();
    const { setOrgSignatureEnforcement } = await import(
      '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js'
    );
    setOrgSignatureEnforcement(false);
    const { runtimeMiniDef } = await import('./runtime-trial-support.js');
    const { d, name, docs } = await world.start(runtimeMiniDef(world.root), { runner });
    const rtrace = [];
    const rc = new Cast(join(world.root, 'workspace'), plans())
      .bind(() => docs.store)
      .install(runner);
    for (const [role, f] of [...runner.on])
      runner.on.set(role, (t, tools) => f(t, instrument(rtrace, role, tools)));
    await runner.toolsOf(d, name, 'synthesiser');
    const rw1 = instrument(rtrace, 'worker-1', await runner.toolsOf(d, name, 'worker-1'));
    let release2;
    rc.hold = new Promise((res) => (release2 = res));
    writeFiles(join(world.root, 'workspace'), honest(W1));
    expect(await call(rw1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({
      ok: true,
    });
    writeFiles(join(world.root, 'workspace'), bumped(W1));
    release2();
    expect(
      await waitFor(
        () =>
          docs.store.list()[0]?.versions.length === 2 &&
          docs.store.list()[0].head.status === 'accepted',
      ),
    ).toBe(true);
    await docs.notices.idle();
    // the same calls on the one document, on both layers
    expect(byRef(rtrace)).toEqual(byRef(w.trace));
    expect(byRef(rtrace)[`${W1}@v1`]).toEqual(
      expect.arrayContaining(['synthesiser decide accept consistency']),
    );
    const hv = trialView(w.root);
    const rv = trialView(world.root);
    expect(statuses(rv)).toEqual(statuses(hv));
    expect(count(rv.events, 'decide', false)).toBe(1);
    expect(count(hv.events, 'decide', false)).toBe(1);
    expect(rv.events.filter((e) => e.kind === 'decide' && !e.ok).map((e) => e.file)).toEqual(
      hv.events.filter((e) => e.kind === 'decide' && !e.ok).map((e) => e.file),
    );
    for (const to_kind of ['producer', 'lead']) {
      expect(sentTo(rv.events, 'relay', to_kind), to_kind).toBe(1);
      expect(sentTo(hv.events, 'relay', to_kind), to_kind).toBe(1);
    }
    expect(JSON.parse(rv.events.find((e) => e.kind === 'relay' && e.ok).detail).reason).toBe(
      'deliverable-changed',
    );
    expect(JSON.parse(hv.events.find((e) => e.kind === 'relay' && e.ok).detail).reason).toBe(
      'deliverable-changed',
    );
    expect(runner.errors).toEqual([]);
    expect(w.errors).toEqual([]);
    expect(workerOfDoc(W1)).toBe('worker-1');
  }, 60000);
});

describe('cross-section sends: the same allow and refuse decisions, and nothing else changes', () => {
  it('the harness section map and the runtime org_send agree on every pair of roles', async () => {
    const { runtimeMiniDef } = await import('./runtime-trial-support.js');
    const { Scripted } = await import(
      '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js'
    );
    const { setOrgSignatureEnforcement } = await import(
      '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js'
    );
    setOrgSignatureEnforcement(false);
    const runner = new Scripted();
    const { d, name, running } = await world.start(runtimeMiniDef(world.root), { runner });
    const h = new HarnessWorld(tmp('p315-hs'));
    const roles = ['lead', 'worker-1', 'worker-2', 'worker-3', 'worker-4', 'synthesiser'];
    const tools = Object.fromEntries(
      await Promise.all(roles.map(async (r) => [r, await runner.toolsOf(d, name, r)])),
    );
    const decisions: Record<string, [boolean, boolean]> = {};
    for (const from of roles)
      for (const to of roles) {
        if (from === to) continue;
        const text = (
          await tools[from]
            .find((t) => t.name === 'org_send')
            .handler({ to, subject: 'hello', message: 'a note' })
        ).text;
        decisions[`${from}>${to}`] = [
          h.sendRefusal(from, to) === undefined,
          !text.startsWith('REFUSED'),
        ];
      }
    for (const [pair, [harnessAllows, runtimeAllows]] of Object.entries(decisions))
      expect(runtimeAllows, pair).toBe(harnessAllows);
    expect(decisions['worker-1>worker-3']).toEqual([false, false]); // across sections
    expect(decisions['worker-1>worker-2']).toEqual([true, true]); // inside sweep-a
    expect(decisions['worker-2>lead']).toEqual([true, true]); // the root is reachable
    expect(decisions['lead>synthesiser']).toEqual([true, true]); // and reaches every section
    const refused = running
      .busEvents()
      .filter((e) => e.reason === 'cross-section-refused')
      .map((e) => `${e.from}>${e.to}`);
    expect(refused.sort()).toEqual(
      Object.entries(decisions)
        .filter(([, [a]]) => !a)
        .map(([p]) => p)
        .sort(),
    );
  }, 60000);
});
