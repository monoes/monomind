// P3.9: the producer relay (open item 17) at engine level: a real store and event log, the real delivery journal, a
// fake deliver (and a real Mailbox for the eviction case). The cases mirror the harness's handoff-v2-relay.test.ts
// (contents, attempts left, copy to the lead, exhausted wording, nothing from a fault record, nothing on an accept,
// a failed delivery recorded) plus the durability matrix of both relay kinds.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeliverableChange } from '../../../src/orgrt/documents/deliverable-guards.js';
import { RUNTIME_SENDER } from '../../../src/orgrt/documents/deliver.js';
import { Mailbox } from '../../../src/orgrt/mailbox.js';
import { NoticeEngine, type NoticeSink } from '../../../src/orgrt/documents/notices.js';
import { COPY_REASON_CAP, REASON_CAP, capReason } from '../../../src/orgrt/documents/relay.js';
import type { TypeBinding } from '../../../src/orgrt/documents/store-types.js';
import { briefBinding, must, open, pub, refusal, tickingClock, tmp } from './store-support.js';

type Sent = { to: string; subject: string; body: string };
const norm = (s: string): string => s.replace(/\b[0-9a-f]{12}\b/g, '<rev>');
const isRelay = (m: Sent): boolean => /^document (rejected|needs republishing)/.test(m.subject);

/** The producing section's lead is `research-lead` unless a test says otherwise. */
const copyTo = (_section: string, producer: string): string | undefined => (producer === 'research-lead' ? 'boss' : 'research-lead');

function rig(dir = tmp('p39-'), over: { bindings?: TypeBinding[]; copy?: typeof copyTo | null } = {}) {
  const store = open(dir, over.bindings ? { bindings: over.bindings } : {});
  const copy = over.copy === null ? undefined : (over.copy ?? copyTo);
  const engine = new NoticeEngine({ dir, store, now: tickingClock(), ...(copy ? { copyTo: copy } : {}) });
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
  return { dir, store, engine, sent, sink, relays: () => sent.filter(isRelay) };
}
type Rig = ReturnType<typeof rig>;
const publish = (r: Rig, over = {}) => must(r.store.publish(pub(over)));
const decide = (r: Rig, role: string, id: string, version: number, decision: 'accept' | 'reject', reason = 'the second claim is not in the source') =>
  must(
    r.store.decide({
      role,
      id,
      version,
      decision,
      ...(decision === 'reject' ? { reason } : {}),
      idempotency_key: `d-${role}-${id}-${version}-${decision}-${reason.length}`,
    }),
  );
const change = (over: Partial<DeliverableChange> = {}): DeliverableChange => ({
  type: 'brief',
  doc: 'brief-1',
  version: 1,
  producer: 'researcher',
  decider: 'writer',
  consumer: 'writing',
  files: ['out/m1/answers.json'],
  problems: ["out/m1/answers.json differs from the document's sheets entry m1 at $.answers[3].value: the file has 203, the document has 206"],
  ...over,
});

describe('a rejection reaches the producer through the runtime', () => {
  it('sends one message to the producing role with document, version, contract, consumer, reason, rework rounds, attempts and what to do; the text is exact', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    await r.engine.idle();
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    const [p, lead] = r.relays();
    expect(r.relays()).toHaveLength(2);
    expect(p.to).toBe('researcher');
    expect(p.subject).toBe('document rejected: brief-1 v1 (writing)');
    expect(norm(p.body)).toBe(
      'writer (writing) rejected version 1 of document "brief-1" (contract: brief <rev>). Reason given: the second claim is not in the source ' +
        'Rework rounds so far for this document from writing: 1. ' +
        'Publish attempts for "brief": 0 of 3 used, 3 left (each publish the store refuses uses one). ' +
        'What to do: check the underlying deliverable against the code and fix it if the reason holds, then publish a corrected version with org_doc_publish (supersedes: "brief-1@v1"); it replaces the rejected one. ' +
        'If you are sure the reason is wrong, publish the same content again with a short note (the note argument of org_doc_publish) saying why.',
    );
    expect(lead.to).toBe('research-lead');
    expect(lead.subject).toBe('document rejected: brief-1 v1 (writing) (copy)');
    expect(lead.body).toBe(
      'writer rejected brief-1 v1: the second claim is not in the source (researcher was notified directly, no relay needed; publish attempts left 3).',
    );
    // the contract's revision in the text is the store's
    expect(r.store.contracts()[0].revision.startsWith(/\(contract: brief ([0-9a-f]{12})\)/.exec(p.body)![1])).toBe(true);
  });

  it('is one relay per committed rejection: an idempotent repeat of the decision sends nothing more, an accept sends nothing', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    expect(r.relays()).toHaveLength(2);
    decide(r, 'writer', 'brief-1', 1, 'reject'); // the identical decision is a no-op: nothing is committed
    await r.engine.idle();
    expect(r.relays()).toHaveLength(2);
    const acc = rig();
    acc.engine.start(acc.sink());
    publish(acc);
    decide(acc, 'writer', 'brief-1', 1, 'accept');
    decide(acc, 'reviewer', 'brief-1', 1, 'accept');
    await acc.engine.idle();
    expect(acc.relays()).toEqual([]);
  });

  it('names the producer that published THAT version, runs after the commit and never inside the decide call', async () => {
    const r = rig(undefined, { bindings: [{ ...briefBinding(), producers: ['researcher', 'analyst'] }] });
    r.engine.start(r.sink());
    const v1 = publish(r);
    publish(r, { role: 'analyst', supersedes: v1.ref });
    decide(r, 'writer', 'brief-1', 2, 'reject');
    expect(r.relays()).toEqual([]); // nothing ran inside the call
    await r.engine.idle();
    expect(r.relays().map((m) => `${m.to}:${m.subject}`)).toEqual([
      'analyst:document rejected: brief-1 v2 (writing)',
      'research-lead:document rejected: brief-1 v2 (writing) (copy)',
    ]);
  });

  it('relays the reason verbatim up to the cap and cuts it with an ellipsis marker beyond it; the copy has a shorter cap', async () => {
    expect(REASON_CAP).toBe(600);
    expect(COPY_REASON_CAP).toBe(200);
    const exact = 'x'.repeat(REASON_CAP);
    const long = `${exact}TAIL-NOT-SENT`;
    expect(capReason(exact, REASON_CAP)).toBe(exact);
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject', long);
    await r.engine.idle();
    const [p, lead] = r.relays();
    expect(p.body).toContain(`Reason given: ${exact}… [cut at 600 characters; the whole reason is in the decisions of org_doc_read] Rework`);
    expect(p.body).not.toContain('TAIL');
    expect(lead.body).toContain(`${'x'.repeat(COPY_REASON_CAP)}… [cut at 200 characters;`);
    expect(lead.body).not.toContain('x'.repeat(COPY_REASON_CAP + 1));
    expect(must(r.store.read({ role: 'researcher', id: 'brief-1', version: 1 })).decisions.writing.reason).toBe(long);
    // a surrogate pair split by the cut is dropped, never cut in half
    expect(capReason(`${'a'.repeat(599)}\u{1F600}b`, 600).startsWith('a'.repeat(599) + '…')).toBe(true);
  });

  it('states the attempts used and left from the store counters, and when they are exhausted says the section lead must take over', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    refusal(r.store.publish(pub({ body: { topic: 'x' } }))); // counted refusals use attempts
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    expect(r.store.attempts('brief')).toMatchObject({ used: 1, left: 2 });
    expect(r.relays()[0].body).toContain('Publish attempts for "brief": 1 of 3 used, 2 left');
    expect(r.relays()[1].body).toContain('publish attempts left 2)');
    // a publish that exhausts the attempts leaves a pending version nobody can replace: reject it
    const x = rig();
    x.engine.start(x.sink());
    publish(x);
    for (let i = 0; i < 3; i++) refusal(x.store.publish(pub({ body: { topic: 'x' } })));
    expect(x.store.attempts('brief')).toMatchObject({ used: 3, left: 0 });
    decide(x, 'reviewer', 'brief-1', 1, 'reject', 'still wrong');
    await x.engine.idle();
    const [p2, lead2] = x.relays();
    expect(p2.body).toContain('All 3 publish attempts for "brief" are used, so no further publish of this type will be accepted: your section lead must take over.');
    expect(lead2.body).toContain('publish attempts left 0, the section lead must take over');
    // the first message is unchanged by what happened later: the text is derived from the log up to its own event
    expect(norm(r.engine.notices().find((n) => n.key.endsWith(':producer'))!.body)).toContain('1 of 3 used, 2 left');
  });

  it('counts rework rounds per consuming section and names the section in the subject when there are several', async () => {
    const r = rig();
    r.engine.start(r.sink());
    const v1 = publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle(); // each relay goes out before the producer replaces the version (else it is moot)
    const v2 = publish(r, { supersedes: v1.ref });
    decide(r, 'writer', 'brief-1', 2, 'reject', 'the third claim is wrong');
    await r.engine.idle();
    publish(r, { supersedes: v2.ref });
    decide(r, 'reviewer', 'brief-1', 3, 'reject', 'format');
    await r.engine.idle();
    const mine = r.relays().filter((m) => m.to === 'researcher');
    expect(mine.map((m) => m.subject)).toEqual([
      'document rejected: brief-1 v1 (writing)',
      'document rejected: brief-1 v2 (writing)',
      'document rejected: brief-1 v3 (review)',
    ]);
    expect(mine.map((m) => /Rework rounds so far for this document from (\w+): (\d)/.exec(m.body)!.slice(1).join('='))).toEqual(['writing=1', 'writing=2', 'review=1']);
    const single = rig(undefined, { bindings: [briefBinding({}, [{ id: 'writing', deciders: ['writer'] }])] });
    single.engine.start(single.sink());
    publish(single);
    decide(single, 'writer', 'brief-1', 1, 'reject');
    await single.engine.idle();
    expect(single.relays()[0].subject).toBe('document rejected: brief-1 v1'); // one consuming section: nothing to tell apart
  });

  it('names the deliverable files of the contract in the what-to-do line', async () => {
    const files = ['m1', 'm2'].map((m) => ({ file: `out/${m}/answers.json`, select: { array: 'sheets', key: 'module', value: m }, compare: ['module'] }));
    const r = rig(undefined, { bindings: [briefBinding({ deliverable_files: files as never })] });
    r.engine.start(r.sink());
    publish(r); // the deliverable guard is not installed on a bare store, so the publish commits; the text names the files
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    expect(r.relays()[0].body).toContain('check the underlying deliverable (out/m1/answers.json, out/m2/answers.json) against the code');
  });

  it('carries nothing but the contract, the event fields and the reason: no body, note, fault, seed or injection text', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r, { body: { topic: 'An injected fault here', claims: ['seed 42 swapped values'] }, note: 'fault: swapped values, seed 42' });
    decide(r, 'writer', 'brief-1', 1, 'reject', 'claim 1 does not match the source');
    await r.engine.idle();
    for (const m of r.relays()) {
      expect(`${m.subject} ${m.body}`).not.toMatch(/fault|seed|inject|swapped|An injected/i);
      expect(`${m.subject} ${m.body}`).not.toContain('Pricing page');
    }
    // the same shape for every document
    const shape = (m: Sent) => norm(m.body).replace(/brief-\d/g, 'ID');
    publish(r);
    decide(r, 'writer', 'brief-2', 1, 'reject', 'claim 1 does not match the source');
    await r.engine.idle();
    const mine = r.relays().filter((m) => m.to === 'researcher');
    expect(shape(mine[0])).toBe(shape(mine[1]));
  });

  it('copies the root when the producer is the lead, and nobody when there is nobody else', async () => {
    const lead = rig(undefined, { bindings: [{ ...briefBinding(), producers: ['research-lead'] }] });
    lead.engine.start(lead.sink());
    publish(lead, { role: 'research-lead' });
    decide(lead, 'writer', 'brief-1', 1, 'reject');
    await lead.engine.idle();
    expect(lead.relays().map((m) => m.to)).toEqual(['research-lead', 'boss']);
    const alone = rig(undefined, { copy: null });
    alone.engine.start(alone.sink());
    publish(alone);
    decide(alone, 'writer', 'brief-1', 1, 'reject');
    await alone.engine.idle();
    expect(alone.relays().map((m) => m.to)).toEqual(['researcher']);
  });

  it('a relay about a version the producer already replaced is not sent to it, and is recorded as moot; the lead copy is an audit record and is still sent', async () => {
    const r = rig();
    const v1 = publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    publish(r, { supersedes: v1.ref }); // the producer republished before the engine could deliver
    r.engine.start(r.sink());
    await r.engine.idle();
    expect(r.relays().map((m) => m.to)).toEqual(['research-lead']);
    expect(readFileSync(join(r.dir, 'notices.jsonl'), 'utf8')).toContain('moot: version superseded');
  });
});

describe('a refused accept (deliverable files changed) reaches the producer through the runtime', () => {
  it('owes one message to the producer and a copy to the lead: the files, the first difference, and what to do; the text is exact', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    r.engine.owe(change());
    await r.engine.idle();
    const [p, lead] = r.relays();
    expect(p.to).toBe('researcher');
    expect(p.subject).toBe('document needs republishing: brief-1 v1');
    expect(norm(p.body)).toBe(
      'Version 1 of document "brief-1" (contract: brief <rev>) could not be accepted by writer (writing) because your deliverable files changed after you published it: out/m1/answers.json. ' +
        "First difference: out/m1/answers.json differs from the document's sheets entry m1 at $.answers[3].value: the file has 203, the document has 206. " +
        'Publish a corrected version with org_doc_publish (supersedes: "brief-1@v1") so the document and the files agree.',
    );
    expect(lead.to).toBe('research-lead');
    expect(lead.subject).toBe('document needs republishing: brief-1 v1 (copy)');
    expect(lead.body).toBe(
      'writer could not accept brief-1 v1: the deliverable files of researcher changed after publishing (out/m1/answers.json); researcher was notified directly to republish, no relay needed.',
    );
  });

  it('is one relay per version and difference: a retried accept while the files still differ is not relayed again, another difference is', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    r.engine.owe(change());
    r.engine.owe(change());
    await r.engine.idle();
    expect(r.relays()).toHaveLength(2);
    r.engine.owe(change({ files: ['out/m1/answers.json', 'out/m2/answers.json'], problems: ['out/m2/answers.json does not exist', 'out/m1/answers.json is not valid JSON'] }));
    await r.engine.idle();
    const second = r.relays().filter((m) => m.to === 'researcher')[1];
    expect(second.body).toContain('First difference: out/m2/answers.json does not exist (and 1 more).');
    expect(r.relays()).toHaveLength(4);
  });

  it('commits nothing to the store: the obligation is in the journal, and an unknown type owes nothing', async () => {
    const r = rig();
    publish(r);
    const before = r.store.info().seq;
    r.engine.owe(change());
    r.engine.owe(change({ type: 'nope' }));
    expect(r.store.info().seq).toBe(before);
    const owed = readFileSync(join(r.dir, 'notices.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(owed.map((o) => [o.t, o.audience, o.to])).toEqual([['owed', 'producer', 'researcher'], ['owed', 'lead', 'research-lead']]);
    expect(owed[0]).toMatchObject({ kind: 'deliverable-changed', doc: 'brief-1', version: 1, seq: before });
  });
});

describe('not lost: committed obligations, a journal, retry and re-delivery (both relay kinds)', () => {
  it('crash between the commit of a rejection and its delivery: the relay is owed and sent exactly once after the restart', async () => {
    const r = rig();
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject'); // committed; the engine had no delivery path (the process died)
    expect(r.engine.pending().filter((n) => n.kind === 'rejected')).toHaveLength(2);
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.relays().map((m) => `${m.to}:${m.subject}`)).toEqual(['researcher:document rejected: brief-1 v1 (writing)', 'research-lead:document rejected: brief-1 v1 (writing) (copy)']);
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start(third.sink());
    await third.engine.idle();
    expect(third.engine.pending()).toEqual([]);
    // a delivered producer relay is re-sent at a start while the producer has not republished and the mailbox does not
    // hold it (here: a fake mailbox that never holds anything); the copy to the lead is an audit record and is not
    expect(third.relays().map((m) => m.to)).toEqual(['researcher']);
  });

  it('crash between the refused accept and its delivery: the journalled obligation is sent exactly once after the restart', async () => {
    const r = rig();
    publish(r);
    r.engine.owe(change()); // journalled; no delivery path yet
    expect(r.engine.pending().filter((n) => n.kind === 'deliverable-changed')).toHaveLength(2);
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.relays().map((m) => m.to)).toEqual(['researcher', 'research-lead']);
    // the producer republishes: nothing is re-sent at the next start, and it does not matter that the journal has the record
    publish(next, { supersedes: 'brief-1@v1' });
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start(third.sink());
    await third.engine.idle();
    expect(third.relays()).toEqual([]);
  });

  it('crash BEFORE the journal line: no obligation exists, and the consumer never got the refusal either, so its retry owes it again', async () => {
    const r = rig();
    publish(r);
    r.engine.close(); // died inside the guard, before owe() wrote anything
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    expect(next.relays()).toEqual([]);
    next.engine.owe(change()); // the consumer retries its accept, the guard refuses again
    await next.engine.idle();
    expect(next.relays().map((m) => m.to)).toEqual(['researcher', 'research-lead']);
  });

  it('a delivered relay the producer has not acted on is re-sent on resume, unless the restored mailbox still holds it; once republished, never', async () => {
    const r = rig();
    r.engine.start(r.sink());
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    r.engine.owe(change());
    await r.engine.idle();
    expect(r.relays()).toHaveLength(4);
    r.engine.close();
    const kept = new Mailbox();
    kept.push(`[message from ${RUNTIME_SENDER}] subject: document rejected: brief-1 v1 (writing)\n\nrestored from a checkpoint`);
    const next = rig(r.dir);
    next.engine.start(next.sink(undefined, { queued: (to, s) => to === 'researcher' && kept.serialize().queue.some((m) => m.includes(`subject: ${s}\n`)) }));
    await next.engine.idle();
    expect(next.relays().map((m) => `${m.to}:${m.subject}`)).toEqual(['researcher:document needs republishing: brief-1 v1']);
    publish(next, { supersedes: 'brief-1@v1' });
    next.engine.close();
    const done = rig(r.dir);
    done.engine.start(done.sink());
    await done.engine.idle();
    expect(done.relays()).toEqual([]);
  });

  it('the Mailbox eviction at 500: a relay pushed out of a full queue is not silently lost, resume re-delivers it', async () => {
    const r = rig();
    const box = new Mailbox();
    const toBox: NoticeSink = {
      deliver: async (to, subject, body) => {
        if (to === 'researcher') box.push(`[message from ${RUNTIME_SENDER}] subject: ${subject}\n\n${body}`);
        return `delivered to ${to}`;
      },
    };
    const queued = (_to: string, s: string) => box.serialize().queue.some((m) => m.includes(`subject: ${s}\n`));
    r.engine.start(toBox);
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    for (let i = 0; i < 500; i++) box.push(`noise ${i}`);
    expect(box.serialize().queue.some((m) => m.includes('document rejected'))).toBe(false);
    r.engine.close();
    const next = rig(r.dir);
    next.engine.start({ ...toBox, queued });
    await next.engine.idle();
    expect(box.serialize().queue.filter((m) => m.includes('document rejected: brief-1 v1'))).toHaveLength(1);
    next.engine.close();
    const third = rig(r.dir);
    third.engine.start({ ...toBox, queued });
    await third.engine.idle();
    expect(box.serialize().queue.filter((m) => m.includes('document rejected: brief-1 v1'))).toHaveLength(1);
  });

  it('a failed relay is recorded and reported as a relay, retried at the next opportunity, bounded, and never throws into the decider', async () => {
    const r = rig();
    const emitted: string[] = [];
    let healthy = false;
    r.engine.start({
      deliver: async (to, subject, body) => {
        if (!healthy) return 'ERROR: unknown recipient';
        r.sent.push({ to, subject, body });
        return `delivered to ${to}`;
      },
      emit: (e) => e.reason.startsWith('doc-relay') && emitted.push(`${e.reason}|${e.msg.slice(0, 18)}`),
    });
    publish(r);
    await r.engine.idle();
    emitted.length = 0;
    expect(() => decide(r, 'writer', 'brief-1', 1, 'reject')).not.toThrow();
    await r.engine.idle();
    expect(emitted).toEqual(['doc-relay-failed|relay "document re', 'doc-relay-failed|relay "document re']); // producer and lead: each recipient fails once
    healthy = true;
    await r.engine.retry();
    expect(r.relays().map((m) => m.to)).toEqual(['researcher', 'research-lead']);
    expect(r.engine.relayFacts()[0]).toMatchObject({ state: 'delivered', failures: 1 });
    const dead = rig();
    const reasons: string[] = [];
    dead.engine.start({ deliver: async () => 'REFUSED: no', emit: (e) => reasons.push(e.reason) });
    publish(dead);
    decide(dead, 'writer', 'brief-1', 1, 'reject');
    for (let i = 0; i < 20; i++) await dead.engine.retry();
    expect(reasons).toContain('doc-relay-gave-up');
    expect(dead.engine.relayFacts()[0].state).toBe('exhausted');
    const n = reasons.length;
    await dead.engine.retry();
    expect(reasons.length).toBe(n);
  });

  it('a REFUSED relay is failed, a queued one delivered; a torn journal tail is ignored and not glued to the next record', async () => {
    const r = rig();
    r.engine.start({ deliver: async (to) => (to === 'researcher' ? 'queued for researcher (role starting)' : 'REFUSED: no') });
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    const f = r.engine.relayFacts()[0];
    expect(f.state).toBe('delivered');
    expect(f.copies).toEqual([{ to: 'research-lead', state: 'pending' }]);
    r.engine.close();
    appendFileSync(join(r.dir, 'notices.jsonl'), '{"t":"owed","key":"c:brief-1@v1:abc","at":"2026-10-04T12:0');
    const next = rig(r.dir);
    next.engine.start(next.sink());
    await next.engine.idle();
    next.engine.owe(change());
    await next.engine.idle();
    const lines = readFileSync(join(r.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } })).toHaveLength(1);
    expect(lines.filter((l) => l.includes('"t":"owed"') && l.includes('"audience"'))).toHaveLength(2);
  });

  it('with notices off (the internal test switch) no relay is sent and the obligation stays pending', async () => {
    const r = rig();
    r.engine.setEnabledForTest(false);
    r.engine.start(r.sink());
    publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    r.engine.owe(change());
    await r.engine.idle();
    expect(r.sent).toEqual([]);
    expect(r.engine.pending().filter((n) => n.kind === 'rejected' || n.kind === 'deliverable-changed')).toHaveLength(4);
  });
});

describe('the facts lead-watch needs', () => {
  it('per producer relay: delivered_at, the copies, and the first republish after the relay', async () => {
    const r = rig();
    r.engine.start(r.sink());
    const v1 = publish(r);
    decide(r, 'writer', 'brief-1', 1, 'reject');
    await r.engine.idle();
    let [f] = r.engine.relayFacts();
    expect(f).toMatchObject({ kind: 'rejected', doc: 'brief-1', version: 1, producer: 'researcher', state: 'delivered', failures: 0 });
    expect(typeof f.delivered_at).toBe('string');
    expect(f.republished_at).toBeUndefined();
    expect(f.copies.map((c) => [c.to, c.state])).toEqual([['research-lead', 'delivered']]);
    const v2 = publish(r, { supersedes: v1.ref });
    await r.engine.idle();
    [f] = r.engine.relayFacts();
    expect(f.republished_version).toBe(2);
    expect(f.republished_at).toBe(must(r.store.read({ role: 'researcher', id: 'brief-1', version: 2 })).at);
    expect(v2.version).toBe(2);
    r.engine.owe(change({ version: 2 }));
    await r.engine.idle();
    expect(r.engine.relayFacts().map((x) => [x.kind, x.version])).toEqual([['rejected', 1], ['deliverable-changed', 2]]);
  });
});
