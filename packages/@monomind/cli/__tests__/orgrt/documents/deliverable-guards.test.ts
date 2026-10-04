// P3.10: the publish and decide guards on a real store (no daemon, no model): refusal text and counter, the cap
// and its fail-closed code, an accept after a file changed, the comparison against what the producer sent.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DeliverableChange, deliverableGuard } from '../../../src/orgrt/documents/deliverable-guards.js';
import type { DocumentStore } from '../../../src/orgrt/documents/store.js';
import type { DeliverableFile } from '../../../src/orgrt/documents/types.js';
import { briefBinding, must, open, refusal, tmp } from './store-support.js';

const schema = {
  type: 'object',
  required: ['sheets'],
  properties: {
    sheets: {
      type: 'array',
      minItems: 1,
      items: { type: 'object', required: ['module', 'answers'], properties: { module: { type: 'string' }, answers: { type: 'array' } } },
    },
  },
};
const files = (...ms: string[]): DeliverableFile[] =>
  ms.map((m) => ({ file: `out/${m}/answers.json`, select: { array: 'sheets', key: 'module', value: m }, compare: ['module', 'answers[].q', 'answers[].value', 'answers[].files'] }));
const sheet = (m: string, v = 1) => ({ module: m, answers: [{ q: 'q1', value: v, files: ['a', 'b'] }] });
const bodyOf = (v = 1, ...ms: string[]) => ({ sheets: ms.map((m) => ({ ...sheet(m, v), answers: [{ ...sheet(m, v).answers[0], evidence: [{ n: v }] }] })) });

function setup(over: Record<string, unknown> = {}, consumers?: { id: string; deciders: string[] }[]) {
  const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p310-ws-'));
  const w = (m: string, v = 1) => {
    mkdirSync(join(ws, 'out', m), { recursive: true });
    writeFileSync(join(ws, 'out', m, 'answers.json'), JSON.stringify(sheet(m, v)));
  };
  const changes: DeliverableChange[] = [];
  const binding = briefBinding({ type: 'sheets', schema, deliverable_files: files('m1', 'm2'), ...over } as never, consumers ?? [{ id: 'writing', deciders: ['writer'] }]);
  const store: DocumentStore = open(tmp(), { bindings: [binding] });
  store.addGuard(deliverableGuard({ workspaceOf: (r) => (r === 'researcher' ? ws : undefined), onChanged: (c) => changes.push(c) }));
  let n = 0;
  const publish = (body: unknown, extra = {}) => store.publish({ role: 'researcher', type: 'sheets', body, idempotency_key: `k${++n}`, ...extra });
  const decide = (ref: string, decision: 'accept' | 'reject', role = 'writer') => {
    const [id, v] = ref.split('@v');
    return store.decide({ role, id, version: Number(v), decision, reason: decision === 'reject' ? 'no' : undefined, idempotency_key: `d${++n}` });
  };
  return { ws, w, store, publish, decide, changes };
}

describe('publish guard', () => {
  it('a document that matches its files is accepted for commit, whatever else it carries', () => {
    const s = setup();
    s.w('m1');
    s.w('m2');
    expect(must(s.publish(bodyOf(1, 'm1', 'm2')))).toMatchObject({ ref: 'sheets-1@v1', status: 'pending' });
  });

  it('a mismatch is refused naming the file and the first differing path; counted as consistency, not as an attempt; nothing committed', () => {
    const s = setup();
    s.w('m1');
    s.w('m2');
    const r = refusal(s.publish(bodyOf(2, 'm1', 'm2')));
    expect(r).toMatchObject({ code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_MISMATCH', refusals_left: 4 });
    expect(r.message).toMatch(/^"sheets" disagrees with your deliverable files, so it was not published: out\/m1\/answers\.json differs from the document's sheets entry m1 at \$\.answers\[0\]\.value: the file has 1, the document has 2; out\/m2\//);
    expect(r.message).toMatch(/This does not use a publish attempt; 4 consistency refusals left\.$/);
    expect(r.problems?.length).toBe(2);
    expect(s.store.attempts('sheets')).toMatchObject({ used: 0, left: 3, refusals_used: 1, refusals_left: 4 });
    expect(s.store.list()).toEqual([]);
  });

  it('a missing file and invalid JSON are refused the same way', () => {
    const s = setup();
    s.w('m1');
    writeFileSync(join(s.ws, 'out/m1/answers.json'), '{nope');
    const r = refusal(s.publish(bodyOf(1, 'm1', 'm2')));
    expect(r.guard_code).toBe('DELIVERABLE_MISMATCH');
    expect(r.message).toMatch(/out\/m1\/answers\.json is not valid JSON; write it before publishing; out\/m2\/answers\.json does not exist/);
  });

  it('after max_consistency_refusals the store fails closed with its own code, even for a consistent document', () => {
    const s = setup({ max_consistency_refusals: 2 });
    s.w('m1');
    s.w('m2');
    for (let i = 0; i < 2; i++) expect(refusal(s.publish(bodyOf(9, 'm1', 'm2'))).guard_code).toBe('DELIVERABLE_MISMATCH');
    const r = refusal(s.publish(bodyOf(1, 'm1', 'm2')));
    expect(r).toMatchObject({ code: 'CONSISTENCY_EXHAUSTED', refusals_left: 0 });
    expect(s.store.attempts('sheets')).toMatchObject({ used: 0, left: 3 });
    expect(s.store.list()).toEqual([]);
  });

  it('consistency refusals and publish attempts are separate budgets', () => {
    const s = setup({ max_publish_attempts: 2 });
    s.w('m1');
    s.w('m2');
    for (let i = 0; i < 3; i++) refusal(s.publish(bodyOf(9, 'm1', 'm2')));
    expect(refusal(s.publish({ nothing: 1 })).code).toBe('CONTENT_INVALID'); // a schema failure uses an attempt
    expect(s.store.attempts('sheets')).toMatchObject({ used: 1, left: 1, refusals_used: 3, refusals_left: 2 });
    expect(must(s.publish(bodyOf(1, 'm1', 'm2'))).status).toBe('pending');
  });

  it('a refused publish retried with the same key after the file is fixed commits; a committed key replays without re-reading files', () => {
    const s = setup();
    s.w('m1');
    s.w('m2');
    const key = 'retry-1';
    const body = bodyOf(2, 'm1', 'm2');
    expect(refusal(s.publish(body, { idempotency_key: key })).guard_code).toBe('DELIVERABLE_MISMATCH');
    s.w('m1', 2);
    s.w('m2', 2);
    const ok = must(s.publish(body, { idempotency_key: key }));
    expect(ok.ref).toBe('sheets-1@v1');
    s.w('m1', 7); // the files move on afterwards
    expect(must(s.publish(body, { idempotency_key: key }))).toMatchObject({ ref: 'sheets-1@v1', replayed: true });
    expect(s.store.list()).toHaveLength(1);
  });

  it('an unresolvable workspace is refused and not counted', () => {
    const store = open(tmp(), { bindings: [briefBinding({ type: 'sheets', schema, deliverable_files: files('m1') } as never, [{ id: 'writing', deciders: ['writer'] }])] });
    store.addGuard(deliverableGuard({ workspaceOf: () => undefined }));
    const u = refusal(store.publish({ role: 'researcher', type: 'sheets', body: bodyOf(1, 'm1'), idempotency_key: 'y' }));
    expect(u).toMatchObject({ code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_WORKSPACE_UNAVAILABLE' });
    expect(store.attempts('sheets')).toMatchObject({ used: 0, refusals_used: 0 });
    expect(store.list()).toEqual([]);
  });

  it('a contract without deliverable_files is untouched, and the guard is never asked for a workspace', () => {
    const store = open(tmp(), { bindings: [briefBinding({ type: 'sheets', schema } as never, [{ id: 'writing', deciders: ['writer'] }])] });
    store.addGuard(deliverableGuard({ workspaceOf: () => { throw new Error('asked'); } }));
    expect(must(store.publish({ role: 'researcher', type: 'sheets', body: bodyOf(1, 'm1'), idempotency_key: 'z' })).status).toBe('pending');
  });
});

describe('decide guard', () => {
  const published = () => {
    const s = setup();
    s.w('m1');
    s.w('m2');
    return { s, ref: must(s.publish(bodyOf(1, 'm1', 'm2'))).ref };
  };

  it('accepts when the files are unchanged since the publish', () => {
    const { s, ref } = published();
    expect(must(s.decide(ref, 'accept')).status).toBe('accepted');
    expect(s.changes).toEqual([]);
  });

  it('refuses an accept once a file changed: names file and path, commits nothing, uncounted, tells the relay the facts', () => {
    const { s, ref } = published();
    const seq = s.store.info().seq;
    s.w('m2', 5);
    const r = refusal(s.decide(ref, 'accept'));
    expect(r).toMatchObject({ code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_CHANGED' });
    expect(r.message).toMatch(/^version 1 cannot be accepted: the producer's deliverable files changed after it was published \(out\/m2\/answers\.json differs from the document's sheets entry m2 at \$\.answers\[0\]\.value: the file has 5, the document has 1\)\. The producer must publish a corrected version; decide on that one\.$/);
    expect(s.store.info().seq).toBe(seq);
    expect(s.store.list()[0].head.status).toBe('pending');
    expect(s.store.attempts('sheets')).toMatchObject({ used: 0, refusals_used: 0 });
    expect(s.changes).toEqual([
      expect.objectContaining({ type: 'sheets', doc: 'sheets-1', version: 1, producer: 'researcher', decider: 'writer', consumer: 'writing', files: ['out/m2/answers.json'] }),
    ]);
  });

  it('the comparison is against what the producer sent: restoring the file makes the accept pass, a changed file never does', () => {
    const { s, ref } = published();
    s.w('m1', 3);
    expect(refusal(s.decide(ref, 'accept')).guard_code).toBe('DELIVERABLE_CHANGED');
    s.w('m1', 1);
    expect(must(s.decide(ref, 'accept')).status).toBe('accepted');
  });

  it('the producer republishes a corrected version; that one is accepted', () => {
    const { s, ref } = published();
    s.w('m1', 4);
    expect(refusal(s.decide(ref, 'accept')).guard_code).toBe('DELIVERABLE_CHANGED');
    const v2 = must(s.publish({ sheets: [sheet('m1', 4), sheet('m2', 1)] }, { supersedes: ref }));
    expect(v2.ref).toBe('sheets-1@v2');
    expect(must(s.decide(v2.ref, 'accept')).status).toBe('accepted');
  });

  it('a file that changes after the accept is irrelevant to the accepted version', () => {
    const { s, ref } = published();
    must(s.decide(ref, 'accept'));
    s.w('m1', 99);
    const read = s.store.read({ role: 'writer', id: 'sheets-1' });
    expect(read).toMatchObject({ ok: true, status: 'accepted', version: 1 });
    expect(JSON.stringify((read as { body: unknown }).body)).not.toContain('99');
    expect(s.changes).toEqual([]);
  });

  it('a reject is never blocked by a changed file', () => {
    const { s, ref } = published();
    s.w('m1', 8);
    expect(must(s.decide(ref, 'reject')).status).toBe('rejected');
  });

  it('with two consumers each accept is checked, so a change between them blocks the second', () => {
    const s = setup({}, [{ id: 'writing', deciders: ['writer'] }, { id: 'review', deciders: ['reviewer'] }]);
    s.w('m1');
    s.w('m2');
    const ref = must(s.publish(bodyOf(1, 'm1', 'm2'))).ref;
    expect(must(s.decide(ref, 'accept', 'writer')).status).toBe('pending');
    s.w('m1', 6);
    expect(refusal(s.decide(ref, 'accept', 'reviewer')).guard_code).toBe('DELIVERABLE_CHANGED');
    expect(s.changes[0]).toMatchObject({ decider: 'reviewer', consumer: 'review' });
  });

  it('an unresolvable producer workspace refuses the accept, uncounted', () => {
    const lone = open(tmp(), { bindings: [briefBinding({ type: 'sheets', schema, deliverable_files: files('m1') } as never, [{ id: 'writing', deciders: ['writer'] }])] });
    const r0 = must(lone.publish({ role: 'researcher', type: 'sheets', body: bodyOf(1, 'm1'), idempotency_key: 'q' }));
    lone.addGuard(deliverableGuard({ workspaceOf: () => undefined }));
    const r = refusal(lone.decide({ role: 'writer', id: r0.id, version: 1, decision: 'accept', idempotency_key: 'a' }));
    expect(r.guard_code).toBe('DELIVERABLE_WORKSPACE_UNAVAILABLE');
    expect(lone.attempts('sheets')).toMatchObject({ refusals_used: 0 });
  });
});
