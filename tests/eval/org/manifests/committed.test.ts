// Every committed scenario manifest is complete (spec section 10) and none is a draft.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarios = [
  'dev-feature-qa',
  'dev-feature-qa-revise',
  'deliberative-design',
  'growth-like',
  'research-report',
  'sparse-dispatch',
];

describe('committed scenario manifests', () => {
  it('are exactly the six scenarios', () => {
    expect(
      readdirSync(here)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(scenarios.map((s) => `${s}.json`).sort());
  });
  it.each(scenarios)('%s validates and carries no draft marker', (id) => {
    const m = JSON.parse(readFileSync(join(here, `${id}.json`), 'utf8'));
    expect(validateManifest(m)).toEqual({ ok: true, problems: [] });
    expect(m.status).toBeUndefined();
    expect(m.id).toBe(id);
  });

  it('dev-feature-qa-revise (approved by the owner 2026-10-02) has the revision unit, the dev-feature cost and margin, and its fixture record is approved', () => {
    const m = JSON.parse(readFileSync(join(here, 'dev-feature-qa-revise.json'), 'utf8'));
    expect(m.units.map((u: { id: string }) => u.id)).toEqual([
      'feature-change',
      'qa-report',
      'defect-found-and-fixed',
    ]);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 8 });
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/first version/);
    expect(m.committed_at).toBe('2026-10-02');
    const fixture = JSON.parse(
      readFileSync(join(here, '../fixtures/dev-feature-qa-revise/fixture.json'), 'utf8'),
    );
    expect(fixture.status).toMatch(/^APPROVED 2026-10-02/);
    expect(fixture.fixture.status).toMatch(/^APPROVED 2026-10-02/);
  });
});
