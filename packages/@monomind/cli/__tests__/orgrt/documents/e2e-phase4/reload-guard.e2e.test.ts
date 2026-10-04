// P4.12 scenario H (the reload guard, P4.10, which the plan's list for P4.12 does not letter): a running sections org with
// all four Phase 4 keys cannot change its structure through a reload. A structural reload is refused whole (atomic: the
// running definition, the role caps and the document flow are exactly as they were, an audit event names the reason, the
// file stays on disk for a restart); a reload that carries only live keys (a section allocation with the org budget, a
// rework cap, a loop's max_rounds) is applied, and each takes effect at once on the documents in flight.
import { describe, expect, it } from 'vitest';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { CostScripted, publish, review, useWorld, waitFor } from './world.js';

const world = useWorld('p4-reload');
type Raw = Record<string, any>;
const ALL = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const org = (edit: (r: Raw) => void = () => {}): Raw => {
  const raw = phase4Org(KEY_SETS.all); // writer (development), budgets, rework caps (qa 2, development 3), loop max_rounds 2
  raw.name = 'reload-e2e';
  edit(raw);
  return raw;
};
const events = (running: any, reason: string): any[] => running.busEvents().filter((e: any) => e.reason === reason);
const caps = (running: any) => Object.fromEntries(ALL.map((id) => [id, running.agents.get(id)?.policy.policy.maxUsd]));
const snapshot = (running: any) => JSON.stringify({ def: running.def, caps: caps(running) });

async function setup() {
  const runner = new CostScripted();
  const s = await world.start(org(), { runner });
  const tools: Record<string, any> = {};
  for (const r of ALL) tools[r] = await runner.toolsOf(s.d, s.name, r);
  return { ...s, runner, tools };
}

describe('a structural reload of a running Phase 4 org', () => {
  const refused: Array<[string, (r: Raw) => void, RegExp]> = [
    ['the writing scope changed', (r) => (r.sections.development.writes = ['lib/**']), /sections\.development\.writes: /],
    ['a section lead changed', (r) => (r.sections.development.lead = 'coder'), /sections\.development\.lead: /],
    ['a loop re-pointed at other types', (r) => (r.loops[0].types = ['build']), /loops\[0\]\.types: loop 0: types changed .*only max_rounds reloads/],
    ['a document contract changed', (r) => (r.documents.build = { schema: { ...r.documents.build.schema, required: ['summary', 'notes'] } }), /documents\.build: document type "build" changed/],
  ];
  for (const [label, edit, pattern] of refused)
    it(`is refused whole and the live org carries on: ${label}`, async () => {
      const { d, name, running, tools, docs } = await setup();
      expect(await publish(tools.coder, 'build', 'before the reload')).toMatchObject({ ok: true, ref: 'build-1@v1' });
      const before = snapshot(running);
      const applied = events(running, 'hot-reload').length;
      world.write(org(edit));
      let message = '';
      try {
        d.reloadOrgDef(name);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/^org reload-e2e: reload refused, the running org keeps its definition and nothing was applied: /);
      expect(message).toMatch(pattern);
      expect(message).toMatch(/stop and start the org to apply it/);
      expect(snapshot(running)).toBe(before);
      expect(events(running, 'hot-reload-refused')).toHaveLength(1);
      expect(events(running, 'hot-reload-refused')[0].data).toMatchObject({ reason: 'structural' });
      expect(events(running, 'hot-reload')).toHaveLength(applied);
      // the documents in flight are untouched: qa reviews the build and the loop's counters are the same
      expect(await review(tools['qa-lead'], 'build-1', 1, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
      expect(docs.loopReport()[0]).toMatchObject({ max_rounds: 2, rounds: 0 });
    });

  it('a mixed reload (a raise the guard would allow and a structural key) applies nothing; the same file without the structural key is applied whole', async () => {
    const { d, name, running } = await setup();
    const before = snapshot(running);
    const raise = (r: Raw) => {
      r.sections.qa.max_rework_rounds = 3;
      r.loops[0].max_rounds = 3;
    };
    world.write(org((r) => (raise(r), (r.sections.development.lead = 'coder'))));
    expect(() => d.reloadOrgDef(name)).toThrow(/sections\.development\.lead: /);
    expect(snapshot(running)).toBe(before);
    expect((running.def as any).sections.qa.max_rework_rounds).toBe(2);
    expect((running.def as any).loops[0].max_rounds).toBe(2);
    world.write(org(raise));
    expect(d.reloadOrgDef(name).changed).toEqual(expect.arrayContaining(['sections.qa.max_rework_rounds', 'loops[0].max_rounds']));
    expect((running.def as any).sections.qa.max_rework_rounds).toBe(3);
    expect((running.def as any).loops[0].max_rounds).toBe(3);
  });
});

describe('the keys a reload carries live', () => {
  it('a section allocation (with the org budget), a rework cap and a loop round limit are applied together and act on the documents in flight', async () => {
    const { d, name, running, tools, docs, runner } = await setup();
    // two rejections spend qa's cap of 2: the thread is frozen, the loop has one return
    await publish(tools.coder, 'build', 'one');
    await review(tools['qa-lead'], 'build-1', 1, 'reject');
    await publish(tools.coder, 'build', 'two', { supersedes: 'build-1@v1' });
    await review(tools['qa-lead'], 'build-1', 2, 'reject');
    expect(await waitFor(() => runner.count('boss', 'rework exhausted') === 1)).toBe(true);
    expect(await publish(tools.coder, 'build', 'three', { supersedes: 'build-1@v2' })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
    expect(docs.loopReport()[0]).toMatchObject({ rounds: 1, max_rounds: 2, exhausted: false });

    world.write(
      org((r) => {
        r.sections.development.budget = { usd: 40 };
        r.run_config.budget_usd = 110;
        r.sections.qa.max_rework_rounds = 3;
        r.loops[0].max_rounds = 4;
      }),
    );
    const res = d.reloadOrgDef(name);
    expect(res.changed).toEqual(expect.arrayContaining(['sections.development.budget', 'run_config.budget_usd', 'sections.qa.max_rework_rounds', 'loops[0].max_rounds']));
    expect(events(running, 'hot-reload-refused')).toEqual([]);
    expect((running.def as any).sections.development.budget).toEqual({ usd: 40 });
    expect(docs.reworkReport()).toMatchObject([{ rounds: 2, cap: 3, exhausted: false, frozen: false }]); // thawed by the raised cap
    expect(docs.loopReport()[0]).toMatchObject({ max_rounds: 4, exhausted: false });
    // so the producer's third version goes through
    expect(await publish(tools.coder, 'build', 'three', { supersedes: 'build-1@v2' })).toMatchObject({ ok: true, ref: 'build-1@v3' });
    expect(docs.loopReport()[0]).toMatchObject({ rounds: 2, max_rounds: 4 });
    expect(caps(running)).toEqual({ boss: 30, 'dev-lead': 10, coder: 20, 'qa-lead': 20, observer: 20 }); // role caps are the roles' own
    expect(runner.errors).toEqual([]);
  });
});
