// P4.7: durability of the rework-exhausted notice, the engine alone (a real store and event log, the real notice
// journal, a fake deliver, a real Mailbox for the eviction case). The obligation is derived from the committed
// rejection that reached the cap, so a crash between that commit and the delivery loses nothing; a resume sends it
// once, never again once delivered and no longer frozen; a failing recipient is retried to a bound and then reported.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_SENDER } from '../../../src/orgrt/documents/deliver.js';
import { NoticeEngine, type NoticeSink } from '../../../src/orgrt/documents/notices.js';
import type { ReworkEscalation } from '../../../src/orgrt/documents/rework.js';
import { Mailbox } from '../../../src/orgrt/mailbox.js';
import { briefBinding, must, open, pub, tickingClock, tmp } from './store-support.js';

type Sent = { to: string; subject: string; body: string };
const SINGLE = [briefBinding({}, [{ id: 'writing', deciders: ['writer'] }])];
const caps: Record<string, number | undefined> = { writing: 2 };
const escalation: ReworkEscalation = {
  caps: () => caps,
  root: 'boss',
  recipients: (t) => ['boss', 'research-lead', t.consumer === 'writing' ? 'writer' : 'reviewer'],
};

function rig(dir = tmp('p47n-')) {
  const store = open(dir, { bindings: SINGLE });
  const engine = new NoticeEngine({ dir, store, now: tickingClock(), maxFailures: 3 });
  engine.useRework(escalation);
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
type Rig = ReturnType<typeof rig>;
let n = 0;
const reject = (r: Rig, v: number) => must(r.store.decide({ role: 'writer', id: 'brief-1', version: v, decision: 'reject', reason: `no ${v}`, idempotency_key: `d${++n}` }));
const spent = (m: Sent): boolean => m.subject.startsWith('rework exhausted');
/** brief-1 rejected up to `rounds` times. */
function run(r: Rig, rounds: number) {
  must(r.store.publish(pub()));
  for (let v = 1; v <= rounds; v++) {
    reject(r, v);
    if (v < rounds) must(r.store.publish(pub({ supersedes: `brief-1@v${v}` })));
  }
}
const journal = (dir: string) => readFileSync(join(dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const xDelivered = (dir: string) => journal(dir).filter((j) => j.t === 'delivered' && String(j.key).startsWith('x:'));

describe('delivery', () => {
  it('the root and the leads are each told exactly once, at the rejection that reaches the cap, not before', async () => {
    const r = rig();
    r.engine.start(r.sink());
    run(r, 1);
    await r.engine.idle();
    expect(r.sent.filter(spent)).toEqual([]);
    must(r.store.publish(pub({ supersedes: 'brief-1@v1' })));
    reject(r, 2);
    await r.engine.idle();
    expect(r.sent.filter(spent).map((m) => `${m.to}:${m.subject}`)).toEqual([
      'boss:rework exhausted: brief-1 (writing)',
      'research-lead:rework exhausted: brief-1 (writing) (copy)',
      'writer:rework exhausted: brief-1 (writing) (copy)',
    ]);
    await r.engine.retry();
    expect(r.sent.filter(spent)).toHaveLength(3); // nothing again
  });

  it('is sent by the runtime like the other notices; the producer is not among the recipients (its relay says it)', async () => {
    const r = rig();
    r.engine.start(r.sink());
    run(r, 2);
    await r.engine.idle();
    expect(r.sent.filter(spent).map((m) => m.to)).not.toContain('researcher');
    // the producer's own message is the relay, which says the round and that the cap is spent
    const relays = r.sent.filter((m) => m.to === 'researcher');
    expect(relays.map((m) => m.subject)).toEqual(['document rejected: brief-1 v2']); // v1's was moot: replaced before it was sent
    expect(relays[0].body).toContain('This is rework round 2 of 2');
    expect(relays[0].body).toContain('The cap of 2 rework rounds is spent');
  });

  it('an org with no cap owes no exhaustion notice however many rounds', async () => {
    const r = rig();
    r.engine.useRework({ ...escalation, caps: () => ({}) });
    r.engine.start(r.sink());
    run(r, 3);
    await r.engine.idle();
    expect(r.sent.filter(spent)).toEqual([]);
  });
});

describe('durability', () => {
  it('crash after the exhausting reject commit, before any delivery: a resume sends each notice once', async () => {
    const first = rig();
    first.engine.setEnabledForTest(false); // the process "died" after the commit
    first.engine.start(first.sink());
    run(first, 2);
    await first.engine.idle();
    expect(first.sent).toEqual([]);
    first.engine.close();
    const again = rig(first.dir);
    again.engine.start(again.sink());
    await again.engine.idle();
    expect(again.sent.filter(spent).map((m) => m.to)).toEqual(['boss', 'research-lead', 'writer']);
    expect(xDelivered(first.dir)).toHaveLength(3);
    again.engine.close();
    // a third start with the thread thawed (the root accepted): nothing is sent for it again
    must(again.store.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'root' }, 'writing'));
    const third = rig(first.dir);
    third.engine.start(third.sink());
    await third.engine.idle();
    expect(third.sent.filter(spent)).toEqual([]);
    expect(xDelivered(first.dir)).toHaveLength(3);
  });

  it('delivered and still frozen: a resume re-sends only what the recipient mailbox no longer holds; thawed, never', async () => {
    const r = rig();
    const boxes = new Map<string, Mailbox>();
    const box = (to: string) => boxes.get(to) ?? boxes.set(to, new Mailbox()).get(to)!;
    const toBox: NoticeSink = {
      deliver: async (to, subject, body) => {
        box(to).push(`[message from ${RUNTIME_SENDER}] subject: ${subject}\n\n${body}`);
        return `delivered to ${to}`;
      },
      queued: (to, s) => box(to).serialize().queue.some((m) => m.includes(`subject: ${s}\n`)),
    };
    r.engine.start(toBox);
    run(r, 2);
    await r.engine.idle();
    const held = (to: string) => box(to).serialize().queue.filter((m) => m.includes('rework exhausted')).length;
    expect([held('boss'), held('research-lead'), held('writer')]).toEqual([1, 1, 1]);
    // the Mailbox keeps 500: the root's queue overflows and the notice to the root is pushed out
    for (let i = 0; i < 500; i++) box('boss').push(`noise ${i}`);
    expect(held('boss')).toBe(0);
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start(toBox);
    await next.engine.idle();
    expect([held('boss'), held('research-lead'), held('writer')]).toEqual([1, 1, 1]); // only the evicted one was sent again
    expect(box('boss').serialize().queue.length).toBe(500);
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start(toBox);
    await third.engine.idle();
    expect([held('boss'), held('research-lead'), held('writer')]).toEqual([1, 1, 1]); // nothing duplicated
    third.engine.close();
    // the root reads the document, so it has seen the notice: an evicted copy is not sent again
    must(third.store.read({ role: 'boss', id: 'brief-1', version: 2 }));
    for (let i = 0; i < 500; i++) box('boss').push(`more noise ${i}`);
    expect(held('boss')).toBe(0);
    const read = rig(r.dir);
    read.engine.start(toBox);
    await read.engine.idle();
    expect(held('boss')).toBe(0);
    read.engine.close();
    // the root accepts: the thread thaws, and an evicted notice is no longer worth sending
    must(third.store.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'root' }, 'writing'));
    for (let i = 0; i < 500; i++) box('writer').push(`noise ${i}`);
    expect(held('writer')).toBe(0);
    const fourth = rig(r.dir);
    fourth.engine.start(toBox);
    await fourth.engine.idle();
    expect(held('writer')).toBe(0);
  });

  it('a failing recipient is retried at the next opportunity, bounded, then reported; the others are delivered', async () => {
    const r = rig();
    const emitted: string[] = [];
    const calls = new Map<string, number>();
    r.engine.start({
      deliver: async (to, subject) => {
        calls.set(to, (calls.get(to) ?? 0) + 1);
        if (to === 'boss' && subject.startsWith('rework exhausted')) throw new Error('mailbox full');
        r.sent.push({ to, subject, body: '' });
        return `delivered to ${to}`;
      },
      emit: (e) => emitted.push(e.reason),
    });
    run(r, 2);
    await r.engine.idle();
    await r.engine.retry();
    await r.engine.retry();
    await r.engine.retry(); // past the bound of 3
    expect(r.sent.filter(spent).map((m) => m.to).sort()).toEqual(['research-lead', 'writer']);
    expect(calls.get('boss')).toBe(3);
    expect(emitted.filter((e) => e === 'doc-notice-failed')).toHaveLength(2);
    expect(emitted.filter((e) => e === 'doc-notice-gave-up')).toHaveLength(1);
    expect(r.engine.pending().filter((x) => x.kind === 'rework-exhausted')).toEqual([]);
    expect(journal(r.dir).filter((j) => j.t === 'failed' && String(j.key).startsWith('x:'))).toHaveLength(3);
  });
});

describe('a reload that lowers the cap', () => {
  it('owes the notice for a thread that has now reached it, once; raising it again owes nothing new', async () => {
    const live: Record<string, number | undefined> = { writing: 3 };
    const r = rig();
    r.engine.useRework({ ...escalation, caps: () => live });
    r.engine.start(r.sink());
    run(r, 2);
    await r.engine.idle();
    expect(r.sent.filter(spent)).toEqual([]); // 2 rounds of 3
    live.writing = 2; // the reload
    await r.engine.retry();
    expect(r.sent.filter(spent).map((m) => m.to)).toEqual(['boss', 'research-lead', 'writer']);
    live.writing = 4;
    await r.engine.retry();
    live.writing = 2;
    await r.engine.retry();
    expect(r.sent.filter(spent)).toHaveLength(3);
  });
});
