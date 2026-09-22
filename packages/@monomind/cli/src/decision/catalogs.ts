/**
 * Candidate catalogs for the Jev picker. Registry agents and skills come from
 * the shared helper so the hook and the CLI read them identically.
 */
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

/** Org-library skills (project, user, bundled), optionally limited to `names`. */
export function orgSkillCatalog(root: string, names?: string[]): CatalogItem[] {
  const allow = names ? new Set(names) : null;
  return listSkills(root)
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
