// packages/@monomind/cli/__tests__/orgrt/documents/loops-rounds.test.ts
// P4.3 (spec 6.5, 6.15, open item 27): THE ROUND RULES, stated in the test names so the owner can read them
// before anything is wired. Plan choices where the spec is silent, each pinned below:
//   - an unset max_rework_rounds means no cap;
//   - a rework round is one version of a document that the consuming section rejected; exhausted at the cap;
//   - a loop round is one return of the cycle to the section that published the lineage's first document,
//     counted over `inputs` and `supersedes`; exhausted when rounds reach max_rounds.
// States are built through the real reducer (support/loop-log.ts), so each one is a state the store could commit.
import { describe, expect, it } from 'vitest';
import { capsFromDef, lineageRounds, reworkStatus, reworkThreads } from '../../../src/orgrt/documents/loops.js';
import type { LoopSpec } from '../../../src/orgrt/documents/loops.js';
import { ReplayError, applyEvent } from '../../../src/orgrt/documents/state.js';
import type { StoreEvent } from '../../../src/orgrt/documents/store-types.js';
import { Log } from '../support/loop-log.js';

const LOOP: LoopSpec = { index: 0, between: ['development', 'qa'], types: ['build', 'report'], max_rounds: 3 };
const dev = (l: Log, o: { doc?: string; inputs?: string[] } = {}) =>
  l.publish({ type: 'build', section: 'development', consumers: ['qa'], ...o });
const qa = (l: Log, o: { doc?: string; inputs?: string[] } = {}) =>
  l.publish({ type: 'report', section: 'qa', consumers: ['development'], ...o });
const rounds = (l: Log, loop: LoopSpec = LOOP, withInputs = true) =>
  lineageRounds(l.state, loop, withInputs ? l.inputsOf : undefined);

/** A rejected build is republished `n` times (n returns of the cycle to development). */
function rejectLoop(n: number): { log: Log; ref: string } {
  const l = new Log();
  let ref = dev(l);
  for (let i = 0; i < n; i += 1) {
    l.decide(ref, 'qa', 'reject');
    ref = dev(l, { doc: 'build-1' });
  }
  return { log: l, ref };
}

describe('loop round: one return of the cycle to the section that published the first document', () => {
  it('no loop-type document: no lineage', () => {
    expect(rounds(new Log())).toEqual([]);
  });

  it('a first document is round 0, origin is its section, nothing is exhausted', () => {
    const l = new Log();
    dev(l);
    const [x] = rounds(l);
    expect(x).toMatchObject({ loop: 0, origin: 'development', first: 'build-1@v1', rounds: 0, max_rounds: 3, exhausted: false, settled: false });
    expect(x.versions).toEqual(['build-1@v1']);
    expect(x.escalate).toEqual({ to: 'root', copy_leads_of: ['development', 'qa'] });
  });

  it('a republish after a rejection by the other section of the loop is a return: rounds 1, then 2', () => {
    expect(rounds(rejectLoop(1).log)[0].rounds).toBe(1);
    expect(rounds(rejectLoop(2).log)[0].rounds).toBe(2);
  });

  it('a republish with no rejection (revising a pending version) is not a return', () => {
    const l = new Log();
    dev(l);
    dev(l, { doc: 'build-1' });
    expect(rounds(l)[0].rounds).toBe(0);
  });

  it('the cap is reached at max_rounds returns: below, at and above', () => {
    const below = rounds(rejectLoop(2).log)[0];
    expect([below.rounds, below.exhausted, below.exhausted_seq]).toEqual([2, false, undefined]);
    const at = rounds(rejectLoop(3).log)[0];
    expect([at.rounds, at.exhausted]).toEqual([3, true]);
    const above = rounds(rejectLoop(5).log)[0];
    expect([above.rounds, above.exhausted]).toEqual([5, true]);
  });

  it('exhausted_seq is the commit sequence of the return that reached the cap, and does not move afterwards', () => {
    const { log, ref } = rejectLoop(3);
    const at = rounds(log)[0];
    expect(at.exhausted_seq).toBe(log.state.docs['build-1'].versions[3].seq);
    log.decide(ref, 'qa', 'reject');
    dev(log, { doc: 'build-1' });
    expect(rounds(log)[0].exhausted_seq).toBe(at.exhausted_seq);
  });

  it('a ping-pong over inputs: development build, qa report on it, development revises on the report: one return per revision', () => {
    const l = new Log();
    const b1 = dev(l);
    const r1 = qa(l, { inputs: [b1] });
    const b2 = dev(l, { doc: 'build-1', inputs: [r1] });
    const r2 = qa(l, { doc: undefined, inputs: [b2] });
    const b3 = dev(l, { doc: 'build-1', inputs: [r2] });
    const [x, ...rest] = rounds(l);
    expect(rest).toEqual([]);
    expect(x.rounds).toBe(2);
    expect(x.versions).toEqual([b1, r1, b2, r2, b3]);
  });

  it('a version that both supersedes a rejected one and takes the other side\'s report as input counts once', () => {
    const l = new Log();
    const b1 = dev(l);
    const r1 = qa(l, { inputs: [b1] });
    l.decide(b1, 'qa', 'reject');
    dev(l, { doc: 'build-1', inputs: [r1] });
    expect(rounds(l)[0].rounds).toBe(1);
  });

  it('the other section publishing on a feedback input is not a return to the origin', () => {
    const l = new Log();
    const b1 = dev(l);
    const r1 = qa(l, { inputs: [b1] });
    qa(l, { doc: 'report-1', inputs: [b1] });
    expect(r1).toBe('report-1@v1');
    expect(rounds(l)[0].rounds).toBe(0);
  });

  it('a lineage whose first document is the qa one has qa as origin: returns are counted at qa', () => {
    const l = new Log();
    const r1 = qa(l);
    const b1 = dev(l, { inputs: [r1] });
    qa(l, { doc: 'report-1', inputs: [b1] });
    const [x] = rounds(l);
    expect(x.origin).toBe('qa');
    expect(x.rounds).toBe(1);
  });

  it('without the inputs lookup only supersedes links are seen: a feedback-only loop shows 0 rounds, a reject loop is unchanged', () => {
    const l = new Log();
    const b1 = dev(l);
    const r1 = qa(l, { inputs: [b1] });
    dev(l, { doc: 'build-1', inputs: [r1] });
    expect(rounds(l, LOOP, true)[0].rounds).toBe(1);
    expect(rounds(l, LOOP, false).map((x) => x.rounds)).toEqual([0, 0]);
    expect(rounds(rejectLoop(2).log, LOOP, false)[0].rounds).toBe(2);
  });

  it('a rejection by a section outside the loop does not make a republish a return', () => {
    const l = new Log();
    const b1 = l.publish({ type: 'build', section: 'development', consumers: ['qa', 'audit'] });
    l.decide(b1, 'audit', 'reject');
    l.publish({ type: 'build', section: 'development', consumers: ['qa', 'audit'], doc: 'build-1' });
    expect(rounds(l)[0].rounds).toBe(0);
  });

  it('types outside the loop are not part of the lineage, even when an input names them', () => {
    const l = new Log();
    const spec = l.publish({ type: 'spec', section: 'planning', consumers: ['development'] });
    const b1 = dev(l, { inputs: [spec] });
    l.decide(b1, 'qa', 'reject');
    dev(l, { doc: 'build-1', inputs: [spec] });
    const lineages = rounds(l);
    expect(lineages).toHaveLength(1);
    expect(lineages[0].versions).toEqual(['build-1@v1', 'build-1@v2']);
    expect(lineages[0].rounds).toBe(1);
  });

  it('an input naming a version that does not exist, or a later one, or itself, is ignored', () => {
    const l = new Log();
    const b1 = dev(l, { inputs: ['build-9@v1', 'build-1@v1'] });
    l.decide(b1, 'qa', 'reject');
    dev(l, { doc: 'build-1', inputs: ['build-1@v5', 'build-1@v2'] });
    expect(rounds(l)[0].rounds).toBe(1);
  });
});

describe('lineages: a supersedes chain and inputs references define one lineage; others stay apart', () => {
  it('two unrelated documents are two lineages with their own rounds', () => {
    const l = new Log();
    const a = dev(l);
    const b = dev(l);
    l.decide(a, 'qa', 'reject');
    dev(l, { doc: 'build-1' });
    expect(a).toBe('build-1@v1');
    expect(b).toBe('build-2@v1');
    expect(rounds(l).map((x) => [x.first, x.rounds])).toEqual([
      ['build-1@v1', 1],
      ['build-2@v1', 0],
    ]);
  });

  it('a document that takes another lineage\'s report as input joins it', () => {
    const l = new Log();
    const b1 = dev(l);
    const r1 = qa(l, { inputs: [b1] });
    dev(l, { inputs: [r1] }); // build-2, a new document, derived from the report on build-1
    const lineages = rounds(l);
    expect(lineages).toHaveLength(1);
    expect(lineages[0].versions).toEqual(['build-1@v1', 'report-1@v1', 'build-2@v1']);
    expect(lineages[0].rounds).toBe(1);
  });

  it('lineages that merge keep the larger round count (counts never fall) and then count the merging return', () => {
    const l = new Log();
    // lineage A: two returns.
    let a = dev(l);
    for (let i = 0; i < 2; i += 1) {
      l.decide(a, 'qa', 'reject');
      a = dev(l, { doc: 'build-1' });
    }
    const ra = qa(l, { inputs: [a] });
    // lineage B: a fresh build and report, 0 returns.
    const b = dev(l);
    const rb = qa(l, { inputs: [b] });
    expect([rounds(l).length, rounds(l).map((x) => x.rounds)]).toEqual([2, [2, 0]]);
    // development publishes a build that takes both reports as input.
    dev(l, { inputs: [ra, rb] });
    const lineages = rounds(l);
    expect(lineages).toHaveLength(1);
    expect(lineages[0].rounds).toBe(3);
    expect(lineages[0].origin).toBe('development');
    expect(lineages[0].exhausted).toBe(true);
  });

  it('merging an exhausted lineage into a fresh one leaves the result exhausted', () => {
    const { log } = rejectLoop(3);
    const fresh = dev(log);
    const r = qa(log, { inputs: [fresh] });
    const old = log.state.docs['build-1'].versions.length;
    const r0 = qa(log, { inputs: [`build-1@v${old}`] });
    dev(log, { inputs: [r, r0] });
    const lineages = rounds(log);
    expect(lineages).toHaveLength(1);
    expect(lineages[0].exhausted).toBe(true);
    expect(lineages[0].rounds).toBeGreaterThanOrEqual(3);
  });

  it('lineages are ordered by the commit of their first version', () => {
    const l = new Log();
    qa(l);
    dev(l);
    expect(rounds(l).map((x) => x.first)).toEqual(['report-1@v1', 'build-1@v1']);
  });
});

describe('settled: every document head in the lineage is accepted', () => {
  it('the last accepted outcome ends the loop cleanly, even at the cap', () => {
    const { log, ref } = rejectLoop(3);
    expect(rounds(log)[0]).toMatchObject({ exhausted: true, settled: false });
    log.decide(ref, 'qa', 'accept');
    expect(rounds(log)[0]).toMatchObject({ exhausted: true, settled: true });
  });

  it('a rejected head is not settled, and neither is a pending one', () => {
    const { log, ref } = rejectLoop(1);
    expect(rounds(log)[0].settled).toBe(false);
    log.decide(ref, 'qa', 'reject');
    expect(rounds(log)[0].settled).toBe(false);
  });

  it('one accepted document and one pending one in the lineage is not settled', () => {
    const l = new Log();
    const b1 = dev(l);
    l.decide(b1, 'qa', 'accept');
    qa(l, { inputs: [b1] });
    expect(rounds(l)[0].settled).toBe(false);
  });
});

describe('replay, duplicates and conflicts cannot change a count', () => {
  const copy = (e: StoreEvent): StoreEvent => JSON.parse(JSON.stringify(e)) as StoreEvent;

  it('a second decision by the same consumer on a version is a replay error, and the counts stay', () => {
    const { log, ref } = rejectLoop(1);
    log.decide(ref, 'qa', 'reject');
    const before = JSON.stringify([rounds(log), reworkThreads(log.state, { qa: 2 })]);
    const dup = copy(log.events[log.events.length - 1]);
    (dup as { seq: number }).seq = log.state.seq + 1;
    (dup as { op: string }).op = 'decide:qa:other-key';
    expect(() => applyEvent(log.state, dup)).toThrow(ReplayError);
    expect(JSON.stringify([rounds(log), reworkThreads(log.state, { qa: 2 })])).toBe(before);
  });

  it('the last event appended a second time is a replay error', () => {
    const { log } = rejectLoop(1);
    const dup = copy(log.events[log.events.length - 1]);
    (dup as { seq: number }).seq = log.state.seq + 1;
    expect(() => applyEvent(log.state, dup)).toThrow(ReplayError);
  });

  it('a supersede of a version that is not the head is a replay error and changes nothing (the store answers SUPERSEDES_CONFLICT)', () => {
    const { log } = rejectLoop(2);
    const before = JSON.stringify(rounds(log));
    const stale = copy(log.events.find((e) => e.type === 'published' && e.version === 2) as StoreEvent);
    (stale as { seq: number }).seq = log.state.seq + 1;
    (stale as { version: number }).version = 3;
    (stale as { supersedes: number }).supersedes = 1;
    (stale as { op: string }).op = 'publish:p:stale';
    expect(() => applyEvent(log.state, stale)).toThrow(ReplayError);
    expect(JSON.stringify(rounds(log))).toBe(before);
  });

  it('replaying the same events into a new state gives the same lineages and threads', () => {
    const { log } = rejectLoop(3);
    const again = new Log();
    for (const e of log.events) applyEvent(again.state, copy(e));
    expect(lineageRounds(again.state, LOOP, log.inputsOf)).toEqual(rounds(log));
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
