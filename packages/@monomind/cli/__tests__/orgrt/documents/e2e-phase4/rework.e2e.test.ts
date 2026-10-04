// P4.12 scenario C: rework rounds end to end in the real daemon (no model). A producing section (coder, dev-lead),
// a consuming section (qa-lead) with max_rework_rounds 2, the root (boss) and an observer in no section. The
// consumer rejects: the first rejection is relayed to the producer (round 1 of 2); the second spends the cap, so
// the root and both leads get ONE durable notice, the producer is told to wait, a further revision is refused
// (REWORK_EXHAUSTED, uncounted, nothing committed), the root accepts the frozen head and the thread ends. A reload
// that raises the cap thaws a frozen thread. Every role is woken only by the runtime's own messages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { CostScripted, call, publish, review, settle, useWorld, waitFor } from './world.js';

const world = useWorld('p4-rework');
const org = (cap = 2) => {
  const raw = phase4Org(KEY_SETS.rework);
  raw.name = 'rework-org';
  raw.sections.qa.max_rework_rounds = cap;
  return raw;
};
const NOTICE = 'rework exhausted';
const journal = (dir: string): any[] =>
  readFileSync(join(dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const head = (docs: any, id: string) => docs.store.list().find((x: any) => x.id === id)?.head;

async function setup(cap = 2) {
  const runner = new CostScripted();
  const s = await world.start(org(cap), { runner });
  const tools: Record<string, any> = {};
  for (const r of ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer']) tools[r] = await runner.toolsOf(s.d, s.name, r);
  return { ...s, runner, tools };
}

describe('rework rounds with a cap of 2, end to end', () => {
  it('the first rejection is relayed, the second spends the cap: one notice to the root and both leads, the producer is refused, the root decides', async () => {
    const { runner, tools, docs, d, name } = await setup(2);
    expect(await publish(tools.coder, 'build', 'first try')).toMatchObject({ ok: true, ref: 'build-1@v1' });

    // round 1 of 2: rejected, relayed to the producer with the round counted by the same rule, no escalation yet
    expect(await review(tools['qa-lead'], 'build-1', 1, 'reject', 'the tests are missing')).toMatchObject({ ok: true, status: 'rejected' });
    expect(await waitFor(() => runner.count('coder', 'document rejected') === 1)).toBe(true);
    const relay1 = runner.textsOf('coder', 'document rejected')[0];
    expect(relay1).toContain('the tests are missing');
    expect(relay1).toContain('This is rework round 1 of 2 for this document from qa.');
    expect(relay1).not.toContain('is spent');
    await docs.notices!.idle();
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(0);
    expect(docs.reworkReport()).toMatchObject([{ rounds: 1, cap: 2, exhausted: false, frozen: false }]);

    // the producer revises (supersedes v1): allowed, a new version
    expect(await publish(tools.coder, 'build', 'second try', { supersedes: 'build-1@v1' })).toMatchObject({ ok: true, ref: 'build-1@v2' });
    const attemptsBefore = docs.store.attempts('build');

    // round 2 of 2: the cap is spent
    expect(await review(tools['qa-lead'], 'build-1', 2, 'reject', 'still no tests')).toMatchObject({ ok: true, status: 'rejected' });
    expect(await waitFor(() => runner.count('boss', NOTICE) === 1)).toBe(true);
    await docs.notices!.idle();
    expect(await waitFor(() => runner.count('dev-lead', NOTICE) === 1 && runner.count('qa-lead', NOTICE) === 1)).toBe(true);
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(1);
    for (const r of ['coder', 'observer']) expect(runner.count(r, NOTICE), r).toBe(0);
    const bossMsg = runner.textsOf('boss', NOTICE)[0];
    expect(bossMsg).toMatch(/^\[message from org-docs\] subject: rework exhausted: build-1 \(qa\)\n/);
    expect(bossMsg).toContain('qa has rejected 2 versions of it, which is its cap of 2 rework rounds');
    expect(bossMsg).toContain('Last rejection: version 2, by qa-lead: still no tests');
    const relay2 = runner.textsOf('coder', 'document rejected')[1];
    expect(relay2).toContain('This is rework round 2 of 2 for this document from qa.');
    expect(relay2).toContain('The cap of 2 rework rounds is spent, so this document is frozen');

    // the lineage is frozen: a revision is refused, never counted, nothing committed; a NEW document is still allowed
    const refused = await publish(tools.coder, 'build', 'third try', { supersedes: 'build-1@v2' });
    expect(refused).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED', guard_code: 'REWORK_EXHAUSTED' });
    expect(docs.store.list().find((x) => x.id === 'build-1')!.versions).toHaveLength(2);
    expect(docs.store.attempts('build')).toEqual(attemptsBefore);
    expect(docs.reworkReport()).toMatchObject([{ rounds: 2, cap: 2, exhausted: true, frozen: true }]);
    expect(await publish(tools.coder, 'build', 'a different change')).toMatchObject({ ok: true, ref: 'build-2@v1' });

    // only the root decides a frozen head: not the observer, and not the root for a version that is not frozen
    await call(tools.observer, 'org_doc_read', { id: 'build-1', version: 2 });
    expect(await call(tools.observer, 'org_doc_decide', { id: 'build-1', version: 2, decision: 'accept' })).toMatchObject({ ok: false });
    await call(tools.boss, 'org_doc_read', { id: 'build-2', version: 1 });
    expect(await call(tools.boss, 'org_doc_decide', { id: 'build-2', version: 1, decision: 'accept' })).toMatchObject({ ok: false });
    expect(await review(tools.boss, 'build-1', 2, 'accept')).toMatchObject({ ok: true, decision: 'accept', consumer: 'qa', status: 'accepted' });
    expect(head(docs, 'build-1')).toMatchObject({ version: 2, status: 'accepted' });
    expect(docs.reworkReport()).toMatchObject([{ rounds: 1, cap: 2, exhausted: false, frozen: false }]); // the thread ended: the root's accept settles it

    // exactly once: the three notices are journalled once each, and asking the engine again sends nothing
    await docs.notices!.retry();
    await settle();
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(1);
    const delivered = journal(docs.dir).filter((j) => j.t === 'delivered' && String(j.key).startsWith('x:'));
    expect(delivered).toHaveLength(3);
    expect(new Set(delivered.map((j) => j.key)).size).toBe(3);
    expect(runner.errors).toEqual([]);
    await d.stopOrg(name);
  });

  it('a reload that raises the cap thaws a frozen thread with no stop; the revision then goes through', async () => {
    const { runner, tools, docs, d, name } = await setup(2);
    await publish(tools.coder, 'build', 'one');
    await review(tools['qa-lead'], 'build-1', 1, 'reject');
    await publish(tools.coder, 'build', 'two', { supersedes: 'build-1@v1' });
    await review(tools['qa-lead'], 'build-1', 2, 'reject');
    expect(await waitFor(() => runner.count('boss', NOTICE) === 1)).toBe(true);
    expect(await publish(tools.coder, 'build', 'three', { supersedes: 'build-1@v2' })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });

    world.write(org(3));
    expect(d.reloadOrgDef(name).changed).toContain('sections.qa.max_rework_rounds');
    expect(docs.reworkReport()).toMatchObject([{ rounds: 2, cap: 3, exhausted: false, frozen: false }]);
    expect(await publish(tools.coder, 'build', 'three', { supersedes: 'build-1@v2' })).toMatchObject({ ok: true, ref: 'build-1@v3' });
    await review(tools['qa-lead'], 'build-1', 3, 'accept');
    expect(head(docs, 'build-1')).toMatchObject({ version: 3, status: 'accepted' });
    await docs.notices!.idle();
    expect(runner.count('boss', NOTICE)).toBe(1); // the raised cap owes nothing new
  });
});
