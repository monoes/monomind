/** Portable Mastermind router-skill rendering. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getMastermindSkillSourceDir,
  MASTERMIND_SKILLS,
  renderSkillPackage,
} from '../../mastermind/manifest.js';
import { sharedSkillSurface } from '../shared-surface.js';
import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';

function hasConcreteSkillLocation(adapter: PlatformAdapter, scope: InstallScope): boolean {
  const location = adapter.paths.locations.skill?.[scope];
  return location !== undefined && typeof location !== 'string';
}

/** Render only a verified native portable-skill surface. */
export function renderSkillRouter(adapter: PlatformAdapter, scope: InstallScope): ArtifactIntent[] {
  if (adapter.capabilities.skills !== 'native' || !hasConcreteSkillLocation(adapter, scope)) {
    return [];
  }

  // Every Mastermind skill, the router (`mastermind` itself) included, is
  // rendered from its real curated SKILL.md via renderSkillPackage() — the
  // curated file on disk is the single source of truth. `mastermind` used to
  // be special-cased to a separate generator (portableSkillRouter(), o-09
  // regression 61396db8d): it built its own workflow list from this same
  // MASTERMIND_SKILLS array, which never listed mastermind-idea/
  // mastermind-design, so it silently shipped a router contradicting the
  // curated file's own "these gates are mandatory" text. The special case
  // was never a fallback for a missing source dir either — this .map() would
  // already throw on the first non-mastermind renderSkillPackage() call
  // before any such guard could run.
  // Each file is written whole and owned through the init manifest's hashes
  // (GH #344). `marker`/`supersedes` name the blocks older versions wrapped it
  // in, so an install can still recognise and migrate those files.
  const surface = sharedSkillSurface(adapter, scope);
  const owner = surface?.id ?? adapter.id;
  const sharing = (name: string) =>
    surface && {
      surface: surface.id,
      supersedes: surface.platforms.map((id) => `skills:${id}:${name}`),
    };
  const packages = MASTERMIND_SKILLS.map((skill) => ({
    kind: 'skill' as const,
    locationKey: 'skill' as const,
    content: renderSkillPackage(skill),
    marker: `skills:${owner}:${skill.name}`,
    ...sharing(skill.name),
    relativePath: `${skill.source}/SKILL.md`,
    scope,
    replace: 'owned_file' as const,
    format: 'md' as const,
  }));
  const sourceDir = getMastermindSkillSourceDir();
  if (!sourceDir) return packages;
  const references = MASTERMIND_SKILLS.flatMap((skill) =>
    skill.references.map((reference) => ({
      kind: 'skill' as const,
      locationKey: 'skill' as const,
      content: readFileSync(join(sourceDir, skill.source, reference), 'utf8'),
      marker: `skills:${owner}:${skill.name}:${reference}`,
      ...sharing(`${skill.name}:${reference}`),
      relativePath: `${skill.source}/${reference}`,
      scope,
      replace: 'owned_file' as const,
      format: 'md' as const,
    })),
  );
  return [...packages, ...references];
}
