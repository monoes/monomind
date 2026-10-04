/**
 * Org sections spec 7.1/7.3 (Phase 5): the checklist items that detect a structure that the measured
 * results say fits the work badly (19 chain, 20 team without a deadline, 21 documents without checks).
 * All three are warnings, never errors.
 */
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../packages/@monomind/cli/src/orgrt/validate-checklist.js';

const role = (id: string, reports_to: string | null) => ({
  id,
  title: id,
  type: reports_to === null ? 'boss' : 'specialist',
  reports_to,
  responsibilities: ['Send self-contained briefs and do the work'],
  adapter_config: { model: 'claude-sonnet-5' },
  budget_usd: 2,
  policy: { autoApproveTools: ['Bash', 'WebFetch', 'WebSearch'] },
});

const org = (roles: ReturnType<typeof role>[], extra: Record<string, unknown> = {}) =>
  OrgDefSchema.parse({
    name: 'x',
    goal: 'g',
    status: 'stopped',
    schedule: null,
    run_config: { max_concurrent_agents: 12, ...(extra.run_config as object) },
    roles,
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'run_config')),
  });

const has = (w: string[], n: number) => w.filter((x) => x.startsWith(`#${n} `));

describe('checklist #19: a strict chain of roles', () => {
  it('warns on a chain of three or more roles', () => {
    const w = checklistFindings(org([role('a', null), role('b', 'a'), role('c', 'b')])).warnings;
    expect(has(w, 19)).toHaveLength(1);
    expect(has(w, 19)[0]).toMatch(/single agent/);
  });
  it('is quiet for a boss with two workers, and for a two-role pair', () => {
    expect(
      has(checklistFindings(org([role('a', null), role('b', 'a'), role('c', 'a')])).warnings, 19),
    ).toHaveLength(0);
    expect(
      has(checklistFindings(org([role('a', null), role('b', 'a')])).warnings, 19),
    ).toHaveLength(0);
  });
});

describe('checklist #20: a parallel team with no deadline', () => {
  const team = (n: number) => [
    role('boss', null),
    ...Array.from({ length: n }, (_, i) => role(`w${i}`, 'boss')),
  ];
  it('warns for four workers, a one-shot org and no max_run', () => {
    const w = checklistFindings(org(team(4))).warnings;
    expect(has(w, 20)).toHaveLength(1);
    expect(has(w, 20)[0]).toMatch(/deadline/);
  });
  it('is quiet with a max_run, with a schedule, or with fewer than four workers', () => {
    expect(
      has(checklistFindings(org(team(4), { run_config: { max_run: '10m' } })).warnings, 20),
    ).toHaveLength(0);
    expect(has(checklistFindings({ ...org(team(4)), schedule: '30m' }).warnings, 20)).toHaveLength(
      0,
    );
    expect(has(checklistFindings(org(team(3))).warnings, 20)).toHaveLength(0);
  });
});

describe('checklist #21: a document type with no checks', () => {
  const sectioned = (documents: Record<string, unknown>) =>
    org([role('boss', null), role('w', 'boss'), role('r', 'boss')], {
      requires: { sections: 1 },
      run_config: { experimental: 'eval' },
      sections: { work: { lead: 'boss', members: ['w'], publishes: Object.keys(documents) } },
      documents,
    });
  it('warns for each type without checks, naming it', () => {
    const w = checklistFindings(
      sectioned({
        sheet: { schema: { type: 'object' } },
        note: { schema: { type: 'object' }, checks: [{ type: 'files_in_module' }] },
      }),
    ).warnings;
    expect(has(w, 21)).toHaveLength(1);
    expect(has(w, 21)[0]).toMatch(/documents\.sheet/);
  });
  it('does not warn in an org without sections', () => {
    const w = checklistFindings(
      org([role('boss', null), role('w', 'boss')], {
        documents: { sheet: { schema: {} } },
      } as never),
    ).warnings;
    expect(has(w, 21)).toHaveLength(0);
  });
});
