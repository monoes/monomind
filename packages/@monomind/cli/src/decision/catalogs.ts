/**
 * Candidate catalogs for the Jev picker. Registry agents and skills come from
 * the shared helper (.claude/helpers/jev-catalog.cjs) so the hook and the CLI
 * read them identically; both indexes are refreshed first when stale.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRegistry, findProjectRoot } from '../agents/registry-freshness.js';
import { verifyEntry } from '../catalog/digest.js';
import { buildSnapshot, eligible } from '../catalog/snapshot.js';
import { bundledSkillsDir, listSkills } from '../orgrt/skill-library.js';
import type { OrgRole } from '../orgrt/types.js';
import { type CatalogItem, jevModule } from './jev.js';

export interface RouteLike {
  name: string;
  agentSlug: string;
  description?: string;
  utterances?: string[];
}

/** The project that owns `cwd` (walking up), or `cwd` itself. */
const projectOf = (cwd: string): string => findProjectRoot(cwd) ?? cwd;

/** Registry agents, rebuilt synchronously first when registry.json is missing
 *  or older than an agent definition. */
export function agentCatalog(root: string): CatalogItem[] {
  const project = projectOf(root);
  ensureRegistry(project);
  return jevModule()?.loadAgentCatalog(project) ?? [];
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/decision → ../.. is the package root; dist/src/decision → ../../.. */
const BUILDER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
];

interface SkillIndexBuilder {
  build(root: string, opts?: { bundledDir?: string }): unknown;
  ensure(root: string, opts?: { bundledDir?: string }): unknown;
}

/**
 * The skill index for `root` (platform skills + Org library), with the
 * bundled builder. A project with a `.claude` dir gets its
 * .claude/helpers/skill-registry.json refreshed when a source is newer (the
 * hook reads that file); any other directory is indexed in memory only.
 */
export function skillIndex(root: string): unknown {
  const file = BUILDER_CANDIDATES.find((p) => existsSync(p));
  if (!file) return undefined;
  try {
    const builder = createRequire(import.meta.url)(file) as SkillIndexBuilder;
    const opts = { bundledDir: bundledSkillsDir() };
    return existsSync(join(root, '.claude'))
      ? builder.ensure(root, opts)
      : builder.build(root, opts);
  } catch {
    return undefined;
  }
}

type MaybeCatalog = { origin?: string; catalogId?: string };

/** Catalog skills leave the machine only with the `jev` target; legacy skills
 *  are unchanged. Without a root no catalog skill is sent. */
export function jevVisible<T>(root: string | undefined, items: readonly T[]): T[] {
  // `T` is deliberately unconstrained: rankOrgSkills's own `T extends {name,
  // description, tags}` has neither field, and constraining here fails to compile.
  const cat = (s: T): MaybeCatalog => s as MaybeCatalog;
  if (!items.some((s) => cat(s).origin === 'catalog')) return [...items];
  // Re-verify at the egress boundary: the snapshot cache is keyed on state.json,
  // so a package tampered after a warm cache must not leave the machine.
  const allowed = new Set(
    root
      ? eligible(buildSnapshot(root), 'jev')
          .filter((a) => verifyEntry(root, a).ok)
          .map((a) => a.id)
      : [],
  );
  return items.filter((s) => cat(s).origin !== 'catalog' || allowed.has(cat(s).catalogId ?? ''));
}

/** Org-library skills (project, user, bundled, and catalog skills approved for
 *  `jev`), optionally limited to `names`. */
export function orgSkillCatalog(root: string, names?: string[]): CatalogItem[] {
  const allow = names ? new Set(names) : null;
  return jevVisible(root, listSkills(root))
    .filter((s) => !allow || allow.has(s.name))
    .map((s) => ({ id: s.name, description: s.description, text: s.tags.join(' ') }));
}

/** Every skill a task can use, as one index: platform skills first (they are
 *  directly invokable), then Org-library skills that are not a platform skill
 *  or an agent by another name. Org skills are read with `monomind org skills
 *  show <name>`. The same loader the prompt hook uses, over the same index. */
export function taskSkillCatalog(root: string): CatalogItem[] {
  const project = projectOf(root);
  ensureRegistry(project);
  const index = skillIndex(project);
  return jevModule()?.loadSkillCatalog(project, index ? { index } : undefined) ?? [];
}

export function roleCatalog(
  roles: Pick<OrgRole, 'id' | 'title' | 'responsibilities'>[],
): CatalogItem[] {
  return roles.map((r) => ({
    id: r.id,
    name: r.title,
    description: [r.title, ...(r.responsibilities ?? [])].filter(Boolean).join('; '),
  }));
}
