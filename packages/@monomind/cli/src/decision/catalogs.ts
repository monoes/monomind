/**
 * Candidate catalogs for the Jev picker. Registry agents and skills come from
 * the shared helper so the hook and the CLI read them identically.
 */
import { verifyEntry } from '../catalog/digest.js';
import { buildSnapshot, eligible } from '../catalog/snapshot.js';
import { listSkills } from '../orgrt/skill-library.js';
import type { OrgRole } from '../orgrt/types.js';
import { type CatalogItem, jevModule } from './jev.js';

export interface RouteLike {
  name: string;
  agentSlug: string;
  description?: string;
  utterances?: string[];
}

export function agentCatalog(root: string): CatalogItem[] {
  return jevModule()?.loadAgentCatalog(root) ?? [];
}

export function skillCatalog(root: string): CatalogItem[] {
  return jevModule()?.loadSkillCatalog(root) ?? [];
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

export function roleCatalog(
  roles: Pick<OrgRole, 'id' | 'title' | 'responsibilities'>[],
): CatalogItem[] {
  return roles.map((r) => ({
    id: r.id,
    name: r.title,
    description: [r.title, ...(r.responsibilities ?? [])].filter(Boolean).join('; '),
  }));
}

/** @monoes/routing routes, one entry per agent slug. */
export function routeCatalog(routes: RouteLike[]): CatalogItem[] {
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const r of routes) {
    if (seen.has(r.agentSlug)) continue;
    seen.add(r.agentSlug);
    out.push({
      id: r.agentSlug,
      name: r.name,
      description: r.description ?? r.name,
      text: (r.utterances ?? []).join(' '),
    });
  }
  return out;
}
