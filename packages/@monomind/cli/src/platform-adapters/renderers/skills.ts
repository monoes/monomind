/** Portable Mastermind router-skill rendering. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getMastermindSkillSourceDir,
  MASTERMIND_SKILLS,
  renderSkillPackage,
} from '../../mastermind/manifest.js';
import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';

function hasConcreteSkillLocation(adapter: PlatformAdapter, scope: InstallScope): boolean {
  const location = adapter.paths.locations.skill?.[scope];
  return location !== undefined && typeof location !== 'string';
}

/**
 * This is the portable router projection. The manifest remains the canonical
 * source for full SKILL.md packages; later materialization copies each package
 * beneath this declared skill root without platform-specific duplication.
 */
export function portableSkillRouter(): string {
  const workflows = MASTERMIND_SKILLS.map(
    ({ name, description }) => `- \`${name}\` — ${description}`,
  ).join('\n');

  return [
    '---',
    'name: mastermind',
    'description: Route a request to the applicable Mastermind workflow.',
    '---',
    '',
    '# Mastermind',
    '',
    'Load only the workflow that matches the current task:',
    workflows,
    '',
    'If skills cannot be loaded natively, run `monomind mastermind run <skill> --print`.',
  ].join('\n');
}

/** Render only a verified native portable-skill surface. */
export function renderSkillRouter(adapter: PlatformAdapter, scope: InstallScope): ArtifactIntent[] {
  if (adapter.capabilities.skills !== 'native' || !hasConcreteSkillLocation(adapter, scope)) {
    return [];
  }

  const packages = MASTERMIND_SKILLS.map((skill) => ({
    kind: 'skill' as const,
    locationKey: 'skill' as const,
    content: skill.name === 'mastermind' ? portableSkillRouter() : renderSkillPackage(skill),
    marker: `skills:${adapter.id}:${skill.name}`,
    relativePath: `${skill.source}/SKILL.md`,
    scope,
    replace: 'managed_block' as const,
    format: 'md' as const,
  }));
  const sourceDir = getMastermindSkillSourceDir();
  if (!sourceDir) return packages;
  const references = MASTERMIND_SKILLS.flatMap((skill) =>
    skill.references.map((reference) => ({
      kind: 'skill' as const,
      locationKey: 'skill' as const,
      content: readFileSync(join(sourceDir, skill.source, reference), 'utf8'),
      marker: `skills:${adapter.id}:${skill.name}:${reference}`,
      relativePath: `${skill.source}/${reference}`,
      scope,
      replace: 'managed_block' as const,
      format: 'md' as const,
    })),
  );
  return [...packages, ...references];
}
