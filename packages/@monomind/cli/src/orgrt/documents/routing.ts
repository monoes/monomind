// packages/@monomind/cli/src/orgrt/documents/routing.ts
/**
 * Org sections spec 6.6 and 13.1.5 (piece P3.7): the cross-section `org_send`
 * refusal. ONE pure function, `crossSectionRefusal`, asked by the shared
 * deliver path (cross-org-deliver.ts). It returns the refusal text, or
 * undefined when the send may go ahead; it is undefined for every org that is
 * not on the sections surface, so those orgs behave exactly as before.
 *
 * Rules (a send is refused only when ALL hold):
 *  - the org is on the sections surface (`sectionsSurface(def).enabled`);
 *  - the send is local (the caller does not ask about cross-org targets);
 *  - sender and target are both in a section (as lead or member);
 *  - those sections differ.
 * Never refused: the root (the boss, or the role that reports to no one) as
 * sender or target, the human and the runtime sender `org-docs` as senders, a
 * role in no section as sender or target (the map binds only sectioned roles;
 * the pilot measured the same), and any send within one section.
 */
import { sectionsSurface } from './surface.js';

/** Senders that are not roles of the org and are never bound by the map. */
export const RUNTIME_SENDERS: readonly string[] = ['human', 'org-docs'];

interface DefLike {
  sections?: unknown;
  roles: { id: string; type?: string; reports_to?: string | null }[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The section a role belongs to (as lead or member), or undefined. */
export function sectionOf(def: Pick<DefLike, 'sections'>, role: string): string | undefined {
  const sections = def.sections;
  if (!isObject(sections)) return undefined;
  for (const [name, s] of Object.entries(sections)) {
    if (!isObject(s)) continue;
    if (s.lead === role) return name;
    if (Array.isArray(s.members) && s.members.includes(role)) return name;
  }
  return undefined;
}

/** The root role: the boss, else the role that reports to no one (the root is in no section and reads everything). */
export const rootRoleId = (def: Pick<DefLike, 'roles'>): string | undefined =>
  (
    def.roles.find((r) => r.type === 'boss') ??
    def.roles.find((r) => r.reports_to === null || r.reports_to === undefined)
  )?.id;

const isRoot = (def: DefLike, id: string): boolean => rootRoleId(def) === id;

/** The refusal text, as the org_send tool result. */
export function crossSectionRefusalText(
  from: string,
  fromSection: string,
  to: string,
  toSection: string,
): string {
  return `REFUSED: ${from} (section ${fromSection}) cannot message ${to} (section ${toSection}). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can reach any section.`;
}

/** Why a message must not go from `from` to `to`, or undefined when it may. */
export function crossSectionRefusal(def: DefLike, from: string, to: string): string | undefined {
  if (!sectionsSurface(def).enabled) return undefined;
  if (RUNTIME_SENDERS.includes(from) && !def.roles.some((r) => r.id === from)) return undefined;
  if (isRoot(def, from) || isRoot(def, to)) return undefined;
  const a = sectionOf(def, from);
  const b = sectionOf(def, to);
  if (!a || !b || a === b) return undefined;
  return crossSectionRefusalText(from, a, to, b);
}
