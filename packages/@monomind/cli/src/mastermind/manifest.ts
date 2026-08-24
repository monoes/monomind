/**
 * Canonical portable Mastermind workflow inventory.
 *
 * Additions require a shipped `.claude/skills/<source>/SKILL.md` package and a
 * manifest fixture. Consumers must use this manifest rather than maintaining
 * their own workflow lists.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSourceDir } from '../init/shared.js';
import { MASTERMIND_SKILLS, type MastermindSkill } from './manifest-data.js';

export { MASTERMIND_SKILLS, type MastermindSkill } from './manifest-data.js';

/** Resolve a canonical workflow name or an accepted shorthand, case-insensitively. */
export function resolveMastermindSkill(name: string): MastermindSkill | undefined {
  const normalized = name.trim().toLowerCase();
  return MASTERMIND_SKILLS.find(
    (skill) => skill.name === normalized || skill.aliases.includes(normalized),
  );
}

/** Locate the package's shipped Mastermind skill source tree. */
export function getMastermindSkillSourceDir(sourceBaseDir?: string): string | null {
  return findSourceDir('skills', sourceBaseDir);
}

/**
 * Load a canonical skill package for display or a platform projection.
 *
 * The packages are already platform-neutral. `target` is deliberately part of
 * the stable API so renderers can select target-specific transformations later
 * without changing callers.
 */
export function renderSkillPackage(skill: MastermindSkill, _target = 'neutral'): string {
  const sourceDir = getMastermindSkillSourceDir();
  if (!sourceDir) {
    throw new Error('Could not locate the shipped Mastermind skill source directory');
  }

  return readFileSync(join(sourceDir, skill.source, 'SKILL.md'), 'utf8');
}
