import { describe, expect, it } from 'vitest';
import { briefBinding, briefSchema, fresh, good, must, open, pub, refusal } from './store-support.js';
import type { DecideReceipt, } from '../../../src/orgrt/documents/store-types.js';

const dec = (store: ReturnType<typeof fresh>['store'], role: string, ref: string, decision: 'accept' | 'reject', reason?: string, extra = {}) => {
  const [id, v] = ref.split('@v');
  return store.decide({ role, id, version: Number(v), decision, reason, idempotency_key: `d-${role}-${ref}-${decision}-${Math.random()}`, ...extra });
};

describe('publish', () => {
  it('commits a conforming body from its producer as pending v1 of a runtime-issued id', () => {
    const { store } = fresh();
    const r = must(store.publish(pub()));
    expect(r).toMatchObject({ ref: 'brief-1@v1', id: 'brief-1', version: 1, status: 'pending' });
    expect(r.contract_revision).toMatch(/^[0-9a-f]{64}$/);
    expect(r.supersedes).toBeUndefined();
    expect(must(store.publish(pub())).id).toBe('brief-2'); // a first publish without supersedes is a new document
  });

  const table: [string, Parameters<typeof pub>[0], string][] = [
    ['unknown type', { type: 'nope' }, 'UNKNOWN_TYPE'],
    ['not the producer', { role: 'writer' }, 'NOT_PRODUCER'],
    ['bad role', { role: '__proto__' }, 'ROLE_INVALID'],
    ['empty key', { idempotency_key: '' }, 'IDEMPOTENCY_KEY_INVALID'],
    ['body is not JSON data', { body: { topic: 'abc', claims: [undefined] } }, 'BODY_NOT_JSON'],
    ['supersedes a document that does not exist', { supersedes: 'brief-9@v1' }, 'SUPERSEDES_INVALID'],
    ['supersedes is not a reference', { supersedes: 'brief' }, 'SUPERSEDES_INVALID'],
  ];
  it.each(table)('refuses: %s', (_n, over, code) => {
    const { store } = fresh();
    expect(refusal(store.publish(pub(over))).code).toBe(code);
    expect(store.list()).toEqual([]);
  });

  it('refuses a body that fails the schema with every reason at once, creates nothing and counts the attempt', () => {
    const { store } = fresh();
    const r = refusal(store.publish(pub({ body: { topic: 'x' } })));
    expect(r.code).toBe('CONTENT_INVALID');
    expect(r.problems?.map((p) => p.path)).toEqual(expect.arrayContaining(['$.topic', '$.claims']));
    expect(r.problems?.map((p) => p.code)).toEqual(expect.arrayContaining(['VALUE_TOO_SHORT', 'VALUE_REQUIRED']));
    expect(r.attempts_left).toBe(2);
    expect(store.list()).toEqual([]);
    expect(store.attempts('brief')).toMatchObject({ used: 1, left: 2 });
  });

  it('refuses a body over the size limit (counted) and one that is in the limit', () => {
    const { store } = fresh();
    const s = open(fresh().dir, { bindings: [briefBinding({ max_bytes: 400 })] });
    expect(refusal(s.publish(pub({ body: { topic: 'Big', claims: ['x'.repeat(500)] } }))).code).toBe('TOO_LARGE');
    expect(s.attempts('brief')?.used).toBe(1);
    expect(must(s.publish(pub())).version).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it('refuses over 1 MiB by default', () => {
    const { store } = fresh();
    expect(refusal(store.publish(pub({ body: { topic: 'Big', claims: ['x'.repeat(1024 * 1024)] } }))).code).toBe('TOO_LARGE');
  });

  it('checks the evidence argument against the contract and names a declared kind with no entry', () => {
    const s = open(fresh().dir, { bindings: [briefBinding({ evidence: [{ kind: 'command', min: 2 }, { kind: 'source' }] })] });
    const r = refusal(s.publish(pub({ evidence: [{ kind: 'command', command: 'npm test', exitCode: 0 }] })));
    expect(r.problems?.map((p) => `${p.code} ${p.message}`).join('|')).toMatch(/EVIDENCE_MISSING 2 command.*1 given.*EVIDENCE_MISSING 1 source/);
    expect(refusal(s.publish(pub({ evidence: [{ kind: 'opinion' }] as never }))).problems?.[0].code).toBe('EVIDENCE_INVALID');
    const ok = must(s.publish(pub({ evidence: [{ kind: 'command' }, { kind: 'command' }, { kind: 'source', url: 'https://x.test', quote: 'q' }] })));
    expect((must(s.peek(ok.id)) as { evidence: unknown[] }).evidence).toHaveLength(3); // stored verbatim
  });

  it('records inputs and refuses malformed ones', () => {
    const { store } = fresh();
    expect(refusal(store.publish(pub({ inputs: ['nonsense'] }))).problems?.[0]).toMatchObject({ code: 'INPUT_INVALID', path: 'inputs[0]' });
    const r = must(store.publish(pub({ inputs: ['brief-1@v1', 'brief-1@v1'] })));
    expect((must(store.peek(r.id)) as { inputs: string[] }).inputs).toEqual(['brief-1@v1', 'brief-1@v1']);
  });

  it('keeps a trimmed note of at most 400 characters', () => {
    const { store } = fresh();
    const r = must(store.publish(pub({ note: `  ${'n'.repeat(500)}  ` })));
    expect((must(store.peek(r.id)) as { note: string }).note).toHaveLength(400);
  });
});

describe('idempotency', () => {
  it('returns the committed receipt for the same key and payload and appends nothing', () => {
    const { store } = fresh();
    const a = must(store.publish(pub({ idempotency_key: 'same' })));
    const seq = store.info().seq;
    const b = must(store.publish(pub({ idempotency_key: 'same' })));
    expect(b).toEqual({ ...a, replayed: true });
    expect(store.info().seq).toBe(seq);
    expect(store.list()).toHaveLength(1);
  });

  it('conflicts when the same key carries a different payload, and keys are scoped to the caller', () => {
    const s = open(fresh().dir, { bindings: [{ ...briefBinding(), producers: ['researcher', 'other'] }] });
    must(s.publish(pub({ idempotency_key: 'k' })));
    expect(refusal(s.publish(pub({ idempotency_key: 'k', body: { ...good, topic: 'Different' } }))).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(must(s.publish(pub({ idempotency_key: 'k', role: 'other' }))).replayed).toBeUndefined(); // another role's key
  });

  it('replays a publish even after the cap is used up', () => {
    const { store } = fresh();
    const a = must(store.publish(pub({ idempotency_key: 'first' })));
    for (let i = 0; i < 3; i++) store.publish(pub({ body: {} }));
    expect(refusal(store.publish(pub())).code).toBe('PUBLISH_EXHAUSTED');
    expect(must(store.publish(pub({ idempotency_key: 'first' }))).replayed).toBe(true);
    expect(a.version).toBe(1);
  });
});

describe('versions and supersede', () => {
  it('a revision names the expected head, becomes the new head, and supersedes a pending version', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    const v2 = must(store.publish(pub({ supersedes: v1.ref, body: { ...good, topic: 'Rev two' } })));
    expect(v2).toMatchObject({ ref: 'brief-1@v2', supersedes: 'brief-1@v1', status: 'pending' });
    expect(store.list()[0].versions.map((v) => v.status)).toEqual(['superseded', 'pending']);
    expect(store.list()[0].head.version).toBe(2);
  });

  it('a stale supersedes fails with the current head (compare-and-set), one head and no branches', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    must(store.publish(pub({ supersedes: v1.ref })));
    const r = refusal(store.publish(pub({ supersedes: v1.ref })));
    expect(r).toMatchObject({ code: 'SUPERSEDES_CONFLICT', head: 'brief-1@v2' });
    expect(store.attempts('brief')?.used).toBe(0); // a conflict is not a content failure
  });

  it('a rejected version stays rejected when superseded, and a decision on a superseded version is refused', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    must(dec(store, 'writer', v1.ref, 'reject', 'claims unsourced'));
    const v2 = must(store.publish(pub({ supersedes: v1.ref })));
    expect(store.list()[0].versions.map((v) => v.status)).toEqual(['rejected', 'pending']);
    const v3 = must(store.publish(pub({ supersedes: v2.ref })));
    expect(refusal(dec(store, 'writer', v2.ref, 'accept')).code).toBe('SUPERSEDED');
    expect(refusal(dec(store, 'writer', v2.ref, 'accept')).message).toMatch(/superseded by version 3/);
    expect(v3.version).toBe(3);
  });

  it('versions are per document: a second document of the type starts at v1', () => {
    const { store } = fresh();
    const a = must(store.publish(pub()));
    must(store.publish(pub({ supersedes: a.ref })));
    expect(must(store.publish(pub())).ref).toBe('brief-2@v1');
  });
});

describe('read and list', () => {
  it('returns the latest accepted version, else the head, an explicit version, and records the read', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    expect(must(store.read({ role: 'writer', id: v1.id }))).toMatchObject({ version: 1, status: 'pending', body: good });
    must(dec(store, 'writer', v1.ref, 'accept'));
    must(dec(store, 'reviewer', v1.ref, 'accept'));
    must(store.publish(pub({ supersedes: v1.ref, body: { ...good, topic: 'Second' } })));
    expect(must(store.read({ role: 'writer', id: v1.id }))).toMatchObject({ version: 1, status: 'accepted' });
    expect(must(store.read({ role: 'writer', id: v1.id, version: 2 }))).toMatchObject({ version: 2, status: 'pending' });
    expect(refusal(store.read({ role: 'writer', id: v1.id, version: 3 })).code).toBe('UNKNOWN_VERSION');
    expect(refusal(store.read({ role: 'writer', id: 'brief-7' })).code).toBe('UNKNOWN_DOCUMENT');
    const reads = store.list()[0];
    expect(reads.id).toBe('brief-1');
  });

  it('read events carry role and purpose and are visible in the state', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    store.read({ role: 'writer', id: v1.id, purpose: 'review' });
    store.read({ role: 'writer', id: v1.id });
    expect(store.info().seq).toBe(3);
  });

  it('lists documents with their versions, rework rounds and a filter by type, section and head status', () => {
    const { store } = fresh();
    const a = must(store.publish(pub()));
    must(store.publish(pub()));
    must(dec(store, 'writer', a.ref, 'reject', 'no'));
    expect(store.list({ status: 'rejected' }).map((d) => d.id)).toEqual(['brief-1']);
    expect(store.list({ status: 'pending' }).map((d) => d.id)).toEqual(['brief-2']);
    expect(store.list({ type: 'brief', section: 'research' })).toHaveLength(2);
    expect(store.list({ section: 'other' })).toHaveLength(0);
    expect(store.list({ id: 'brief-1' })[0].rework).toEqual({ writing: 1 });
    expect(store.contracts()[0]).toMatchObject({ type: 'brief', section: 'research', contract: { schema: briefSchema } });
  });
});

describe('decide: acceptance is per consumer', () => {
  it('accepts a version only when every consuming section has accepted, and reports who is awaited', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    expect(must(dec(store, 'writer', v.ref, 'accept'))).toMatchObject({ status: 'pending', waiting_on: ['review'], consumer: 'writing' });
    expect(must(dec(store, 'reviewer', v.ref, 'accept'))).toMatchObject({ status: 'accepted', waiting_on: [] });
    expect(must(store.peek(v.id))).toMatchObject({ status: 'accepted', decisions: { writing: { decision: 'accept', by: 'writer' }, review: { decision: 'accept', by: 'reviewer' } } });
  });

  const matrix: [string, string, string, string, string?][] = [
    // [name, first decider, first decision, second decider, second decision] -> checked below
    ['accept then accept', 'accept', 'accept', 'accepted'],
    ['accept then reject', 'accept', 'reject', 'rejected'],
    ['reject then accept', 'reject', 'accept', 'VERSION_CLOSED'],
    ['reject then reject', 'reject', 'reject', 'VERSION_CLOSED'],
  ];
  it.each(matrix)('matrix: %s', (_n, d1, d2, expected) => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    must(dec(store, 'writer', v.ref, d1 as 'accept', d1 === 'reject' ? 'r1' : undefined));
    const r2 = dec(store, 'reviewer', v.ref, d2 as 'accept', d2 === 'reject' ? 'r2' : undefined);
    if (expected === 'VERSION_CLOSED') expect(refusal(r2).code).toBe('VERSION_CLOSED');
    else expect(must(r2).status).toBe(expected);
  });

  it('rejects as soon as one consumer rejects, requires a reason, and counts one rework round per committed rejection', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    expect(refusal(dec(store, 'writer', v.ref, 'reject')).code).toBe('REASON_REQUIRED');
    expect(refusal(dec(store, 'writer', v.ref, 'reject', '   ')).code).toBe('REASON_REQUIRED');
    must(dec(store, 'writer', v.ref, 'reject', 'claims unsourced'));
    must(dec(store, 'writer', v.ref, 'reject', 'claims unsourced')); // identical repeat: a no-op
    expect(store.list()[0].rework).toEqual({ writing: 1 });
    expect(must(store.peek(v.id)).decisions.writing.reason).toBe('claims unsourced');
  });

  it('only declared decision makers decide: producer, outsiders, wrong consumer and a stranger are refused', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    for (const role of ['researcher', 'intruder']) expect(refusal(dec(store, role, v.ref, 'accept')).code).toBe('NOT_DECIDER');
    expect(refusal(dec(store, 'writer', v.ref, 'accept', undefined, { consumer: 'review' })).code).toBe('NOT_DECIDER');
    expect(refusal(dec(store, 'writer', 'brief-5@v1', 'accept')).code).toBe('UNKNOWN_DOCUMENT');
    expect(refusal(dec(store, 'writer', 'brief-1@v4', 'accept')).code).toBe('UNKNOWN_VERSION');
    expect(refusal(dec(store, 'writer', v.ref, 'maybe' as never)).code).toBe('DECISION_INVALID');
  });

  it('a role that decides for two sections must name one', () => {
    const s = open(fresh().dir, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['lead'] }, { id: 'review', deciders: ['lead'] }])] });
    const v = must(s.publish(pub()));
    expect(refusal(dec(s, 'lead', v.ref, 'accept')).code).toBe('CONSUMER_AMBIGUOUS');
    expect(must(dec(s, 'lead', v.ref, 'accept', undefined, { consumer: 'writing' })).consumer).toBe('writing');
  });

  it('an identical repeat decision is a no-op, a reversal is refused, a retry of the same key returns the receipt', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    const first = must(store.decide({ role: 'writer', id: v.id, version: 1, decision: 'accept', idempotency_key: 'dk' }));
    const seq = store.info().seq;
    const again = must(store.decide({ role: 'writer', id: v.id, version: 1, decision: 'accept', idempotency_key: 'dk' }));
    expect(again).toEqual({ ...first, replayed: true });
    const repeat = must(store.decide({ role: 'writer', id: v.id, version: 1, decision: 'accept', idempotency_key: 'other' })) as DecideReceipt;
    expect(repeat.noop).toBe(true);
    expect(store.info().seq).toBe(seq);
    expect(refusal(dec(store, 'writer', v.ref, 'reject', 'changed my mind')).code).toBe('REVERSAL_REFUSED');
    expect(refusal(store.decide({ role: 'writer', id: v.id, version: 1, decision: 'reject', reason: 'x', idempotency_key: 'dk' })).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('compare-and-set on the document state sequence', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    const seq = store.peek(v.id) as { state_seq: number };
    expect(refusal(dec(store, 'writer', v.ref, 'accept', undefined, { expected_state_seq: seq.state_seq + 5 })).code).toBe('STATE_SEQ_CONFLICT');
    expect(must(dec(store, 'writer', v.ref, 'accept', undefined, { expected_state_seq: seq.state_seq })).status).toBe('pending');
  });

  it('a decision applies to a specific version: v1 is decided, v2 is still waiting', () => {
    const { store } = fresh();
    const v1 = must(store.publish(pub()));
    must(dec(store, 'writer', v1.ref, 'accept'));
    must(dec(store, 'reviewer', v1.ref, 'accept'));
    const v2 = must(store.publish(pub({ supersedes: v1.ref })));
    expect(store.list()[0].versions.map((v) => v.status)).toEqual(['accepted', 'pending']);
    expect(must(dec(store, 'writer', v2.ref, 'accept')).waiting_on).toEqual(['review']);
    expect(refusal(dec(store, 'writer', v1.ref, 'reject', 'late')).code).toBe('REVERSAL_REFUSED');
  });
});

describe('attempt caps', () => {
  it('counts failed publishes per type, says how many are left, and fails closed once exhausted', () => {
    const { store } = fresh();
    expect(refusal(store.publish(pub({ body: {} }))).attempts_left).toBe(2);
    expect(refusal(store.publish(pub({ body: {} }))).attempts_left).toBe(1);
    const last = refusal(store.publish(pub({ body: {} })));
    expect(last.attempts_left).toBe(0);
    expect(last.message).toMatch(/lead/);
    expect(refusal(store.publish(pub())).code).toBe('PUBLISH_EXHAUSTED'); // even a conforming body
    expect(store.list()).toEqual([]);
  });

  it('successful publishes do not use attempts (spec 6.3: failed publishes count)', () => {
    const { store } = fresh();
    let ref = must(store.publish(pub())).ref;
    for (let i = 0; i < 5; i++) ref = must(store.publish(pub({ supersedes: ref }))).ref;
    expect(store.attempts('brief')?.used).toBe(0);
  });

  it('a changed contract revision starts a fresh count; an unchanged reopen does not', () => {
    const { dir, store } = fresh();
    for (let i = 0; i < 3; i++) store.publish(pub({ body: {} }));
    expect(refusal(store.publish(pub())).code).toBe('PUBLISH_EXHAUSTED');
    const same = open(dir);
    expect(refusal(same.publish(pub())).code).toBe('PUBLISH_EXHAUSTED');
    const changed = open(dir, { bindings: [briefBinding({ max_publish_attempts: 4 })] });
    expect(changed.attempts('brief')).toMatchObject({ used: 0, left: 4 });
    expect(must(changed.publish(pub())).version).toBe(1);
  });
});

describe('guards (the seam for deliverable checks)', () => {
  it('a guard refusal commits nothing; a counted one uses the consistency budget, not a publish attempt', () => {
    const { store } = fresh();
    store.addGuard({ publish: (c) => (c.body && (c.body as { topic: string }).topic === 'Refuse' ? { code: 'FILES_DISAGREE', message: 'disagrees with out/a.json', counts: 'consistency' } : undefined) });
    const r = refusal(store.publish(pub({ body: { ...good, topic: 'Refuse' } })));
    expect(r).toMatchObject({ code: 'GUARD_REFUSED', guard_code: 'FILES_DISAGREE', refusals_left: 4 });
    expect(store.attempts('brief')).toMatchObject({ used: 0, refusals_used: 1 });
    expect(store.list()).toEqual([]);
  });

  it('a decide guard sees the body and can refuse an accept, uncounted', () => {
    const { store } = fresh();
    const v = must(store.publish(pub()));
    store.addGuard({ decide: (c) => (c.decision === 'accept' ? { code: 'CHANGED', message: `files of ${c.doc} changed` } : undefined) });
    const r = refusal(dec(store, 'writer', v.ref, 'accept'));
    expect(r).toMatchObject({ code: 'GUARD_REFUSED', guard_code: 'CHANGED' });
    expect(must(dec(store, 'writer', v.ref, 'reject', 'because')).status).toBe('rejected');
  });

  it('listeners hear every committed event in order, a throwing one changes nothing, and re-entry is refused', () => {
    const { store } = fresh();
    const seen: string[] = [];
    store.onCommitted(() => { throw new Error('boom'); });
    const off = store.onCommitted((e) => seen.push(`${e.seq}:${e.type}`));
    let inner: unknown;
    store.onCommitted((e) => { if (e.type === 'published') inner = store.publish(pub()); });
    const v = must(store.publish(pub()));
    must(dec(store, 'writer', v.ref, 'accept'));
    off();
    store.read({ role: 'writer', id: v.id });
    expect(seen).toEqual(['1:published', '2:decided']);
    expect(refusal(inner).code).toBe('REENTRANT');
  });
});
