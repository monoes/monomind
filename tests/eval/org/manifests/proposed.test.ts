// A proposed scenario manifest is a draft for owner review. It must be complete enough to review (every
// field a committed manifest needs), and must not be usable as a committed one until the owner edits and
// commits it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, 'proposed', f), 'utf8'));
const drafts = readdirSync(join(here, 'proposed')).filter((f) => f.endsWith('.proposed.json'));

describe('PROPOSED scenario manifests', () => {
  it.each(drafts)('%s is marked proposed and refused as it stands', (f) => {
    const m = load(f);
    expect(m.status).toBe('PROPOSED');
    expect(m.notice).toMatch(/PROPOSED DRAFT.*owner/);
    const check = validateManifest(m);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      'committed_at is required and must be an ISO date (YYYY-MM-DD)',
    ]);
  });

  it.each(drafts)('%s is otherwise a complete manifest: only committing it is left', (f) => {
    expect(validateManifest({ ...load(f), committed_at: '2026-10-03' })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('keeps drafts out of the committed manifest directory', () => {
    const committed = readdirSync(here).filter((f) => f.endsWith('.json'));
    expect(committed.some((f) => f.includes('revise'))).toBe(false);
    expect(committed).toContain('dev-feature-qa.json'); // the active one is unchanged
  });

  it('dev-feature-qa-revise adds the revision unit and keeps the cost, qualification and non-inferiority basis', () => {
    const m = load('dev-feature-qa-revise.proposed.json');
    expect(m.units.map((u: { id: string }) => u.id)).toEqual([
      'feature-change',
      'qa-report',
      'defect-found-and-fixed',
    ]);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 8 });
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/first version/);
  });
});
