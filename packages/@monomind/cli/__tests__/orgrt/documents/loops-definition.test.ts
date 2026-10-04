// P4.8 (spec 6.15): `loops` on the sections surface, through the real checklist. A declared loop passes; an
// undeclared cycle is an error that names the sections; a loop that closes no cycle is a warning; overlapping loops
// are an error; an acyclic definition is untouched; off the surface `loops` is refused exactly as before.
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { loopOrg } from '../support/loop-defs.js';
import { sectionsRaw } from '../support/sections-defs.js';

const check = (raw: Record<string, any>) => checklistFindings(OrgDefSchema.parse(raw));
/** The generic warnings every definition of this shape gets (models, budgets, approvals): the baseline to compare with. */
const BASE = check(loopOrg(null, (r) => { r.sections.qa.publishes = []; r.sections.development.consumes = []; delete r.documents.report; })).warnings;
const TOP = '"loops" is not yet supported (org sections are designed, not built) — remove it';

describe('loops on the sections surface', () => {
  it('a declared dev and QA loop validates with no error and no warning but the generic ones and #21 (the fixture declares no checks)', () => {
    const f = check(loopOrg(4));
    const no21 = (ws: string[]) => ws.filter((w) => !w.startsWith('#21 '));
    expect(f.errors).toEqual([]);
    expect(no21(f.warnings)).toEqual(no21(BASE));
    expect(f.warnings.filter((w) => w.startsWith('#21 ')).map((w) => w.split(':')[0])).toEqual([
      '#21 documents.build',
      '#21 documents.report',
      '#21 documents.memo',
    ]);
  });

  it('an undeclared cycle is an error naming both sections, the types and the way out', () => {
    const f = check(loopOrg(null));
    expect(f.errors).toEqual([
      'sections.development, sections.qa: sections "development", "qa" hand documents around a cycle (types "build", "memo", "report") and no loop declares it — declare it: loops: [{"between": ["development", "qa"], "types": ["build", "memo", "report"], "max_rounds": N}], or break the cycle by removing one of those types from a consumes or publishes list',
    ]);
  });

  it('breaking the cycle instead (qa stops publishing report) validates with no loops key at all', () => {
    const raw = loopOrg(null, (r) => {
      r.sections.qa.publishes = [];
      r.sections.development.consumes = [];
      delete r.documents.report;
    });
    expect(check(raw)).toEqual({ errors: [], warnings: BASE });
  });

  it('a loop whose sections close no cycle is accepted with a warning and bounds nothing', () => {
    const raw = loopOrg(null, (r) => {
      r.sections.qa.publishes = [];
      r.sections.development.consumes = [];
      delete r.documents.report;
      r.loops = [{ between: ['development', 'qa'], types: ['build', 'memo'], max_rounds: 3 }];
    });
    const f = check(raw);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([expect.stringMatching(/^loops\[0\]: "development", "qa" do not form a cycle of document hand-offs, so this loop bounds nothing/), ...BASE]);
  });

  it('two loops that share a section are an error on the second', () => {
    const f = check(
      loopOrg(2, (r) => {
        r.loops.push({ between: ['development', 'qa'], types: ['report'], max_rounds: 2 });
      }),
    );
    expect(f.errors).toEqual([expect.stringMatching(/^loops\[1\]\.between: shares "development", "qa" with loops\[0\]/)]);
  });

  it.each([
    ['max_rounds zero', (r: Record<string, any>) => (r.loops[0].max_rounds = 0), /^loops\[0\]\.max_rounds: must be a positive integer/],
    ['an unknown section', (r: Record<string, any>) => (r.loops[0].between = ['development', 'nowhere']), /^loops\[0\]\.between: section "nowhere" does not exist/],
    ['an unknown field', (r: Record<string, any>) => (r.loops[0].escalate_to = 'boss'), /^loops\[0\]\.escalate_to: unknown loop field/],
    ['a type that is not a document type', (r: Record<string, any>) => (r.loops[0].types = ['build', 'nope']), /^loops\[0\]\.types: type "nope" is not a document type/],
  ])('%s is an error with the path and a remedy', (_n, patch, re) => {
    const f = check(loopOrg(2, patch));
    expect(f.errors.some((e) => re.test(e))).toBe(true);
    expect(f.errors.every((e) => e.includes(' — '))).toBe(true);
  });

  it('a section that consumes and publishes one type gets the existing error once, not a second cycle error', () => {
    const f = check(loopOrg(null, (r) => (r.sections.development.consumes = ['report', 'build'])));
    expect(f.errors.filter((e) => e.includes('both consumed and published'))).toHaveLength(1);
    expect(f.errors.some((e) => e.includes('which it publishes itself'))).toBe(false);
  });

  it('an acyclic sections definition has the findings it had before (none added)', () => {
    const f = check(sectionsRaw());
    expect(f.errors).toEqual([]);
    expect(f.warnings.filter((w) => /cycle|loop/.test(w))).toEqual([]);
  });
});

describe('surface off: `loops` is refused exactly as before', () => {
  const plain = () => {
    const raw = loopOrg(2);
    return { name: raw.name, goal: raw.goal, run_config: { idle_minutes: 0 }, roles: raw.roles.slice(0, 1) };
  };
  it.each([
    ['an empty list', []],
    ['a declared loop', [{ between: ['a', 'b'], types: ['t'], max_rounds: 2 }]],
    ['an object', {}],
  ])('loops as %s', (_n, loops) => {
    expect(check({ ...plain(), loops }).errors).toEqual([TOP]);
  });
});
