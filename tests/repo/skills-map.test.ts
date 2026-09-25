/**
 * SKILLS_MAP (packages/@monomind/cli/src/init/shared.ts) is what `monomind
 * init` copies out of the npm-shipped skill tree. Two drifts went unnoticed:
 *
 *   - it listed `monolean-review`, which exists in no tree, so init silently
 *     copied nothing for it;
 *   - the package shipped skills init never installs (github-issue-triage and
 *     github-repo-recap, deleted from the root tree in 1f13282ea, and
 *     stop-slop, which three marketing agents tell the model to read).
 *
 * Reads the BUILT map (dist/), like the other shipped-tree checks.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileGeneratedSkills } from '../../scripts/sync-claude-trees.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG_SKILLS = join(REPO_ROOT, 'packages/@monomind/cli/.claude/skills');

let skillsMap: Record<string, string[]>;
const shippedSkills = () =>
  readdirSync(PKG_SKILLS).filter((d) => existsSync(join(PKG_SKILLS, d, 'SKILL.md')));

beforeAll(async () => {
  // monodesign is compiled into the package tree at pack time (prepack).
  compileGeneratedSkills(REPO_ROOT);
  const shared = await import(
    pathToFileURL(join(REPO_ROOT, 'packages/@monomind/cli/dist/src/init/shared.js')).href
  );
  skillsMap = shared.SKILLS_MAP;
});

describe('SKILLS_MAP matches the shipped skill tree', () => {
  it('every SKILLS_MAP entry exists as a skill in the package tree', () => {
    const shipped = new Set(shippedSkills());
    const missing = Object.values(skillsMap)
      .flat()
      .filter((name) => !name.endsWith('*') && !shipped.has(name));
    expect(missing).toEqual([]);
  });

  it('every shipped skill is installed by some SKILLS_MAP entry', () => {
    const entries = Object.values(skillsMap).flat();
    const installed = (skill: string) =>
      entries.some((e) => (e.endsWith('*') ? skill.startsWith(e.slice(0, -1)) : e === skill));
    expect(shippedSkills().filter((s) => !installed(s))).toEqual([]);
  });
});
