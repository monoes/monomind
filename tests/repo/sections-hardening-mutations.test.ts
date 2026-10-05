/**
 * GA row R7 (org sections spec 9.3): keeps the mutation table of the release-build
 * guards honest. scripts/sections-hardening-mutation.mjs weakens each guard in turn and
 * requires the probe suite to fail; if a refactor moved or reworded a guard, its
 * mutation would silently stop applying. This test fails first, on every run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { MUTATIONS, ORGRT } from '../../scripts/sections-hardening-mutations.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('sections hardening mutation table', () => {
  it('covers every release-build row R1 to R6', () => {
    const rows = new Set((MUTATIONS as { row: string }[]).map((m) => m.row));
    expect([...rows].sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  });

  for (const m of MUTATIONS as {
    row: string;
    name: string;
    file: string;
    find: string;
    replace: string;
  }[]) {
    it(`${m.row}: "${m.name}" still applies to exactly one place in ${m.file}`, () => {
      const text = readFileSync(join(REPO, ORGRT, m.file), 'utf8');
      expect(text.split(m.find).length - 1).toBe(1);
      expect(m.replace).not.toBe(m.find);
    });
  }
});
