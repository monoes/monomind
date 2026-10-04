// packages/@monomind/cli/__tests__/orgrt/documents/surface.test.ts
// P3.1: the one predicate, and that a definition without the new keys parses to
// exactly the object it parsed to before sections existed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sectionsSurface } from '../../../src/orgrt/documents/surface.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { VARIANTS } from '../support/golden-variants.js';
import { sectionsRaw } from '../support/sections-defs.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, '..', 'fixtures', 'sections-off', 'defs-parsed.json'), 'utf8'),
) as Record<string, unknown>;

describe('sectionsSurface', () => {
  it('is on only for a top-level sections object with a declared section', () => {
    expect(sectionsSurface(OrgDefSchema.parse(sectionsRaw())).enabled).toBe(true);
    expect(sectionsSurface({ sections: { a: { members: ['x'] } } }).enabled).toBe(true);
  });

  it.each([
    ['no sections key', {}],
    ['sections: {}', { sections: {} }],
    ['a section with nothing in it', { sections: { a: {} } }],
    ['sections as a list', { sections: [{ members: ['x'] }] }],
    ['sections as a string', { sections: 'yes' }],
    ['sections null', { sections: null }],
    ['documents alone', { documents: { d: { schema: {} } } }],
    ['requires alone', { requires: { sections: 1 } }],
    ['experimental alone', { run_config: { experimental: 'eval' } }],
    ['a completion object alone', { run_config: { completion: { mode: 'dag', protocol: 'sections-v1' } } }],
  ])('is off for %s', (_n, def) => {
    expect(sectionsSurface(def as never).enabled).toBe(false);
  });

  it('is off for an undefined definition', () => {
    expect(sectionsSurface(undefined).enabled).toBe(false);
  });

  it('is pure: same answer twice, input untouched, only `sections` is read', () => {
    const def = sectionsRaw();
    const before = JSON.stringify(def);
    expect(sectionsSurface(def)).toEqual(sectionsSurface(def));
    expect(JSON.stringify(def)).toBe(before);
    const stripped = { sections: def.sections };
    expect(sectionsSurface(stripped)).toEqual(sectionsSurface(def));
    expect(Object.keys(sectionsSurface(def))).toEqual(['enabled']);
  });
});

describe('schema entries are optional with no defaults', () => {
  const names = [
    ...VARIANTS.map((v) => [v.name, v.raw] as const),
    ['minimal', { name: 'tiny', roles: [{ id: 'a' }] }] as const,
  ];

  it.each(names)('%s parses to exactly the recorded object, with no new key', (n, raw) => {
    const parsed = JSON.parse(JSON.stringify(OrgDefSchema.parse(raw)));
    expect(parsed).toEqual(golden[n]);
    for (const k of ['requires', 'sections', 'documents'] as const) expect(k in parsed).toBe(false);
    expect('experimental' in parsed.run_config).toBe(false);
  });

  it('parses a sections definition and keeps the completion object', () => {
    const parsed = OrgDefSchema.parse(sectionsRaw());
    expect(parsed.run_config.completion).toEqual({ mode: 'dag', protocol: 'sections-v1' });
    expect(parsed.requires).toEqual({ sections: 1 });
    expect(parsed.run_config.experimental).toBe('eval');
  });

  it('still refuses a malformed completion at parse', () => {
    const ok = (completion: unknown) =>
      OrgDefSchema.safeParse({ name: 'x', roles: [{ id: 'a' }], run_config: { completion } }).success;
    expect(ok('dag')).toBe(true);
    expect(ok('sometimes')).toBe(false);
    expect(ok({ mode: 'weekly', protocol: 'sections-v1' })).toBe(false);
    expect(ok({ mode: 'dag' })).toBe(false);
    expect(ok({ mode: 'dag', protocol: 'sections-v1', extra: 1 })).toBe(false);
  });
});
