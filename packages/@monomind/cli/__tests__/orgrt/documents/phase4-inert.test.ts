// packages/@monomind/cli/__tests__/orgrt/documents/phase4-inert.test.ts
//
// Org sections P4.0 (spec 13.2, the Phase 4 inert net, tests only). Part 1 of 3 (the others are
// phase4-inert-pins.test.ts and phase4-inert-inventory.test.ts). This file records what the checklist and the
// sections definition check say TODAY about every key Phase 4 gives effect to, so a piece that relaxes one
// has to edit an expectation here, visibly, in its own commit:
//   - the keys Phase 4 relaxes or refuses differently: top-level `loops`, `run_config.budget_usd`,
//     `run_config.budget_mode`, `sections.<s>.budget`, and the deferred run_config keys of 6.9;
//   - the keys accepted today that Phase 4 gives effect or findings to: `writes` (one section),
//     `max_rework_rounds`, a cycle between sections, `worktree-per-role` with `writes`, a roster above
//     `max_concurrent_agents`, a member whose `reports_to` is not its lead;
//   - the refusals Phase 4 leaves alone (`parallelism.max_depth`, `mode: deliberative`, `requests: direct`,
//     more than one writing section): pinned too, so that a relaxation by accident shows.
// Off the sections surface the same keys fail with the messages of the sections-off era (also pinned by
// validate-checklist-sections.test.ts and the P3.0 goldens, which stay as they are).
//
// HOW A DELIBERATE CHANGE IS MADE. A failing expectation here means a piece changed what the checklist says.
// If the piece is the one that gives that key effect, it edits ONLY its own block below (named in the comment
// "EDITED BY") and lists the edit in its report. Any other failure means the piece is wrong, not this file.
//   P4.4  writes (one writing section; worktree-per-role with writes; the more-than-one-writer text stays)
//   P4.5  run_config.budget_usd, run_config.budget_mode, sections.<s>.budget, the deferred run_config keys
//   P4.7  max_rework_rounds
//   P4.8  loops, an undeclared cycle between sections
//   P4.9  the capacity error and the reports_to warning
// Nothing here depends on the clock, the disk or the network: every case parses a literal object.
import { describe, expect, it } from 'vitest';
import { sectionsSurface } from '../../../src/orgrt/documents/surface.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistErrorsForRaw, checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { VARIANTS } from '../support/golden-variants.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const plain = VARIANTS[0].raw as Raw;

const TOP = (k: string) => `"${k}" is not yet supported (org sections are designed, not built) — remove it`;
const RC = (k: string) => `run_config.${k} is not yet supported — remove it`;
const SECTION_BUDGET = (s: string) =>
  `sections.${s}.budget: not yet supported (section budgets need run_config.budget_usd, which is not built) — remove it`;

/** A plain (sections-off) org with extra top-level and run_config keys. */
const off = (top: Raw = {}, runConfig: Raw = {}) =>
  checklistFindings(OrgDefSchema.parse({ ...plain, ...top, run_config: { idle_minutes: 0, ...runConfig } }));
/** The valid P3.1 sections org with `patch` applied to a fresh copy. */
const on = (patch: (raw: Raw) => void = () => {}) => checklistFindings(OrgDefSchema.parse(sectionsRaw(patch)));
const baseline = on();

describe('phase4 inert: off-surface refusals are unchanged', () => {
  const LOOPS_VALUES: [string, unknown][] = [
    ['an empty list', []],
    ['a declared loop', [{ between: ['research', 'development'], types: ['findings'], max_rounds: 2 }]],
    ['an object', {}],
  ];

  it.each(LOOPS_VALUES)('loops as %s is refused with the not-yet-supported text', (_n, loops) => {
    expect(off({ loops }).errors).toEqual([TOP('loops')]);
  });

  it.each([
    ['budget_usd', { budget_usd: 5 }, [RC('budget_usd')]],
    ['budget_mode', { budget_mode: 'soft' }, [RC('budget_mode')]],
    ['budget_usd and budget_mode', { budget_usd: 5, budget_mode: 'soft' }, [RC('budget_usd'), RC('budget_mode')]],
    ['budget_usd as zero', { budget_usd: 0 }, [RC('budget_usd')]],
  ])('run_config %s is refused with the not-yet-supported text', (_n, rc, errors) => {
    expect(off({}, rc).errors).toEqual(errors);
  });

  it('requires alone is refused', () => {
    expect(off({ requires: { sections: 1 } }).errors).toEqual([TOP('requires')]);
  });

  it('an empty would-be section does not switch the surface on, so loops and the section map are both refused', () => {
    const top = { sections: { s1: {} }, loops: [] };
    expect(sectionsSurface(top).enabled).toBe(false);
    expect(off(top).errors).toEqual([TOP('sections'), TOP('loops')]);
  });

  it('a section entry that carries a budget or writes key is NOT off the surface: one key is enough to switch it on', () => {
    expect(sectionsSurface({ sections: { s1: { budget: { usd: 5 } } } }).enabled).toBe(true);
    expect(sectionsSurface({ sections: { s1: { writes: ['src/**'] } } }).enabled).toBe(true);
  });

  it('everything at once, off the surface: the refusals come in the order of the deferred lists', () => {
    const f = off({ sections: {}, documents: {}, loops: [], requires: { sections: 1 } }, { budget_usd: 5, budget_mode: 'soft' });
    expect(f.errors).toEqual([
      TOP('sections'),
      TOP('documents'),
      TOP('loops'),
      TOP('requires'),
      RC('budget_usd'),
      RC('budget_mode'),
    ]);
  });

  it('checklistErrorsForRaw (dashboard import and create) refuses the same keys', () => {
    expect(checklistErrorsForRaw({ ...plain, loops: [] })).toEqual([TOP('loops')]);
    expect(checklistErrorsForRaw({ ...plain, run_config: { idle_minutes: 0, budget_usd: 5 } })).toEqual([RC('budget_usd')]);
    expect(checklistErrorsForRaw({ ...plain, run_config: { idle_minutes: 0, budget_mode: 'soft' } })).toEqual([
      RC('budget_mode'),
    ]);
  });
});

describe('phase4 inert: on-surface refusals of the Phase 4 keys are unchanged today', () => {
  it('the baseline sections org has no error', () => {
    expect(baseline.errors).toEqual([]);
  });

  // EDITED BY P4.8: loops.
  it.each([
    ['an empty list', []],
    ['a declared loop', [{ between: ['research', 'development'], types: ['findings'], max_rounds: 2 }]],
    ['an object', {}],
  ])('top-level loops as %s is still refused', (_n, loops) => {
    expect(on((r) => (r.loops = loops)).errors).toEqual([TOP('loops')]);
  });

  // EDITED BY P4.5: run_config.budget_usd, run_config.budget_mode.
  it.each([
    ['budget_usd', { budget_usd: 5 }, [RC('budget_usd')]],
    ['budget_mode soft', { budget_mode: 'soft' }, [RC('budget_mode')]],
    ['budget_mode strict', { budget_mode: 'strict' }, [RC('budget_mode')]],
    ['both', { budget_usd: 5, budget_mode: 'soft' }, [RC('budget_usd'), RC('budget_mode')]],
  ])('run_config %s is still refused', (_n, rc, errors) => {
    expect(on((r) => Object.assign(r.run_config, rc)).errors).toEqual(errors);
  });

  // EDITED BY P4.5: sections.<s>.budget.
  it.each([
    ['{usd: 5}', { usd: 5 }],
    ['a number', 5],
    ['an empty object', {}],
    ['a string', 'five'],
  ])('sections.research.budget as %s is still refused with the build-order text', (_n, budget) => {
    expect(on((r) => (r.sections.research.budget = budget)).errors).toEqual([SECTION_BUDGET('research')]);
  });

  it('a section budget together with run_config.budget_usd gives both refusals, run_config first', () => {
    const f = on((r) => {
      r.run_config.budget_usd = 10;
      r.sections.research.budget = { usd: 5 };
      r.sections.development.budget = { usd: 5 };
    });
    expect(f.errors).toEqual([RC('budget_usd'), SECTION_BUDGET('research'), SECTION_BUDGET('development')]);
  });

  // EDITED BY P4.5: the deferred keys of 6.9 are unknown run_config keys today (a warning, not an error).
  it.each(['max_turn_usd', 'allow_unbounded_turn', 'budget_slice'])('run_config.%s is only an unknown-key warning today', (k) => {
    const f = on((r) => (r.run_config[k] = k === 'allow_unbounded_turn' ? true : 1));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([`unknown run_config.${k} is ignored by the runtime — check the spelling`, ...baseline.warnings]);
  });

  // The refusals Phase 4 leaves as they are (NOT edited by any Phase 4 piece, except the writers text by P4.4 if it rewords it).
  it('a second writing section is refused with the single-writer text', () => {
    const f = on((r) => {
      r.sections.research.writes = ['src/a'];
      r.sections.development.writes = ['src/b'];
    });
    expect(f.errors).toEqual([
      'sections.research, sections.development: only one section may declare writes in this build (a single writer per repository, merge_owner is not yet supported) — keep writes on one section and hand the rest off as documents',
    ]);
  });

  it('writes that is not a list of strings is refused', () => {
    expect(on((r) => (r.sections.research.writes = [1])).errors).toEqual([
      'sections.research.writes: must be a list of repository paths — got a list',
    ]);
    expect(on((r) => (r.sections.research.writes = 'src')).errors).toEqual([
      'sections.research.writes: must be a list of repository paths — got "src"',
    ]);
  });

  it('parallelism.max_depth, mode deliberative and requests direct are refused as not yet supported', () => {
    expect(on((r) => (r.sections.research.parallelism = { max_depth: 2 })).errors).toEqual([
      'sections.research.parallelism.max_depth: not yet supported — remove it (max_parallel is planning guidance only)',
    ]);
    expect(on((r) => (r.sections.research.mode = 'deliberative')).errors).toEqual([
      'sections.research.mode: "deliberative" is not yet supported — use "execution" and a separate deliberative role',
    ]);
    expect(on((r) => (r.sections.research.requests = 'direct')).errors).toEqual([
      'sections.research.requests: "direct" is not yet supported — use "via-lead" or remove it',
    ]);
  });

  it('max_rework_rounds that is not a positive integer is refused', () => {
    for (const v of [0, -1, 1.5, '2'])
      expect(on((r) => (r.sections.research.max_rework_rounds = v)).errors, String(v)).toEqual([
        `sections.research.max_rework_rounds: must be a positive integer — got ${JSON.stringify(v)}`,
      ]);
  });
});

describe('phase4 inert: keys accepted today that Phase 4 gives effect or findings to', () => {
  // EDITED BY P4.4: writes has an effect (the writer preflight and the policy overlay); a valid single writer stays accepted.
  it('one writing section is accepted, with the warnings of the baseline', () => {
    const f = on((r) => (r.sections.research.writes = ['src/**']));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(baseline.warnings);
  });

  // EDITED BY P4.4: refused with writes (separate trees mean separate writers).
  it('workspace worktree-per-role together with writes is accepted today', () => {
    const f = on((r) => {
      r.sections.research.writes = ['src/**'];
      r.run_config.workspace = 'worktree-per-role';
    });
    expect(f.errors).toEqual([]);
  });

  // EDITED BY P4.7: max_rework_rounds has an effect; a valid cap stays accepted.
  it('a valid max_rework_rounds is accepted today', () => {
    const f = on((r) => (r.sections.development.max_rework_rounds = 3));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(baseline.warnings);
  });

  // EDITED BY P4.8: an undeclared cycle becomes an error.
  it('a two-section cycle (research publishes findings, development publishes plans back) validates today', () => {
    const f = on((r) => {
      r.documents.plans = { schema: { type: 'object', required: ['summary'] }, evidence: [{ kind: 'source', verify: 'cited' }] };
      r.sections.development.publishes = ['plans'];
      r.sections.research.consumes = ['plans'];
    });
    expect(f.errors).toEqual([]);
  });

  // EDITED BY P4.9: the capacity error. The default max_concurrent_agents is 4; a sections org with more agent roles
  // than the cap is now an ERROR (the shared fixture sets 5 for its five roles). Full rules: lead-rules-definition.test.ts.
  it('a roster above max_concurrent_agents is an error on the surface (P4.9)', () => {
    expect(baseline.errors).toEqual([]);
    const f = on((r) => delete r.run_config.max_concurrent_agents);
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toMatch(/^run_config\.max_concurrent_agents: 4 is below the 5 agent roles/);
    expect(on((r) => (r.run_config.max_concurrent_agents = 1)).errors).toHaveLength(1);
  });

  // EDITED BY P4.9: the reports_to warning.
  it('a member whose reports_to is not its section lead gets a warning, not an error (P4.9)', () => {
    const f = on((r) => (r.roles.find((x: Raw) => x.id === 'coder').reports_to = 'boss'));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([
      expect.stringMatching(/^roles\.coder\.reports_to: "coder" is in section "development" but reports to "boss", not its section lead "dev-lead"/),
      ...baseline.warnings,
    ]);
  });

  it('parallelism.max_parallel is accepted and has no finding', () => {
    const f = on((r) => (r.sections.research.parallelism = { max_parallel: 2 }));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(baseline.warnings);
  });
});
