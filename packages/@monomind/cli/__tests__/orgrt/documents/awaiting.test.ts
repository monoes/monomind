// P3.16c (parity-trial finding 4): lead-watch's "silent with open work" must not fire for a consumer that is
// correctly waiting for documents. The pure rule (documents/awaiting.ts) over a facts table, the hook in the
// pure LeadWatch.tick, and the legacy behaviour (no documents: the snapshot has no such field) unchanged.
import { describe, expect, it } from 'vitest';
import { type AwaitFacts, type AwaitHead, awaitingDocuments } from '../../../src/orgrt/documents/awaiting.js';
import { LeadWatch, type RoleSnapshot } from '../../../src/orgrt/lead-watch.js';

const head = (over: Partial<AwaitHead> = {}): AwaitHead => ({
  doc: 'findings-1',
  type: 'findings',
  version: 1,
  status: 'pending',
  decided: [],
  read: [],
  ...over,
});
const facts = (heads: AwaitHead[], types = [{ type: 'findings', deciders: ['dev-lead'] }]): AwaitFacts => ({ types, heads });

describe('awaitingDocuments: a consumer whose only open work is waiting for documents', () => {
  it('no document of a type it decides exists yet: waiting', () => {
    expect(awaitingDocuments('dev-lead', facts([]))).toBe(true);
  });

  it('a role that decides nothing is never waiting (producers, members, the root)', () => {
    for (const r of ['researcher', 'coder', 'boss']) expect(awaitingDocuments(r, facts([]))).toBe(false);
  });

  it('some of several types it decides have no document yet: waiting, even when others were decided', () => {
    const types = [
      { type: 'a', deciders: ['syn'] },
      { type: 'b', deciders: ['syn'] },
    ];
    const a = head({ doc: 'a-1', type: 'a', status: 'accepted', decided: ['syn'], read: ['syn'] });
    expect(awaitingDocuments('syn', facts([a], types))).toBe(true);
  });

  it('a published version it was told of and has not read: waiting (the notice is pending or delivered; the unread-watch covers it)', () => {
    expect(awaitingDocuments('dev-lead', facts([head()]))).toBe(true);
  });

  it('a pending version it has read and not decided is work in hand: not waiting, so silence is flagged', () => {
    expect(awaitingDocuments('dev-lead', facts([head({ read: ['dev-lead'] })]))).toBe(false);
    // even while another type is still to come
    const types = [
      { type: 'findings', deciders: ['dev-lead'] },
      { type: 'plan', deciders: ['dev-lead'] },
    ];
    expect(awaitingDocuments('dev-lead', facts([head({ read: ['dev-lead'] })], types))).toBe(false);
  });

  it('every needed type exists and every head is settled: nothing left to wait for', () => {
    expect(awaitingDocuments('dev-lead', facts([head({ status: 'accepted', decided: ['dev-lead'], read: ['dev-lead'] })]))).toBe(false);
  });

  it('it rejected the head and the producer has not republished: waiting for the revision', () => {
    expect(awaitingDocuments('dev-lead', facts([head({ status: 'rejected', decided: ['dev-lead'], read: ['dev-lead'] })]))).toBe(true);
  });

  it('a version another decider decided does not make it work in hand for this one', () => {
    const types = [{ type: 'findings', deciders: ['dev-lead', 'qa-lead'] }];
    const h = head({ decided: ['qa-lead'], read: ['qa-lead'] });
    expect(awaitingDocuments('dev-lead', facts([h], types))).toBe(true); // unread by dev-lead: still waiting for its turn
    expect(awaitingDocuments('qa-lead', facts([h], types))).toBe(false); // decided its part; pending on dev-lead, nothing waits for qa-lead
  });
});

const CFG = { notStartedMs: 90_000, silentMs: 180_000 };
const role = (over: Partial<RoleSnapshot> = {}): RoleSnapshot => ({
  id: 'dev-lead',
  lead: 'boss',
  started: true,
  lastActivity: 1_000,
  waiting: false,
  openTasks: [],
  ...over,
});
const briefed = (w: LeadWatch): void => w.messageAssigned('dev-lead', { id: 'm1', title: 'Wait for the documents', since: 0 });

describe('LeadWatch.tick: the awaitingDocuments hook', () => {
  it('a started role waiting for documents is not reported silent, however long', () => {
    const w = new LeadWatch(CFG);
    briefed(w);
    expect(w.tick([role({ awaitingDocuments: true })], 10_000_000)).toEqual([]);
  });

  it('the same role not waiting is reported silent, as before (legacy snapshot: no field at all)', () => {
    for (const snap of [role(), role({ awaitingDocuments: false })]) {
      const w = new LeadWatch(CFG);
      briefed(w);
      const [n] = w.tick([snap], 182_000);
      expect(n).toMatchObject({ kind: 'silent', role: 'dev-lead', lead: 'boss' });
    }
  });

  it('it stops being suppressed the moment the role has work in hand: the clock then runs from its last event', () => {
    const w = new LeadWatch(CFG);
    briefed(w);
    expect(w.tick([role({ awaitingDocuments: true, lastActivity: 5_000_000 })], 5_100_000)).toEqual([]);
    expect(w.tick([role({ awaitingDocuments: false, lastActivity: 5_000_000 })], 5_100_000)).toEqual([]); // 100 s of silence: not yet
    expect(w.tick([role({ awaitingDocuments: false, lastActivity: 5_000_000 })], 5_181_000)).toHaveLength(1);
  });

  it('a role that never started is still reported: waiting for documents is no excuse for not starting', () => {
    const w = new LeadWatch(CFG);
    briefed(w);
    const [n] = w.tick([role({ started: false, lastActivity: 0, awaitingDocuments: true })], 91_000);
    expect(n.kind).toBe('not-started');
  });
});
