// P4.7 (spec 13.2, open item 27): the pure facts of `max_rework_rounds` and the exhaustion notice derived from the
// committed log. A real store and event log, no daemon. Threshold exactly at the cap (cap 2: the second rejection
// exhausts), nothing below it or without a cap, the notice derived once per thread, frozen derived from state and caps.
import { describe, expect, it } from 'vitest';
import {
  capsFromDef,
  deriveReworkNotices,
  frozenThreads,
  reworkFacts,
  rootMayDecide,
  syncReworkCaps,
  type ReworkEscalation,
} from '../../../src/orgrt/documents/rework.js';
import { deriveRelays } from '../../../src/orgrt/documents/relay.js';
import { EventLog, parseLog } from '../../../src/orgrt/documents/events.js';
import { applyEvent, emptyState } from '../../../src/orgrt/documents/state.js';
import { join } from 'node:path';
import { briefBinding, must, open, pub, refusal, tmp } from './store-support.js';

const esc = (caps: Record<string, number | undefined>): ReworkEscalation => ({
  caps: () => caps,
  root: 'boss',
  recipients: (t) => ['boss', 'research-lead', t.consumer === 'writing' ? 'writer' : 'reviewer'],
});

let n = 0;
const reject = (s: ReturnType<typeof open>, role: string, id: string, version: number, reason = 'not good enough') =>
  must(s.decide({ role, id, version, decision: 'reject', reason, idempotency_key: `d${++n}` }));
const accept = (s: ReturnType<typeof open>, role: string, id: string, version: number) =>
  must(s.decide({ role, id, version, decision: 'accept', idempotency_key: `d${++n}` }));

/** brief-1 rejected by `writer` (writing) `rounds` times, each version superseding the last. */
function rejected(rounds: number) {
  const dir = tmp('p47-');
  const s = open(dir, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['writer'] }])] }); // one consuming section
  must(s.publish(pub()));
  for (let v = 1; v <= rounds; v++) {
    reject(s, 'writer', 'brief-1', v, `reason ${v}`);
    if (v < rounds) must(s.publish(pub({ supersedes: `brief-1@v${v}` })));
  }
  return { dir, s };
}
const events = (dir: string) => parseLog(EventLog.read(join(dir, 'events.jsonl'))).events;

describe('thread facts', () => {
  it('a cap of 2: the first rejection does not exhaust, the second does (derived from the state and the caps)', () => {
    const one = rejected(1);
    expect(reworkFacts(one.s.state, { writing: 2 })).toMatchObject([{ doc: 'brief-1', consumer: 'writing', rounds: 1, cap: 2, exhausted: false, frozen: false, head: 1 }]);
    const two = rejected(2);
    expect(reworkFacts(two.s.state, { writing: 2 })).toMatchObject([
      { doc: 'brief-1', consumer: 'writing', rounds: 2, cap: 2, exhausted: true, frozen: true, head: 2, rejected_versions: [1, 2] },
    ]);
  });

  it('no cap, no thread: an unset max_rework_rounds exhausts nothing however many rounds', () => {
    const r = rejected(4);
    expect(reworkFacts(r.s.state, {})).toEqual([]);
    expect(frozenThreads(r.s.state, {}, 'brief-1')).toEqual([]);
    expect(rootMayDecide(r.s.state, {}, 'brief-1', 4)).toBeUndefined();
  });

  it('a cap belongs to the consuming section: a rejection by another section does not count toward it', () => {
    const r = rejected(2);
    expect(reworkFacts(r.s.state, { review: 2 })).toEqual([]);
  });

  it('frozen is derived from the current caps every time: raising the cap thaws, lowering it freezes', () => {
    const r = rejected(2);
    expect(frozenThreads(r.s.state, { writing: 2 }, 'brief-1')).toHaveLength(1);
    expect(frozenThreads(r.s.state, { writing: 3 }, 'brief-1')).toEqual([]);
    expect(frozenThreads(r.s.state, { writing: 1 }, 'brief-1')).toHaveLength(1);
  });

  it('the root may decide only the head of a frozen thread, for the exhausted consuming section', () => {
    const r = rejected(2);
    expect(rootMayDecide(r.s.state, { writing: 2 }, 'brief-1', 2)).toBe('writing');
    expect(rootMayDecide(r.s.state, { writing: 2 }, 'brief-1', 1)).toBeUndefined(); // not the head
    expect(rootMayDecide(r.s.state, { writing: 3 }, 'brief-1', 2)).toBeUndefined(); // not frozen
    expect(rootMayDecide(r.s.state, { writing: 2 }, 'brief-9', 1)).toBeUndefined();
  });

  it('capsFromDef reads only positive integers', () => {
    expect(capsFromDef({ sections: { a: { max_rework_rounds: 2 }, b: {}, c: { max_rework_rounds: 0 }, d: { max_rework_rounds: 1.5 } } })).toEqual({ a: 2 });
  });

  it('syncReworkCaps copies a changed cap and reports it, sets and deletes, touches nothing else', () => {
    const live = { sections: { a: { lead: 'x', max_rework_rounds: 2 }, b: { lead: 'y' } } };
    expect(syncReworkCaps(live, { sections: { a: { lead: 'z', max_rework_rounds: 3 }, b: { lead: 'y', max_rework_rounds: 1 }, c: { max_rework_rounds: 9 } } })).toEqual([
      'sections.a.max_rework_rounds',
      'sections.b.max_rework_rounds',
    ]);
    expect(live).toEqual({ sections: { a: { lead: 'x', max_rework_rounds: 3 }, b: { lead: 'y', max_rework_rounds: 1 } } });
    expect(syncReworkCaps(live, { sections: { a: { lead: 'x' }, b: { lead: 'y', max_rework_rounds: 1 } } })).toEqual(['sections.a.max_rework_rounds']);
    expect(live.sections.a).toEqual({ lead: 'x' });
    expect(syncReworkCaps(live, { sections: { a: {}, b: { max_rework_rounds: 1 } } })).toEqual([]);
    expect(syncReworkCaps({}, { sections: { a: {} } })).toEqual([]);
  });
});

describe('the exhaustion notice (derived from the committed log)', () => {
  it('none below the cap, none without a cap, exactly one per recipient at the rejection that reaches it', () => {
    const one = rejected(1);
    expect(deriveReworkNotices(events(one.dir), esc({ writing: 2 }))).toEqual([]);
    const two = rejected(2);
    expect(deriveReworkNotices(events(two.dir), esc({}))).toEqual([]);
    const notices = deriveReworkNotices(events(two.dir), esc({ writing: 2 }));
    expect(notices.map((x) => [x.to, x.kind, x.audience ?? 'root'])).toEqual([
      ['boss', 'rework-exhausted', 'root'],
      ['research-lead', 'rework-exhausted', 'lead'],
      ['writer', 'rework-exhausted', 'lead'],
    ]);
    const exhaustingSeq = events(two.dir).filter((e) => e.type === 'decided').at(-1)!.seq;
    for (const x of notices) {
      expect(x.seq).toBe(exhaustingSeq);
      expect(x).toMatchObject({ doc: 'brief-1', version: 2, subject: expect.stringContaining('rework exhausted: brief-1 (writing)') });
    }
    // a third rejection in the same thread (cap lowered, or raised later) derives no second notice for the same cap
    expect(new Set(notices.map((x) => x.key)).size).toBe(3);
  });

  it('the root text names the document, rounds, cap, the last reason and the four options; the copies are short', () => {
    const [root, lead] = deriveReworkNotices(events(rejected(2).dir), esc({ writing: 2 }));
    expect(root.subject).toBe('rework exhausted: brief-1 (writing)');
    expect(root.body).toBe(
      'The review cycle of document "brief-1" (type brief) is spent: writing has rejected 2 versions of it, which is its cap of 2 rework rounds (sections.writing.max_rework_rounds). ' +
        'Last rejection: version 2, by writer: reason 2 ' +
        'The thread is frozen: the producer cannot publish a revision of it, and was told to wait for you. ' +
        'You decide. Options: (1) raise the cap: set sections.writing.max_rework_rounds higher in the org definition and reload it, and the producer may revise again; ' +
        '(2) decide the document yourself: org_doc_decide on brief-1 version 2 with decision "accept" (it replaces writing\'s rejection and ends the thread); ' +
        '(3) reassign the work to another role or section; (4) close the thread: leave it frozen (org_doc_decide with decision "reject" confirms the rejection).',
    );
    expect(lead.subject).toBe('rework exhausted: brief-1 (writing) (copy)');
    expect(lead.body).toBe(
      'The review cycle of document "brief-1" is spent: writing rejected 2 versions, its cap of 2 rework rounds. Last rejection (version 2, writer): reason 2 The thread is frozen and the root decides; the producer was told to wait. Do not publish or decide it again.',
    );
  });

  it('the last reason is length-capped (600 for the root, 200 for the copies)', () => {
    const dir = tmp('p47-');
    const s = open(dir, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['writer'] }])] });
    must(s.publish(pub()));
    reject(s, 'writer', 'brief-1', 1);
    must(s.publish(pub({ supersedes: 'brief-1@v1' })));
    reject(s, 'writer', 'brief-1', 2, 'x'.repeat(2000));
    const [root, lead] = deriveReworkNotices(events(dir), esc({ writing: 2 }));
    expect(root.body).toContain(`${'x'.repeat(600)}… [cut at 600 characters`);
    expect(root.body).not.toContain('x'.repeat(601));
    expect(lead.body).toContain(`${'x'.repeat(200)}… [cut at 200 characters`);
    expect(lead.body).not.toContain('x'.repeat(201));
  });

  it('is a pure function of the log and the caps: the same keys every time; a changed cap derives its own keys', () => {
    const r = rejected(2);
    const a = deriveReworkNotices(events(r.dir), esc({ writing: 2 })).map((x) => x.key);
    expect(deriveReworkNotices(events(r.dir), esc({ writing: 2 })).map((x) => x.key)).toEqual(a);
    expect(a[0]).toMatch(/^x:brief-1\|writing\|2@\d+:boss$/);
    const lowered = deriveReworkNotices(events(r.dir), esc({ writing: 1 })).map((x) => x.key);
    expect(lowered[0]).toMatch(/^x:brief-1\|writing\|1@\d+:boss$/);
    expect(lowered.some((k) => a.includes(k))).toBe(false);
  });

  it('a thread exhausted again after the root accepted it is a new obligation (its key names the event)', () => {
    const dir = tmp('p47-');
    const s = open(dir, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['writer'] }])] });
    must(s.publish(pub()));
    reject(s, 'writer', 'brief-1', 1);
    must(s.publish(pub({ supersedes: 'brief-1@v1' })));
    reject(s, 'writer', 'brief-1', 2);
    must(s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'root-1' }, 'writing'));
    must(s.publish(pub({ supersedes: 'brief-1@v2' }))); // accepted head: a revision is a new round, not frozen
    reject(s, 'writer', 'brief-1', 3);
    const keys = deriveReworkNotices(events(dir), esc({ writing: 2 })).filter((x) => x.to === 'boss').map((x) => x.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('the root override in the store (the reducer and the replay)', () => {
  it('an accept by the root replaces the consumer rejection of the head: accepted, the thread thaws, the log replays to the same state', () => {
    const r = rejected(2);
    const rec = must(r.s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'root-1' }, 'writing'));
    expect(rec).toMatchObject({ ok: true, version: 2, consumer: 'writing', decision: 'accept', status: 'accepted' });
    const doc = r.s.state.docs['brief-1'];
    expect(doc.versions[1].decisions.writing).toMatchObject({ decision: 'accept', by: 'boss' });
    expect(doc.rework.writing).toBe(1);
    expect(frozenThreads(r.s.state, { writing: 2 }, 'brief-1')).toEqual([]);
    const ev = events(r.dir).at(-1) as { override?: boolean; by: string };
    expect(ev).toMatchObject({ type: 'decided', by: 'boss', decision: 'accept', override: true });
    const replay = emptyState();
    for (const e of events(r.dir)) applyEvent(replay, e);
    expect(replay).toEqual(r.s.state);
  });

  it('without the override a reversal is refused as before, and the root is not a decider', () => {
    const r = rejected(2);
    expect(refusal(r.s.decide({ role: 'writer', id: 'brief-1', version: 2, decision: 'accept', idempotency_key: 'k-w' })).code).toBe('REVERSAL_REFUSED');
    expect(refusal(r.s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', idempotency_key: 'k-b' })).code).toBe('NOT_DECIDER');
  });

  it('the override is only for an accept of the head over a rejection: a reject confirms (no event), an older version is refused', () => {
    const r = rejected(2);
    const seq = r.s.info().seq;
    expect(must(r.s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'reject', reason: 'closed', consumer: 'writing', idempotency_key: 'c1' }, 'writing'))).toMatchObject({ noop: true, status: 'rejected' });
    expect(r.s.info().seq).toBe(seq);
    expect(refusal(r.s.decide({ role: 'boss', id: 'brief-1', version: 1, decision: 'accept', consumer: 'writing', idempotency_key: 'c2' }, 'writing')).code).toBe('REVERSAL_REFUSED');
  });

  it('a replayed override key returns its receipt; with another consuming section still to decide the version stays pending', () => {
    const dir = tmp('p47-');
    const s = open(dir); // two consuming sections: writing and review
    must(s.publish(pub()));
    reject(s, 'writer', 'brief-1', 1);
    must(s.publish(pub({ supersedes: 'brief-1@v1' })));
    reject(s, 'writer', 'brief-1', 2);
    const r = must(s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'k' }, 'writing'));
    expect(r).toMatchObject({ status: 'pending', waiting_on: ['review'] });
    expect(must(s.decide({ role: 'boss', id: 'brief-1', version: 2, decision: 'accept', consumer: 'writing', idempotency_key: 'k' }, 'writing'))).toMatchObject({ replayed: true });
    expect(must(s.decide({ role: 'reviewer', id: 'brief-1', version: 2, decision: 'accept', idempotency_key: 'kr' })).status).toBe('accepted');
  });
});

describe('the relay says the round, and at the cap the producer is told to wait', () => {
  const relays = (dir: string, s: ReturnType<typeof open>, caps: Record<string, number | undefined>) =>
    deriveRelays(s.contracts(), events(dir), (_sec, producer) => (producer === 'research-lead' ? undefined : 'research-lead'), caps);

  it('without a cap the P3.9 text is unchanged', () => {
    const r = rejected(1);
    const [p] = relays(r.dir, r.s, {});
    expect(p.body).toContain('Rework rounds so far for this document from writing: 1.');
    expect(p.body).toContain('What to do:');
    expect(p.body).not.toMatch(/rework round \d of/);
  });

  it('below the cap: "rework round N of M" and the usual instruction', () => {
    const r = rejected(1);
    const [p, lead] = relays(r.dir, r.s, { writing: 2 });
    expect(p.body).toContain('This is rework round 1 of 2 for this document from writing.');
    expect(p.body).toContain('What to do:');
    expect(p.body).not.toContain('Rework rounds so far');
    expect(lead.body).toContain('; rework round 1 of 2)');
  });

  it('at the cap: the producer is told the cap is spent and to wait for the root or the lead, with no revise instruction', () => {
    const r = rejected(2);
    const [, second] = relays(r.dir, r.s, { writing: 2 }).filter((x) => x.audience === 'producer');
    expect(second.body).toContain('This is rework round 2 of 2 for this document from writing.');
    expect(second.body).toContain(
      'The cap of 2 rework rounds is spent, so this document is frozen: org_doc_publish will refuse a revision of it. Do not publish it again; wait for the root or your section lead to decide it (both have been told).',
    );
    expect(second.body).not.toContain('What to do:');
    const lead = relays(r.dir, r.s, { writing: 2 }).filter((x) => x.audience === 'lead').at(-1)!;
    expect(lead.body).toContain('; rework round 2 of 2, the cap is spent and the root decides)');
  });
});
