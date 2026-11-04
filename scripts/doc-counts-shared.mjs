#!/usr/bin/env node
/**
 * doc-count generation — shared repo-root/tracked-file plumbing.
 * Split out of generate-doc-counts.mjs (file-size sweep). Pure move.
 *
 * What counts: tracked files, plus the skills generated at pack time.
 *
 * Walking the working tree made the counts machine-dependent: the monodesign
 * skill is gitignored and compiled locally (and by the CLI's prepack), so a
 * checkout that had compiled it said 90 bundled skills and one that had not
 * said 89; any untracked scratch file counted too. Now a file counts when git
 * tracks it or when it lies in a generated skill directory, which is compiled
 * fresh first — exactly what `npm pack` ships.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGeneratedSkills } from './sync-claude-trees.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const read = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');

/** Skill directories compiled at pack time rather than committed. */
const GENERATED_SKILL_DIRS = [
  '.claude/skills/monodesign/',
  // Gitignored trees written by scripts/generate-claude-trees.mjs.
  'packages/@monomind/cli/.claude/',
  '.agents/skills/',
  '.gemini/skills/',
  '.gemini/helpers/',
  '.kimi-code/agents/',
  '.kimi-code/plugin/commands/',
  '.kimi-code/skills/',
];

compileGeneratedSkills(REPO_ROOT);

const TRACKED = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter(Boolean),
);

/** True for a repo-relative path that ships: tracked, or inside a generated skill dir. */
export function counts(rel) {
  return TRACKED.has(rel) || GENERATED_SKILL_DIRS.some((dir) => rel.startsWith(dir));
}

/** The npm-shipped asset tree `monomind init` copies from. */
export const CLI_PKG = 'packages/@monomind/cli';
