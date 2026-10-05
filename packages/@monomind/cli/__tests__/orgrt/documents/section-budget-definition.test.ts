// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-definition.test.ts
// P4.5: the budget keys through the real checklist (`checklistFindings`, which `org validate`, start, reload and
// the dashboard all call). Every P4.1 finding code is reached from a definition; off the surface the keys fail
// with today's messages; the unsupported keys the core refuses stay refused.
import { describe, expect, it } from 'vitest';
import { BUDGET_FINDING_CODES } from '../../../src/orgrt/documents/section-budget-findings.js';
import { sectionBudgetChecklist } from '../../../src/orgrt/documents/section-budget-wire.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistErrorsForRaw, checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { VARIANTS } from '../support/golden-variants.js';
import { budgetedOrg } from '../support/section-budget-org.js';

type Raw = Record<string, any>;
const check = (raw: Raw) => checklistFindings(OrgDefSchema.parse(raw));
const role = (raw: Raw, id: string): Raw => raw.roles.find((r: Raw) => r.id === id);
const starts = (list: string[], prefix: string): boolean => list.some((e) => e.startsWith(prefix));

describe('a valid partition', () => {
  it('has no error, no unknown-key warning and no budget warning', () => {
    const f = check(budgetedOrg());
    expect(f.errors).toEqual([]);
    expect(f.warnings.filter((w) => /unknown|budget_usd: |allocation/.test(w))).toEqual([]);
  });

  it('is accepted by checklistErrorsForRaw (the dashboard path)', () => {
    expect(checklistErrorsForRaw(budgetedOrg())).toEqual([]);
  });

  it('an org that sets no budget key is checked exactly as before (no budget finding at all)', () => {
    const f = check(budgetedOrg((r) => {
      for (const x of r.roles) delete x.budget_usd;
      delete r.run_config.budget_usd;
      delete r.sections.research.budget;
      delete r.sections.development.budget;
      delete r.sections.watch.budget;
    }));
    expect(f.errors).toEqual([]);
  });
});

// [finding code, how to break the valid org, the finding's path prefix, 'errors' or 'warnings']
const MATRIX: Array<[string, (r: Raw) => void, string, 'errors' | 'warnings']> = [
  ['ORG_BUDGET_MISSING', (r) => delete r.run_config.budget_usd, 'run_config.budget_usd: sections allocate USD', 'errors'],
  ['ORG_BUDGET_INVALID', (r) => (r.run_config.budget_usd = 0), 'run_config.budget_usd: must be a positive number', 'errors'],
  ['SECTION_BUDGET_SHAPE', (r) => (r.sections.research.budget = { usd: -3 }), 'sections.research.budget: must be {"usd"', 'errors'],
  ['SECTION_BUDGET_SHAPE', (r) => (r.sections.research.budget = { usd: 30, tokens: 5 }), 'sections.research.budget: "tokens" is not yet supported', 'errors'],
  ['SECTION_BUDGET_MISSING', (r) => delete r.sections.development.budget, 'sections.development.budget: section "development" has no budget', 'errors'],
  ['ROLE_CAP_MISSING', (r) => delete role(r, 'coder').budget_usd, 'roles.coder.budget_usd: role "coder" has no explicit budget_usd', 'errors'],
  ['ROLE_CAP_CONFLICT', (r) => (role(r, 'coder').policy.maxUsd = 5), 'roles.coder.policy.maxUsd: role "coder" has budget_usd', 'errors'],
  ['SECTION_CAPS_OVER_ALLOCATION', (r) => (r.sections.research.budget = { usd: 20 }), 'sections.research.budget.usd: the role caps of section "research"', 'errors'],
  ['ALLOCATIONS_OVER_ORG_BUDGET', (r) => (r.run_config.budget_usd = 50), 'run_config.budget_usd: the section allocations sum to $70', 'errors'],
  ['RESERVE_EMPTY', (r) => (r.run_config.budget_usd = 70), 'run_config.budget_usd: the allocations ($70) use the whole org budget', 'errors'],
  ['RESERVE_CAPS_OVER', (r) => (role(r, 'boss').budget_usd = 50), 'run_config.budget_usd: the caps of the root and the roles in no section', 'errors'],
  ['UNPRICED_RUNNER', (r) => (role(r, 'coder').runtime = 'codex'), 'roles.coder.runtime: role "coder" runs on codex', 'errors'],
  ['BUDGET_MODE_UNSUPPORTED', (r) => (r.run_config.budget_mode = 'strict'), 'run_config.budget_mode: "strict" is not yet supported', 'errors'],
  ['BUDGET_KEY_NOT_YET_SUPPORTED', (r) => (r.run_config.max_turn_usd = 1), 'run_config.max_turn_usd: max_turn_usd is not yet supported', 'errors'],
  ['BUDGET_KEY_NOT_YET_SUPPORTED', (r) => (r.run_config.allow_unbounded_turn = true), 'run_config.allow_unbounded_turn: ', 'errors'],
  ['BUDGET_KEY_NOT_YET_SUPPORTED', (r) => (r.run_config.slice_cap = 1), 'run_config.slice_cap: ', 'errors'],
  ['BUDGET_KEY_NOT_YET_SUPPORTED', (r) => (r.run_config.slice_floor = 1), 'run_config.slice_floor: ', 'errors'],
  ['ALLOCATION_UNASSIGNED', (r) => (role(r, 'coder').budget_usd = 10), 'sections.development.budget.usd: $10 of section "development" is not assigned', 'warnings'],
  ['ROSTER_ROLE_UNKNOWN', (r) => r.sections.research.members.push('ghost'), 'sections.research: role "ghost" is named in the roster', 'warnings'],
];

describe('every P4.1 finding is reached through checklistFindings', () => {
  it.each(MATRIX)('%s (%#)', (_code, patch, prefix, kind) => {
    const f = check(budgetedOrg((r) => {
      for (const x of r.roles) x.policy = { ...x.policy };
      patch(r);
    }));
    expect(starts(f[kind], prefix), `${prefix}\n${JSON.stringify(f, null, 1)}`).toBe(true);
  });

  it('the matrix covers every code the core defines, except the one a parsed definition cannot reach', () => {
    const covered = new Set(MATRIX.map(([c]) => c));
    // ROLE_CAP_INVALID needs a non-positive budget_usd or policy.maxUsd, which the schema refuses first.
    expect(BUDGET_FINDING_CODES.filter((c) => !covered.has(c))).toEqual(['ROLE_CAP_INVALID']);
  });

  it('ROLE_CAP_INVALID is reached through the checklist function itself (the schema refuses it on parse)', () => {
    const raw = budgetedOrg();
    role(raw, 'coder').budget_usd = -1;
    expect(OrgDefSchema.safeParse(raw).success).toBe(false);
    const f = sectionBudgetChecklist(raw as never);
    expect(starts(f.errors, 'roles.coder.budget_usd: role "coder" budget_usd must be a positive number')).toBe(true);
  });

  it('the same errors reach the dashboard path (checklistErrorsForRaw)', () => {
    const raw = budgetedOrg((r) => (r.sections.research.budget = { usd: 20 }));
    expect(starts(checklistErrorsForRaw(raw), 'sections.research.budget.usd: the role caps')).toBe(true);
  });

  it('a conflicting policy.maxUsd is refused even when no budget_usd is set on the role', () => {
    const f = check(budgetedOrg((r) => (role(r, 'coder').policy = { sandbox: { mode: 'off' }, maxUsd: 7 })));
    expect(starts(f.errors, 'roles.coder.policy.maxUsd: ')).toBe(true);
  });

  it('a policy.maxUsd equal to budget_usd is accepted', () => {
    expect(check(budgetedOrg((r) => (role(r, 'coder').policy = { sandbox: { mode: 'off' }, maxUsd: 20 }))).errors).toEqual([]);
  });

  it('endpoint roles hold no cap and need none', () => {
    const f = check(budgetedOrg((r) => {
      r.roles.push({ id: 'hook', title: 'hook', kind: 'endpoint', reports_to: 'boss', endpoint: { url: 'https://example.com/x' } });
    }));
    expect(f.errors.filter((e) => e.includes('"hook"'))).toEqual([]);
  });
});

describe('org budget without section budgets', () => {
  it('run_config.budget_usd alone is accepted as the org ceiling', () => {
    const f = check(budgetedOrg((r) => {
      delete r.sections.research.budget;
      delete r.sections.development.budget;
      delete r.sections.watch.budget;
      for (const x of r.roles) delete x.budget_usd;
    }));
    expect(f.errors).toEqual([]);
  });

  it.each([0, -5, 'ten', null])('run_config.budget_usd of %j alone is refused', (v) => {
    const f = check(budgetedOrg((r) => {
      delete r.sections.research.budget;
      delete r.sections.development.budget;
      delete r.sections.watch.budget;
      r.run_config.budget_usd = v;
    }));
    expect(starts(f.errors, 'run_config.budget_usd: must be a positive number of dollars')).toBe(true);
  });
});

describe('off the surface the budget keys fail with today\'s messages (unchanged)', () => {
  const plain = VARIANTS[0].raw as Raw;
  const off = (rc: Raw, extra: Raw = {}) =>
    checklistFindings(OrgDefSchema.parse({ ...plain, ...extra, run_config: { idle_minutes: 0, ...rc } }));
  it.each([
    [{ budget_usd: 5 }, ['run_config.budget_usd is not yet supported — remove it']],
    [{ budget_mode: 'soft' }, ['run_config.budget_mode is not yet supported — remove it']],
    [{ budget_usd: 5, budget_mode: 'soft' }, ['run_config.budget_usd is not yet supported — remove it', 'run_config.budget_mode is not yet supported — remove it']],
  ])('run_config %j', (rc, errors) => {
    expect(off(rc).errors).toEqual(errors);
  });

  it('max_turn_usd and allow_unbounded_turn stay unknown-key warnings', () => {
    const f = off({ max_turn_usd: 1, allow_unbounded_turn: true });
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(
      expect.arrayContaining([
        'unknown run_config.max_turn_usd is ignored by the runtime — check the spelling',
        'unknown run_config.allow_unbounded_turn is ignored by the runtime — check the spelling',
      ]),
    );
  });

  it('a section budget without the surface keys is one more key that switches the surface on, not a refusal of its own', () => {
    // `sections` with a budget IS the surface; the other sections requirements then apply (documents).
    const f = off({}, { sections: { s1: { budget: { usd: 5 }, members: ['boss'] } } });
    expect(f.errors.some((e) => e.startsWith('documents: a sections org must declare'))).toBe(true);
    expect(f.errors.some((e) => e.includes('which is not built'))).toBe(false);
  });
});
