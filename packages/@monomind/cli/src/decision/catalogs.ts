/**
 * Candidate catalogs for the Jev picker. Registry agents and skills come from
 * the shared helper (.claude/helpers/jev-catalog.cjs) so the hook and the CLI
 * read them identically; both indexes are refreshed first when stale.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AgentRegistry,
  buildUnifiedRegistry,
  computeAgentRoots,
} from '../agents/registry-builder.js';
import { ensureRegistry, findProjectRoot, registryPath } from '../agents/registry-freshness.js';
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

/**
 * Where `cwd`'s agents come from. Inside a project (walking up, never $HOME)
 * the project's .monomind/registry.json, refreshed first when stale. Outside
 * one the registry is built in memory and nothing is written, so a run from
 * $HOME or a plain folder never creates a `.monomind` there.
 */
function agentSource(cwd: string): { root: string; registry?: AgentRegistry } {
  const project = findProjectRoot(cwd);
  if (project) {
    ensureRegistry(project);
    return { root: project };
  }
  return {
    root: cwd,
    registry: buildUnifiedRegistry(computeAgentRoots(cwd), undefined, { base: cwd }),
  };
}

/** Registry agents (see agentSource). */
export function agentCatalog(root: string): CatalogItem[] {
  const src = agentSource(root);
  return (
    jevModule()?.loadAgentCatalog(
      src.root,
      src.registry ? { registry: src.registry } : undefined,
    ) ?? []
  );
}

/** Every spawnable agent name (frontmatter `name`, the Task subagent_type) in
 *  the registry. Deprecated agents are included: picks hide them, but a Task
 *  call naming one still works. */
export function agentNames(root: string): Set<string> {
  const src = agentSource(root);
  try {
    const reg = (src.registry ?? JSON.parse(readFileSync(registryPath(src.root), 'utf8'))) as {
      agents?: { name?: unknown; slug?: unknown }[];
    };
    return new Set(
      (reg.agents ?? [])
        .map((a) => a.name ?? a.slug)
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    );
  } catch {
    return new Set();
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/decision → ../.. is the package root; dist/src/decision → ../../.. */
const BUILDER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
];

interface SkillIndexBuilder {
  build(root: string, opts?: { bundledDir?: string; user?: boolean }): unknown;
  ensure(root: string, opts?: { bundledDir?: string }): unknown;
  isStale(root: string, opts?: { bundledDir?: string }): boolean;
}

function skillIndexBuilder(): SkillIndexBuilder | undefined {
  const file = BUILDER_CANDIDATES.find((p) => existsSync(p));
  return file ? (createRequire(import.meta.url)(file) as SkillIndexBuilder) : undefined;
}

/** True when .claude/helpers/skill-registry.json is missing or older than a
 *  source; undefined when the builder is unavailable. */
export function skillIndexIsStale(root: string): boolean | undefined {
  try {
    return skillIndexBuilder()?.isStale(root, { bundledDir: bundledSkillsDir() });
  } catch {
    return undefined;
  }
}

/**
 * The skill index for `root` (platform skills + Org library), with the
 * bundled builder. Inside a project (findProjectRoot) with a `.claude` dir,
 * the project's .claude/helpers/skill-registry.json is refreshed when a source
 * is newer (the hook reads that file); anywhere else — $HOME included — the
 * index is built in memory only. `user: false` leaves ~/.claude/skills out and
 * always indexes in memory.
 */
export function skillIndex(root: string, opts: { user?: boolean } = {}): unknown {
  try {
    const builder = skillIndexBuilder();
    if (!builder) return undefined;
    const bundledDir = bundledSkillsDir();
    if (opts.user === false) return builder.build(root, { bundledDir, user: false });
    const project = findProjectRoot(root);
    return project && existsSync(join(project, '.claude'))
      ? builder.ensure(project, { bundledDir })
      : builder.build(project ?? root, { bundledDir });
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
 *  or an agent by another name. Org skills are read with the org_skill_show
 *  MCP tool. The same loader the prompt hook uses, over the same index. */
export function taskSkillCatalog(root: string): CatalogItem[] {
  const src = agentSource(root);
  const index = skillIndex(src.root);
  return (
    jevModule()?.loadSkillCatalog(src.root, {
      ...(index ? { index } : {}),
      ...(src.registry ? { registry: src.registry } : {}),
    }) ?? []
  );
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
