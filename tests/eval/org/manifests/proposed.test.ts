// The proposed scenario manifests are drafts for owner review. They must be
// complete enough to review (every field a committed manifest needs), and they
// must not be usable as committed ones until the owner edits and commits them.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, 'proposed', f), 'utf8'));
const scenarios = ['research-report', 'deliberative-design', 'sparse-dispatch'].map((id) =>
  load(`${id}.proposed.json`),
);

describe('PROPOSED scenario manifests', () => {
  it.each(scenarios)('$id is marked proposed and refused as it stands', (m) => {
    expect(m.status).toBe('PROPOSED');
    expect(m.notice).toMatch(/PROPOSED DRAFT.*owner/);
    const check = validateManifest(m);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      'committed_at is required and must be an ISO date (YYYY-MM-DD)',
    ]);
  });

  it.each(scenarios)('$id is otherwise a complete manifest: only committing it is left', (m) => {
    expect(validateManifest({ ...m, committed_at: '2026-10-03' })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('plans $8 per run, like every paid scenario', () => {
    for (const m of scenarios) expect(m.cost.planning_allocation_usd).toBe(8);
  });

  it('keeps drafts out of the committed manifest directory', () => {
    const committed = readdirSync(join(here)).filter((f) => f.endsWith('.json'));
    expect(committed).toEqual(['dev-feature-qa.json', 'growth-like.json']);
  });

  it('marks the dev-feature fixture proposed and names the scenario it serves', () => {
    const f = load('dev-feature-qa-fixture.proposed.json');
    expect(f.status).toBe('PROPOSED');
    expect(f.scenario).toBe('dev-feature-qa');
    expect(f.fixture.status).toBe('PROPOSED');
    expect(f.fixture.pinned_commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
