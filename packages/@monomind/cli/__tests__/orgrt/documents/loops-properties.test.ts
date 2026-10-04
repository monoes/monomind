// packages/@monomind/cli/__tests__/orgrt/documents/loops-properties.test.ts
// P4.3: properties of the round rules over random but valid histories (a seeded generator, so a failure
// names its seed). Every history goes through the real reducer, so each prefix is a state the store could hold.
//   - rounds never decrease along a lineage, also when lineages merge;
//   - exhaustion is monotone: once a lineage or a rework thread is exhausted, no later event un-exhausts it;
//   - a rework thread's exhaustion point does not move once set;
//   - a rework thread's count always equals the store's own `rework` counter;
//   - every loop-type version is in exactly one lineage;
//   - the result is a function of the events: a replay gives the same answer.
import { describe, expect, it } from 'vitest';
import { lineageRounds, reworkThreads } from '../../../src/orgrt/documents/loops.js';
import type { LoopLineage, ReworkThread } from '../../../src/orgrt/documents/loops.js';
import type { LoopSpec } from '../../../src/orgrt/documents/loops.js';
import { applyEvent } from '../../../src/orgrt/documents/state.js';
import { Log } from '../support/loop-log.js';

const LOOP: LoopSpec = { index: 0, between: ['development', 'qa'], types: ['build', 'report'], max_rounds: 3 };
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
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const docs = Object.values(l.state.docs);
  const refs = docs.flatMap((d) => d.versions.map((v) => `${d.id}@v${v.version}`));
  const inputs = (): string[] | undefined =>
    refs.length > 0 && r() < 0.6 ? Array.from({ length: 1 + Math.floor(r() * 2) }, () => pick(refs)) : undefined;
  const roll = r();
  const pending = docs.filter((d) => {
    const v = d.versions[d.versions.length - 1];
    return v.consumers.some((c) => !v.decisions[c]);
  });
  if (roll < 0.3 || docs.length === 0) {
    const type = pick(['build', 'report', 'spec']);
    const section = type === 'build' ? 'development' : type === 'report' ? 'qa' : 'planning';
    const consumers = type === 'build' ? pick([['qa'], ['qa', 'security']]) : type === 'report' ? ['development'] : ['development'];
    l.publish({ type, section, consumers, inputs: inputs() });
  } else if (roll < 0.6) {
    const d = pick(docs);
    const head = d.versions[d.versions.length - 1];
    l.publish({ type: d.type, section: d.section, consumers: head.consumers, doc: d.id, inputs: inputs() });
  } else if (pending.length > 0) {
    const d = pick(pending);
    const v = d.versions[d.versions.length - 1];
    const c = pick(v.consumers.filter((x) => !v.decisions[x]));
    l.decide(`${d.id}@v${v.version}`, c, r() < 0.65 ? 'reject' : 'accept');
  }
}

const lineageOf = (ls: LoopLineage[], ref: string): LoopLineage | undefined => ls.find((x) => x.versions.includes(ref));
const key = (t: ReworkThread): string => `${t.doc}|${t.consumer}`;

describe('round rules over random histories', () => {
  it('rounds never decrease, exhaustion never reverts, thread counts equal the store counter (300 histories of 60 steps)', () => {
    let exhaustedSeen = 0;
    let mergedSeen = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = rng(seed);
      const l = new Log();
      let prevL: LoopLineage[] = [];
      let prevT = new Map<string, ReworkThread>();
      for (let i = 0; i < 60; i += 1) {
        step(l, r);
        const ls = lineageRounds(l.state, LOOP, l.inputsOf);
        const ts = reworkThreads(l.state, CAPS);
        const ctx = `seed ${seed} step ${i}`;
        for (const p of prevL) {
          const now = lineageOf(ls, p.versions[0]);
          expect(now, `${ctx}: lineage of ${p.first} lost`).toBeDefined();
          expect(now?.rounds, `${ctx}: rounds fell for ${p.first}`).toBeGreaterThanOrEqual(p.rounds);
          if (p.exhausted) expect(now?.exhausted, `${ctx}: ${p.first} un-exhausted`).toBe(true);
          for (const v of p.versions) expect(now?.versions, `${ctx}: ${v} left its lineage`).toContain(v);
          if (now && now.versions.length > p.versions.length && ls.length < prevL.length) mergedSeen += 1;
        }
        const seen = ls.flatMap((x) => x.versions);
        expect(new Set(seen).size, `${ctx}: a version is in two lineages`).toBe(seen.length);
        const loopVersions = Object.values(l.state.docs)
          .filter((d) => LOOP.types.includes(d.type))
          .reduce((n, d) => n + d.versions.length, 0);
        expect(seen.length, `${ctx}: a loop version is in no lineage`).toBe(loopVersions);
        for (const x of ls) expect(x.exhausted).toBe(x.rounds >= x.max_rounds);
        for (const [k, p] of prevT) {
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
        if (ls.some((x) => x.exhausted) || ts.some((t) => t.exhausted)) exhaustedSeen += 1;
        prevL = ls;
        prevT = new Map(ts.map((t) => [key(t), t]));
      }
    }
    // The generator must actually reach the interesting cases, or the properties above prove nothing.
    expect(exhaustedSeen).toBeGreaterThan(1000);
    expect(mergedSeen).toBeGreaterThan(20);
  });

  it('a replay of the events gives the same answer (the rules are a function of the events)', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const r = rng(1000 + seed);
      const l = new Log();
      for (let i = 0; i < 50; i += 1) step(l, r);
      const again = new Log();
      for (const e of l.events) applyEvent(again.state, JSON.parse(JSON.stringify(e)));
      expect(lineageRounds(again.state, LOOP, l.inputsOf), `seed ${1000 + seed}`).toEqual(lineageRounds(l.state, LOOP, l.inputsOf));
      expect(reworkThreads(again.state, CAPS)).toEqual(reworkThreads(l.state, CAPS));
    }
  });

  it('the answer does not depend on the order object keys happen to be stored in', () => {
    const r = rng(77);
    const l = new Log();
    for (let i = 0; i < 80; i += 1) step(l, r);
    const reversed = { ...l.state, docs: Object.fromEntries(Object.entries(l.state.docs).reverse()) };
    expect(lineageRounds(reversed, LOOP, l.inputsOf)).toEqual(lineageRounds(l.state, LOOP, l.inputsOf));
    expect(reworkThreads(reversed, CAPS)).toEqual(reworkThreads(l.state, CAPS));
  });
});
