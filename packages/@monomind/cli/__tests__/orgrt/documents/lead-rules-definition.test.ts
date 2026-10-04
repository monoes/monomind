// P4.9 (plan 13.2): the two definition rules of the lead work. (1) The capacity preflight: a sections org whose
// `run_config.max_concurrent_agents` (default 4) is below its agent-role count is an ERROR; (2) a member whose
// `reports_to` is not its section lead is a WARNING. Both only on the sections surface, through the shared
// checklist (`org validate`, org start and reload all run it), and neither for an org without sections.
import { describe, expect, it } from 'vitest';
import { sectionsDefinitionFindings } from '../../../src/orgrt/documents/definition.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { sectionsRaw } from '../support/sections-defs.js';

const parse = (patch: (raw: Record<string, any>) => void) => OrgDefSchema.parse(sectionsRaw(patch));
const findings = (patch: (raw: Record<string, any>) => void) => sectionsDefinitionFindings(parse(patch));
const capacity = (list: string[]) => list.filter((e) => e.startsWith('run_config.max_concurrent_agents'));
const reportsTo = (list: string[]) => list.filter((e) => /\.reports_to:/.test(e));

describe('capacity preflight (an error, sections orgs only)', () => {
  // the valid fixture has five agent roles
  it.each([
    ['five roles, cap 5', 5, 0],
    ['five roles, cap 20', 20, 0],
    ['five roles, cap 4', 4, 1],
    ['five roles, cap 1', 1, 1],
  ])('%s', (_n, cap, errors) => {
    const f = findings((r) => (r.run_config.max_concurrent_agents = cap));
    expect(capacity(f.errors)).toHaveLength(errors);
  });

  it('an unset cap is the schema default 4: the error says so and names the remedy', () => {
    const f = findings((r) => delete r.run_config.max_concurrent_agents);
    expect(capacity(f.errors)).toEqual([
      'run_config.max_concurrent_agents: 4 is below the 5 agent roles of this sections org (it defaults to 4) — an idle role keeps its slot, so a role past the cap never starts and a section can stall; raise it to at least 5, or remove roles',
    ]);
  });

  it('a cap of 3 is reported as 3', () => {
    const f = findings((r) => (r.run_config.max_concurrent_agents = 3));
    expect(capacity(f.errors)[0]).toMatch(/^run_config\.max_concurrent_agents: 3 is below the 5 agent roles/);
  });

  it('an endpoint role is not an agent and takes no slot', () => {
    const f = findings((r) => {
      r.run_config.max_concurrent_agents = 5;
      r.roles.push({ id: 'hook', title: 'hook', type: 'specialist', reports_to: 'boss', kind: 'endpoint', endpoint: { url: 'https://example.com/hook' }, responsibilities: [] });
    });
    expect(capacity(f.errors)).toEqual([]);
  });

  it('the error reaches the shared checklist (start, validate and reload), and a roster that grows past the cap on reload is refused', () => {
    const ok = parse((r) => (r.run_config.max_concurrent_agents = 5));
    expect(capacity(checklistFindings(ok).errors)).toEqual([]);
    const grown = parse((r) => {
      r.run_config.max_concurrent_agents = 5;
      r.roles.push({ id: 'extra', title: 'extra', type: 'specialist', reports_to: 'boss', responsibilities: ['help'] });
    });
    expect(capacity(checklistFindings(grown).errors)).toHaveLength(1);
  });

  it('an org without sections is never asked: no capacity error, only the advice it always had', () => {
    const plain = sectionsRaw((r) => {
      delete r.sections;
      delete r.documents;
      delete r.requires;
      r.run_config = { idle_minutes: 0, max_concurrent_agents: 2 };
    });
    const f = checklistFindings(OrgDefSchema.parse(plain));
    expect(capacity(f.errors)).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(f.warnings.some((w) => w.startsWith('#3 run_config.max_concurrent_agents is 2'))).toBe(true);
  });
});

describe('reports_to advice (a warning, sections orgs only)', () => {
  it('a member that reports to its section lead, and a lead, give none', () => {
    expect(reportsTo(findings(() => {}).warnings)).toEqual([]);
  });

  it('a member that reports to someone else is warned, naming the path and the fix', () => {
    const f = findings((r) => (r.roles.find((x: any) => x.id === 'researcher').reports_to = 'boss'));
    expect(reportsTo(f.warnings)).toEqual([
      'roles.researcher.reports_to: "researcher" is in section "research" but reports to "boss", not its section lead "research-lead" — the org chart and the section disagree; set reports_to: "research-lead"',
    ]);
    expect(f.errors.filter((e) => /reports_to/.test(e))).toEqual([]); // a warning, not an error (item 30)
  });

  it('a dedicated lead (outside members) is the lead its members should report to', () => {
    const f = findings((r) => {
      r.sections.development = { lead: 'dev-lead', members: ['coder'], consumes: ['findings'] };
      r.roles.find((x: any) => x.id === 'coder').reports_to = 'boss';
    });
    expect(reportsTo(f.warnings)).toEqual([expect.stringContaining('"coder" is in section "development"')]);
  });

  it('a self-led one-member section has no lead to disagree with', () => {
    const f = findings((r) => {
      r.sections.development = { members: ['coder'], consumes: ['findings'] };
      r.roles.find((x: any) => x.id === 'coder').reports_to = 'boss';
    });
    expect(reportsTo(f.warnings)).toEqual([]);
  });

  it('is not given for an org that is not on the sections surface', () => {
    const plain = sectionsRaw((r) => {
      delete r.sections;
      delete r.documents;
      delete r.requires;
      r.run_config = { idle_minutes: 0 };
      r.roles.find((x: any) => x.id === 'researcher').reports_to = 'boss';
    });
    expect(reportsTo(checklistFindings(OrgDefSchema.parse(plain)).warnings)).toEqual([]);
  });
});
