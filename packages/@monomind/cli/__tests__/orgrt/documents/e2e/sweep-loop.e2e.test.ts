// P3.14 scenario 2, the sweep-3 v2 loop end to end in the real daemon on a miniature of the sweep org: a root lead,
// three producers (own sections) with checks and deliverable files, a consuming synthesiser section. The faults
// are made BY THE SCRIPTED PRODUCERS (no harness injector): worker-1 publishes a wrong value, then (after the
// relay) reversed files, then the honest sheets; worker-2's document first disagrees with its files (refused as a
// consistency refusal) and then carries a duplicated sheet; worker-3 is honest. The consumer, woken only by the
// runtime's notices, reads, runs org_doc_check, rejects flagged documents with the reasons, the runtime relays
// to the producers, they republish, the consumer accepts, and the synthesis is built from the accepted versions.
// The full trail is pinned as fixtures/sections-on/e2e-sweep-trail.json (re-capture: see trail.ts).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, duplicatedSheet, honest, idOf, miniOrg, reversedFiles, wrongValue } from './mini-org.js';
import { Scripted, useWorld, waitFor } from './scripted.js';
import { expectGoldenOn, jsonl, noFaultRecord, trailOf } from './trail.js';

const world = useWorld('e2e-sweep');
const [W1, W2, W3] = MINI_DOCS;
const sheetSum = (b: ReturnType<typeof honest>) => b.sheets.reduce((n, s) => n + (s.answers.find((a) => a.q === 'q05')?.value as number), 0);

async function runLoop() {
  const runner = new Scripted();
  const started = await world.start(miniOrg(), { runner });
  const { d, name, docs, running } = started;
  const cast = new Cast(world.root, {
    [W1]: { work: [{ body: wrongValue(W1) }], relay: [{ body: reversedFiles(W1) }] },
    [W2]: { work: [{ body: duplicatedSheet(W2), files: honest(W2) }, { body: duplicatedSheet(W2) }] },
  })
    .bind(() => docs.store)
    .install(runner);
  await runner.toolsOf(d, name, 'synthesiser', 'brief: sheets will come, process each when it is published');
  await Cast.assign(d, name);
  expect(await waitFor(() => cast.synthesis !== undefined, 15000)).toBe(true);
  await docs.notices!.idle();
  const copies = () => runner.subjects('lead').filter((s) => s.endsWith('(copy)'));
  expect(await waitFor(() => copies().length === 3)).toBe(true);
  await docs.notices!.idle();
  expect(runner.errors).toEqual([]);
  return { ...started, runner, cast, docs, running };
}

describe('the sweep-3 v2 loop on the miniature org', () => {
  it('check, reject with reasons, relay, republish, accept, synthesise from the accepted versions', async () => {
    const { runner, cast, docs, running } = await runLoop();
    // the final state: three accepted heads, the faulty versions rejected, nothing pending
    expect(docs.store.list().map((x) => `${x.id}:${x.versions.map((v) => `v${v.version}:${v.status}`).join(',')}`).sort()).toEqual([
      `${idOf(W1)}:v1:rejected,v2:rejected,v3:accepted`,
      `${idOf(W2)}:v1:rejected,v2:accepted`,
      `${idOf(W3)}:v1:accepted`,
    ]);
    // the counts: 6 versions published, 3 rejections relayed (producer + copy), 1 consistency refusal, no failure
    const counts = docs.store.list().flatMap((x) => x.versions).length;
    expect(counts).toBe(6);
    expect(docs.store.attempts(W2)).toMatchObject({ refusals_used: 1 });
    expect(docs.store.attempts(W1)).toMatchObject({ refusals_used: 0 });
    const journal = jsonl(join(docs.dir, 'notices.jsonl'));
    expect(journal.map((j) => j.t)).toEqual(Array(13).fill('delivered')); // 6 publish notices + 1 all-available + 3 relays + 3 copies
    expect(new Set(journal.map((j) => j.key)).size).toBe(13); // each obligation delivered exactly once
    expect(journal.filter((j) => j.again)).toEqual([]);
    expect(docs.checks.counts()).toMatchObject({ calls: 6, ran: 6, refused: 0, calls_flagging: 3 });
    // the consumer read -> check -> decided each version once, in that order, and its reasons name the checks
    for (const [ref, decision] of [[`${idOf(W1)}@v1`, 'reject'], [`${idOf(W1)}@v2`, 'reject'], [`${idOf(W1)}@v3`, 'accept'], [`${idOf(W2)}@v1`, 'reject'], [`${idOf(W2)}@v2`, 'accept'], [`${idOf(W3)}@v1`, 'accept']]) {
      const mine = cast.calls.filter((c) => c.ref === ref && c.role === 'synthesiser');
      expect(mine.map((c) => c.tool), ref).toEqual(['org_doc_read', 'org_doc_check', 'org_doc_decide']);
      const ev = jsonl(join(docs.dir, 'events.jsonl')).find((e) => e.type === 'decided' && `${e.doc}@v${e.version}` === ref);
      expect(ev.decision, ref).toBe(decision);
    }
    const reasons = jsonl(join(docs.dir, 'events.jsonl')).filter((e) => e.type === 'decided' && e.decision === 'reject').map((e) => `${e.doc}@v${e.version}: ${e.reason}`);
    expect(reasons.find((r) => r.startsWith(`${idOf(W1)}@v1`))).toContain('value_matches_chain');
    expect(reasons.find((r) => r.startsWith(`${idOf(W1)}@v2`))).toContain('files_match_evidence');
    expect(reasons.find((r) => r.startsWith(`${idOf(W2)}@v1`))).toContain('unique_across_sheets');
    // the runtime relayed each rejection to its producer (and a copy to the root), carrying the consumer's reason
    const relayed = (w: string) => runner.texts(w).filter((t) => /subject: document rejected/.test(t));
    expect(relayed('worker-1').map((t) => /subject: (.*)/.exec(t)?.[1])).toEqual([`document rejected: ${idOf(W1)} v1`, `document rejected: ${idOf(W1)} v2`]);
    expect(relayed('worker-1')[0]).toMatch(/^\[message from org-docs\]/);
    expect(relayed('worker-1')[0]).toContain('value_matches_chain');
    expect(relayed('worker-1')[1]).toContain('files_match_evidence');
    expect(relayed('worker-2').map((t) => /subject: (.*)/.exec(t)?.[1])).toEqual([`document rejected: ${idOf(W2)} v1`]);
    expect(relayed('worker-3')).toEqual([]);
    expect(runner.subjects('lead').filter((s) => s.endsWith('(copy)')).sort()).toEqual([`document rejected: ${idOf(W1)} v1 (copy)`, `document rejected: ${idOf(W1)} v2 (copy)`, `document rejected: ${idOf(W2)} v1 (copy)`]);
    // the relay facts lead-watch will read: every rejection delivered and answered by a republish
    for (const f of docs.notices!.relayFacts()) expect(f).toMatchObject({ kind: 'rejected', state: 'delivered', republished_version: f.version + 1 });
    // the synthesis was built from the accepted versions alone, after the last acceptance
    expect(cast.synthesis).toEqual({
      inputs: { [idOf(W1)]: { version: 3, status: 'accepted' }, [idOf(W2)]: { version: 2, status: 'accepted' }, [idOf(W3)]: { version: 1, status: 'accepted' } },
      sum_q05: MINI_DOCS.reduce((n, t) => n + sheetSum(honest(t)), 0),
    });
    expect(JSON.parse(readFileSync(join(world.root, 'out', 'synthesis.json'), 'utf8'))).toEqual(cast.synthesis);
    const events = jsonl(join(docs.dir, 'events.jsonl'));
    const lastDecided = events.map((e) => e.type).lastIndexOf('decided');
    expect(events.slice(lastDecided + 1).map((e) => `${e.type}:${e.by}`)).toEqual(Array(3).fill('read:synthesiser'));
    // the all-available message went out once; no failed or re-sent delivery, no document bus event
    expect(runner.subjects('synthesiser').filter((s) => s === 'all documents are available')).toHaveLength(1);
    expect(running.busEvents().filter((e) => e.type === 'audit' && /^doc-/.test(e.reason ?? ''))).toEqual([]);
    expect(running.busEvents().filter((e) => e.type === 'message' && e.from === 'org-docs')).toHaveLength(13); // every delivery is on the bus
  });

  it('no fault-record information reaches any message, journal, event or check record', async () => {
    const { runner, docs } = await runLoop();
    for (const t of runner.allTexts()) expect(noFaultRecord(t), t.slice(0, 200)).toBe(true);
    for (const f of ['events.jsonl', 'notices.jsonl', 'checks.jsonl'])
      for (const l of readFileSync(join(docs.dir, f), 'utf8').split('\n').filter(Boolean)) expect(noFaultRecord(l), `${f}: ${l.slice(0, 200)}`).toBe(true);
    expect(readdirSync(docs.dir).sort()).toEqual(['checks.jsonl', 'contracts', 'events.jsonl', 'notices.jsonl', 'part-reads.jsonl', 'sweep-1', 'sweep-2', 'sweep-3']);
  });

  it('the full trail equals the pinned golden', async () => {
    const { root, running, docs, runner, cast } = { ...(await runLoop()), root: world.root };
    expectGoldenOn('e2e-sweep-trail', trailOf({ root, running, docs, runner, cast }));
  });
});
