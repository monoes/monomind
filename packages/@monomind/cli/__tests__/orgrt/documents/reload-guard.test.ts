// packages/@monomind/cli/__tests__/orgrt/documents/reload-guard.test.ts
// P4.10: the classifier of structural reload changes. Every structural key is refused with its path and the
// restart remedy; every key a reload carries live is not reported; an org off the sections surface is never
// reported (its reload is what it was).
import { describe, expect, it } from 'vitest';
import { RELOAD_REMEDY, reloadRefusalText, structuralReloadChanges } from '../../../src/orgrt/documents/reload-guard.js';
import { loopOrg } from '../support/loop-defs.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const clone = (raw: Raw): Raw => JSON.parse(JSON.stringify(raw));
const base = (): Raw => sectionsRaw((r) => (r.sections.development.writes = ['src/**']));
const diff = (edit: (r: Raw) => void, from: () => Raw = base) => {
  const next = clone(from());
  edit(next);
  return structuralReloadChanges(from() as never, next as never);
};
const role = (id: string, reportsTo: string | null) => ({ id, type: reportsTo === null ? 'boss' : 'specialist', reports_to: reportsTo });

describe('structural keys are reported with code, path, message and the restart remedy', () => {
  const table: Array<[string, (r: Raw) => void, string, string, (() => Raw)?]> = [
    ['a section added', (r) => (r.sections.qa = { lead: 'coder', members: ['coder'] }), 'section-added', 'sections.qa'],
    ['a section removed', (r) => delete r.sections.development, 'section-removed', 'sections.development'],
    ['a role added to a section', (r) => (r.roles.push(role('extra', 'boss')), r.sections.research.members.push('extra')), 'section-members', 'sections.research.members'],
    ['a member removed from a section', (r) => (r.sections.research.members = ['research-lead']), 'section-members', 'sections.research.members'],
    ['a lead changed', (r) => (r.sections.research.lead = 'researcher'), 'section-lead', 'sections.research.lead'],
    ['writes added', (r) => (r.sections.research.writes = ['docs/**']), 'section-writes', 'sections.research.writes'],
    ['writes changed', (r) => (r.sections.development.writes = ['lib/**']), 'section-writes', 'sections.development.writes'],
    ['writes removed', (r) => delete r.sections.development.writes, 'section-writes', 'sections.development.writes'],
    ['consumes changed', (r) => (r.sections.development.consumes = []), 'section-flow', 'sections.development.consumes'],
    ['publishes changed', (r) => (r.sections.research.publishes = []), 'section-flow', 'sections.research.publishes'],
    ['requests added', (r) => (r.sections.research.requests = ['findings']), 'section-flow', 'sections.research.requests'],
    ['parallelism changed', (r) => (r.sections.research.parallelism = 2), 'section-other', 'sections.research.parallelism'],
    ['mode changed', (r) => (r.sections.research.mode = 'queue'), 'section-other', 'sections.research.mode'],
    ['a document type added', (r) => (r.documents.report = { schema: { type: 'object' } }), 'documents', 'documents.report'],
    ['a document type removed', (r) => delete r.documents.findings, 'documents', 'documents.findings'],
    ['a document schema changed', (r) => (r.documents.findings.schema.required = ['summary', 'notes']), 'documents', 'documents.findings'],
    ['a document evidence edge changed', (r) => (r.documents.findings.evidence = []), 'documents', 'documents.findings'],
    ['requires changed', (r) => (r.requires = { sections: 2 }), 'requires', 'requires'],
    ['completion changed', (r) => (r.run_config.completion = { mode: 'boss', protocol: 'sections-v1' }), 'completion', 'run_config.completion'],
    ['experimental changed', (r) => (r.run_config.experimental = 'release'), 'experimental', 'run_config.experimental'],
    ['a loop added', (r) => (r.loops = [{ between: ['development', 'qa'], types: ['build'], max_rounds: 2 }]), 'loops-added', 'loops[0]'],
    ['a loop removed', (r) => delete r.loops, 'loops-removed', 'loops[0]', () => loopOrg(2)],
    ['a loop between changed', (r) => (r.loops[0].between = ['development', 'review']), 'loops-structure', 'loops[0].between', () => loopOrg(2)],
    ['a loop types changed', (r) => (r.loops[0].types = ['build']), 'loops-structure', 'loops[0].types', () => loopOrg(2)],
    ['the root role changed', (r) => ((r.roles[0].type = 'specialist'), (r.roles[1].type = 'boss'), (r.roles[1].reports_to = null)), 'root', 'roles'],
    ['the sections surface switched off', (r) => delete r.sections, 'sections-disabled', 'sections'],
  ];
  for (const [label, edit, code, path, from] of table)
    it(label, () => {
      const found = diff(edit, from);
      const hit = found.find((c) => c.code === code && c.path === path);
      expect(hit, JSON.stringify(found)).toBeDefined();
      expect(hit!.message.length).toBeGreaterThan(10);
      expect(hit!.remedy).toBe(RELOAD_REMEDY);
      expect(hit!.remedy).toMatch(/stop and start the org/);
    });

  it('the sections surface switched on in a running sections-off org', () => {
    const off = sectionsRaw((r) => delete r.sections);
    const found = structuralReloadChanges(off as never, sectionsRaw() as never);
    expect(found.map((c) => c.code)).toContain('sections-enabled');
  });
});

describe('keys a reload carries live are not reported', () => {
  const allowed: Array<[string, (r: Raw) => void, (() => Raw)?]> = [
    ['a section budget allocation', (r) => (r.sections.research.budget = { usd: 35 })],
    ['max_rework_rounds', (r) => (r.sections.research.max_rework_rounds = 4)],
    ['run_config.budget_usd', (r) => (r.run_config.budget_usd = 90)],
    ['a run_config deadline or limit', (r) => (r.run_config.idle_minutes = 3)],
    ['loops[i].max_rounds with between and types unchanged', (r) => (r.loops[0].max_rounds = 9), () => loopOrg(2)],
    ['a role cap', (r) => (r.roles[2].budget_usd = 12)],
    ['a role policy', (r) => (r.roles[2].policy = { sandbox: { mode: 'off' }, denyTools: ['WebFetch'] })],
    ['the goal', (r) => (r.goal = 'something else')],
    ['a new role that belongs to no section', (r) => r.roles.push(role('bystander', 'boss'))],
    ['the members of a section listed in another order', (r) => r.sections.research.members.reverse()],
    ['document keys written in another order', (r) => (r.documents.findings = Object.fromEntries(Object.entries(r.documents.findings).reverse()))],
  ];
  for (const [label, edit, from] of allowed) it(label, () => expect(diff(edit, from)).toEqual([]));

  it('an unchanged definition', () => expect(diff(() => {})).toEqual([]));
});

describe('an org off the sections surface is never reported', () => {
  const off = (): Raw => sectionsRaw((r) => (delete r.sections, delete r.documents, delete r.requires));
  it('whatever else changes', () => {
    expect(
      diff((r) => ((r.run_config.completion = 'boss'), (r.documents = { x: {} }), (r.requires = { sections: 7 }), (r.loops = [{}])), off),
    ).toEqual([]);
  });
});

describe('a mixed change reports every structural change and nothing allowed', () => {
  it('lists each structural key once', () => {
    const found = diff((r) => {
      r.sections.research.budget = { usd: 35 };
      r.sections.development.writes = ['lib/**'];
      r.documents.findings.schema.required = ['summary', 'notes'];
    });
    expect(found.map((c) => c.path).sort()).toEqual(['documents.findings', 'sections.development.writes']);
  });
  it('the refusal text names every path, the org and the restart remedy', () => {
    const text = reloadRefusalText('sec-org', diff((r) => ((r.sections.development.writes = ['lib/**']), (r.requires = { sections: 2 }))));
    expect(text).toMatch(/^org sec-org: reload refused, the running org keeps its definition and nothing was applied: /);
    expect(text).toContain('sections.development.writes');
    expect(text).toContain('requires');
    expect(text).toMatch(/stop and start the org to apply it/);
  });
  it('a role added to a section says membership is read at start', () => {
    const found = diff((r) => (r.roles.push(role('extra', 'boss')), r.sections.research.members.push('extra')));
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/added extra/);
    expect(found[0].message).toMatch(/old section map/);
  });
});
