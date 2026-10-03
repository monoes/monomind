// Variant v2 of parallel-sweep-3, scripted with no model, part 2: the producer relay (fields, exhausted attempts, no leak of
// the fault record, delivery through the daemon deliver with the cross-section refusal intact) and the whole loop through the
// real store, tools and metrics, with a careless and a checking consumer. Part 1: handoff-v2.test.ts.
// @ts-nocheck: plain .mjs modules
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handoffMetrics } from '../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import type { T } from './handoff-v2-support.js';
import {
  correctDoc,
  DOCS,
  events,
  fileSheet,
  mods,
  pilot,
  publishAll,
  S,
  trial,
  useV2Corpus,
  V1,
  V2,
  worker,
  writeFiles,
} from './handoff-v2-support.js';
import { attachPilot, RELAY_SENDER } from './harness.js';

useV2Corpus();

describe('the producer relay', () => {
  it('a rejection reaches the producer once, with document, version, contract, reason, attempts left and what to do, and the lead gets a copy', async () => {
    const t = trial(20261004);
    await publishAll(t);
    const f = t.plan.faults[0];
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 1,
      decision: 'reject',
      reason: 'm2 q03 looks off against the code',
    });
    expect(t.sent).toHaveLength(2);
    const [p, lead] = t.sent;
    expect(p.to).toBe(worker(f.doc));
    for (const part of [
      `"${f.doc}"`,
      'version 1',
      V2.find((c) => c.id === f.doc).title,
      'synthesiser rejected',
      'm2 q03 looks off against the code',
      '1 of 4 used, 3 left',
      'pilot__doc_publish',
      'short note',
      'out/m',
    ])
      expect(p.body).toContain(part);
    expect(p.subject).toBe(`document rejected: ${f.doc} v1`);
    expect(lead.to).toBe('lead');
    expect(lead.body).toMatch(/was notified directly, no relay needed/);
    // an idempotent repeat of the same decision sends nothing more
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 1,
      decision: 'reject',
      reason: 'again',
    });
    expect(t.sent).toHaveLength(2);
    expect(events(t, 'relay').map((e) => JSON.parse(e.detail).to_kind)).toEqual([
      'producer',
      'lead',
    ]);
  });

  it('says so when the attempts are exhausted, never carries anything from the fault record, and sends nothing on an accept', async () => {
    const t = trial(20261004);
    const f = t.plan.faults.find((x) => x.class === 'wrong-value-q05');
    for (let i = 0; i < 4; i++)
      await t.as(worker(f.doc))('doc_publish', {
        doc_id: f.doc,
        content: correctDoc(f.doc),
        note: i ? 'same content again' : undefined,
      });
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 4,
      decision: 'reject',
      reason: 'm1 q05 wrong',
    });
    expect(t.sent[0].body).toMatch(
      /All 4 publish attempts for this document are used.*tell your lead/,
    );
    const rec = JSON.parse(events(t, 'fault')[0].detail);
    for (const m of t.sent)
      for (const secret of [
        rec.changed,
        rec.from_sha,
        rec.to_sha,
        rec.class,
        'wrong-value',
        'injected',
      ])
        expect(`${m.subject} ${m.body}`).not.toContain(secret);
    const other = DOCS.find((d) => d !== f.doc);
    await t.as(worker(other))('doc_publish', { doc_id: other, content: correctDoc(other) });
    const before = t.sent.length;
    await t.as('synthesiser')('doc_decide', { doc_id: other, version: 1, decision: 'accept' });
    expect(t.sent).toHaveLength(before);
    expect((await t.as('synthesiser')('doc_read', { doc_id: f.doc, version: 2 })).doc.note).toBe(
      'same content again',
    );
  });

  it('is delivered through the daemon deliver with the cross-section refusal still holding, and a refused delivery is recorded as failed', async () => {
    const delivered: any[][] = [];
    const daemon: any = {
      toolProviders: {},
      orgs: new Map([['org', {}]]),
      deliver: async (...a: any[]) => {
        delivered.push(a);
        return a[2] === 'worker-2' ? 'ERROR: unknown recipient' : 'queued';
      },
    };
    const root = mkdtempSync(join(S.tmp, 'h-'));
    writeFiles(root);
    const store = attachPilot(
      daemon,
      {
        runId: 'r',
        dir: join(root, 'pilot-state'),
        routing: pilot.routing,
        contracts: V2,
        workspace: join(root, 'workspace'),
        relay: { copy_to: ['lead'] },
      },
      'r',
    );
    expect(await daemon.deliver('org', 'worker-1', 'synthesiser', 's', 'b')).toMatch(
      /^Refused: worker-1 \(section sweep-a\) cannot message synthesiser/,
    );
    expect(await daemon.deliver('org', 'worker-1', 'lead', 's', 'b')).toBe('queued');
    expect(delivered).toHaveLength(1);
    store.publish('worker-1', 'module-sheets-w1', correctDoc('module-sheets-w1'));
    store.decide('synthesiser', 'module-sheets-w1', 1, 'reject', 'm1 q01 is wrong');
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered.slice(1).map((a) => [a[0], a[1], a[2]])).toEqual([
      ['org', RELAY_SENDER, 'synthesiser'], // the publish notice (consumer-publish-notice)
      ['org', RELAY_SENDER, 'worker-1'],
      ['org', RELAY_SENDER, 'lead'],
    ]);
    expect(store.events().filter((e) => e.kind === 'send-refused')).toHaveLength(1);
    store.publish('worker-2', 'module-sheets-w2', correctDoc('module-sheets-w2'));
    store.decide('synthesiser', 'module-sheets-w2', 1, 'reject', 'm5 q01 is wrong');
    await new Promise((r) => setTimeout(r, 20));
    const failed = store.events().filter((e) => e.kind === 'relay' && !e.ok);
    expect(failed).toHaveLength(1);
    expect(JSON.parse(failed[0].detail)).toMatchObject({
      to: 'worker-2',
      error: 'ERROR: unknown recipient',
    });
  });
});

describe('the whole loop through the real store, tools and metrics', () => {
  /** A scripted consumer that rejects exactly what doc_check flags, naming the first flagged answer; it never reads code. */
  async function checkerSynth(t: T) {
    const synth = t.as('synthesiser');
    for (const doc of DOCS) {
      const r = await synth('doc_check', { doc_id: doc });
      const first = r.flagged[0] ?? r.doc_level[0];
      const reason = r.flagged[0]
        ? `${first.sheet} ${first.q}: ${first.failed[0].check}`
        : r.doc_level[0]
          ? r.doc_level[0].detail
          : '';
      if (first) await synth('doc_decide', { doc_id: doc, version: 1, decision: 'reject', reason });
      else await synth('doc_decide', { doc_id: doc, version: 1, decision: 'accept' });
    }
  }

  it('a publish refused for its file, corrected; the checker rejects the four faults; each producer is told and republishes; all accepted', async () => {
    const t = trial(20261004);
    const w1 = correctDoc('module-sheets-w1');
    w1.sheets[0].answers[0].value += 3;
    expect(
      (await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: w1 })).error,
    ).toMatch(/out\/m1\/answers\.json/);
    await publishAll(t);
    await checkerSynth(t);
    expect(
      t.sent
        .filter((m) => m.to !== 'lead')
        .map((m) => m.to)
        .sort(),
    ).toEqual(t.plan.faults.map((f) => worker(f.doc)).sort());
    for (const f of t.plan.faults) {
      expect(
        await t.as(worker(f.doc))('doc_publish', { doc_id: f.doc, content: correctDoc(f.doc) }),
      ).toMatchObject({ ok: true, version: 2 });
      expect(await t.as('synthesiser')('doc_check', { doc_id: f.doc })).toMatchObject({
        flagged: [],
        doc_level: [],
      });
      expect(
        await t.as('synthesiser')('doc_decide', { doc_id: f.doc, version: 2, decision: 'accept' }),
      ).toMatchObject({ status: 'accepted' });
    }
    const m = handoffMetrics({ root: t.root, truth: S.truth });
    expect(m).toMatchObject({
      injected: 4,
      caught: 4,
      missed: 0,
      false_rejects: 0,
      final_accepted_docs: 8,
      final_accepted_correct: 8,
      final_accepted_corrupted: 0,
      republish_cycles: 4,
    });
    expect(m.v2).toMatchObject({
      doc_check: {
        calls: 12,
        refused: 0,
        faults_flagged: 4,
        faults_checked_unflagged: 0,
        faults_never_checked: 0,
      },
      consistency_refusals_at_publish: { count: 1, files: ['out/m1/answers.json'] },
      accepts_refused_changed_deliverable: { count: 0, files: [] },
      producer_relay: {
        sent_to_producer: 4,
        copies_to_lead: 4,
        failed: 0,
        by_reason: { rejected: 4 },
      },
    });
    expect(m.v2.doc_check.flagged_by_check).toMatchObject({
      value_matches_chain: 2,
      files_match_evidence: 2,
      files_in_module: expect.any(Number),
      unique_across_sheets: 1,
    });
    expect(m.v2.doc_check.flagged_answers).toBeGreaterThanOrEqual(6);
    expect(Object.values(m.v2.fault_flags)).toEqual([true, true, true, true]);
  });

  it('the careless consumer that never calls doc_check accepts all four faults: the aid is the whole difference', async () => {
    const accept = async (t: T) => {
      await publishAll(t);
      for (const doc of DOCS)
        await t.as('synthesiser')('doc_decide', { doc_id: doc, version: 1, decision: 'accept' });
      return handoffMetrics({ root: t.root, truth: S.truth });
    };
    const careless = await accept(trial(20261004));
    expect(careless).toMatchObject({
      injected: 4,
      caught: 0,
      missed: 4,
      final_accepted_corrupted: 4,
      synthesis_written: false,
    });
    expect(careless.v2.doc_check).toMatchObject({
      calls: 0,
      faults_never_checked: 4,
      faults_flagged: 0,
    });
    expect(careless.v2.producer_relay.sent_to_producer).toBe(0);
    // the same documents under the checker
    const t = trial(20261004);
    await publishAll(t);
    await checkerSynth(t);
    const checked = handoffMetrics({ root: t.root, truth: S.truth });
    expect(checked).toMatchObject({ injected: 4, caught: 4, missed: 0 });
    expect(checked.v2.doc_check.faults_flagged).toBe(4);
  });

  it('v1 behaviour (no relay, no checks, no deliverables) is unchanged', async () => {
    const t = trial(20261004, { contracts: V1, relay: false });
    for (const doc of DOCS)
      await t.as(worker(doc))('doc_publish', {
        doc_id: doc,
        content: { worker: worker(doc), sheets: mods(doc).map(fileSheet) },
      });
    const f = t.plan.faults[0];
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 1,
      decision: 'reject',
      reason: 'm1 wrong',
    });
    expect(t.sent).toEqual([]);
    expect(events(t, 'relay')).toEqual([]);
    expect(
      (
        await t
          .as('synthesiser')('doc_check', { doc_id: f.doc })
          .catch(() => ({ ok: false }))
      ).ok,
    ).toBe(false);
    expect(handoffMetrics({ root: t.root, truth: S.truth }).v2).toMatchObject({
      doc_check: { calls: 0 },
      producer_relay: { sent_to_producer: 0 },
    });
  });
});
