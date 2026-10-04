// packages/@monomind/cli/src/orgrt/documents/lead-rules.ts
/**
 * Org sections piece P4.9 (plan 13.2, A63 to A69): what a section lead is owed and what a role may not do across
 * sections. Pure, and every rule is off for an org that is not on the sections surface.
 *
 *  - `taskAssignmentRefusal`: the `org_task` / `org_plan_graph` assignee bound. The same rule as the `org_send`
 *    one in routing.ts: refused when creator and assignee are both in a section, the sections differ and the
 *    creator is not the root. Same-section assignment (member to member, lead to member) is not bound (item 30).
 *  - `leadFor`: who a notice about a role is addressed to: the role's section lead when it is not the role itself,
 *    else the role's `reports_to`, else the root. A sections-off org never asks (callers keep `reports_to`).
 *  - `leadRulesFindings`: the capacity preflight (an error) and the `reports_to` advice (a warning).
 */
import type { OrgDef } from '../types.js';
import type { Findings } from './definition-util.js';
import { isObject } from './definition-util.js';
import { rootRoleId, sectionOf } from './routing.js';
import { sectionsSurface } from './surface.js';

/** The `max_concurrent_agents` an org gets when it sets none (types.ts). */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;

interface DefLike {
  sections?: unknown;
  roles: { id: string; type?: string; reports_to?: string | null }[];
}

/** The lead of a section: its declared lead, else its first member (a one-member section leads itself). */
export function sectionLead(def: Pick<DefLike, 'sections'>, section: string): string | undefined {
  const s = isObject(def.sections) ? def.sections[section] : undefined;
  if (!isObject(s)) return undefined;
  if (typeof s.lead === 'string') return s.lead;
  return Array.isArray(s.members) && typeof s.members[0] === 'string' ? s.members[0] : undefined;
}

/** Why `creator` may not give a task to `assignee`, or undefined when it may. */
export function taskAssignmentRefusal(
  def: DefLike,
  creator: string,
  assignee: string,
): string | undefined {
  if (!sectionsSurface(def).enabled) return undefined;
  const root = rootRoleId(def);
  if (creator === root || assignee === root) return undefined;
  const a = sectionOf(def, creator);
  const b = sectionOf(def, assignee);
  if (!a || !b || a === b) return undefined;
  return `REFUSED: ${creator} (section ${a}) cannot assign a task to ${assignee} (section ${b}). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can assign to any section.`;
}

/** The role to tell about `role`: its section lead, else its `reports_to`, else the root (`boss`). */
export function leadFor(def: DefLike, role: string, boss: string): string {
  const section = sectionsSurface(def).enabled ? sectionOf(def, role) : undefined;
  const lead = section ? sectionLead(def, section) : undefined;
  if (lead && lead !== role) return lead;
  return def.roles.find((r) => r.id === role)?.reports_to ?? boss;
}

/** Errors and warnings of the lead rules for a definition on the sections surface. */
export function leadRulesFindings(def: OrgDef, f: Findings): void {
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const cap =
    typeof rc.max_concurrent_agents === 'number'
      ? rc.max_concurrent_agents
      : DEFAULT_MAX_CONCURRENT_AGENTS;
  const agents = def.roles.filter((r) => r.kind !== 'endpoint').length;
  if (cap < agents)
    f.errors.push(
      `run_config.max_concurrent_agents: ${cap} is below the ${agents} agent roles of this sections org (it defaults to ${DEFAULT_MAX_CONCURRENT_AGENTS}) — an idle role keeps its slot, so a role past the cap never starts and a section can stall; raise it to at least ${agents}, or remove roles`,
    );
  const sections = (def as unknown as { sections?: unknown }).sections;
  if (!isObject(sections)) return;
  for (const [name, s] of Object.entries(sections)) {
    const lead = sectionLead(def, name);
    if (!isObject(s) || !lead || !Array.isArray(s.members)) continue;
    for (const m of s.members) {
      const r = def.roles.find((x) => x.id === m);
      if (r && m !== lead && (r.reports_to ?? null) !== lead)
        f.warnings.push(
          `roles.${m}.reports_to: "${m}" is in section "${name}" but reports to ${r.reports_to ? `"${r.reports_to}"` : 'no one'}, not its section lead "${lead}" — the org chart and the section disagree; set reports_to: "${lead}"`,
        );
    }
  }
}
