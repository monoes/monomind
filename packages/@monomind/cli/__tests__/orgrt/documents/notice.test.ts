// P3.8: the publication notice and the all-available message (spec 6.2 (a) to (e), R24), the engine alone: a real
// store and event log, the real notice journal, a fake deliver (and a real Mailbox for the eviction case). No daemon.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Mailbox } from '../../../src/orgrt/mailbox.js';
import { NoticeEngine, type NoticeSink } from '../../../src/orgrt/documents/notices.js';
import { RUNTIME_SENDER } from '../../../src/orgrt/documents/deliver.js';
import type { TypeBinding } from '../../../src/orgrt/documents/store-types.js';
import { briefBinding, must, open, pub, refusal, tickingClock, tmp } from './store-support.js';

type Sent = { to: string; subject: string; body: string };
const norm = (s: string): string => s.replace(/\b[0-9a-f]{12}\b/g, '<rev>');

/** A store, its engine and a recording sink; `again(dir)` reopens both over the same directory (a restart). */
function rig(dir = tmp('p38-'), over: { bindings?: TypeBinding[] } = {}) {
  const store = open(dir, over.bindings ? { bindings: over.bindings } : {});
  const engine = new NoticeEngine({ dir, store, now: tickingClock() });
  const sent: Sent[] = [];
  const sink = (deliver?: NoticeSink['deliver'], extra: Partial<NoticeSink> = {}): NoticeSink => ({
    deliver:
      deliver ??
      (async (to, subject, body) => {
        sent.push({ to, subject, body });
        return `delivered to ${to}`;
      }),
    ...extra,
  });
  return { dir, store, engine, sent, sink };
}
const publish = (r: ReturnType<typeof rig>, over = {}) => must(r.store.publish(pub(over)));
const decide = (r: ReturnType<typeof rig>, role: string, id: string, version: number, decision: 'accept' | 'reject') =>
  must(
    r.store.decide({
      role,
      id,
      version,
      decision,
      ...(decision === 'reject' ? { reason: 'not good enough' } : {}),
      idempotency_key: `d-${role}-${id}-${version}-${decision}`,
    }),
  );

describe('the notice on a publish', () => {
  it('sends each decision maker exactly one notice with document, version, contract, producer and what is ready; the text is exact', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    const ready = r.sent.filter((m) => m.subject.startsWith('document ready'));
    expect(ready.map((m) => m.to)).toEqual(['writer', 'reviewer']);
    expect(ready.map((m) => m.subject)).toEqual(['document ready: brief-1 v1', 'document ready: brief-1 v1']);
    expect(norm(ready[0].body)).toBe(
      'researcher published version 1 of document "brief-1" (contract: brief <rev>). It is ready to read (org_doc_read), and decide on (org_doc_decide).',
    );
    expect(ready[1].body).toBe(ready[0].body);
    expect(r.store.contracts()[0].revision.startsWith(/\(contract: brief ([0-9a-f]{12})\)/.exec(ready[0].body)![1])).toBe(true);
    expect(r.sent.map((m) => m.to).filter((t) => t === 'researcher')).toEqual([]); // the producer is not a decision maker
  });

  it('is sent by the runtime after the commit, off the publisher call, as one delivery per notice (a 3-publish run: 6 notices)', async () => {
    const r = rig();
    r.engine.start(r.sink());
    for (let i = 0; i < 3; i++) publish(r);
    expect(r.sent).toEqual([]); // nothing ran inside the publish calls
    await r.engine.idle();
    expect(r.sent.filter((m) => m.subject.startsWith('document ready')).map((m) => `${m.to}:${m.subject}`)).toEqual([
      'writer:document ready: brief-1 v1',
      'reviewer:document ready: brief-1 v1',
      'writer:document ready: brief-2 v1',
      'reviewer:document ready: brief-2 v1',
      'writer:document ready: brief-3 v1',
      'reviewer:document ready: brief-3 v1',
    ]);
  });

  it('mentions org_doc_check only where the contract declares checks', async () => {
    const withChecks = rig(undefined, { bindings: [briefBinding({ checks: [{ type: 'files_match_evidence' }] })] });
    withChecks.engine.start(withChecks.sink());
    publish(withChecks);
    await withChecks.engine.idle();
    expect(norm(withChecks.sent[0].body)).toContain('ready to read (org_doc_read), check (org_doc_check), and decide on (org_doc_decide).');
    const plain = rig();
    plain.engine.start(plain.sink());
    publish(plain);
    await plain.engine.idle();
    expect(plain.sent[0].body).not.toContain('org_doc_check');
  });

  it('carries nothing but the contract and the log: no fault, seed or injection text, and the same shape for every document', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    publish(r, { body: { topic: 'A fault injected here', claims: ['seed 42'] }, note: 'fault: swapped values' });
    await r.engine.idle();
    const notices = r.sent.filter((m) => m.subject.startsWith('document ready'));
    for (const m of notices) expect(`${m.subject} ${m.body}`).not.toMatch(/fault|seed|inject|swapped|A fault/i);
    const shape = (m: Sent) => norm(m.body).replace(/brief-\d/g, 'ID');
    expect(shape(notices[0])).toBe(shape(notices[2]));
  });

  it('a refused publish sends nothing', async () => {
    const r = rig();
    r.engine.start(r.sink());
    refusal(r.store.publish(pub({ body: { topic: 'x' } })));
    refusal(r.store.publish(pub({ role: 'writer' })));
    await r.engine.idle();
    expect(r.sent).toEqual([]);
    expect(r.engine.notices()).toEqual([]);
  });

  it('a republish says it supersedes the earlier version, naming what the consumer had decided', async () => {
    const r = rig();
    r.engine.start(r.sink());
    const v1 = publish(r);
    await r.engine.idle();
    // writer decided v1 (reject), reviewer did not decide it
    decide(r, 'writer', 'brief-1', 1, 'reject');
    publish(r, { supersedes: v1.ref });
    await r.engine.idle();
    const second = r.sent.filter((m) => m.subject === 'document ready: brief-1 v2');
    expect(second.map((m) => m.to)).toEqual(['writer', 'reviewer']);
    expect(norm(second[0].body)).toBe(
      'researcher published version 2 of document "brief-1" (contract: brief <rev>). It is ready to read (org_doc_read), and decide on (org_doc_decide). It supersedes version 1, which you had already decided (rejected): decide on this version instead.',
    );
    expect(norm(second[1].body)).toBe(
      'researcher published version 2 of document "brief-1" (contract: brief <rev>). It is ready to read (org_doc_read), and decide on (org_doc_decide). It supersedes version 1, which you had not decided: decide on this version instead.',
    );
  });

  it('a decider of two consuming sections is told once per publish', async () => {
    const r = rig(undefined, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['lead'] }, { id: 'review', deciders: ['lead'] }])] });
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    expect(r.sent.map((m) => `${m.to}:${m.subject}`)).toEqual(['lead:document ready: brief-1 v1', 'lead:all documents are available']);
  });
});

describe('the all-available message', () => {
  const two = () =>
    rig(undefined, {
      bindings: [
        briefBinding(),
        {
          ...briefBinding({}, [{ id: 'writing', deciders: ['writer'] }]),
          contract: { type: 'plan', schema: briefBinding().contract.schema, max_publish_attempts: 3 },
        },
      ],
    });
  const planPub = (r: ReturnType<typeof rig>, over = {}) => must(r.store.publish(pub({ type: 'plan', ...over })));

  it('is sent once per decision maker, after the publish that completes its set, listing every id and version, and never again', async () => {
    const r = two();
    r.engine.start(r.sink());
    const b = publish(r);
    await r.engine.idle();
    expect(r.sent.filter((m) => m.subject === 'all documents are available').map((m) => m.to)).toEqual(['reviewer']); // reviewer needs only brief
    planPub(r); // completes writer's set (brief + plan)
    await r.engine.idle();
    const all = r.sent.filter((m) => m.subject === 'all documents are available');
    expect(all.map((m) => m.to)).toEqual(['reviewer', 'writer']);
    expect(all[1].body).toBe(
      'All 2 documents you consume are now available: "brief-1" (version 1), "plan-1" (version 1). Read and decide each one you have not decided yet (org_doc_read, org_doc_decide), then start your final work from the accepted documents.',
    );
    // it comes after the last publish notice of that publish
    const idx = (to: string, s: string) => r.sent.findIndex((m) => m.to === to && m.subject === s);
    expect(idx('writer', 'all documents are available')).toBeGreaterThan(idx('writer', 'document ready: plan-1 v1'));
    // a republish notifies again but never repeats the all-available message
    publish(r, { supersedes: b.ref });
    planPub(r);
    await r.engine.idle();
    expect(r.sent.filter((m) => m.subject === 'all documents are available')).toHaveLength(2);
    expect(r.sent.filter((m) => m.subject === 'document ready: brief-1 v2')).toHaveLength(2);
  });

  it('does not repeat after the store is reopened (the once is part of the persisted state)', async () => {
    const r = two();
    r.engine.start(r.sink());
    publish(r);
    planPub(r);
    await r.engine.idle();
    const before = r.sent.length;
    r.engine.close();
    const again = rig(r.dir, { bindings: [briefBinding(), { ...briefBinding({}, [{ id: 'writing', deciders: ['writer'] }]), contract: { type: 'plan', schema: briefBinding().contract.schema, max_publish_attempts: 3 } }] });
    again.engine.start(again.sink());
    await again.engine.idle();
    // the unread publish notices are re-sent on a resume (see the re-delivery tests); the all-available one is not
    expect(again.sent.map((m) => m.subject)).toEqual(['document ready: brief-1 v1', 'document ready: brief-1 v1', 'document ready: plan-1 v1']);
    publish(again);
    await again.engine.idle();
    expect(again.sent.filter((m) => m.subject === 'all documents are available')).toEqual([]);
    expect(before).toBe(5); // brief: writer, reviewer; plan: writer; all-available: reviewer, writer
  });

  it('lists the check tool only when a needed contract declares checks', async () => {
    const r = rig(undefined, { bindings: [briefBinding({ checks: [{ type: 'value_type', is: 'integer' }] })] });
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    const all = r.sent.find((m) => m.subject === 'all documents are available');
    expect(all?.body).toContain('Read, check and decide');
    expect(all?.body).toContain('org_doc_read, org_doc_check, org_doc_decide');
  });
});

describe('not lost: committed obligations, a journal, retry and re-delivery', () => {
  it('crash between commit and delivery: the committed publish still owes its notices, sent exactly once after the restart', async () => {
    const r = rig();
    publish(r); // committed; the engine had no delivery path yet (the process died before anything was sent)
    expect(r.engine.pending()).toHaveLength(4); // a notice each for writer and reviewer, and each one's all-available
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.sent.map((m) => `${m.to}:${m.subject}`).sort()).toEqual([
      'reviewer:all documents are available',
      'reviewer:document ready: brief-1 v1',
      'writer:all documents are available',
      'writer:document ready: brief-1 v1',
    ]);
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start(third.sink());
    await third.engine.idle();
    expect(third.engine.pending()).toEqual([]);
  });

  it('after a restart an undelivered notice is sent exactly once, a delivered and acted-on one never again', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    must(r.store.read({ role: 'writer', id: 'brief-1' }));
    decide(r, 'writer', 'brief-1', 1, 'accept');
    must(r.store.read({ role: 'reviewer', id: 'brief-1' }));
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.sent).toEqual([]);
    expect(readFileSync(join(r.dir, 'notices.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4);
  });

  it('a delivered notice the decision maker has not acted on is re-sent on resume, unless the restored mailbox still holds it', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    must(r.store.read({ role: 'writer', id: 'brief-1' })); // writer acted; reviewer did not
    r.engine.close();
    const next = rig(r.dir);
    const kept = new Mailbox();
    kept.push(`[message from ${RUNTIME_SENDER}] subject: document ready: brief-1 v1\n\nrestored from a checkpoint`);
    next.engine.start(next.sink(undefined, { queued: (_to, s) => kept.serialize().queue.some((m) => m.includes(`subject: ${s}\n`)) }));
    await next.engine.idle();
    expect(next.sent).toEqual([]); // the mailbox still holds it
    next.engine.close();
    const empty = rig(r.dir);
    empty.engine.start(empty.sink());
    await empty.engine.idle();
    expect(empty.sent.map((m) => `${m.to}:${m.subject}`)).toEqual(['reviewer:document ready: brief-1 v1']);
  });

  it('the Mailbox eviction at 500: a notice pushed out of a full queue is not silently lost, resume re-delivers it', async () => {
    const r = rig();
    const box = new Mailbox();
    const toBox: NoticeSink = {
      deliver: async (to, subject, body) => {
        if (to === 'reviewer') box.push(`[message from ${RUNTIME_SENDER}] subject: ${subject}\n\n${body}`);
        return `delivered to ${to}`;
      },
    };
    r.engine.start(toBox);
    publish(r);
    await r.engine.idle();
    for (let i = 0; i < 500; i++) box.push(`noise ${i}`); // the 500-item eviction drops the oldest: the notice
    expect(box.serialize().queue.some((m) => m.includes('document ready: brief-1 v1'))).toBe(false);
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start({
      ...toBox,
      queued: (_to, s) => box.serialize().queue.some((m) => m.includes(`subject: ${s}\n`)),
    });
    await next.engine.idle();
    expect(box.serialize().queue.filter((m) => m.includes('document ready: brief-1 v1'))).toHaveLength(1);
    expect(box.serialize().queue.length).toBe(500);
    // started again with the notice present in the queue: no duplicate
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start({ ...toBox, queued: (_to, s) => box.serialize().queue.some((m) => m.includes(`subject: ${s}\n`)) });
    await third.engine.idle();
    expect(box.serialize().queue.filter((m) => m.includes('document ready: brief-1 v1'))).toHaveLength(1);
  });

  it('a failed delivery is recorded, retried at the next opportunity, bounded, and never throws into the publisher', async () => {
    const r = rig();
    const emitted: string[] = [];
    let healthy = false;
    let calls = 0;
    r.engine.start({
      deliver: async (to, subject, body) => {
        calls++;
        if (!healthy) return 'ERROR: recipient crashed';
        r.sent.push({ to, subject, body });
        return `delivered to ${to}`;
      },
      emit: (e) => emitted.push(e.reason),
    });
    expect(() => publish(r)).not.toThrow();
    await r.engine.idle();
    expect(emitted).toEqual(['doc-notice-failed', 'doc-notice-failed']); // one per recipient: head-of-line, the later notices wait
    expect(r.engine.pending().length).toBe(4);
    expect(r.engine.facts()[0].notices.map((n) => [n.role, n.state, n.failures])).toEqual([
      ['writer', 'pending', 1],
      ['reviewer', 'pending', 1],
    ]);
    healthy = true;
    await r.engine.retry();
    expect(r.sent.map((m) => `${m.to}:${m.subject}`)).toEqual([
      'writer:document ready: brief-1 v1',
      'reviewer:document ready: brief-1 v1',
      'writer:all documents are available',
      'reviewer:all documents are available',
    ]);
    expect(r.engine.pending()).toEqual([]);
    // bounded: a recipient that never works is given up on, reported once, and left alone
    const dead = rig();
    const reasons: string[] = [];
    dead.engine.start({ deliver: async () => { throw new Error('boom'); }, emit: (e) => reasons.push(e.reason) });
    publish(dead);
    for (let i = 0; i < 20; i++) await dead.engine.retry();
    expect(reasons.filter((x) => x === 'doc-notice-gave-up').length).toBeGreaterThan(0);
    expect(dead.engine.facts()[0].notices.every((n) => n.state === 'exhausted')).toBe(true);
    const callsBefore = reasons.length;
    await dead.engine.retry();
    expect(reasons.length).toBe(callsBefore);
    expect(calls).toBeGreaterThan(0);
  });

  it('a REFUSED receipt is a failed delivery; a queued receipt is a delivered one', async () => {
    const r = rig();
    const reasons: string[] = [];
    r.engine.start({
      deliver: async (to) => (to === 'writer' ? 'REFUSED: no' : 'queued for reviewer (role starting)'),
      emit: (e) => reasons.push(e.reason),
    });
    publish(r);
    await r.engine.idle();
    expect(reasons).toEqual(['doc-notice-failed']);
    expect(r.engine.facts()[0].notices.map((n) => n.state)).toEqual(['pending', 'delivered']);
  });

  it('a torn last line in the journal is ignored and not glued to the next record', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    for (const role of ['writer', 'reviewer']) must(r.store.read({ role, id: 'brief-1' }));
    r.engine.close();
    appendFileSync(join(r.dir, 'notices.jsonl'), '{"t":"delivered","key":"p:1:wri');
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.sent).toEqual([]);
    publish(next);
    await next.engine.idle();
    const lines = readFileSync(join(r.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } })).toHaveLength(1);
    expect(lines.filter((l) => l.includes('"p:4:'))).toHaveLength(2);
  });

  it('with notices off (the internal test switch) nothing is sent and the obligations stay pending', async () => {
    const r = rig();
    r.engine.setEnabledForTest(false);
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    expect(r.sent).toEqual([]);
    expect(r.engine.pending().length).toBe(4);
  });
});

describe('the facts lead-watch needs', () => {
  it('per published version: published_at, each notice delivered_at, the first read per consumer', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    must(r.store.read({ role: 'writer', id: 'brief-1' }));
    must(r.store.read({ role: 'writer', id: 'brief-1' }));
    const [f] = r.engine.facts();
    expect(f).toMatchObject({ doc: 'brief-1', version: 1, type: 'brief' });
    expect(f.published_at).toMatch(/^2026-10-04T12:00:/);
    expect(f.notices.map((n) => [n.role, n.state])).toEqual([['writer', 'delivered'], ['reviewer', 'delivered']]);
    expect(f.notices.every((n) => typeof n.delivered_at === 'string')).toBe(true);
    expect(Object.keys(f.first_read_at)).toEqual(['writer']);
  });
});
