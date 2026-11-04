import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
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

/** The role fields blueprint resolution reads and fills — structurally a
 *  subset of the Org Runtime's OrgRole, so the catalog needs no orgrt types. */
export interface BlueprintRole {
  id: string;
  blueprint?: string;
  skills?: string[];
  skill_pool?: string[];
}

/** An org definition as blueprint resolution sees it (structurally OrgDef). */
export interface BlueprintOrgDef {
  roles: BlueprintRole[];
}

export interface ResolvedBlueprints<D extends BlueprintOrgDef = BlueprintOrgDef> {
  def: D;
  errors: string[];
  notes: string[];
}

/** The raw `blueprint.json` of the active `org` blueprint `name`, read once
 *  from its verified package; undefined when none is active. */
function readBlueprintBytes(root: string, name: string): Buffer | undefined {
  const asset = eligible(buildSnapshot(root), 'org').find(
    (a) => a.kind === 'blueprint' && a.name === name,
  );
  if (!asset?.dir) return undefined;
  // The snapshot may be cached; the bytes read below must still match the digest.
  const check = verifyEntry(root, asset);
  if (!check.ok) throw new Error(`package ${check.reason}`);
  return readFileSync(join(check.dir, 'blueprint.json'));
}

const bytesDigest = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The one value recorded for a blueprint that can't be read. Fixed, so the
 *  hash doesn't depend on which check failed first (a cached snapshot can
 *  report a changed package differently from a fresh one) or on local paths. */
export const BLUEPRINT_UNAVAILABLE = 'unavailable: not active for org on this machine';

/**
 * #571: what the signed hash records for blueprint `name` — `sha256:<hex>` of
 * its `blueprint.json` bytes, or BLUEPRINT_UNAVAILABLE when no active `org`
 * blueprint of that name can be read. Start and reload resolve a blueprint
 * only while its bytes still have the digest that was verified.
 */
export function blueprintDigest(root: string, name: string): string {
  try {
    const bytes = readBlueprintBytes(root, name);
    return bytes ? bytesDigest(bytes) : BLUEPRINT_UNAVAILABLE;
  } catch {
    return BLUEPRINT_UNAVAILABLE;
  }
}

/**
 * Fills each blueprint role's unset `skills` / `skill_pool` from its active
 * `org` blueprint. Explicit role fields always win; blueprints never produce
 * `policy` or `tool_providers` — their hints only become `notes`. Returns the
 * input object itself when no role names a blueprint, and never writes the
 * Org JSON. Skill names are left to the existing `validateRoleSkills`.
 *
 * With `digests` (the ones the signature was verified with, keyed
 * `blueprint:<name>`), a blueprint is used only if the bytes read now have
 * that digest (#571), so what the operator signed is what the roles get.
 */
export function resolveOrgDefBlueprints<D extends BlueprintOrgDef>(
  def: D,
  root: string,
  digests?: Record<string, string>,
): ResolvedBlueprints<D> {
  if (!def.roles.some((r) => r.blueprint !== undefined)) return { def, errors: [], notes: [] };
  const errors: string[] = [];
  const notes: string[] = [];
  const roles = def.roles.map((role) => {
    if (role.blueprint === undefined) return role;
    const label = `role "${role.id}": blueprint "${role.blueprint}"`;
    let bp: Blueprint;
    try {
      const bytes = readBlueprintBytes(root, role.blueprint);
      if (!bytes) {
        errors.push(`${label} is not active for org on this machine`);
        return role;
      }
      if (digests && digests[`blueprint:${role.blueprint}`] !== bytesDigest(bytes)) {
        errors.push(`${label} changed since the org was signed`);
        return role;
      }
      bp = BlueprintSchema.parse(JSON.parse(bytes.toString('utf8')));
    } catch (e) {
      errors.push(`${label} is invalid: ${(e as Error).message}`);
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
  // Each role is spread whole, so every field of D's own role type survives.
  return { def: { ...def, roles: roles as D['roles'] }, errors, notes };
}
