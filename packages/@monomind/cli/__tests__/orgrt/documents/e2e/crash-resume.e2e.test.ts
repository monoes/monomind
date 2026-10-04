// P3.14 scenario 6: stop the daemon mid-scenario and resume from the persisted state. The "process died" moments
// are made with the notice engine's test switch (it sends nothing while off, exactly as a process that died after a
// commit and before its delivery pass), then the org is stopped and started again with `resume`, with a fresh
// scripted runner (new sessions). Exactly-once recovery: the documents replay from the event log, every committed
// obligation is delivered once (a publish whose notice never went out, a rejection whose relay never went out),
// nothing already acted on is sent again, and no decision is made twice.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, honest, idOf, miniOrg, wrongValue, writeFiles } from './mini-org.js';
import { Scripted, call, useWorld, waitFor } from './scripted.js';
import { jsonl } from './trail.js';

const world = useWorld('e2e-crash');
const [W1, W2, W3] = MINI_DOCS;
const noticeOf = (id: string, v: number) => `document ready: ${id} v${v}`;

describe('crash and resume mid-scenario', () => {
  it('after a publish (notice never sent) and after a reject (relay never sent): the resume delivers each obligation exactly once and the loop completes', async () => {
    // ---- first process ----
    const r1 = new Scripted();
    const first = await world.start(miniOrg(), { runner: r1 });
    const cast = new Cast(world.root, { [W1]: { work: [{ body: wrongValue(W1) }] } }).bind(() => first.docs.store).install(r1);
    await r1.toolsOf(first.d, first.name, 'synthesiser', 'brief');
    for (const w of ['worker-1', 'worker-2', 'worker-3', 'lead']) await r1.toolsOf(first.d, first.name, w);
    await Cast.assign(first.d, first.name, [W3]); // a document fully through the loop: published, noticed, accepted
    expect(await waitFor(() => cast.processed.has(`${idOf(W3)}@v1`))).toBe(true);
    let release!: () => void;
    cast.hold = new Promise((r) => (release = r));
    await Cast.assign(first.d, first.name, [W1]); // published and noticed...
    expect(await waitFor(() => r1.subjects('synthesiser').includes(noticeOf(idOf(W1), 1)))).toBe(true);
    first.docs.notices!.setEnabledForTest(false); // ...the process dies after this point: nothing more is delivered
    release();
    expect(await waitFor(() => first.docs.store.list().find((x) => x.id === idOf(W1))?.head.status === 'rejected')).toBe(true); // a reject committed, its relay never sent
    await Cast.assign(first.d, first.name, [W2]); // a publish committed, its notice never sent
    expect(await waitFor(() => first.docs.store.list().length === 3)).toBe(true);
    await first.docs.notices!.idle();
    expect(first.docs.notices!.pending().map((n) => `${n.kind}:${n.audience ?? ''}:${n.to}`).sort()).toEqual([
      'all-available::synthesiser',
      'published::synthesiser',
      'rejected:lead:lead',
      'rejected:producer:worker-1',
    ]);
    const log1 = jsonl(join(first.docs.dir, 'events.jsonl'));
    const delivered1 = jsonl(join(first.docs.dir, 'notices.jsonl'));
    expect(delivered1).toHaveLength(2); // only w3's and w1's publish notices went out
    await first.d.stopOrg(first.name);

    // ---- second process: resume with a fresh runner ----
    const r2 = new Scripted();
    cast.install(r2);
    const again = await world.start(miniOrg(), { runner: r2, resume: true });
    cast.bind(() => again.docs.store);
    expect(again.running.run).toBe(first.running.run);
    // the documents replayed from the log: the committed events are the same prefix, byte for byte
    expect(jsonl(join(again.docs.dir, 'events.jsonl')).slice(0, log1.length)).toEqual(log1);
    expect(await waitFor(() => cast.synthesis !== undefined)).toBe(true);
    await again.docs.notices!.idle();
    expect(await waitFor(() => r2.subjects('lead').filter((s) => s.endsWith('(copy)')).length === 1)).toBe(true);

    // every obligation was delivered exactly once over both processes, and nothing acted on was re-sent
    const journal = jsonl(join(again.docs.dir, 'notices.jsonl'));
    const delivered = journal.filter((j) => j.t === 'delivered');
    expect(new Set(delivered.map((j) => j.key)).size).toBe(delivered.length);
    expect(delivered).toHaveLength(7); // 2 before the stop; after it: w2's notice, all-available, relay, copy, w1 v2's notice
    expect(journal.filter((j) => j.again || j.t === 'failed')).toEqual([]);
    // what the second process sent: the unsent publish notice, the all-available message, the v2 notice, the relay and its copy
    expect(r2.subjects('synthesiser').filter((s) => s.startsWith('document ready')).sort()).toEqual([noticeOf(idOf(W1), 2), noticeOf(idOf(W2), 1)].sort());
    expect(r2.subjects('synthesiser').filter((s) => s === 'all documents are available')).toHaveLength(1);
    expect(r2.subjects('worker-1').filter((s) => s.startsWith('document rejected'))).toEqual([`document rejected: ${idOf(W1)} v1`]);
    expect(r2.subjects('lead').filter((s) => s.endsWith('(copy)'))).toEqual([`document rejected: ${idOf(W1)} v1 (copy)`]);
    // the first process had already told the consumer about w1 v1 and w3 v1, and the second did not repeat them
    expect(r1.subjects('synthesiser').filter((s) => s.startsWith('document ready')).sort()).toEqual([noticeOf(idOf(W1), 1), noticeOf(idOf(W3), 1)].sort());
    // no duplicate decision, and the loop completed: w1 republished (v2), everything accepted
    const decided = jsonl(join(again.docs.dir, 'events.jsonl')).filter((e) => e.type === 'decided').map((e) => `${e.doc}@v${e.version}:${e.decision}`);
    expect(decided.sort()).toEqual([`${idOf(W1)}@v1:reject`, `${idOf(W1)}@v2:accept`, `${idOf(W2)}@v1:accept`, `${idOf(W3)}@v1:accept`].sort());
    expect(new Set(decided).size).toBe(decided.length);
    expect(again.docs.store.list().every((x) => x.head.status === 'accepted')).toBe(true);
    expect(cast.synthesis?.inputs[idOf(W1)]).toEqual({ version: 2, status: 'accepted' });
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);
  });

  it('the unread watch is seeded from the bus history on resume: the episode count carries over', async () => {
    const r1 = new Scripted();
    const first = await world.start(miniOrg({ unreadS: 0.4 }), { runner: r1 });
    first.docs.notices!.setEnabledForTest(false); // the consumer is never told, so nobody reads
    await r1.toolsOf(first.d, first.name, 'synthesiser');
    const w1 = await r1.toolsOf(first.d, first.name, 'worker-1');
    writeFiles(world.root, honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({ ok: true });
    const unread = (r: typeof first) => r.running.busEvents().filter((e) => e.reason === 'doc-unread');
    expect(await waitFor(() => unread(first).length === 1)).toBe(true);
    expect(unread(first)[0].data).toMatchObject({ key: `${idOf(W1)}@v1>lead`, n: 1, cause: 'notice-undelivered' });
    await first.d.stopOrg(first.name);
    // the second process sends the committed notice, the consumer still does not read: the same episode goes on at n 2
    const again = await world.start(miniOrg({ unreadS: 0.4 }), { runner: new Scripted(), resume: true });
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => unread(again).some((e) => e.data?.n === 2), 12_000)).toBe(true);
    const second = unread(again).find((e) => e.data?.n === 2);
    expect(second?.data).toMatchObject({ key: `${idOf(W1)}@v1>lead`, n: 2, cause: 'not-read' });
    expect(unread(again).filter((e) => e.data?.n === 1)).toEqual([]);
  });
});
