/**
 * `org validate` and `org run` fail on a skill name the org skill library
 * cannot resolve, but nothing checked the org definitions this repo ships
 * until someone tried to run one: renaming or dropping a skill (or a project
 * skill under .monomind/org-skills) silently broke every org that pinned it.
 *
 * Every tracked org definition must name only skills the real resolver finds,
 * with the repo root as project root — and the user's own ~/.monomind skills
 * excluded, so a skill that exists only on one machine cannot pass here. The
 * copies under config/orgs mirror .monomind/orgs and must not drift.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandSkillPool, getSkill } from '../../packages/@monomind/cli/src/orgrt/skill-library.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface OrgFile {
  roles: { id: string; skills?: string[]; skill_pool?: string[] }[];
  loadouts?: Record<string, { skills?: string[] }>;
}

/** Org definitions git tracks: .monomind/orgs holds untracked local orgs too. */
const trackedOrgFiles = execFileSync(
  'git',
  ['ls-files', '--', '.monomind/orgs/*.json', 'config/orgs/*.json'],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\n')
  .filter((p) => /^(\.monomind|config)\/orgs\/[^/]+\.json$/.test(p));

/** Every skill reference in one org: [where, name-or-selector]. */
function skillRefs(def: OrgFile): [string, string][] {
  const refs: [string, string][] = [];
  for (const role of def.roles) {
    for (const s of role.skills ?? []) refs.push([`role "${role.id}" skills`, s]);
    for (const s of role.skill_pool ?? []) refs.push([`role "${role.id}" skill_pool`, s]);
  }
  for (const [name, loadout] of Object.entries(def.loadouts ?? {})) {
    for (const s of loadout.skills ?? []) refs.push([`loadout "${name}" skills`, s]);
  }
  return refs;
}

describe('tracked org definitions', () => {
  const savedHome = process.env.MONOMIND_HOME;
  beforeAll(() => {
    // Point the user skill root at a directory that does not exist.
    process.env.MONOMIND_HOME = join(repoRoot, '.no-such-monomind-home');
  });
  afterAll(() => {
    if (savedHome === undefined) delete process.env.MONOMIND_HOME;
    else process.env.MONOMIND_HOME = savedHome;
  });

  it('are found', () => {
    expect(trackedOrgFiles).toContain('.monomind/orgs/release.json');
    expect(trackedOrgFiles).toContain('.monomind/orgs/monomind-dev.json');
  });

  it.each(trackedOrgFiles)('%s names only skills the org skill library resolves', (file) => {
    const def = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as OrgFile;
    const missing = skillRefs(def)
      .filter(([, ref]) =>
        ref.startsWith('tag:')
          ? expandSkillPool([ref], repoRoot).length === 0
          : getSkill(ref, repoRoot) === null,
      )
      .map(([where, ref]) => `${where}: ${ref}`);
    expect(missing).toEqual([]);
  });

  const mirrored = trackedOrgFiles
    .filter((p) => p.startsWith('config/orgs/'))
    .map((p) => basename(p))
    .filter((name) => existsSync(join(repoRoot, '.monomind', 'orgs', name)));

  it.each(mirrored)('%s is byte-identical in .monomind/orgs and config/orgs', (name) => {
    const a = readFileSync(join(repoRoot, '.monomind', 'orgs', name));
    const b = readFileSync(join(repoRoot, 'config', 'orgs', name));
    expect(a.equals(b)).toBe(true);
  });
});
