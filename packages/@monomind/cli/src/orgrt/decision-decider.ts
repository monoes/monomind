// packages/@monomind/cli/src/orgrt/decision-decider.ts
/**
 * #835 PR 7: a decision role as an approval decider. `autonomy.decider` may be
 * `{ kind: 'role', role: '<id>' }`; approvals and gates the autonomy routes to a decider are put
 * to that role's provider as one question. Only a confident, usable answer resolves a request
 * (`decision:<role>`): `approve` / `deny` for a choice role (the criteria must offer `approve`),
 * a score at or above the threshold for a noul/score role (approve only). Everything else - below
 * threshold, no probability, provider failure, an option off the menu - returns `null`, and the
 * request stays with a person. Nothing here ever approves on failure.
 */
import {
  askRole,
  type DecisionDeps,
  findDecisionRole,
  isDecisionRole,
  QUESTION_ID,
} from './decision-roles.js';
import type { OrgRole } from './types.js';

export const ROLE_DECIDER_KIND = 'role';

export type RoleLike = Pick<OrgRole, 'id' | 'kind' | 'decision'>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why `decider` (a `kind: 'role'` block) cannot be used, or undefined when it can. */
function roleDeciderProblem(
  decider: Record<string, unknown>,
  roles: readonly RoleLike[] | undefined,
): string | undefined {
  const id = decider.role;
  if (typeof id !== 'string' || !id) return 'decider kind "role" needs a role id';
  const target = findDecisionRole({ roles: (roles ?? []) as OrgRole[] }, id);
  if (!roles?.some((r) => r.id === id)) return `decider role "${id}" matches no role id`;
  if (!target) return `decider role "${id}" is not a decision role`;
  const d = target.decision;
  const fb = d && roles.find((r) => r.id === d.fallback_role);
  if (!d || !fb || isDecisionRole(fb))
    return `decider role "${id}" needs a fallback_role that is a non-decision role`;
  if (d.question === 'choice' && !Object.hasOwn(d.criteria, 'approve'))
    return `decider role "${id}" must offer an "approve" option in decision.criteria`;
  return undefined;
}

/** The decision role a `role` decider names, or undefined (not a role decider, or invalid). */
export function roleDeciderTarget(
  decider: unknown,
  roles: readonly RoleLike[] | undefined,
): OrgRole | undefined {
  if (!isObject(decider) || decider.kind !== ROLE_DECIDER_KIND) return undefined;
  if (roleDeciderProblem(decider, roles)) return undefined;
  return findDecisionRole({ roles: roles as OrgRole[] }, decider.role as string);
}

/** `org validate` errors for an `autonomy.decider` of kind `role`. */
export function deciderRoleErrors(def: {
  roles: readonly RoleLike[];
  autonomy?: unknown;
}): string[] {
  const autonomy = def.autonomy;
  const decider = isObject(autonomy) ? autonomy.decider : undefined;
  if (!isObject(decider) || decider.kind !== ROLE_DECIDER_KIND) return [];
  const problem = roleDeciderProblem(decider, def.roles);
  return problem ? [`autonomy: ${problem}`] : [];
}

export type DeciderVerdict = { approved: boolean } | { approved: null; why: string };

/** Put one approval request to the decision role. Never throws. */
export async function consultDecisionRole(
  role: OrgRole,
  request: string,
  deps: Pick<DecisionDeps, 'ask' | 'resolveProvider'> = {},
): Promise<DeciderVerdict> {
  const d = role.decision!;
  const asked = await askRole(role, request, deps);
  if ('why' in asked) return { approved: null, why: asked.why };
  const a = asked.result?.answers?.[QUESTION_ID];
  if (!a || a.type !== d.question) return { approved: null, why: 'no usable answer' };
  if ((a.probSource ?? 'none') === 'none')
    return { approved: null, why: 'answer carries no probability' };
  if (d.question === 'choice') {
    const { choice, confidence } = a;
    if (typeof choice !== 'string' || !Object.hasOwn(d.criteria, choice))
      return { approved: null, why: 'answer is not one of the options' };
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < d.threshold)
      return { approved: null, why: `confidence below threshold ${d.threshold}` };
    if (choice === 'approve') return { approved: true };
    if (choice === 'deny') return { approved: false };
    return { approved: null, why: `answer "${choice}" is neither approve nor deny` };
  }
  const v = a.noul;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1 || v < d.threshold)
    return { approved: null, why: `score below threshold ${d.threshold}` };
  return { approved: true };
}
