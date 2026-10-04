// P3.14 scenario 3, deliverable consistency in the live loop on the miniature org: a publish that disagrees with
// the producer's files is refused and counted as a consistency refusal (no attempt used, no notice, no version),
// the producer fixes the file and republishes; an accept refused after the producer changed a file triggers the
// changed-deliverable relay, the producer republishes, and the consumer, woken by the supersede notice, accepts.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cast } from './cast.js';
import { MINI_DOCS, honest, idOf, miniOrg, wrongValue, writeFiles } from './mini-org.js';
import { Scripted, call, useWorld, waitFor } from './scripted.js';
import { jsonl } from './trail.js';

const world = useWorld('e2e-consist');
const [W1] = MINI_DOCS;

/** The honest document with one value and its evidence trace changed together: still passes every check. */
function bumped(doc: string) {
  const b = honest(doc);
  const a = b.sheets[1].answers[3];
  a.value += 5;
  a.evidence[0].out += 5;
  return b;
}

describe('consistency refusals', () => {
  it('a publish disagreeing with the files is refused and counted as a consistency refusal; the producer fixes the file and republishes', async () => {
    const runner = new Scripted();
    const { d, name, docs } = await world.start(miniOrg(), { runner });
    new Cast(world.root).bind(() => docs.store).install(runner);
    await runner.toolsOf(d, name, 'synthesiser');
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    const wrong = wrongValue(W1);
    writeFiles(world.root, honest(W1)); // the producer's files say one thing, the document another
    const refused = await call(w1, 'org_doc_publish', { type: W1, body: wrong });
    expect(refused).toMatchObject({ ok: false, code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_MISMATCH', refusals_left: 4 });
    expect(refused.error).toMatch(/out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[4\]\.value/);
    expect(refused.error).not.toContain(world.root);
    expect(refused).not.toHaveProperty('attempts_left'); // a consistency refusal uses no publish attempt
    // counted, durable, and nothing downstream happened: no version, no notice, the consumer was not woken
    expect(docs.store.attempts(W1)).toMatchObject({ used: 0, left: 4, refusals_used: 1, refusals_left: 4 });
    expect(jsonl(join(docs.dir, 'events.jsonl')).map((e) => `${e.type}:${e.counts ?? ''}:${e.code ?? ''}`)).toEqual(['refused:consistency:DELIVERABLE_MISMATCH']);
    expect(docs.store.list()).toEqual([]);
    await docs.notices!.idle();
    expect(runner.subjects('synthesiser')).toEqual(['brief']);
    expect(jsonl(join(docs.dir, 'notices.jsonl'))).toEqual([]);
    // the producer fixes the file and republishes: accepted into the store, the consumer is told
    writeFiles(world.root, wrong);
    expect(await call(w1, 'org_doc_publish', { type: W1, body: wrong })).toMatchObject({ ok: true, ref: `${idOf(W1)}@v1` });
    expect(await waitFor(() => runner.subjects('synthesiser').includes(`document ready: ${idOf(W1)} v1`))).toBe(true);
    expect(docs.store.attempts(W1)).toMatchObject({ refusals_used: 1 });
    expect(runner.errors).toEqual([]);
  });

  it('an accept refused after the producer changed a file triggers the changed-deliverable relay; the republish supersedes and is accepted', async () => {
    const runner = new Scripted();
    const { d, name, docs, running } = await world.start(miniOrg(), { runner });
    const cast = new Cast(world.root, { [W1]: { work: [{ body: honest(W1) }], relay: [{ body: bumped(W1) }] } })
      .bind(() => docs.store)
      .install(runner);
    await runner.toolsOf(d, name, 'synthesiser');
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    let release!: () => void;
    cast.hold = new Promise((r) => (release = r)); // the consumer is busy while the producer's file moves
    writeFiles(world.root, honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({ ok: true });
    writeFiles(world.root, bumped(W1)); // the producer edits its file after publishing
    release();
    expect(await waitFor(() => docs.store.list()[0]?.versions.length === 2 && docs.store.list()[0].head.status === 'accepted')).toBe(true);
    await docs.notices!.idle();
    // the refusal reached the consumer's model as a tool result, and was not retried by it
    const decides = cast.calls.filter((c) => c.role === 'synthesiser' && c.tool === 'org_doc_decide');
    expect(decides.map((c) => `${c.ref}:${c.ok}:${c.guard_code ?? ''}`)).toEqual([`${idOf(W1)}@v1:false:DELIVERABLE_CHANGED`, `${idOf(W1)}@v2:true:`]);
    // the runtime told the producer, naming the file, with no daemon override and no role action
    const msg = runner.texts('worker-1').find((t) => /subject: document needs republishing/.test(t)) as string;
    expect(msg).toMatch(/^\[message from org-docs\] subject: document needs republishing: module-sheets-w1-1 v1\n/);
    expect(msg).toContain('because your deliverable files changed after you published it: out/m2/answers.json.');
    expect(msg).not.toContain(world.root);
    expect(runner.texts('worker-1').filter((t) => t.includes('needs republishing'))).toHaveLength(1);
    // the supersede notice brought the consumer back, naming what it supersedes
    const ready = runner.texts('synthesiser').filter((t) => t.includes('document ready'));
    expect(ready).toHaveLength(2);
    expect(ready[1]).toContain('It supersedes version 1, which you had not decided: decide on this version instead.');
    // journalled before delivery, delivered once, answered by the republish
    const journal = jsonl(join(docs.dir, 'notices.jsonl'));
    expect(journal.filter((j) => j.t === 'owed').map((j) => j.kind)).toEqual(['deliverable-changed', 'deliverable-changed']); // producer and copy
    expect(docs.notices!.relayFacts()).toMatchObject([{ kind: 'deliverable-changed', doc: idOf(W1), version: 1, state: 'delivered', republished_version: 2 }]);
    expect(running.busEvents().filter((e) => e.type === 'audit' && /^doc-/.test(e.reason ?? ''))).toEqual([]);
    expect(runner.errors).toEqual([]);
  });
});
