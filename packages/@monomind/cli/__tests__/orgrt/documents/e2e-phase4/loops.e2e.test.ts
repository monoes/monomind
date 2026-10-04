// P4.12 scenario D: a dev and QA loop end to end in the real daemon (no model). The two sections hand documents round
// in a cycle (development publishes `build`, qa publishes `report` on it, development builds again on the report), and
// loops[0] declares it with max_rounds 2. A round is counted through `inputs` (the real store, inputsOf), exhaustion
// is escalated once to the root and both leads, a further return is refused (LOOP_EXHAUSTED, uncounted), the root
// decides. An undeclared cycle is a definition error at start.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { loopOrg } from '../../support/loop-defs.js';
import { role } from '../../support/doc-defs.js';
import { OrgDefSchema } from '../../../../src/orgrt/types.js';
import { checklistFindings } from '../../../../src/orgrt/validate-checklist.js';
import { CostScripted, publish, review, settle, useWorld, waitFor } from './world.js';

const world = useWorld('p4-loops');
const org = () => ({ ...phase4Org(KEY_SETS.loop), name: 'loop-e2e' });
const NOTICE = 'loop exhausted';
const loopJournal = (dir: string): any[] =>
  readFileSync(join(dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => String(j.key).startsWith('l:'));

async function setup() {
  const runner = new CostScripted();
  const s = await world.start(org(), { runner });
  const tools: Record<string, any> = {};
  for (const r of ['boss', 'dev-lead', 'coder', 'qa-lead']) tools[r] = await runner.toolsOf(s.d, s.name, r);
  return { ...s, runner, tools };
}

describe('a dev and QA loop to exhaustion', () => {
  it('rounds are counted through inputs; the cap is spent at the second return; the escalation goes out once; a third return is refused; the root decides', async () => {
    const { runner, tools, docs, d, name } = await setup();
    const rounds = () => docs.loopReport()[0];

    // round 0: development's first build, qa reviews it and reports on it (the report names its input)
    expect(await publish(tools.coder, 'build', 'the first build')).toMatchObject({ ok: true, ref: 'build-1@v1' });
    expect(await review(tools['qa-lead'], 'build-1', 1, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    expect(await publish(tools['qa-lead'], 'report', 'two defects found', { inputs: ['build-1@v1'] })).toMatchObject({ ok: true, ref: 'report-1@v1' });
    expect(rounds()).toMatchObject({ rounds: 0, max_rounds: 2, exhausted: false, frozen: false });

    // return 1: development builds again on the report
    expect(await review(tools['dev-lead'], 'report-1', 1, 'accept')).toMatchObject({ ok: true });
    expect(await publish(tools.coder, 'build', 'fixed the defects', { inputs: ['report-1@v1'] })).toMatchObject({ ok: true, ref: 'build-2@v1' });
    expect(rounds()).toMatchObject({ rounds: 1, exhausted: false });

    // return 2: the cap. The round is still allowed and under review: nothing is escalated yet
    await review(tools['qa-lead'], 'build-2', 1, 'accept');
    await publish(tools['qa-lead'], 'report', 'one defect left', { inputs: ['build-2@v1'] });
    await review(tools['dev-lead'], 'report-2', 1, 'accept');
    expect(await publish(tools.coder, 'build', 'fixed the last defect', { inputs: ['report-2@v1'] })).toMatchObject({ ok: true, ref: 'build-3@v1' });
    expect(rounds()).toMatchObject({ rounds: 2, exhausted: true, frozen: true, settled: false });
    await docs.notices!.idle();
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(0);

    // qa rejects the last round: the round that would have been needed next. One notice to the root and both leads
    expect(await review(tools['qa-lead'], 'build-3', 1, 'reject', 'the fix breaks the parser')).toMatchObject({ ok: true, status: 'rejected' });
    expect(await waitFor(() => runner.count('boss', NOTICE) === 1)).toBe(true);
    await docs.notices!.idle();
    expect(await waitFor(() => runner.count('dev-lead', NOTICE) === 1 && runner.count('qa-lead', NOTICE) === 1)).toBe(true);
    expect(runner.count('coder', NOTICE)).toBe(0);
    const bossMsg = runner.textsOf('boss', NOTICE)[0];
    expect(bossMsg).toMatch(/^\[message from org-docs\] subject: loop exhausted: loops\[0\] \(development, qa\)\n/);
    expect(bossMsg).toContain('max_rounds 2 (loops[0].max_rounds)');
    expect(bossMsg).toContain('Last rejection: build-3@v1, by qa-lead for qa: the fix breaks the parser');

    // a third return is refused, not counted, nothing committed; the cycle's other half still works
    await publish(tools['qa-lead'], 'report', 'still one defect', { inputs: ['build-3@v1'] });
    await review(tools['dev-lead'], 'report-3', 1, 'accept');
    const versions = docs.store.list().flatMap((x) => x.versions).length;
    const attempts = docs.store.attempts('build');
    const third = await publish(tools.coder, 'build', 'one more try', { inputs: ['report-3@v1'] });
    expect(third).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED', guard_code: 'LOOP_EXHAUSTED' });
    expect(third.remedy).toContain('wait for the root');
    expect(docs.store.list().flatMap((x) => x.versions)).toHaveLength(versions);
    expect(docs.store.attempts('build')).toEqual(attempts);
    expect(rounds()).toMatchObject({ rounds: 2, exhausted: true, frozen: true });

    // the root decides: accepting the last version ends the loop
    expect(await review(tools.boss, 'build-3', 1, 'accept')).toMatchObject({ ok: true, consumer: 'qa', status: 'accepted' });
    expect(rounds()).toMatchObject({ exhausted: true, settled: true, frozen: false });

    // escalated once: three journal entries, one per recipient, and a retry sends nothing
    await docs.notices!.retry();
    await settle();
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(1);
    expect(loopJournal(docs.dir).filter((j) => j.t === 'delivered')).toHaveLength(3);
    expect(runner.errors).toEqual([]);
    await d.stopOrg(name);
  });

  it('a last round that qa accepts ends the loop cleanly: no escalation, no root decision owed', async () => {
    const { runner, tools, docs } = await setup();
    await publish(tools.coder, 'build', 'one');
    await review(tools['qa-lead'], 'build-1', 1, 'accept');
    await publish(tools['qa-lead'], 'report', 'report one', { inputs: ['build-1@v1'] });
    await review(tools['dev-lead'], 'report-1', 1, 'accept');
    await publish(tools.coder, 'build', 'two', { inputs: ['report-1@v1'] });
    await review(tools['qa-lead'], 'build-2', 1, 'accept');
    await publish(tools['qa-lead'], 'report', 'report two', { inputs: ['build-2@v1'] });
    await review(tools['dev-lead'], 'report-2', 1, 'accept');
    await publish(tools.coder, 'build', 'three', { inputs: ['report-2@v1'] });
    expect(await review(tools['qa-lead'], 'build-3', 1, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    await docs.notices!.idle();
    await settle();
    for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(runner.count(r, NOTICE), r).toBe(0);
    expect(docs.loopReport()[0]).toMatchObject({ rounds: 2, exhausted: true, settled: true, frozen: false });
  });
});

describe('at org start', () => {
  it('an undeclared cycle between sections is a definition error naming both sections and the remedy', async () => {
    await expect(world.start(loopOrg(null))).rejects.toThrow(/sections "development", "qa" hand documents around a cycle .* and no loop declares it/);
  });

  it('a loop that names an unknown section is refused at start; one that covers no cycle is a warning (it bounds nothing)', async () => {
    await expect(world.start(loopOrg(2, (r) => (r.loops[0].between = ['development', 'nowhere'])))).rejects.toThrow(/loops\[0\]\.between: section "nowhere" does not exist/);
    const noCycle = loopOrg(2, (r) => {
      r.roles.push(role('observer', 'boss'));
      r.sections.development.consumes = [];
      r.sections.qa.publishes = [];
      delete r.documents.report;
      r.loops[0].types = ['build'];
    });
    // covering no cycle is a validate WARNING (the loop bounds nothing): the org still starts
    expect(checklistFindings(OrgDefSchema.parse(noCycle)).warnings.join('\n')).toMatch(/loops\[0\]: "development", "qa" do not form a cycle of document hand-offs, so this loop bounds nothing/);
    expect((await world.start(noCycle)).docs).toBeDefined();
  });

  it('loops outside the sections surface is still not supported: it fails at start with the validate text', async () => {
    const raw = loopOrg(2);
    delete raw.sections;
    delete raw.documents;
    delete raw.requires;
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    await expect(world.start(raw, { evalGate: false })).rejects.toThrow(/"loops" is not yet supported/);
  });
});
