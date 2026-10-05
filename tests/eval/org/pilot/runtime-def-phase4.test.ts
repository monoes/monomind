// P4.13: the Phase 4 keys in the runtime switch's definition (runtime-def.ts `phase4`), scripted, no model.
//  - Default OFF: a trial that declares no Phase 4 key (every committed manifest) gets the definition it always got; the P3.15
//    golden (fixtures/runtime-def-sweep3-v2.json) is read here and never written, and `phase4` absent, {} or empty is a no-op.
//  - A synthetic Phase 4 variant (declared by this test, not by any manifest) produces the expected definition: the keys appear
//    where the runtime reads them, only the declared ones, and the result passes the runtime's own definition checks.
//  - The `r` switch carries a variant's phase4 block to the runtime and leaves the harness variant alone.
// @ts-nocheck: the pilot modules are loosely typed fixtures
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sectionsDefinitionFindings } from '../../../../packages/@monomind/cli/src/orgrt/documents/definition.js';
import { sectionsSurface } from '../../../../packages/@monomind/cli/src/orgrt/documents/surface.js';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
import { applyContractTemplate } from './contract-template.js';
import { RuntimeDefError, runtimeOrgDef } from './runtime-def.js';
import { resolveVariant } from './runtime-switch.mjs';

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
/** The kit's ten roles. `caps`: a per-role dollar cap (the budget rules need one on every role of a budgeted org). */
const baseDef = ({ caps = false, readOnly = [] } = {}) => ({
  name: 'parallel-sweep-3',
  goal: 'sweep',
  run_config: { max_concurrent_agents: 10 },
  roles: [
    role('lead', null, caps ? { budget_usd: 20 } : {}),
    ...Array.from({ length: 8 }, (_, i) =>
      role(`worker-${i + 1}`, 'lead', {
        ...(caps ? { budget_usd: 4 } : {}),
        ...(readOnly.includes(`worker-${i + 1}`)
          ? { policy: { denyTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'] } }
          : {}),
      }),
    ),
    role('synthesiser', 'lead', {
      ...(caps ? { budget_usd: 10 } : {}),
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

/** A synthetic variant: every key of the four, over the sweep-3 routing. Nothing like it is in a committed manifest. */
const PHASE4 = {
  sections: {
    'sweep-a': { budget: { usd: 8 }, max_rework_rounds: 2 },
    'sweep-b': { budget: { usd: 8 } },
    'sweep-c': { budget: { usd: 8 } },
    'sweep-d': { budget: { usd: 8 } },
    synthesis: { writes: ['out/**'], budget: { usd: 10 }, max_rework_rounds: 3 },
  },
  budget_usd: 100,
};
const READ_ONLY = Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`);
const phase4Def = (p = PHASE4) =>
  runtimeOrgDef(baseDef({ caps: true, readOnly: READ_ONLY }), trial(), { phase4: p });

describe('default OFF: no Phase 4 key declared, no change', () => {
  const plain = runtimeOrgDef(baseDef(), trial());

  it('the P3.15 golden is what a trial without phase4 produces (and is read, not re-captured, here)', () => {
    expect(plain).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('phase4 absent, {}, or with only empty parts is byte for byte the same definition', () => {
    const same = JSON.stringify(plain);
    for (const p of [undefined, {}, { sections: {} }, { sections: { synthesis: {} } }])
      expect(JSON.stringify(runtimeOrgDef(baseDef(), trial(), { phase4: p }))).toBe(same);
    expect(JSON.stringify(runtimeOrgDef(baseDef(), trial(), {}))).toBe(same);
  });

  it('no committed pilot manifest declares a phase4 block in any variant', () => {
    const manifests = readdirSync(here).filter((f) => f.endsWith('.pilot.json'));
    expect(manifests.length).toBeGreaterThan(0);
    for (const f of manifests) {
      const m = JSON.parse(readFileSync(join(here, f), 'utf8'));
      for (const v of m.variants ?? []) expect(v.phase4, `${f} ${v.id}`).toBeUndefined();
      expect(m.phase4, f).toBeUndefined();
    }
  });

  it('a declared harness variant and its `r` runtime form carry no phase4 unless the manifest does', () => {
    expect(resolveVariant(pilot, 'v2').variant.phase4).toBeUndefined();
    expect(resolveVariant(pilot, 'v2r').variant.phase4).toBeUndefined();
  });
});

describe('a synthetic Phase 4 variant', () => {
  const out = phase4Def();

  it('puts the keys where the runtime reads them, and only the ones declared', () => {
    expect(out.sections['sweep-a']).toEqual({
      lead: 'worker-1',
      members: ['worker-1', 'worker-2'],
      publishes: ['module-sheets-w1', 'module-sheets-w2'],
      budget: { usd: 8 },
      max_rework_rounds: 2,
    });
    expect(out.sections['sweep-b'].max_rework_rounds).toBeUndefined();
    expect(out.sections.synthesis).toMatchObject({
      lead: 'synthesiser',
      writes: ['out/**'],
      budget: { usd: 10 },
      max_rework_rounds: 3,
    });
    expect(out.run_config.budget_usd).toBe(100);
  });

  it('differs from the Phase 3 definition of the same trial by those keys alone', () => {
    const plain = runtimeOrgDef(baseDef({ caps: true, readOnly: READ_ONLY }), trial());
    const strip = (d) => {
      const c = structuredClone(d);
      delete c.run_config.budget_usd;
      for (const s of Object.values(c.sections)) {
        delete s.writes;
        delete s.budget;
        delete s.max_rework_rounds;
      }
      return c;
    };
    expect(strip(out)).toEqual(plain);
  });

  it('is on the sections surface and passes the runtime definition checks and the checklist', () => {
    expect(sectionsSurface(out).enabled).toBe(true);
    const parsed = OrgDefSchema.parse(out);
    expect(sectionsDefinitionFindings(parsed).errors).toEqual([]);
    expect(checklistFindings(parsed).errors).toEqual([]);
  });

  it('does not change its input or the phase4 block it is given', () => {
    const base = baseDef();
    const p = structuredClone(PHASE4);
    const before = JSON.stringify(base);
    const def = runtimeOrgDef(base, trial(), { phase4: p });
    expect(JSON.stringify(base)).toBe(before);
    expect(p).toEqual(PHASE4);
    def.sections.synthesis.writes.push('x');
    expect(p).toEqual(PHASE4); // copies, not aliases
  });

  it('still hides the store directory, with the keys on', () => {
    const hidden = runtimeOrgDef(baseDef(), trial(), { hide: ['/t/docs'], phase4: PHASE4 });
    expect(hidden.roles[0].policy.sandbox.denyRead).toEqual(['/t/docs']);
    expect(hidden.sections.synthesis.writes).toEqual(['out/**']);
  });

  it('is carried to the runtime by the `r` switch, and not by the declared (harness) variant id', () => {
    const manifest = {
      ...pilot,
      variants: pilot.variants.map((v) => (v.id === 'v2' ? { ...v, phase4: PHASE4 } : v)),
    };
    const runtime = resolveVariant(manifest, 'v2r');
    expect(runtime.handoff).toBe('runtime');
    expect(runtime.variant.phase4).toEqual(PHASE4);
    expect(resolveVariant(manifest, 'v2').handoff).toBe('harness'); // the harness has no Phase 4: nothing reads it there
    const viaSwitch = runtimeOrgDef(baseDef({ caps: true, readOnly: READ_ONLY }), trial(), {
      phase4: runtime.variant.phase4,
    });
    expect(viaSwitch).toEqual(out);
  });
});

describe('refusals: what the switch cannot carry', () => {
  it('a section the routing map does not have, an org budget the definition already has: every reason at once', () => {
    const d = baseDef();
    d.run_config.budget_usd = 5;
    const problems = problemsOf(() =>
      runtimeOrgDef(d, trial(), {
        phase4: {
          sections: { nowhere: { budget: { usd: 1 } } },
          budget_usd: 9,
        },
      }),
    );
    expect(problems.some((p) => /phase4\.sections\.nowhere.*no such section/.test(p))).toBe(true);
    expect(problems.some((p) => /already has run_config\.budget_usd/.test(p))).toBe(true);
  });

  it('values the runtime refuses are the runtime checks to refuse, not the switch: a missing role cap is a finding', () => {
    const out = runtimeOrgDef(baseDef({ readOnly: READ_ONLY }), trial(), { phase4: PHASE4 }); // no role caps
    const findings = checklistFindings(OrgDefSchema.parse(out)).errors;
    expect(findings.length).toBeGreaterThan(0);
  });
});
