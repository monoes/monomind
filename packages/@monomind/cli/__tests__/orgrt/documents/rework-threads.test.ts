// packages/@monomind/cli/__tests__/orgrt/documents/rework-threads.test.ts
// Spec 6.5 and open item 27 (rework.ts: reworkThreads, reworkStatus, capsFromDef), stated in the test names:
//   - an unset max_rework_rounds means no cap;
//   - a rework round is one version of a document that the consuming section rejected; exhausted at the cap.
// States are built through the real reducer (support/doc-log.ts), so each one is a state the store could commit.
import { describe, expect, it } from 'vitest';
import { capsFromDef, reworkStatus, reworkThreads } from '../../../src/orgrt/documents/rework.js';
import type { ReworkThread } from '../../../src/orgrt/documents/rework.js';
import { ReplayError, applyEvent } from '../../../src/orgrt/documents/state.js';
import type { StoreEvent } from '../../../src/orgrt/documents/store-types.js';
import { Log } from '../support/doc-log.js';

const dev = (l: Log, o: { doc?: string } = {}) =>
  l.publish({ type: 'build', section: 'development', consumers: ['qa'], ...o });

/** A rejected build is republished `n` times. */
function rejectLoop(n: number): { log: Log; ref: string } {
  const l = new Log();
  let ref = dev(l);
  for (let i = 0; i < n; i += 1) {
    l.decide(ref, 'qa', 'reject');
    ref = dev(l, { doc: 'build-1' });
  }
  return { log: l, ref };
}

describe('replay, duplicates and conflicts cannot change a count', () => {
  const copy = (e: StoreEvent): StoreEvent => JSON.parse(JSON.stringify(e)) as StoreEvent;

  it('a second decision by the same consumer on a version is a replay error, and the counts stay', () => {
    const { log, ref } = rejectLoop(1);
    log.decide(ref, 'qa', 'reject');
    const before = JSON.stringify(reworkThreads(log.state, { qa: 2 }));
    const dup = copy(log.events[log.events.length - 1]);
    (dup as { seq: number }).seq = log.state.seq + 1;
    (dup as { op: string }).op = 'decide:qa:other-key';
    expect(() => applyEvent(log.state, dup)).toThrow(ReplayError);
    expect(JSON.stringify(reworkThreads(log.state, { qa: 2 }))).toBe(before);
  });

  it('the last event appended a second time is a replay error', () => {
    const { log } = rejectLoop(1);
    const dup = copy(log.events[log.events.length - 1]);
    (dup as { seq: number }).seq = log.state.seq + 1;
    expect(() => applyEvent(log.state, dup)).toThrow(ReplayError);
  });

  it('replaying the same events into a new state gives the same threads', () => {
    const { log } = rejectLoop(3);
    const again = new Log();
    for (const e of log.events) applyEvent(again.state, copy(e));
    expect(reworkThreads(again.state, { qa: 2 })).toEqual(reworkThreads(log.state, { qa: 2 }));
  });
});

describe('rework round: versions of a document that the consuming section rejected', () => {
  const caps = { qa: 2 };

  it('below the cap: the thread is listed with its count and is not exhausted', () => {
    const { log } = rejectLoop(1);
    const [t] = reworkThreads(log.state, caps);
    expect(t).toMatchObject({ doc: 'build-1', type: 'build', producer_section: 'development', consumer: 'qa', rounds: 1, cap: 2, exhausted: false, rejected_versions: [1] });
    expect(reworkStatus(log.state, caps)).toEqual([]);
  });

  it('at the cap: exhausted at the rejection that reached it', () => {
    const l = new Log();
    const v1 = dev(l);
    l.decide(v1, 'qa', 'reject');
    const v2 = dev(l, { doc: 'build-1' });
    l.decide(v2, 'qa', 'reject');
    const [t] = reworkStatus(l.state, caps);
    expect(t).toMatchObject({ rounds: 2, exhausted: true, rejected_versions: [1, 2] });
    expect(t.exhausted_seq).toBe(l.state.docs['build-1'].versions[1].decisions.qa.seq);
  });

  it('above the cap: still exhausted, exhausted_seq stays at the rejection that reached the cap', () => {
    const l = new Log();
    let ref = dev(l);
    for (let i = 0; i < 4; i += 1) {
      l.decide(ref, 'qa', 'reject');
      ref = dev(l, { doc: 'build-1' });
    }
    const [t] = reworkStatus(l.state, caps);
    expect(t.rounds).toBe(4);
    expect(t.exhausted_seq).toBe(l.state.docs['build-1'].versions[1].decisions.qa.seq);
  });

  it('an unset cap means no cap: no thread, nothing exhausted, however many rejections', () => {
    const { log } = rejectLoop(6);
    expect(reworkThreads(log.state, {})).toEqual([]);
    expect(reworkThreads(log.state, { qa: undefined })).toEqual([]);
    expect(reworkStatus(log.state, { development: 1 })).toEqual([]);
  });

  it('the cap that applies is the consuming section\'s: a cap on the producing section is not read', () => {
    const { log } = rejectLoop(5);
    expect(reworkStatus(log.state, { development: 1 })).toEqual([]);
    expect(reworkStatus(log.state, { qa: 5 })).toHaveLength(1);
  });

  it('accepts and rejects interleave: only rejected versions count', () => {
    const l = new Log();
    const v1 = dev(l);
    l.decide(v1, 'qa', 'reject');
    const v2 = dev(l, { doc: 'build-1' });
    l.decide(v2, 'qa', 'accept');
    expect(reworkThreads(l.state, caps)[0].rounds).toBe(1);
    expect(reworkStatus(l.state, caps)).toEqual([]);
  });

  it('the same version rejected by two consumers is one round for each, and only the consumer over its cap is exhausted', () => {
    const l = new Log();
    let ref = l.publish({ type: 'build', section: 'development', consumers: ['qa', 'security'] });
    l.decide(ref, 'qa', 'reject');
    l.decide(ref, 'security', 'reject');
    ref = l.publish({ type: 'build', section: 'development', consumers: ['qa', 'security'], doc: 'build-1' });
    l.decide(ref, 'qa', 'reject');
    const threads = reworkThreads(l.state, { qa: 2, security: 2 });
    expect(threads.map((t) => [t.consumer, t.rounds, t.exhausted])).toEqual([
      ['qa', 2, true],
      ['security', 1, false],
    ]);
    expect(reworkStatus(l.state, { qa: 2, security: 2 }).map((t) => t.consumer)).toEqual(['qa']);
  });

  it('documents are separate threads; exhausted ones come back in the order they were exhausted', () => {
    const l = new Log();
    const a = dev(l);
    const b = dev(l);
    l.decide(b, 'qa', 'reject');
    l.decide(a, 'qa', 'reject');
    const b2 = dev(l, { doc: 'build-2' });
    const a2 = dev(l, { doc: 'build-1' });
    l.decide(a2, 'qa', 'reject');
    l.decide(b2, 'qa', 'reject');
    expect(reworkStatus(l.state, caps).map((t) => t.doc)).toEqual(['build-1', 'build-2']);
    expect(reworkThreads(l.state, caps).map((t) => t.doc)).toEqual(['build-1', 'build-2']);
  });

  it('the count equals the rework counter the store derives, for every thread', () => {
    const { log } = rejectLoop(4);
    for (const t of reworkThreads(log.state, caps)) expect(t.rounds).toBe(log.state.docs[t.doc].rework[t.consumer]);
  });

  it('a document with no rejection has no thread', () => {
    const l = new Log();
    dev(l);
    expect(reworkThreads(l.state, caps)).toEqual([]);
  });
});

describe('capsFromDef: max_rework_rounds per consuming section', () => {
  it('reads positive integers and nothing else', () => {
    const sections = {
      a: { max_rework_rounds: 2 },
      b: { max_rework_rounds: 0 },
      c: { max_rework_rounds: 1.5 },
      d: { max_rework_rounds: '3' },
      e: {},
      f: null,
      g: { max_rework_rounds: 1 },
    };
    expect(capsFromDef({ sections })).toEqual({ a: 2, g: 1 });
    expect(capsFromDef({})).toEqual({});
    expect(capsFromDef({ sections: [] })).toEqual({});
  });
});

// Properties over random but valid histories (a seeded generator, so a failure names its seed): exhaustion is
// monotone and its point does not move; a thread's count equals the store's own `rework` counter.
const CAPS = { qa: 2, development: 3, security: 1 };
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random valid step: publish a new document, revise a head, or decide a pending head. */
function step(l: Log, r: () => number): void {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const docs = Object.values(l.state.docs);
  const roll = r();
  const pending = docs.filter((d) => {
    const v = d.versions[d.versions.length - 1];
    return v.consumers.some((c) => !v.decisions[c]);
  });
  if (roll < 0.3 || docs.length === 0) {
    const type = pick(['build', 'report', 'spec']);
    const section = type === 'build' ? 'development' : type === 'report' ? 'qa' : 'planning';
    const consumers = type === 'build' ? pick([['qa'], ['qa', 'security']]) : ['development'];
    l.publish({ type, section, consumers });
  } else if (roll < 0.6) {
    const d = pick(docs);
    const head = d.versions[d.versions.length - 1];
    l.publish({ type: d.type, section: d.section, consumers: head.consumers, doc: d.id });
  } else if (pending.length > 0) {
    const d = pick(pending);
    const v = d.versions[d.versions.length - 1];
    const c = pick(v.consumers.filter((x) => !v.decisions[x]));
    l.decide(`${d.id}@v${v.version}`, c, r() < 0.65 ? 'reject' : 'accept');
  }
}

const key = (t: ReworkThread): string => `${t.doc}|${t.consumer}`;

describe('rework threads over random histories', () => {
  it('exhaustion never reverts or moves, thread counts equal the store counter (300 histories of 60 steps)', () => {
    let exhaustedSeen = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = rng(seed);
      const l = new Log();
      let prev = new Map<string, ReworkThread>();
      for (let i = 0; i < 60; i += 1) {
        step(l, r);
        const ts = reworkThreads(l.state, CAPS);
        const ctx = `seed ${seed} step ${i}`;
        for (const [k, p] of prev) {
          const now = ts.find((t) => key(t) === k);
          expect(now, `${ctx}: thread ${k} lost`).toBeDefined();
          expect(now?.rounds).toBeGreaterThanOrEqual(p.rounds);
          if (p.exhausted) {
            expect(now?.exhausted).toBe(true);
            expect(now?.exhausted_seq, `${ctx}: exhaustion point of ${k} moved`).toBe(p.exhausted_seq);
          }
        }
        for (const t of ts) {
          expect(t.rounds, `${ctx}: ${key(t)} differs from the store counter`).toBe(l.state.docs[t.doc].rework[t.consumer]);
          expect(t.exhausted).toBe(t.rounds >= t.cap);
        }
        if (ts.some((t) => t.exhausted)) exhaustedSeen += 1;
        prev = new Map(ts.map((t) => [key(t), t]));
      }
    }
    // The generator must actually reach the interesting cases, or the properties above prove nothing.
    expect(exhaustedSeen).toBeGreaterThan(1000);
  });

  it('the answer does not depend on the order object keys happen to be stored in', () => {
    const r = rng(77);
    const l = new Log();
    for (let i = 0; i < 80; i += 1) step(l, r);
    const reversed = { ...l.state, docs: Object.fromEntries(Object.entries(l.state.docs).reverse()) };
    expect(reworkThreads(reversed, CAPS)).toEqual(reworkThreads(l.state, CAPS));
  });
});
