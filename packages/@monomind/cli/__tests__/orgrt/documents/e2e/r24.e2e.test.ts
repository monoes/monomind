// P3.14 scenario 1, the R24 acceptance (spec section 11) on the miniature sweep org through a real OrgDaemon: a
// consumer briefed before any document exists, which ends its turn, is woken ONLY by the runtime's messages and
// completes read -> check -> decide for every document; with the notices disabled (the internal test switch) the
// same script deadlocks, nothing is read or decided, and the unread-watch tells the lead; the committed notices
// were never lost, so enabling delivery again completes the run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, idOf, miniOrg } from './mini-org.js';
import { Scripted, useWorld, waitFor } from './scripted.js';

const world = useWorld('e2e-r24');
const jsonl = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('R24 in the daemon: an idle consumer woken only by messages', () => {
  it('briefed before any document exists and ending its turn, it reads, checks and decides every document, woken by notices alone', async () => {
    const runner = new Scripted();
    const { d, name, docs } = await world.start(miniOrg(), { runner });
    const cast = new Cast(world.root).bind(() => docs.store).install(runner);
    await runner.toolsOf(d, name, 'synthesiser', 'brief: sheets will come, process each when it is published');
    expect(runner.subjects('synthesiser')).toEqual(['brief: sheets will come, process each when it is published']); // idle
    await Cast.assign(d, name);
    const done = await waitFor(() => cast.synthesis !== undefined, 4000);
    expect(runner.errors).toEqual([]);
    expect(done).toBe(true);
    await docs.notices!.idle();

    expect(docs.store.list().map((x) => `${x.id}:v${x.head.version}:${x.head.status}`).sort()).toEqual(
      MINI_DOCS.map((t) => `${idOf(t)}:v1:accepted`).sort(),
    );
    // every document went read -> check -> decide, in that order, for the very version the notice named
    for (const t of MINI_DOCS) {
      const mine = cast.calls.filter((c) => c.ref === `${idOf(t)}@v1` && c.role === 'synthesiser');
      expect(mine.map((c) => `${c.tool}:${c.ok}`)).toEqual(['org_doc_read:true', 'org_doc_check:true', 'org_doc_decide:true']);
    }
    // the consumer's only wake-ups were the runtime's messages: one notice per publish, one all-available message
    const subjects = runner.subjects('synthesiser');
    expect(subjects.slice(1).filter((s) => s.startsWith('document ready')).sort()).toEqual(
      MINI_DOCS.map((t) => `document ready: ${idOf(t)} v1`).sort(),
    );
    expect(subjects.filter((s) => s === 'all documents are available')).toHaveLength(1);
    expect(subjects).toHaveLength(1 + 3 + 1);
    // the facts the lead-watch needs: each publish notified the one decision maker and each was read
    const facts = docs.notices!.facts();
    expect(facts).toHaveLength(3);
    for (const f of facts) {
      expect(f.notices).toMatchObject([{ role: 'synthesiser', state: 'delivered' }]);
      expect(Object.keys(f.first_read_at)).toEqual(['synthesiser']);
    }
    // the check calls are on the record, all clean
    expect(docs.checks.counts()).toMatchObject({ calls: 3, ran: 3, refused: 0, calls_flagging: 0 });
    expect(jsonl(join(docs.dir, 'notices.jsonl')).every((j) => j.t === 'delivered')).toBe(true);
  });

  it('regression: the same script with the notices off deadlocks, the unread-watch tells the lead, and enabling delivery completes the run', async () => {
    const runner = new Scripted();
    const { d, name, docs, running } = await world.start(miniOrg({ unreadS: 0.4 }), { runner });
    const cast = new Cast(world.root).bind(() => docs.store).install(runner);
    docs.notices!.setEnabledForTest(false);
    await runner.toolsOf(d, name, 'synthesiser', 'brief: sheets will come, process each when it is published');
    await Cast.assign(d, name);
    const unread = () => running.busEvents().filter((e) => e.reason === 'doc-unread');
    expect(await waitFor(() => unread().length === 3)).toBe(true);
    // the consumer was never woken: nothing read, nothing decided, nothing synthesised
    expect(runner.subjects('synthesiser')).toEqual(['brief: sheets will come, process each when it is published']);
    expect(docs.store.list().every((x) => x.head.status === 'pending')).toBe(true);
    expect(cast.calls.filter((c) => c.role === 'synthesiser')).toEqual([]);
    expect(docs.notices!.pending().length).toBeGreaterThan(0);
    // one lead event per published document, naming the consumer and the cause; the lead (root) got the notices
    expect(unread().map((e) => e.data?.doc).sort()).toEqual(MINI_DOCS.map((t) => idOf(t)).sort());
    for (const e of unread()) expect(e.data).toMatchObject({ to: 'lead', unread: ['synthesiser'], cause: 'notice-undelivered', n: 1 });
    expect(await waitFor(() => runner.texts('lead').filter((t) => t.includes('[watch] Document')).length === 3)).toBe(true);
    // the committed notices were never lost: with delivery on again the consumer completes everything
    docs.notices!.setEnabledForTest(true);
    await docs.notices!.retry();
    expect(await waitFor(() => cast.synthesis !== undefined)).toBe(true);
    expect(docs.store.list().every((x) => x.head.status === 'accepted')).toBe(true);
    expect(runner.errors).toEqual([]);
  });
});
