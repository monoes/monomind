// Variant v2 of parallel-sweep-3 (declared change consumer-publish-notice), scripted with no model: a publish notifies each
// declared consumer once (and a republish says it supersedes), the last needed document sends one 'all available' message,
// nothing is sent in v1, nothing carries fault content, the cross-section refusal still holds, and an idle scripted
// consumer that only a message can wake completes read, check, decide for every document in the v2 path (and deadlocks the
// way p1t-v2 did without the notice). Same patterns as handoff-v2-relay.test.ts.
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

const READY = /^document ready: /;
const ALL = 'all documents are available';
const ready = (t: T) => t.sent.filter((m) => READY.test(m.subject));
const allAvail = (t: T) => t.sent.filter((m) => m.subject === ALL);
const publish = (t: T, doc: string) =>
  t.as(worker(doc))('doc_publish', { doc_id: doc, content: correctDoc(doc) });

/** A consumer that starts idle and acts only when a message reaches it, as a real role does: on a notice it reads, checks and
 *  decides the documents the message names; on any other message it just looks (and finds nothing yet). */
function idleConsumer(t: T) {
  const synth = t.as('synthesiser');
  let cursor = 0;
  const turns: string[] = [];
  async function turn(m: { subject: string; body: string }) {
    turns.push(m.subject);
    const ids = [...m.body.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((i) => DOCS.includes(i));
    if (!ids.length) {
      for (const d of DOCS) await synth('doc_read', { doc_id: d });
      return;
    }
    for (const id of ids) {
      const r = await synth('doc_read', { doc_id: id });
      if (!r.ok || r.doc.decisions.synthesiser) continue;
      const c = await synth('doc_check', { doc_id: id, version: r.doc.version });
      const first = c.flagged[0] ?? c.doc_level[0];
      await synth('doc_decide', {
        doc_id: id,
        version: r.doc.version,
        decision: first ? 'reject' : 'accept',
        ...(first
          ? { reason: `doc_check flagged ${first.sheet ?? ''} ${first.q ?? first.check}` }
          : {}),
      });
    }
  }
  return {
    turns,
    /** The lead's briefing, or any message from outside the store. */
    message: (subject: string, body: string) => turn({ subject, body }),
    /** Delivers what the store sent to the synthesiser since the last call. */
    async drain() {
      const mine = t.sent.filter((m) => m.to === 'synthesiser');
      while (cursor < mine.length) await turn(mine[cursor++]);
    },
  };
}
const okEvents = (t: T, kind: string, role = 'synthesiser') =>
  events(t, kind).filter((e) => e.ok && e.role === role);

describe('the consumer notice on a publish', () => {
  it('one publish sends exactly one notice to the consumer, with document, version, contract title, producer and what is ready, and nothing to the lead', async () => {
    const t = trial(null, { notice: true });
    expect(await publish(t, 'module-sheets-w1')).toMatchObject({ ok: true, version: 1 });
    expect(t.sent).toHaveLength(1);
    const [n] = t.sent;
    expect(n.to).toBe('synthesiser');
    expect(n.subject).toBe('document ready: module-sheets-w1 v1');
    for (const part of [
      '"module-sheets-w1"',
      'version 1',
      V2[0].title,
      'worker-1 published',
      'pilot__doc_read',
      'pilot__doc_check',
      'pilot__doc_decide',
    ])
      expect(n.body).toContain(part);
    expect(n.body).not.toMatch(/supersede/);
    expect(t.sent.filter((m) => m.to === 'lead')).toEqual([]);
    expect(events(t, 'notice').map((e) => [e.ok, JSON.parse(e.detail)])).toEqual([
      [true, { to: 'synthesiser', kind: 'published' }],
    ]);
  });

  it('mentions doc_check only where the contract declares checks', async () => {
    const t = trial(null, {
      notice: true,
      contracts: V2.map((c) => ({ ...c, checks: undefined })),
    });
    await publish(t, 'module-sheets-w1');
    expect(ready(t)[0].body).not.toContain('doc_check');
    expect(ready(t)[0].body).toContain('pilot__doc_read');
  });

  it('is the same text for every document, so it cannot tell a faulted document from a clean one, and carries no fault record', async () => {
    const t = trial(20261004, { notice: true });
    await publishAll(t);
    expect(ready(t)).toHaveLength(8);
    const faulted = new Set(t.plan.faults.map((f) => f.doc));
    expect(faulted.size).toBe(4);
    const norm = (m: { subject: string; body: string }) =>
      `${m.subject} ${m.body}`
        .replace(/module-sheets-w\d/g, 'ID')
        .replace(/worker-\d/g, 'P')
        .replace(/Answer sheets of P's four modules \(m\d+ to m\d+\)/g, 'TITLE');
    expect(new Set(ready(t).map(norm)).size).toBe(1);
    const rec = events(t, 'fault').map((e) => JSON.parse(e.detail));
    expect(rec).toHaveLength(4);
    for (const m of t.sent)
      for (const secret of [
        ...rec.flatMap((r) => [r.changed, r.from_sha, r.to_sha, r.class]),
        'wrong-value',
        'duplicate',
        'files-order',
        'injected',
        'fault',
        'bad',
      ])
        expect(`${m.subject} ${m.body}`).not.toContain(secret);
  });

  it('a refused publish (schema or deliverable files) sends nothing', async () => {
    const t = trial(null, { notice: true });
    const w1 = correctDoc('module-sheets-w1');
    w1.sheets[0].answers[0].value += 3;
    expect(
      (await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: w1 })).ok,
    ).toBe(false);
    expect(
      (await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: { x: 1 } })).ok,
    ).toBe(false);
    expect(t.sent).toEqual([]);
    expect(events(t, 'notice')).toEqual([]);
  });

  it('a republish sends a notice that says it supersedes the earlier version, naming what the consumer had decided', async () => {
    const t = trial(20261004, { notice: true });
    const f = t.plan.faults[0];
    await publish(t, f.doc);
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 1,
      decision: 'reject',
      reason: 'm1 q01 is wrong',
    });
    expect(await publish(t, f.doc)).toMatchObject({ version: 2 });
    const notices = ready(t).filter((m) => m.subject.includes(f.doc));
    expect(notices.map((m) => m.subject)).toEqual([
      `document ready: ${f.doc} v1`,
      `document ready: ${f.doc} v2`,
    ]);
    expect(notices[1].body).toContain(
      'It supersedes version 1, which you had already decided (rejected)',
    );
    expect(notices[1].body).toContain('version 2');
    // an undecided earlier version is superseded too, and the text says so
    const g = DOCS.find((d) => d !== f.doc);
    await publish(t, g);
    await publish(t, g);
    expect(ready(t).at(-1).body).toContain('supersedes version 1, which you had not decided');
    // one notice per successful publish, no more
    expect(ready(t)).toHaveLength(4);
    expect(events(t, 'notice').filter((e) => e.ok)).toHaveLength(4);
  });

  it('a notice the daemon refuses or fails is recorded as failed, not lost', async () => {
    const { HandoffStore } = await import('./store.js');
    const root = mkdtempSync(join(S.tmp, 'f-'));
    writeFiles(root);
    const store = new HandoffStore(join(root, 'pilot-state'), V2, undefined, undefined, {
      workspace: join(root, 'workspace'),
      relay: () => 'REFUSED: no such role',
      consumerNotice: true,
    });
    store.publish('worker-1', 'module-sheets-w1', correctDoc('module-sheets-w1'));
    await new Promise((r) => setTimeout(r, 20));
    const ev = store.events().filter((e) => e.kind === 'notice');
    expect(ev.map((e) => e.ok)).toEqual([true, false]);
    expect(JSON.parse(ev[1].detail)).toMatchObject({
      to: 'synthesiser',
      error: 'REFUSED: no such role',
    });
  });
});

describe('the all-available message', () => {
  it('is sent once, after the last contract document has a version, listing every id, and never again on a republish', async () => {
    const t = trial(null, { notice: true });
    for (const doc of DOCS.slice(0, 7)) await publish(t, doc);
    expect(allAvail(t)).toEqual([]);
    await publish(t, DOCS[7]);
    expect(allAvail(t)).toHaveLength(1);
    const [m] = allAvail(t);
    expect(m.to).toBe('synthesiser');
    for (const id of DOCS) expect(m.body).toContain(`"${id}"`);
    expect(m.body).toContain('All 8 documents');
    expect(m.body).toContain('pilot__doc_check');
    // it follows the last document's own notice
    expect(t.sent.at(-1)).toBe(m);
    expect(t.sent.at(-2).subject).toBe(`document ready: ${DOCS[7]} v1`);
    await publish(t, DOCS[0]);
    await publish(t, DOCS[7]);
    expect(allAvail(t)).toHaveLength(1);
    expect(
      events(t, 'notice').filter((e) => JSON.parse(e.detail).kind === 'all-available'),
    ).toHaveLength(1);
  });

  it('does not repeat after the store is reopened (the once is part of the persisted state)', async () => {
    const t = trial(null, { notice: true });
    await publishAll(t);
    expect(allAvail(t)).toHaveLength(1);
    const { HandoffStore } = await import('./store.js');
    const again = new HandoffStore(join(t.root, 'pilot-state'), V2, undefined, undefined, {
      workspace: join(t.root, 'workspace'),
      relay: (m) => void t.sent.push(m),
      consumerNotice: true,
    });
    again.publish(worker(DOCS[0]), DOCS[0], correctDoc(DOCS[0]));
    expect(allAvail(t)).toHaveLength(1);
  });
});

describe('v1 and the unchanged paths', () => {
  it('v1 treatment (no relay, no checks, no notice) sends nothing on a publish and records no notice', async () => {
    const t = trial(20261003, { contracts: V1, relay: false });
    for (const doc of DOCS)
      await t.as(worker(doc))('doc_publish', {
        doc_id: doc,
        content: { worker: worker(doc), sheets: mods(doc).map(fileSheet) },
      });
    expect(t.sent).toEqual([]);
    expect(events(t, 'notice')).toEqual([]);
    expect(t.store.noticeEnabled()).toBe(false);
  });

  it('v2 without the notice option (the committed p1t-v2 behaviour) sends nothing on a publish; the producer relay is unchanged', async () => {
    const t = trial(20261004);
    await publishAll(t);
    expect(t.sent).toEqual([]);
    expect(t.store.noticeEnabled()).toBe(false);
    const f = t.plan.faults[0];
    await t.as('synthesiser')('doc_decide', {
      doc_id: f.doc,
      version: 1,
      decision: 'reject',
      reason: 'm1 q01 is wrong',
    });
    expect(t.sent.map((m) => m.to)).toEqual([worker(f.doc), 'lead']);
  });

  it('the doc_publish description tells the truth in each variant', async () => {
    const { pilotTools } = await import('./tools.js');
    const text = (tt: T) =>
      pilotTools(tt.store, 'worker-1').find((x) => x.name === 'pilot__doc_publish').description;
    expect(text(trial(null, { notice: true }))).toMatch(
      /The consumer is notified of every publish/,
    );
    expect(text(trial(null))).toMatch(/Consumers are not notified of a publish/);
    expect(text(trial(null, { relay: false, contracts: V1 }))).toMatch(
      /Consumers are not notified:/,
    );
  });
});

describe('through the harness: the daemon deliver, sender pilot-relay, cross-section refusal intact', () => {
  const rig = (relay: any) => {
    const delivered: any[][] = [];
    const daemon: any = {
      toolProviders: {},
      orgs: new Map([['org', {}]]),
      deliver: async (...a: any[]) => {
        delivered.push(a);
        return a[2] === 'synthesiser' && a[3].startsWith('FAIL') ? 'ERROR: down' : 'queued';
      },
    };
    const root = mkdtempSync(join(S.tmp, 'n-'));
    writeFiles(root);
    const store = attachPilot(
      daemon,
      {
        runId: 'r',
        dir: join(root, 'pilot-state'),
        routing: pilot.routing,
        contracts: V2,
        workspace: join(root, 'workspace'),
        ...(relay ? { relay } : {}),
      },
      'r',
    );
    return { daemon, delivered, store };
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('delivers a notice to the synthesiser from pilot-relay on each publish, and still refuses a cross-section send', async () => {
    const { daemon, delivered, store } = rig({ copy_to: ['lead'] });
    store.publish('worker-1', 'module-sheets-w1', correctDoc('module-sheets-w1'));
    await settle();
    expect(delivered.map((a) => [a[0], a[1], a[2], a[3]])).toEqual([
      ['org', RELAY_SENDER, 'synthesiser', 'document ready: module-sheets-w1 v1'],
    ]);
    expect(await daemon.deliver('org', 'worker-1', 'synthesiser', 's', 'b')).toMatch(
      /^Refused: worker-1 \(section sweep-a\) cannot message synthesiser/,
    );
    expect(delivered).toHaveLength(1);
    expect(store.events().filter((e) => e.kind === 'send-refused')).toHaveLength(1);
  });

  it('sends nothing on a publish when the trial has no relay (v1)', async () => {
    const { delivered, store } = rig(undefined);
    store.publish('worker-1', 'module-sheets-w1', {
      worker: 'worker-1',
      sheets: mods('module-sheets-w1').map(fileSheet),
    });
    await settle();
    expect(delivered).toEqual([]);
  });
});

describe('a consumer that only a message can wake', () => {
  it('with notices: briefed before anything exists (finds nothing), then woken by each publish, it reads, checks and decides all eight, and the all-available message finds nothing left to do', async () => {
    const t = trial(null, { notice: true });
    const c = idleConsumer(t);
    await c.message('brief', 'Wait for documents module-sheets-w1..w8 and decide each.');
    expect(okEvents(t, 'read')).toHaveLength(0);
    for (const doc of DOCS) {
      await publish(t, doc);
      await c.drain();
    }
    expect(c.turns.at(-1)).toBe(ALL);
    expect(okEvents(t, 'read').filter((e) => e.version === 1)).toHaveLength(8 + 8);
    expect(okEvents(t, 'check')).toHaveLength(8);
    expect(
      okEvents(t, 'decide')
        .map((e) => e.doc)
        .sort(),
    ).toEqual([...DOCS].sort());
    for (const d of DOCS)
      expect((await t.as('synthesiser')('doc_read', { doc_id: d })).doc.status).toBe('accepted');
    expect(handoffMetrics({ root: t.root, truth: S.truth }).v2.consumer_notices).toEqual({
      sent: 9,
      failed: 0,
      published: 8,
      all_available: 1,
    });
  });

  it('regression: the same consumer without notices (p1t-v2) reads nothing and decides nothing', async () => {
    const t = trial(null);
    const c = idleConsumer(t);
    await c.message('brief', 'Wait for documents module-sheets-w1..w8 and decide each.');
    for (const doc of DOCS) {
      await publish(t, doc);
      await c.drain();
    }
    expect(c.turns).toEqual(['brief']);
    expect(okEvents(t, 'read')).toHaveLength(0);
    expect(okEvents(t, 'check')).toHaveLength(0);
    expect(okEvents(t, 'decide')).toHaveLength(0);
    expect(events(t, 'read').filter((e) => !e.ok)).toHaveLength(8);
    expect(handoffMetrics({ root: t.root, truth: S.truth }).v2.consumer_notices).toMatchObject({
      sent: 0,
    });
  });

  it('with faults: the notice-woken consumer rejects what doc_check flags, each producer republishes on the relay, the superseding notices bring the consumer back, and all eight end accepted', async () => {
    const t = trial(20261004, { notice: true });
    const c = idleConsumer(t);
    await c.message('brief', 'Wait for documents.');
    for (const doc of DOCS) {
      await publish(t, doc);
      await c.drain();
    }
    const rejected = t.sent.filter(
      (m) => m.to !== 'lead' && m.subject.startsWith('document rejected'),
    );
    expect(rejected.map((m) => m.to).sort()).toEqual(
      t.plan.faults.map((f) => worker(f.doc)).sort(),
    );
    for (const f of t.plan.faults) {
      expect(await publish(t, f.doc)).toMatchObject({ version: 2 });
      await c.drain();
    }
    const superseding = ready(t).filter((m) => /supersedes version 1/.test(m.body));
    expect(superseding).toHaveLength(4);
    for (const m of superseding) expect(m.body).toContain('(rejected)');
    for (const d of DOCS)
      expect((await t.as('synthesiser')('doc_read', { doc_id: d })).doc.status).toBe('accepted');
    const m = handoffMetrics({ root: t.root, truth: S.truth });
    expect(m).toMatchObject({ injected: 4, caught: 4, missed: 0, final_accepted_docs: 8 });
    expect(m.v2.consumer_notices).toEqual({ sent: 13, failed: 0, published: 12, all_available: 1 });
    // exactly one notice per successful publish: 8 first versions plus 4 republishes
    expect(ready(t)).toHaveLength(12);
  });
});
