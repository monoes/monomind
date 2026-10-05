// Sections as isolated sub-orgs, end to end in the real daemon (no model): the `loops` key is gone (refused at start with the
// migration text), every non-root role belongs to a section (refused at start otherwise), and two sections that hand documents
// both ways need no declaration: a revise cycle is a consumer reject and the producer's republish through the document channel.
import { describe, expect, it } from 'vitest';
import { devQaOrg } from '../../support/dev-qa-defs.js';
import { role } from '../../support/doc-defs.js';
import { CostScripted, publish, review, useWorld } from './world.js';

const world = useWorld('p4-isolation');

describe('sections are isolated sub-orgs', () => {
  it('a revise cycle between two sections runs through documents alone, with no loops declaration', async () => {
    const runner = new CostScripted();
    const { d, name } = await world.start(devQaOrg(), { runner });
    const tools: Record<string, any> = {};
    for (const r of ['coder', 'qa-lead', 'dev-lead']) tools[r] = await runner.toolsOf(d, name, r);
    await publish(tools.coder, 'build', 'one');
    await review(tools['qa-lead'], 'build-1', 1, 'reject', 'no tests');
    expect(await publish(tools.coder, 'build', 'two', { supersedes: 'build-1@v1' })).toMatchObject({ ok: true, ref: 'build-1@v2' });
    expect(await review(tools['qa-lead'], 'build-1', 2, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    await publish(tools['qa-lead'], 'report', 'all good', { inputs: ['build-1@v2'] });
    expect(await review(tools['dev-lead'], 'report-1', 1, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    expect(runner.errors).toEqual([]);
    await d.stopOrg(name);
  });

  it('loops is refused at start with the migration text', async () => {
    const raw = devQaOrg((r) => (r.loops = [{ between: ['development', 'qa'], types: ['build', 'report'], max_rounds: 2 }]));
    await expect(world.start(raw)).rejects.toThrow(/"loops": removed — sections exchange work only through documents.*max_rework_rounds/);
  });

  it('a role in no section is refused at start, naming the role and the fix', async () => {
    const raw = devQaOrg((r) => r.roles.push(role('observer', 'boss')));
    await expect(world.start(raw)).rejects.toThrow(/roles\.observer: a role outside every section can only be the root — add it to a section's members or make it a lead/);
  });

  it('loops outside the sections surface is still not supported: it fails at start with the validate text', async () => {
    const raw = devQaOrg((r) => (r.loops = [{ between: ['a', 'b'], types: ['t'], max_rounds: 2 }]));
    for (const k of ['sections', 'documents', 'requires']) delete raw[k];
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    await expect(world.start(raw, { evalGate: false })).rejects.toThrow(/"loops" is not yet supported/);
  });
});
