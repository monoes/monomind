import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { OrgDef } from '../orgrt/types.js';
import { verifyEntry } from './digest.js';
import { buildSnapshot, eligible } from './snapshot.js';
import { CATALOG_NAME_RE } from './types.js';

export const BlueprintSchema = z
  .object({
    name: z.string().regex(CATALOG_NAME_RE),
    description: z.string().min(1).max(500),
    archetype: z.string().regex(CATALOG_NAME_RE).optional(),
    skills: z.array(z.string().regex(CATALOG_NAME_RE)).max(20).default([]),
    skill_pool: z
      .array(z.string().regex(/^(tag:)?[a-z0-9][a-z0-9-]{0,63}$/))
      .max(50)
      .default([]),
    runtimeHints: z
      .object({ reasoning: z.enum(['low', 'medium', 'high']).optional() })
      .strict()
      .optional(),
    recommendedPolicy: z
      .object({ git: z.enum(['none', 'read', 'commit', 'push']).optional() })
      .strict()
      .optional(),
  })
  .strict();

export type Blueprint = z.infer<typeof BlueprintSchema>;

export interface ResolvedBlueprints {
  def: OrgDef;
  errors: string[];
  notes: string[];
}

/** Active `org` blueprint by name, parsed from its verified package. */
function loadBlueprint(root: string, name: string): Blueprint | undefined {
  const asset = eligible(buildSnapshot(root), 'org').find(
    (a) => a.kind === 'blueprint' && a.name === name,
  );
  if (!asset?.dir) return undefined;
  // The snapshot may be cached; the bytes read below must still match the digest.
  const check = verifyEntry(root, asset);
  if (!check.ok) throw new Error(`package ${check.reason}`);
  return BlueprintSchema.parse(JSON.parse(readFileSync(join(check.dir, 'blueprint.json'), 'utf8')));
}

/**
 * Fills each blueprint role's unset `skills` / `skill_pool` from its active
 * `org` blueprint. Explicit role fields always win; blueprints never produce
 * `policy` or `tool_providers` — their hints only become `notes`. Returns the
 * input object itself when no role names a blueprint, and never writes the
 * Org JSON. Skill names are left to the existing `validateRoleSkills`.
 */
export function resolveOrgDefBlueprints(def: OrgDef, root: string): ResolvedBlueprints {
  if (!def.roles.some((r) => r.blueprint !== undefined)) return { def, errors: [], notes: [] };
  const errors: string[] = [];
  const notes: string[] = [];
  const roles = def.roles.map((role) => {
    if (role.blueprint === undefined) return role;
    const label = `role "${role.id}": blueprint "${role.blueprint}"`;
    let bp: Blueprint | undefined;
    try {
      bp = loadBlueprint(root, role.blueprint);
    } catch (e) {
      errors.push(`${label} is invalid: ${(e as Error).message}`);
      return role;
    }
    if (!bp) {
      errors.push(`${label} is not active for org on this machine`);
      return role;
    }
    if (bp.runtimeHints?.reasoning)
      notes.push(`${label} suggests reasoning "${bp.runtimeHints.reasoning}" (not applied)`);
    if (bp.recommendedPolicy?.git)
      notes.push(`${label} recommends policy.git "${bp.recommendedPolicy.git}" (not applied)`);
    return {
      ...role,
      skills: role.skills ?? [...(bp.archetype ? [bp.archetype] : []), ...bp.skills],
      skill_pool: role.skill_pool ?? bp.skill_pool,
    };
  });
  return { def: { ...def, roles }, errors, notes };
}
