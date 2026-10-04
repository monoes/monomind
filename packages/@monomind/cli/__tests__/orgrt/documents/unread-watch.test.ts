// P3.13: the pure decision of the unread-document watch (spec 6.2 (f)). Table tests on UnreadWatch.tick with
// injected clocks: no daemon, no timers.
import { describe, expect, it } from 'vitest';
import { MAX_NOTICES } from '../../../src/orgrt/lead-watch.js';
import {
  DEFAULT_UNREAD_S,
  type UnreadDecider,
  type UnreadVersion,
  UnreadWatch,
  unreadIntervalMs,
} from '../../../src/orgrt/documents/unread-watch.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';

const I = 120_000;
const decider = (over: Partial<UnreadDecider> = {}): UnreadDecider => ({
  role: 'dev-lead',
  lead: 'boss',
  notice: 'delivered',
  failures: 0,
  since: 0,
  done: false,
  ...over,
});
const version = (over: Partial<UnreadVersion> = {}): UnreadVersion => ({
  doc: 'findings-1',
  version: 1,
  type: 'findings',
  producer: 'researcher',
  open: true,
  deciders: [decider()],
  ...over,
});

describe('UnreadWatch: delivered, not read (b)', () => {
  it('fires once at the interval, naming document, version, producer, unread consumers, age and options', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version()], I - 1, false)).toEqual([]);
    const [n] = w.tick([version()], I + 5_000, false);
    expect(n).toMatchObject({
      key: 'findings-1@v1>boss',
      lead: 'boss',
      doc: 'findings-1',
      version: 1,
      producer: 'researcher',
      unread: ['dev-lead'],
      cause: 'not-read',
      n: 1,
    });
    expect(n.text).toBe(
      '[watch] Document "findings-1" v1 (findings, published by researcher) has gone unread for 2m: dev-lead (told, no org_doc_read). ' +
        'Options: (1) wait; (2) nudge it: org_send to "dev-lead" (the root may message any role; a role in another section cannot); ' +
        '(3) take over: reassign the review of this document to another role, or have the root read it. ' +
        'If nothing changes you get one more reminder after a longer gap.',
    );
    expect(w.tick([version()], I + 6_000, false)).toEqual([]); // once per episode
  });

  it('backs off by doubling and stops at the cap, the last notice says so', () => {
    const w = new UnreadWatch(I);
    const v = [version()];
    expect(w.tick(v, I, false)).toHaveLength(1);
    expect(w.tick(v, I + 2 * I - 1, false)).toEqual([]);
    expect(w.tick(v, I + 2 * I, false)).toHaveLength(1);
    expect(w.tick(v, I + 2 * I + 4 * I - 1, false)).toEqual([]);
    const [last] = w.tick(v, I + 2 * I + 4 * I, false);
    expect(last.n).toBe(MAX_NOTICES);
    expect(last.text).toContain('This is the last notice for this episode.');
    expect(w.tick(v, 1e12, false)).toEqual([]);
  });

  it('a read ends it, and a later version is a new episode', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version()], I, false)).toHaveLength(1);
    expect(w.tick([version({ deciders: [decider({ done: true })] })], 10 * I, false)).toEqual([]);
    expect(w.tick([version({ version: 2, deciders: [decider({ since: 10 * I })] })], 11 * I, false)).toHaveLength(1);
  });

  it('a decision or a superseding version (the version is no longer pending) ends it', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version()], I, false)).toHaveLength(1);
    expect(w.tick([version({ open: false })], 9 * I, false)).toEqual([]);
  });

  it('never for a version that was decided or superseded before the interval ran out', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version({ open: false })], 1e12, false)).toEqual([]);
  });

  it('a human wait (gate, approval, blocking question) suppresses it without spending the episode', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version()], 5 * I, true)).toEqual([]);
    expect(w.tick([version()], 5 * I + 1, false)).toHaveLength(1);
  });

  it('the clock of a delivered notice runs from the later of publish and delivery', () => {
    const w = new UnreadWatch(I);
    const v = version({ deciders: [decider({ since: 60_000 })] }); // published 0, delivered at 60 s
    expect(w.tick([v], I + 59_000, false)).toEqual([]);
    expect(w.tick([v], I + 60_000, false)).toHaveLength(1);
  });

  it('a decider without a running lead sends nothing and spends nothing', () => {
    const w = new UnreadWatch(I);
    const lone = version({ deciders: [decider({ lead: undefined })] });
    expect(w.tick([lone], 5 * I, false)).toEqual([]);
    expect(w.tick([version()], 5 * I, false)).toHaveLength(1);
  });
});

describe('UnreadWatch: notice not delivered (a), spec 6.2 (f): silent while a notice is pending', () => {
  it('a pending notice (undelivered, or failing and still being retried) is silent at any age', () => {
    const w = new UnreadWatch(I);
    const fresh = version({ deciders: [decider({ notice: 'pending' })] });
    const retrying = version({ doc: 'findings-2', deciders: [decider({ notice: 'pending', failures: 4 })] });
    expect(w.tick([fresh, retrying], I, false)).toEqual([]);
    expect(w.tick([fresh, retrying], 50 * I, false)).toEqual([]);
  });

  it('a pending notice spends no episode: delivery later starts the clock from the delivery', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version({ deciders: [decider({ notice: 'pending' })] })], 9 * I, false)).toEqual([]);
    const delivered = version({ deciders: [decider({ since: 9 * I })] });
    expect(w.tick([delivered], 9 * I + I - 1, false)).toEqual([]);
    const [n] = w.tick([delivered], 10 * I, false);
    expect(n).toMatchObject({ cause: 'not-read', n: 1 });
  });

  it('a notice the runtime gave up delivering is no longer pending: it is surfaced, as its own cause', () => {
    const w = new UnreadWatch(I);
    const v = version({ deciders: [decider({ notice: 'exhausted', failures: 5 })] });
    const [n] = w.tick([v], I, false);
    expect(n.cause).toBe('notice-gave-up');
    expect(n.text).toContain('dev-lead (the runtime gave up delivering its notice after 5 failed attempts)');
    expect(w.tick([v], I + 1, false)).toEqual([]); // once per episode, the same backoff
  });

  it('a notice that was pending and then given up surfaces at the interval from publication', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version({ deciders: [decider({ notice: 'pending', failures: 4 })] })], 2 * I, false)).toEqual([]);
    const [n] = w.tick([version({ deciders: [decider({ notice: 'exhausted', failures: 5 })] })], 2 * I + 1, false);
    expect(n.cause).toBe('notice-gave-up');
  });

  it('beside a pending notice, only the consumers that were told and did not read (or whose notice was given up) are named', () => {
    const w = new UnreadWatch(I);
    const v = version({
      deciders: [
        decider({ role: 'dev-lead', notice: 'pending' }),
        decider({ role: 'qa-lead' }),
        decider({ role: 'ops-lead', notice: 'exhausted', failures: 5 }),
      ],
    });
    const [n] = w.tick([v], I, false);
    expect(n.unread).toEqual(['qa-lead', 'ops-lead']);
    expect(n.cause).toBe('notice-gave-up');
    expect(n.text).not.toContain('dev-lead');
  });

  it('a read ends it even though the notice never arrived', () => {
    const w = new UnreadWatch(I);
    expect(w.tick([version({ deciders: [decider({ notice: 'pending', done: true })] })], 9 * I, false)).toEqual([]);
  });
});

describe('UnreadWatch: several consumers, several leads', () => {
  it('one notice per version and lead, listing only the consumers that have not read', () => {
    const w = new UnreadWatch(I);
    const v = version({
      deciders: [
        decider({ role: 'dev-lead', lead: 'boss' }),
        decider({ role: 'qa-lead', lead: 'boss', done: true }),
        decider({ role: 'ops-lead', lead: 'cto' }),
      ],
    });
    const out = w.tick([v], I, false);
    expect(out.map((n) => [n.lead, n.unread])).toEqual([
      ['boss', ['dev-lead']],
      ['cto', ['ops-lead']],
    ]);
    expect(w.tick([v], I + 1, false)).toEqual([]);
  });

  it('two consumers under one lead share one notice; one reading narrows the list on the next', () => {
    const w = new UnreadWatch(I);
    const both = version({ deciders: [decider({ role: 'dev-lead' }), decider({ role: 'qa-lead' })] });
    const [n] = w.tick([both], I, false);
    expect(n.unread).toEqual(['dev-lead', 'qa-lead']);
    const one = version({ deciders: [decider({ role: 'dev-lead', done: true }), decider({ role: 'qa-lead' })] });
    const [again] = w.tick([one], 4 * I, false);
    expect(again.unread).toEqual(['qa-lead']);
    expect(again.n).toBe(2);
  });

  it('versions are independent episodes', () => {
    const w = new UnreadWatch(I);
    const out = w.tick([version(), version({ doc: 'findings-2' })], I, false);
    expect(out.map((n) => n.doc)).toEqual(['findings-1', 'findings-2']);
  });
});

describe('interval and resume', () => {
  it('fractional seconds work (tests use them) and the default is 120 s', () => {
    const w = new UnreadWatch(300);
    expect(w.tick([version()], 299, false)).toEqual([]);
    expect(w.tick([version()], 300, false)).toHaveLength(1);
    expect(unreadIntervalMs({})).toBe(DEFAULT_UNREAD_S * 1000);
    expect(DEFAULT_UNREAD_S).toBe(120);
    expect(unreadIntervalMs({ lead_watch: {} })).toBe(120_000);
    expect(unreadIntervalMs({ lead_watch: { unread_s: 0.3 } })).toBe(300);
    expect(unreadIntervalMs({ lead_watch: false })).toBeNull();
  });

  it('a seeded episode (the bus history of a resumed run) keeps its count, so the cap holds across a resume', () => {
    const w = new UnreadWatch(I);
    w.seed('findings-1@v1>boss', MAX_NOTICES, 1_000);
    expect(w.tick([version()], 1e12, false)).toEqual([]);
    const two = new UnreadWatch(I);
    two.seed('findings-1@v1>boss', 2, 1_000);
    expect(two.tick([version()], 1_000 + 4 * I - 1, false)).toEqual([]); // the gap since the last notice still holds
    expect(two.tick([version()], 1_000 + 4 * I, false)).toMatchObject([{ n: 3 }]);
  });
});

describe('the lead_watch.unread_s key', () => {
  const base = { name: 'o', goal: 'g', roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }] };
  const parse = (lead_watch: unknown) => OrgDefSchema.safeParse({ ...base, run_config: { lead_watch } });

  it('accepts a positive number (fractions too), no default is added', () => {
    expect(parse({ unread_s: 0.5 }).success).toBe(true);
    const plain = OrgDefSchema.parse({ ...base, run_config: { lead_watch: { silent_s: 60 } } });
    expect(plain.run_config.lead_watch).toEqual({ silent_s: 60 });
  });

  it('refuses zero, negative and non-numbers', () => {
    for (const bad of [0, -1, '120', null]) expect(parse({ unread_s: bad }).success).toBe(false);
  });
});
