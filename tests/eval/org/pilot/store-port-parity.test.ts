// P3.5 parity: the runtime document store (packages/@monomind/cli/src/orgrt/documents/store.ts) against the
// harness HandoffStore that was measured (store.ts here), on the flows the sweeps ran: publish, read, reject,
// republish, accept, and per-consumer acceptance, over the committed parallel-sweep-3 contracts. Each scenario
// drives both stores step by step and compares what a role can observe (ok, version, status, waiting_on, the
// content a reader gets). Where the spec intentionally differs from the prototype (13.1.2, 6.2, 6.3) a test
// below says so and pins the runtime's behaviour. No model, no corpus, no network.
// @ts-nocheck: the prototype modules are loosely typed fixtures
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DocumentStore } from '../../../../packages/@monomind/cli/src/orgrt/documents/store.js';
import { type DocContract, HandoffStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const V1: DocContract[] = pilot.contracts;
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'store-parity-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const brief: DocContract = {
  id: 'brief',
  title: 'Content brief',
  producer: 'researcher',
  consumers: ['writer', 'reviewer'],
  max_attempts: 3,
  schema: {
    type: 'object',
    required: ['topic', 'claims'],
    additionalProperties: false,
    properties: {
      topic: { type: 'string', minLength: 3 },
      claims: { type: 'array', minItems: 1, items: { type: 'string' } },
    },
  },
};

/** The prototype's contract as a runtime binding: contract id is the type, each consumer role is its own consuming section. */
const bindingOf = (c: DocContract) => ({
  contract: { type: c.id, schema: c.schema, max_publish_attempts: c.max_attempts },
  section: 'work',
  producers: [c.producer],
  consumers: c.consumers.map((id) => ({ id, deciders: [id] })),
});

let seq = 0;
/** Both stores behind one interface, so a scenario reads the same for each. */
function pair(contracts: DocContract[]) {
  const dir = mkdtempSync(join(root, 'p-'));
  const protoDir = join(dir, 'proto');
  const rtDir = join(dir, 'docs');
  const proto = new HandoffStore(protoDir, contracts);
  const rt = new DocumentStore({ dir: rtDir, run: 'parity', bindings: contracts.map(bindingOf) });
  const head: Record<string, string> = {};
  return {
    proto,
    rt,
    protoDir,
    rtDir,
    publish(role, doc, content) {
      const p = proto.publish(role, doc, content);
      const r = rt.publish({
        role,
        type: doc,
        body: content,
        idempotency_key: `k${++seq}`,
        ...(head[doc] ? { supersedes: head[doc] } : {}),
      });
      if (r.ok) head[doc] = r.ref;
      return { p, r };
    },
    read(role, doc, version) {
      const p = proto.read(role, doc, version);
      const r = rt.read({ role, id: `${doc}-1`, version });
      return { p, r };
    },
    decide(role, doc, version, decision, reason) {
      const p = proto.decide(role, doc, version, decision, reason);
      const r = rt.decide({
        role,
        id: `${doc}-1`,
        version,
        decision,
        reason,
        idempotency_key: `k${++seq}`,
      });
      return { p, r };
    },
  };
}

const sheet = (m: string, w: number) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => ({
    q: `q${String(qi + 1).padStart(2, '0')}`,
    value: 1000 * w + 10 * qi + Number(m.slice(1)),
    files: Array.from({ length: 4 + (qi % 4) }, (_, i) => `${m}/f${(qi * 7 + i * 3 + w) % 50}.js`),
  })),
});
const docOf = (k: number) => ({
  worker: `worker-${k}`,
  sheets: [1, 2, 3, 4].map((i) => sheet(`m${4 * (k - 1) + i}`, k)),
});
/** The same document with one answer's value changed: what a faulty producer sends. */
const faulty = (k: number) => {
  const d = docOf(k);
  d.sheets[1].answers[3].value += 1;
  return d;
};
const sameOutcome = ({ p, r }) =>
  expect(r.ok, `${JSON.stringify(p)} vs ${JSON.stringify(r)}`).toBe(p.ok);

describe('the sweep-3 flow: publish -> read -> reject -> republish -> accept', () => {
  it('gives the same observable results step by step over the eight committed contracts', () => {
    const s = pair(V1);
    const docs = V1.map((c) => c.id);
    // every worker publishes (worker 2 sends a faulty copy)
    for (const [i, id] of docs.entries()) {
      const k = i + 1;
      const x = s.publish(`worker-${k}`, id, k === 2 ? faulty(k) : docOf(k));
      sameOutcome(x);
      expect(x.r).toMatchObject({ version: 1, status: 'pending' });
      expect(x.p).toMatchObject({ version: 1, status: 'pending' });
    }
    // the synthesiser reads each: the same content, the same version, the same status
    for (const [i, id] of docs.entries()) {
      const { p, r } = s.read('synthesiser', id);
      sameOutcome({ p, r });
      expect(r.body).toEqual(p.doc.content);
      expect([r.version, r.status]).toEqual([p.doc.version, p.doc.status]);
    }
    // it accepts all but the faulty one, which it rejects with a reason
    for (const [i, id] of docs.entries()) {
      const k = i + 1;
      const x =
        k === 2
          ? s.decide('synthesiser', id, 1, 'reject', 'm6 q04 does not match the code')
          : s.decide('synthesiser', id, 1, 'accept');
      sameOutcome(x);
      expect([x.r.status, x.r.waiting_on]).toEqual([x.p.status, x.p.waiting_on]);
      expect(x.r.status).toBe(k === 2 ? 'rejected' : 'accepted');
    }
    // the producer republishes a corrected version, which supersedes; the old one stays rejected in both
    const re = s.publish('worker-2', docs[1], docOf(2));
    sameOutcome(re);
    expect([re.r.version, re.r.status]).toEqual([re.p.version, re.p.status]);
    expect(s.rt.list({ id: `${docs[1]}-1` })[0].versions.map((v) => v.status)).toEqual([
      'rejected',
      'pending',
    ]);
    expect(s.proto.read('worker-2', docs[1], 1).doc.status).toBe('rejected');
    expect(s.proto.read('worker-2', docs[1], 2).doc.status).toBe('pending');
    // a reader without a version gets the same thing in both: the head here, since nothing newer is accepted yet
    expect(s.read('synthesiser', docs[1]).r.version).toBe(
      s.read('synthesiser', docs[1]).p.doc.version,
    );
    // deciding the old version again is refused in both; the new one is accepted, and the default read follows
    sameOutcome(s.decide('synthesiser', docs[1], 1, 'accept'));
    expect(s.decide('synthesiser', docs[1], 1, 'accept').r.ok).toBe(false);
    const acc = s.decide('synthesiser', docs[1], 2, 'accept');
    sameOutcome(acc);
    expect(acc.r.status).toBe('accepted');
    const final = s.read('synthesiser', docs[1]);
    expect([final.r.version, final.r.status]).toEqual([final.p.doc.version, final.p.doc.status]);
    expect(final.r.body).toEqual(final.p.doc.content);
  });

  it('refuses the same bad publishes: wrong worker value type, extra field, missing field, a non-producer', () => {
    const s = pair(V1);
    const id = V1[0].id;
    const cases = [
      ['worker-1', { ...docOf(1), extra: 1 }],
      ['worker-1', { worker: 'worker-1' }],
      ['worker-1', { ...docOf(1), worker: 'worker-9' }],
      ['worker-2', docOf(1)],
      ['worker-1', 'not an object'],
    ];
    for (const [role, body] of cases) {
      const x = s.publish(role, id, body);
      expect(x.p.ok).toBe(false);
      expect(x.r.ok).toBe(false);
    }
    // the failing schema paths agree wherever the prototype names one ("$.sheets: ..." -> path "$.sheets")
    const x = pair(V1).publish('worker-1', id, { worker: 'worker-1' });
    const protoPaths = (x.p.problems ?? []).map((m) => m.split(':')[0]).sort();
    expect(x.r.problems.map((p) => p.path).sort()).toEqual(protoPaths);
  });
});

describe('per-consumer acceptance', () => {
  const good = { topic: 'Pricing page', claims: ['v2.22 ships sections'] };
  it('accepts only when every consumer accepted; one rejection rejects; waiting_on lists who is left', () => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    const a = s.decide('writer', 'brief', 1, 'accept');
    expect([a.r.status, a.r.waiting_on]).toEqual([a.p.status, a.p.waiting_on]);
    expect(a.r.waiting_on).toEqual(['reviewer']);
    const b = s.decide('reviewer', 'brief', 1, 'accept');
    expect([b.r.status, b.r.waiting_on]).toEqual([b.p.status, b.p.waiting_on]);
    expect(b.r.status).toBe('accepted');
  });

  it.each([
    ['accept', 'accept'],
    ['accept', 'reject'],
    ['reject', 'accept'],
    ['reject', 'reject'],
  ])('matrix: writer %s then reviewer %s', (d1, d2) => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    const x = s.decide('writer', 'brief', 1, d1, d1 === 'reject' ? 'r' : undefined);
    const y = s.decide('reviewer', 'brief', 1, d2, d2 === 'reject' ? 'r' : undefined);
    sameOutcome(x);
    sameOutcome(y);
    if (y.p.ok) expect(y.r.status).toBe(y.p.status);
  });

  it('refuses a missing reason, a non-consumer, an unknown version, a superseded version and a changed mind alike', () => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    for (const x of [
      s.decide('writer', 'brief', 1, 'reject'),
      s.decide('researcher', 'brief', 1, 'accept'),
      s.decide('writer', 'brief', 9, 'accept'),
    ]) {
      expect(x.p.ok).toBe(false);
      expect(x.r.ok).toBe(false);
    }
    s.publish('researcher', 'brief', { ...good, topic: 'Rev two' });
    expect(s.decide('writer', 'brief', 1, 'accept').p.ok).toBe(false);
    expect(s.decide('writer', 'brief', 1, 'accept').r.ok).toBe(false);
    sameOutcome(s.decide('writer', 'brief', 2, 'accept'));
    sameOutcome(s.decide('writer', 'brief', 2, 'accept')); // the same decision again is fine in both
    const changed = s.decide('writer', 'brief', 2, 'reject', 'changed my mind');
    expect(changed.p.ok).toBe(false);
    expect(changed.r.ok).toBe(false);
  });

  it('reads default to the latest accepted version, else the head, in both', () => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    s.decide('writer', 'brief', 1, 'accept');
    s.decide('reviewer', 'brief', 1, 'accept');
    s.publish('researcher', 'brief', { ...good, topic: 'Second' });
    const x = s.read('writer', 'brief');
    expect([x.r.version, x.r.status]).toEqual([x.p.doc.version, x.p.doc.status]);
    expect(x.r.version).toBe(1);
  });

  it('survives a restart in both', () => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    s.decide('writer', 'brief', 1, 'accept');
    const proto = new HandoffStore(s.protoDir, [brief]);
    const rt = new DocumentStore({ dir: s.rtDir, run: 'parity', bindings: [bindingOf(brief)] });
    const p = proto.read('reviewer', 'brief');
    const r = rt.peek('brief-1');
    expect([
      r.version,
      r.status,
      r.decisions.reviewer?.decision,
      r.decisions.writer.decision,
    ]).toEqual([
      p.doc.version,
      p.doc.status,
      p.doc.decisions.reviewer?.decision,
      p.doc.decisions.writer.decision,
    ]);
    expect(
      rt.decide({
        role: 'reviewer',
        id: 'brief-1',
        version: 1,
        decision: 'accept',
        idempotency_key: 'after-restart',
      }).status,
    ).toBe('accepted');
    expect(proto.decide('reviewer', 'brief', 1, 'accept').status).toBe('accepted');
  });
});

describe('where the runtime intentionally differs from the prototype (13.1.2, 6.2, 6.3)', () => {
  const good = { topic: 'Pricing page', claims: ['v2.22 ships sections'] };

  it('ids are issued at the first publish and a revision names the expected head; the prototype has one stream per contract', () => {
    const s = pair([brief]);
    expect(s.publish('researcher', 'brief', good).r.ref).toBe('brief-1@v1');
    // the prototype supersedes implicitly; the runtime refuses a revision that does not name the head
    expect(s.proto.publish('researcher', 'brief', good).ok).toBe(true);
    const stale = s.rt.publish({
      role: 'researcher',
      type: 'brief',
      body: good,
      idempotency_key: 'late',
      supersedes: 'brief-1@v0',
    });
    expect(stale.ok).toBe(false);
  });

  it('only failed publishes count against max_publish_attempts (spec 6.3); the prototype counts every publish', () => {
    const s = pair([brief]);
    for (let i = 0; i < 3; i++) s.publish('researcher', 'brief', { ...good, topic: `Topic ${i}` });
    expect(s.proto.publish('researcher', 'brief', good).ok).toBe(false); // prototype: 3 publishes used the cap
    expect(s.rt.attempts('brief')).toMatchObject({ used: 0, left: 3 });
    expect(
      s.rt.publish({
        role: 'researcher',
        type: 'brief',
        body: good,
        idempotency_key: 'more',
        supersedes: 'brief-1@v3',
      }).ok,
    ).toBe(true);
  });

  it('reads are not access-checked in the store: the prototype refuses a non-participant, the static rules are P3.6', () => {
    const s = pair([brief]);
    s.publish('researcher', 'brief', good);
    expect(s.proto.read('intruder', 'brief').ok).toBe(false);
    expect(s.rt.read({ role: 'intruder', id: 'brief-1' }).ok).toBe(true);
  });

  it('a retry with the same idempotency key is the same publish; the prototype has no keys and would publish twice', () => {
    const s = pair([brief]);
    const a = s.rt.publish({
      role: 'researcher',
      type: 'brief',
      body: good,
      idempotency_key: 'same',
    });
    const b = s.rt.publish({
      role: 'researcher',
      type: 'brief',
      body: good,
      idempotency_key: 'same',
    });
    expect(b).toMatchObject({ ref: a.ref, replayed: true });
    s.proto.publish('researcher', 'brief', good);
    expect(s.proto.publish('researcher', 'brief', good)).toMatchObject({ version: 2 });
  });

  it('the size limit is 1 MiB of serialized version, not 20,000 characters', () => {
    const s = pair([brief]);
    const big = { topic: 'Big', claims: ['x'.repeat(30_000)] };
    expect(s.proto.publish('researcher', 'brief', big).ok).toBe(false);
    expect(
      s.rt.publish({ role: 'researcher', type: 'brief', body: big, idempotency_key: 'big' }).ok,
    ).toBe(true);
  });
});
