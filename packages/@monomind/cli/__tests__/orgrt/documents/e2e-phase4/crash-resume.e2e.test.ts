// P4.12 scenario F: stop the daemon mid-scenario and resume from the persisted state, in the real daemon (no model). The
// "process died" moments are made with the notice engine's test switch (nothing is delivered while it is off, exactly as a
// process that died after a commit and before its delivery pass) and, for the budget notices, by closing their engine
// before the crossing (the obligation is journalled, never sent). Then the org is stopped and started again with `resume`
// and a fresh runner. Exactly-once recovery: each owed message is delivered once (a relay whose rejection committed, a
// rework or loop exhaustion committed before its notice, a budget crossing before its notice), nothing already sent is sent
// again on a third start, the freeze and the exhaustion are derived from the replayed log, and the root can still decide.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { CostScripted, call, loopToRejectedLastRound, publish, review, settle, spend, useWorld, waitFor } from './world.js';

const world = useWorld('p4-crash');
const jsonl = (file: string): any[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ALL = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const WARN = 'budget: section "development" at 80 percent';

/** Every role started on `runner`, so what it was sent can be counted. */
async function allTools(started: { d: any; name: string }, runner: CostScripted, roles = ALL): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  for (const r of roles) tools[r] = await runner.toolsOf(started.d, started.name, r);
  return tools;
}

describe('rework, relays and a budget crossing, all committed before their delivery', () => {
  const org = () => ({ ...phase4Org(KEY_SETS.all), name: 'crash-e2e' }); // writer, budgets, rework (qa 2, development 3), a declared loop

  it('the resume delivers each owed message once, the freeze survives, the root decides, and a third start sends nothing', async () => {
    // ---- first process: everything the runtime owes stays undelivered ----
    const r1 = new CostScripted();
    const first = await world.start(org(), { runner: r1 });
    const t1 = await allTools(first, r1);
    first.docs.notices!.setEnabledForTest(false); // the process "dies" after each commit below: no document notice or relay goes out
    first.running.sectionBudget!.notices.close(); // and no budget notice
    await publish(t1.coder, 'build', 'one try');
    await review(t1['qa-lead'], 'build-1', 1, 'reject', 'no tests');
    await publish(t1.coder, 'build', 'two try', { supersedes: 'build-1@v1' });
    await review(t1['qa-lead'], 'build-1', 2, 'reject', 'still no tests'); // the cap of 2 is spent
    await spend(first.d, first.name, first.running, 'coder', 17, 17);
    await spend(first.d, first.name, first.running, 'dev-lead', 7, 7); // development at 24 of 30: the crossing
    expect(await waitFor(() => first.running.sectionBudget!.notices.records().length === 2)).toBe(true);
    expect(first.docs.notices!.pending().map((n: any) => `${n.kind}:${n.audience ?? ''}:${n.to}`).sort()).toEqual([
      'published::qa-lead',
      'published::qa-lead',
      'rejected:lead:dev-lead',
      'rejected:lead:dev-lead',
      'rejected:producer:coder',
      'rejected:producer:coder',
      'rework-exhausted::boss',
      'rework-exhausted:lead:dev-lead',
      'rework-exhausted:lead:qa-lead',
    ]);
    expect(first.running.sectionBudget!.notices.records().map((n: any) => `${n.kind}:${n.to}:${n.state}`).sort()).toEqual([
      'section-budget-warning:boss:pending',
      'section-budget-warning:dev-lead:pending',
    ]);
    for (const r of ['boss', 'dev-lead', 'coder', 'qa-lead']) expect(r1.count(r, 'rework exhausted') + r1.count(r, 'document ') + r1.count(r, 'budget:'), r).toBe(0);
    const eventsBefore = jsonl(join(first.docs.dir, 'events.jsonl'));
    await first.d.stopOrg(first.name);

    // ---- second process: resume with a fresh runner ----
    const r2 = new CostScripted();
    const second = await world.start(org(), { runner: r2, resume: true });
    expect(second.running.run).toBe(first.running.run);
    expect(jsonl(join(second.docs.dir, 'events.jsonl')).slice(0, eventsBefore.length)).toEqual(eventsBefore); // replayed byte for byte
    const t2 = await allTools(second, r2);
    expect(await waitFor(() => r2.count('boss', 'rework exhausted') === 1 && r2.count('boss', WARN) === 1)).toBe(true);
    await second.docs.notices!.idle();
    await second.running.sectionBudget!.notices.idle();
    expect(await waitFor(() => r2.count('dev-lead', 'rework exhausted') === 1 && r2.count('qa-lead', 'rework exhausted') === 1 && r2.count('dev-lead', WARN) === 1)).toBe(true);
    expect(r2.count('qa-lead', 'document ready')).toBe(2); // the two publish notices
    expect(r2.count('dev-lead', 'document rejected')).toBe(2); // the two copies
    // the relay of v1 was already answered by the v2 revision, so the producer is sent the one that is still open
    expect(r2.subjectsAll('coder').filter((s) => s.startsWith('document rejected'))).toEqual(['document rejected: build-1 v2']);
    expect(r2.textsOf('coder', 'document rejected')[0]).toContain('The cap of 2 rework rounds is spent');
    expect(r2.count('observer', 'rework')).toBe(0);
    // the freeze is derived from the replayed log, straight after the resume; the root can decide the frozen head
    expect(await publish(t2.coder, 'build', 'three try', { supersedes: 'build-1@v2' })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
    expect(await review(t2.boss, 'build-1', 2, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    // the budget crossing is not owed again by a later usage event (the crossing is known from the journal)
    await spend(second.d, second.name, second.running, 'dev-lead', 1, 8);
    await settle();
    expect(r2.count('boss', WARN)).toBe(1);
    const owed = jsonl(join(second.docs.dir, 'budget-notices.jsonl'));
    expect(owed.filter((j) => j.t === 'owed')).toHaveLength(2);
    expect(owed.filter((j) => j.t === 'delivered')).toHaveLength(2);
    expect(jsonl(join(second.docs.dir, 'notices.jsonl')).filter((j) => j.t === 'failed' || j.again)).toEqual([]);
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);
    await second.d.stopOrg(second.name);

    // ---- third process: everything was sent, nothing is sent again ----
    const r3 = new CostScripted();
    const third = await world.start(org(), { runner: r3, resume: true });
    await allTools(third, r3);
    await third.docs.notices!.idle();
    await third.running.sectionBudget!.notices.idle();
    await settle(300);
    for (const r of ALL) {
      for (const prefix of ['rework exhausted', 'document ', 'budget:']) expect(r3.count(r, prefix), `${r} ${prefix}`).toBe(0);
    }
    const delivered = jsonl(join(third.docs.dir, 'notices.jsonl')).filter((j) => j.t === 'delivered');
    expect(new Set(delivered.map((j) => j.key)).size).toBe(delivered.length); // never twice
  }, 60_000);
});

describe('a loop exhaustion committed before its notice', () => {
  const org = () => ({ ...phase4Org(KEY_SETS.loop), name: 'crash-loop' });

  it('the escalation goes out once after the resume, the producer is refused straight away, the root decides and the loop ends; a third start sends nothing', async () => {
    const r1 = new CostScripted();
    const first = await world.start(org(), { runner: r1 });
    const t1 = await allTools(first, r1, ['boss', 'dev-lead', 'coder', 'qa-lead']);
    first.docs.notices!.setEnabledForTest(false);
    await loopToRejectedLastRound(t1);
    expect(first.docs.loopReport()[0]).toMatchObject({ rounds: 2, exhausted: true, frozen: true });
    expect(first.docs.notices!.pending().filter((n: any) => n.kind === 'loop-exhausted').map((n: any) => n.to).sort()).toEqual(['boss', 'dev-lead', 'qa-lead']);
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(r1.count(r, 'loop exhausted'), r).toBe(0);
    await first.d.stopOrg(first.name);

    const r2 = new CostScripted();
    const second = await world.start(org(), { runner: r2, resume: true });
    const t2 = await allTools(second, r2, ['boss', 'dev-lead', 'coder', 'qa-lead']);
    expect(await waitFor(() => ['boss', 'dev-lead', 'qa-lead'].every((r) => r2.count(r, 'loop exhausted') === 1))).toBe(true);
    await second.docs.notices!.idle();
    expect(r2.count('coder', 'loop exhausted')).toBe(0);
    expect(second.docs.loopReport()[0]).toMatchObject({ rounds: 2, exhausted: true, frozen: true });
    // the producer's next return is refused at once, from the replayed log, and the root's decision ends the loop
    await publish(t2['qa-lead'], 'report', 'still one defect', { inputs: ['build-3@v1'] });
    await review(t2['dev-lead'], 'report-3', 1, 'accept');
    expect(await publish(t2.coder, 'build', 'one more try', { inputs: ['report-3@v1'] })).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
    expect(await review(t2.boss, 'build-3', 1, 'accept')).toMatchObject({ ok: true, consumer: 'qa', status: 'accepted' });
    expect(second.docs.loopReport()[0]).toMatchObject({ settled: true, frozen: false });
    await second.d.stopOrg(second.name);

    const r3 = new CostScripted();
    const third = await world.start(org(), { runner: r3, resume: true });
    await allTools(third, r3, ['boss', 'dev-lead', 'coder', 'qa-lead']);
    await third.docs.notices!.idle();
    await settle(300);
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(r3.count(r, 'loop exhausted'), r).toBe(0);
    expect(jsonl(join(third.docs.dir, 'notices.jsonl')).filter((j) => j.t === 'delivered' && String(j.key).startsWith('l:'))).toHaveLength(3);
    expect(third.docs.loopReport()[0]).toMatchObject({ settled: true });
    expect(r1.errors.concat(r2.errors, r3.errors)).toEqual([]);
    void call;
  }, 60_000);
});
