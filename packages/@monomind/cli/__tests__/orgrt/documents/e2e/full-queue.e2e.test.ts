// P3.14, the "full queue" acceptance of R24 as far as the runtime has it: the mailbox is bounded (it drops its
// oldest item at 500) and the non-evicting outbox is a named, unbuilt item (spec 9.1, A41). What the runtime does
// have is: a notice that was delivered but evicted before the consumer took it is NOT silently lost. The journal
// says "delivered", the consumer never reads, the unread-watch tells the lead (cause not-read), and the next start
// sends the notice again because the consumer neither read nor decided that version and its mailbox no longer
// holds it. Scripted, no model; the consumer is busy in its first turn while 505 other messages arrive.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, honest, idOf, miniOrg, writeFiles } from './mini-org.js';
import { Scripted, call, useWorld, waitFor } from './scripted.js';
import { jsonl } from './trail.js';

const world = useWorld('e2e-fullq');
const [W1] = MINI_DOCS;

describe('a delivered notice evicted from a full mailbox', () => {
  it('is reported by the unread watch and sent again by the next start, then the consumer decides it', async () => {
    const r1 = new Scripted();
    const first = await world.start(miniOrg({ unreadS: 0.4 }), { runner: r1 });
    let release!: () => void;
    const busy = new Promise<void>((r) => (release = r));
    r1.on.set('synthesiser', async (text) => {
      if (text.includes('subject: brief')) await busy; // the consumer is in the middle of a long first turn
    });
    await first.d.deliver(first.name, 'human', 'synthesiser', 'brief', 'brief');
    expect(await waitFor(() => r1.subjects('synthesiser').includes('brief'))).toBe(true);
    const w1 = await r1.toolsOf(first.d, first.name, 'worker-1');
    writeFiles(world.root, honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({ ok: true });
    await first.docs.notices!.idle();
    expect(jsonl(join(first.docs.dir, 'notices.jsonl')).map((j) => `${j.t}:${j.key}`)).toEqual(['delivered:p:1:synthesiser']);
    // 505 other messages queue behind it: the oldest, the notice, is dropped by the bounded mailbox
    for (let i = 0; i < 505; i++) await first.d.deliver(first.name, 'human', 'synthesiser', `filler ${i}`, 'x');
    release();
    expect(await waitFor(() => r1.subjects('synthesiser').includes('filler 504'), 30_000)).toBe(true);
    expect(r1.subjects('synthesiser').some((s) => s.startsWith('document ready'))).toBe(false); // evicted, never seen
    // the watch tells the lead: the notice is on the journal as delivered, and nothing was read
    const unread = () => first.running.busEvents().filter((e) => e.reason === 'doc-unread');
    expect(await waitFor(() => unread().length >= 1)).toBe(true);
    expect(unread()[0].data).toMatchObject({ doc: idOf(W1), version: 1, cause: 'not-read', unread: ['synthesiser'] });
    await first.d.stopOrg(first.name);

    // the next start: delivered, not acted on, no longer queued -> sent again (and journalled as such)
    const r2 = new Scripted();
    const cast = new Cast(world.root);
    cast.install(r2);
    const again = await world.start(miniOrg({ unreadS: 0.4 }), { runner: r2, resume: true });
    cast.bind(() => again.docs.store);
    expect(await waitFor(() => r2.subjects('synthesiser').includes(`document ready: ${idOf(W1)} v1`))).toBe(true);
    expect(await waitFor(() => again.docs.store.list()[0]?.head.status === 'accepted')).toBe(true);
    expect(r2.subjects('synthesiser').filter((s) => s.startsWith('document ready'))).toEqual([`document ready: ${idOf(W1)} v1`]);
    const resent = jsonl(join(again.docs.dir, 'notices.jsonl')).filter((j) => j.again);
    expect(resent.map((j) => j.key)).toEqual(['p:1:synthesiser']);
    expect(again.running.busEvents().filter((e) => e.reason === 'doc-notice-resent')).toHaveLength(1);
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);
  }, 60_000);
});
