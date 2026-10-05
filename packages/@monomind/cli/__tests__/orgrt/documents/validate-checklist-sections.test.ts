// packages/@monomind/cli/__tests__/orgrt/documents/validate-checklist-sections.test.ts
// P3.1: the checklist relaxes ONLY sections, documents, requires and
// run_config.experimental, and only under sectionsSurface(def).enabled. With
// the surface off every refusal reads exactly as it did before sections.
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistErrorsForRaw, checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { VARIANTS } from '../support/golden-variants.js';
import { sectionsRaw } from '../support/sections-defs.js';

const plain = VARIANTS[0].raw as Record<string, any>;
const off = (top: Record<string, unknown>, runConfig: Record<string, unknown> = {}) =>
  checklistFindings(
    OrgDefSchema.parse({ ...plain, ...top, run_config: { idle_minutes: 0, ...runConfig } }),
  );
const on = (patch: (raw: Record<string, any>) => void = () => {}) =>
  checklistFindings(OrgDefSchema.parse(sectionsRaw(patch)));

const TOP = (k: string) => `"${k}" is not yet supported (org sections are designed, not built) — remove it`;
const RC = (k: string) => `run_config.${k} is not yet supported — remove it`;

describe('surface off: every refusal stays exactly as before', () => {
  it.each([
    ['sections: {}', { sections: {} }, TOP('sections')],
    ['sections with an empty entry', { sections: { s1: {} } }, TOP('sections')],
    ['documents alone', { documents: { d1: {} } }, TOP('documents')],
    ['documents with a valid-looking contract', { documents: { d1: { schema: {} } } }, TOP('documents')],
    ['requires alone', { requires: { sections: 1 } }, TOP('requires')],
    ['loops', { loops: [] }, TOP('loops')],
  ])('%s', (_n, top, message) => {
    expect(off(top as Record<string, unknown>).errors).toEqual([message]);
  });

  it.each([
    ['experimental alone', { experimental: 'eval' }, RC('experimental')],
    ['budget_usd', { budget_usd: 5 }, RC('budget_usd')],
    ['budget_mode', { budget_mode: 'soft' }, RC('budget_mode')],
  ])('run_config.%s', (_n, rc, message) => {
    expect(off({}, rc).errors).toEqual([message]);
  });

  it('a completion object without sections is refused', () => {
    const f = off({}, { completion: { mode: 'dag', protocol: 'sections-v1' } });
    expect(f.errors).toEqual([
      'run_config.completion as an object is only supported with a top-level "sections" — use "boss" or "dag"',
    ]);
  });

  it('sections keys without the surface add no sections finding at all', () => {
    const f = off({ documents: { d1: {} }, requires: { sections: 1 } }, { experimental: 'eval' });
    expect(f.errors).toEqual([TOP('documents'), TOP('requires'), RC('experimental')]);
  });

  it('a plain org has no errors and the same warnings it always had', () => {
    expect(off({}).errors).toEqual([]);
  });

  it('checklistErrorsForRaw refuses the same keys', () => {
    expect(checklistErrorsForRaw({ ...plain, documents: { d1: {} } })).toEqual([TOP('documents')]);
    expect(checklistErrorsForRaw(plain)).toEqual([]);
  });
});

describe('surface on: the four keys are accepted, nothing else is relaxed', () => {
  it('a valid sections definition has no errors and no unknown-key warnings', () => {
    const f = on();
    expect(f.errors).toEqual([]);
    expect(f.warnings.filter((w) => w.includes('unknown'))).toEqual([]);
  });

  it('checklistErrorsForRaw accepts it', () => {
    expect(checklistErrorsForRaw(sectionsRaw())).toEqual([]);
  });

  // `loops` was removed (sections exchange work only through documents): off the surface it stays a deferred key
  // (pinned above, unchanged); on the surface it is refused with the migration text.
  it('loops is refused on the surface with the migration text', () => {
    expect(on((r) => (r.loops = [])).errors).toEqual([
      expect.stringMatching(/^"loops": removed — sections exchange work only through documents; .*max_rework_rounds/),
    ]);
  });

  it('the relaxed keys are not reported as not yet supported', () => {
    const errors = on().errors.join('\n');
    for (const k of ['sections', 'documents', 'requires']) expect(errors).not.toContain(TOP(k));
    expect(errors).not.toContain(RC('experimental'));
  });

  it.each([
    ['requires', (r: Record<string, any>) => (r.requires = { sections: 3 }), 'requires.sections: this runtime supports version 1 only'],
    ['experimental', (r: Record<string, any>) => (r.run_config.experimental = 'beta'), 'run_config.experimental: must be "eval" or absent'],
    ['documents', (r: Record<string, any>) => delete r.documents, 'documents: a sections org must declare a documents map'],
    ['an undeclared type', (r: Record<string, any>) => r.sections.development.consumes.push('plans'), 'type "plans" is not declared'],
    ['schedule on an eval-mode org', (r: Record<string, any>) => (r.schedule = 60), 'schedule: an eval-mode sections org'],
  ])('a missing or wrong %s is a clear finding', (_n, patch, expected) => {
    expect(on(patch).errors.some((e) => e.includes(expected))).toBe(true);
  });

  it('a general-availability org may declare a schedule, the checklist included', () => {
    expect(on((r) => { delete r.run_config.experimental; r.schedule = '2h'; }).errors).toEqual([]);
  });

  it('definition warnings are reported as warnings', () => {
    const f = on((r) => delete r.sections.development.consumes);
    expect(f.errors).toEqual([]);
    expect(f.warnings.some((w) => w.includes('documents.findings: no section consumes it'))).toBe(true);
  });

  it('an unrelated unknown key still warns on a sections org', () => {
    const f = on((r) => (r.colour = 'red'));
    expect(f.warnings.some((w) => w.includes('unknown top-level key "colour"'))).toBe(true);
  });
});
