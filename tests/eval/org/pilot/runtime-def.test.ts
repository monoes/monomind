// P3.15: the translation of a pilot definition (routing map + contracts, as in parallel-sweep-3.pilot.json, v2 included)
// into a sections-surface org definition the runtime accepts. Golden: fixtures/runtime-def-sweep3-v2.json; to re-capture
// it (only after a deliberate change to the translation), run this file with PILOT_RECAPTURE_GOLDEN=1.
// @ts-nocheck: the pilot modules are loosely typed fixtures
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sectionsDefinitionFindings } from '../../../../packages/@monomind/cli/src/orgrt/documents/definition.js';
import { sectionsSurface } from '../../../../packages/@monomind/cli/src/orgrt/documents/surface.js';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
import { applyContractTemplate } from './contract-template.js';
import { pilotOrgDef } from './harness.js';
import { RuntimeDefError, runtimeOrgDef, runtimeText } from './runtime-def.js';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const v2 = pilot.variants.find((v) => v.id === 'v2');
const GOLDEN = join(here, 'fixtures/runtime-def-sweep3-v2.json');

const role = (id, reportsTo, more = {}) => ({
  id,
  title: id,
  type: reportsTo === null ? 'boss' : 'specialist',
  reports_to: reportsTo,
  responsibilities: ['do the work'],
  ...more,
});
/** A stable stand-in for the kit's definition: the same ten roles, no per-trial paths. */
const baseDef = () => ({
  name: 'parallel-sweep-3',
  goal: 'sweep',
  run_config: { max_concurrent_agents: 10 },
  roles: [
    role('lead', null),
    ...Array.from({ length: 8 }, (_, i) => role(`worker-${i + 1}`, 'lead')),
    role('synthesiser', 'lead', {
      responsibilities: ['reads the eight documents with pilot__doc_read; notified by pilot-relay'],
    }),
  ],
});
const trial = () => ({
  runId: 'x',
  dir: '/nowhere',
  routing: pilot.routing,
  contracts: applyContractTemplate(pilot.contracts, v2.contract_template),
  relay: v2.relay,
  workspace: '/nowhere/workspace',
  handoff: 'runtime' as const,
});
const problemsOf = (fn) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuntimeDefError);
    return e.problems as string[];
  }
  throw new Error('expected a RuntimeDefError');
};

describe('runtimeOrgDef: the sweep-3 v2 pilot definition', () => {
  const out = runtimeOrgDef(baseDef(), trial());

  it('equals the committed golden', () => {
    if (process.env.PILOT_RECAPTURE_GOLDEN === '1')
      writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`);
    expect(existsSync(GOLDEN)).toBe(true);
    expect(out).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('is on the sections surface and passes the P3.1 definition checks and the checklist', () => {
    expect(sectionsSurface(out).enabled).toBe(true);
    const parsed = OrgDefSchema.parse(out);
    expect(sectionsDefinitionFindings(parsed).errors).toEqual([]);
    expect(checklistFindings(parsed).errors).toEqual([]);
  });

  it('carries the opt-in keys the surface requires and nothing of the placeholder', () => {
    expect(out.requires).toEqual({ sections: 1 });
    expect(out.run_config.experimental).toBe('eval');
    expect(out.run_config.completion).toEqual({ mode: 'boss', protocol: 'sections-v1' });
    expect(out.run_config.max_concurrent_agents).toBe(10); // the rest of run_config is kept
    for (const r of out.roles) expect(r.tool_providers).toBeUndefined();
  });

  it('turns the routing map into sections (leads also listed as members) with publish and consume edges', () => {
    expect(out.sections['sweep-a']).toEqual({
      lead: 'worker-1',
      members: ['worker-1', 'worker-2'],
      publishes: ['module-sheets-w1', 'module-sheets-w2'],
    });
    expect(out.sections.synthesis).toEqual({
      lead: 'synthesiser',
      members: ['synthesiser'],
      consumes: pilot.contracts.map((c) => c.id),
    });
  });

  it('turns each contract into documents.<id> with the v2 schema, checks, caps and deliverable files', () => {
    const c = out.documents['module-sheets-w3'];
    const src = trial().contracts.find((x) => x.id === 'module-sheets-w3');
    expect(c.schema).toEqual(src.schema);
    expect(c.checks).toEqual(src.checks);
    expect(c.max_publish_attempts).toBe(4);
    expect(c.max_consistency_refusals).toBe(5);
    expect(c.deliverable_files).toEqual(src.deliverables);
    expect(c.deliverable_files).toHaveLength(4); // one per sheet
    expect(Object.keys(c).sort()).toEqual([
      'checks',
      'deliverable_files',
      'max_consistency_refusals',
      'max_publish_attempts',
      'schema',
    ]);
    expect(c.max_chars).toBeUndefined(); // the runtime's own size limit applies (1 MiB), see the parity table
  });

  it('keeps the plain (v1) contracts translatable too: no checks, no deliverable files', () => {
    const plain = runtimeOrgDef(baseDef(), { ...trial(), contracts: pilot.contracts });
    const c = plain.documents['module-sheets-w1'];
    expect(Object.keys(c).sort()).toEqual(['max_publish_attempts', 'schema']);
    expect(sectionsDefinitionFindings(OrgDefSchema.parse(plain)).errors).toEqual([]);
  });

  it('does not change its input, and the default (harness) path is untouched', () => {
    const base = baseDef();
    const before = JSON.stringify(base);
    runtimeOrgDef(base, trial());
    expect(JSON.stringify(base)).toBe(before);
    const harness = pilotOrgDef(baseDef(), { ...trial(), handoff: undefined });
    expect(harness.sections).toBeUndefined();
    expect(harness.roles.find((r) => r.id === 'worker-1').tool_providers[0].name).toBe('pilot');
  });

  it('keeps a completion mode the definition already set', () => {
    const d = baseDef();
    d.run_config.completion = 'dag';
    expect(runtimeOrgDef(d, trial()).run_config.completion).toEqual({
      mode: 'dag',
      protocol: 'sections-v1',
    });
  });

  it('maps the pilot tool and sender names in role text to the runtime ones', () => {
    expect(runtimeText('use pilot__doc_read and pilot__doc_check; notified by pilot-relay')).toBe(
      'use org_doc_read and org_doc_check; notified by org-docs',
    );
    const synth = out.roles.find((r) => r.id === 'synthesiser');
    expect(synth.responsibilities).toEqual([
      'reads the eight documents with org_doc_read; notified by org-docs',
    ]);
  });

  it('can hide the store directory from every role (read and write deny), once', () => {
    const hidden = runtimeOrgDef(baseDef(), trial(), { hide: ['/t/orgs/x/docs'] });
    for (const r of hidden.roles) {
      expect(r.policy.sandbox.denyRead).toEqual(['/t/orgs/x/docs']);
      expect(r.policy.sandbox.denyWrite).toEqual(['/t/orgs/x/docs']);
    }
    const again = runtimeOrgDef(
      {
        ...baseDef(),
        roles: baseDef().roles.map((r) => ({
          ...r,
          policy: { sandbox: { denyRead: ['/a', '/t/orgs/x/docs'] } },
        })),
      },
      trial(),
      { hide: ['/t/orgs/x/docs'] },
    );
    expect(again.roles[0].policy.sandbox.denyRead).toEqual(['/a', '/t/orgs/x/docs']);
  });
});

describe('runtimeOrgDef refusals: what the runtime cannot represent', () => {
  it('a consumer that is not the lead of its section (the runtime decides through the lead)', () => {
    const t = trial();
    t.routing = structuredClone(t.routing);
    t.routing.sections.synthesis = { lead: 'lead-2', members: ['synthesiser'] };
    const d = baseDef();
    d.roles.push(role('lead-2', 'lead'));
    const problems = problemsOf(() => runtimeOrgDef(d, t));
    expect(problems.some((p) => /module-sheets-w1.*synthesiser.*not the lead/.test(p))).toBe(true);
  });

  it('a producer or consumer in no section, and a contract inside one section', () => {
    const t = trial();
    t.contracts = [
      { ...t.contracts[0], producer: 'nobody' },
      { ...t.contracts[1], consumers: ['worker-1'] },
      { ...t.contracts[2], consumers: ['worker-4'] },
    ];
    const problems = problemsOf(() => runtimeOrgDef(baseDef(), t));
    expect(problems.some((p) => /nobody.*in no section/.test(p))).toBe(true);
    expect(problems.some((p) => /module-sheets-w3|module-sheets-w2/.test(p))).toBe(true);
  });

  it('a definition that already has sections, a schedule or a full-access role', () => {
    const withSections = { ...baseDef(), sections: { a: { members: ['lead'] } } };
    expect(problemsOf(() => runtimeOrgDef(withSections, trial())).join('\n')).toMatch(/sections/);
    const scheduled = { ...baseDef(), schedule: { cron: '* * * * *' } };
    expect(problemsOf(() => runtimeOrgDef(scheduled, trial())).join('\n')).toMatch(/schedule/);
    const full = baseDef();
    full.roles[1].policy = { access: 'full' };
    expect(problemsOf(() => runtimeOrgDef(full, trial())).join('\n')).toMatch(/full/);
  });
});
