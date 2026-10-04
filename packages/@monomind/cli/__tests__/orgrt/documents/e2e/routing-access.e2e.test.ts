// P3.14 scenarios 4 and 5 in the live loop of the miniature org.
//  4. org_send across sections is refused (and audited) while documents are the route: the runtime's own notices
//     and relays, sent as org-docs, are never refused.
//  5. Access: a wrong producer, reader or decider is refused while a document is in flight; the refusals change
//     no document state and send no message, and the loop then completes.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, honest, idOf, miniOrg, writeFiles } from './mini-org.js';
import { Scripted, call, useWorld, waitFor } from './scripted.js';
import { jsonl } from './trail.js';

const world = useWorld('e2e-access');
const [W1] = MINI_DOCS;

async function send(tools: { name: string; handler: (a: any) => Promise<{ text: string }> }[], to: string): Promise<string> {
  const t = tools.find((x) => x.name === 'org_send');
  if (!t) throw new Error('no org_send');
  return (await t.handler({ to, subject: 'hello', message: 'a private note' })).text;
}

describe('cross-section org_send inside the live loop', () => {
  it('a producer cannot message another section or the consumer; the lead can be reached; the documents route is open', async () => {
    const runner = new Scripted();
    const { d, name, docs, running } = await world.start(miniOrg(), { runner });
    const cast = new Cast(world.root).bind(() => docs.store).install(runner);
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    await runner.toolsOf(d, name, 'worker-2');
    const syn = await runner.toolsOf(d, name, 'synthesiser');
    const refusal = (from: string, fromSection: string, to: string, toSection: string) =>
      `REFUSED: ${from} (section ${fromSection}) cannot message ${to} (section ${toSection}). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can reach any section.`;
    expect(await send(w1, 'worker-2')).toBe(refusal('worker-1', 'sweep-1', 'worker-2', 'sweep-2'));
    expect(await send(w1, 'synthesiser')).toBe(refusal('worker-1', 'sweep-1', 'synthesiser', 'synthesis'));
    expect(await send(syn, 'worker-1')).toBe(refusal('synthesiser', 'synthesis', 'worker-1', 'sweep-1'));
    expect(await send(w1, 'lead')).toBe('delivered to lead'); // the root can be reached from any section
    // nothing reached the refused targets, and each refusal is on the audit trail
    expect(runner.subjects('worker-2')).toEqual(['brief']);
    expect(runner.subjects('synthesiser')).toEqual(['brief']);
    const audits = running.busEvents().filter((e) => e.reason === 'cross-section-refused');
    expect(audits.map((e) => `${e.from}>${e.to}`)).toEqual(['worker-1>worker-2', 'worker-1>synthesiser', 'synthesiser>worker-1']);
    // documents are the route: the publish reaches the consumer through the runtime (org-docs is never refused)
    writeFiles(world.root, honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({ ok: true });
    expect(await waitFor(() => docs.store.list()[0]?.head.status === 'accepted')).toBe(true);
    expect(cast.calls.some((c) => c.tool === 'org_doc_decide' && c.ok)).toBe(true);
    expect(running.busEvents().filter((e) => e.reason === 'cross-section-refused')).toHaveLength(3); // none new
    expect(runner.errors).toEqual([]);
  });
});

describe('access refusals in the live loop', () => {
  it('a wrong producer, reader or decider is refused in flight, changes nothing, and the loop then completes', async () => {
    const runner = new Scripted();
    const { d, name, docs } = await world.start(miniOrg({ observer: true }), { runner });
    const cast = new Cast(world.root).bind(() => docs.store).install(runner);
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    const w2 = await runner.toolsOf(d, name, 'worker-2');
    const syn = await runner.toolsOf(d, name, 'synthesiser');
    const obs = await runner.toolsOf(d, name, 'observer');
    let release!: () => void;
    cast.hold = new Promise((r) => (release = r)); // the document stays in flight while the refusals are tried
    writeFiles(world.root, honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({ ok: true });
    await docs.notices!.idle();
    const before = { events: jsonl(join(docs.dir, 'events.jsonl')).length, notices: jsonl(join(docs.dir, 'notices.jsonl')).length, told: runner.allTexts().length };

    const id = idOf(W1);
    const codes = [
      await call(w2, 'org_doc_publish', { type: W1, body: honest(W1) }), // another section's producer
      await call(syn, 'org_doc_publish', { type: W1, body: honest(W1) }), // the consumer is no producer
      await call(obs, 'org_doc_publish', { type: W1, body: honest(W1) }), // a role in no section
      await call(obs, 'org_doc_read', { id }), // a role in no section reads nothing
      await call(w2, 'org_doc_read', { id }), // nor does another producer
      await call(w2, 'org_doc_check', { id }),
      await call(w1, 'org_doc_decide', { id, version: 1, decision: 'accept' }), // the producer decides nothing
      await call(w2, 'org_doc_decide', { id, version: 1, decision: 'accept' }),
      await call(obs, 'org_doc_decide', { id, version: 1, decision: 'reject', reason: 'no' }),
    ].map((r) => `${r.ok}:${r.code}`);
    expect(codes).toEqual([
      'false:ACCESS_PUBLISH',
      'false:ACCESS_PUBLISH',
      'false:ACCESS_PUBLISH',
      'false:ACCESS_READ',
      'false:ACCESS_READ',
      'false:ACCESS_READ',
      'false:ACCESS_DECIDE',
      'false:ACCESS_DECIDE',
      'false:ACCESS_DECIDE',
    ]);
    // the refusals changed nothing and told nobody
    expect(jsonl(join(docs.dir, 'events.jsonl')).length).toBe(before.events);
    expect(jsonl(join(docs.dir, 'notices.jsonl')).length).toBe(before.notices);
    expect(runner.allTexts().length).toBe(before.told);
    expect(docs.store.list()[0]).toMatchObject({ head: { version: 1, status: 'pending' } });
    // the right roles still can: the consumer decides once released
    release();
    expect(await waitFor(() => docs.store.list()[0]?.head.status === 'accepted')).toBe(true);
    expect(cast.calls.filter((c) => c.role === 'synthesiser' && c.ok).map((c) => c.tool)).toEqual(['org_doc_read', 'org_doc_check', 'org_doc_decide']);
    expect(await call(w1, 'org_doc_read', { id })).toMatchObject({ ok: true, status: 'accepted' }); // the producer may read its own
    expect(runner.errors).toEqual([]);
  });
});
