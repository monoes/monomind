/**
 * S3: placeholders in role `responsibilities` — and in the policy fields that
 * hold paths (`policy.fileRead`, `policy.fileWrite`, `policy.sandbox.allowWrite`,
 * `policy.sandbox.denyWrite`) — so org configs committed to a repo don't have
 * to embed the owner's absolute paths.
 *
 *   {{org_root}}  the org's project root (the daemon root, opts.orgRoot) —
 *                 NOT the role's cwd, which may be a worktree or scratch dir
 *   {{home}}      the home directory of the user running the org
 *
 * Responsibilities expand when the role prompt is built; policy paths expand
 * when the daemon loads the org, so the file-tool roots and the OS sandbox
 * only ever see absolute paths. Only `{{name}}` with a
 * lowercase snake_case name is a placeholder. An unknown one is left in the
 * text verbatim (never dropped, so a typo stays visible) and `org validate`
 * reports it as an error. A role with no placeholders is returned unchanged,
 * so its prompt stays byte-identical (the system prompt is a cache prefix).
 */
import { homedir } from 'node:os';
import type { OrgDef, OrgRole } from './types.js';

export const PROMPT_VAR_NAMES = ['org_root', 'home'] as const;
export type PromptVarName = (typeof PROMPT_VAR_NAMES)[number];
export type PromptVars = Record<PromptVarName, string>;

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;
const HAS_PLACEHOLDER = /\{\{[a-z_]+\}\}/;
const KNOWN = new Set<string>(PROMPT_VAR_NAMES);

export function promptVarsFor(orgRoot: string, home: string = homedir()): PromptVars {
  return { org_root: orgRoot, home };
}

export function expandPromptVars(text: string, vars: PromptVars): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    KNOWN.has(name) ? vars[name as PromptVarName] : whole,
  );
}

/** The role with its responsibilities expanded; the same object if none changed. */
export function expandRolePromptVars(role: OrgRole, vars: PromptVars): OrgRole {
  const duties = role.responsibilities;
  if (!duties?.length) return role;
  const expanded = duties.map((d) => expandPromptVars(d, vars));
  return expanded.every((d, i) => d === duties[i]) ? role : { ...role, responsibilities: expanded };
}

/** The role's path-holding policy lists, by the name `org validate` reports. */
function policyPathFields(role: OrgRole): Record<string, string[] | undefined> {
  return {
    'policy.fileRead': role.policy?.fileRead,
    'policy.fileWrite': role.policy?.fileWrite,
    'policy.sandbox.allowWrite': role.policy?.sandbox?.allowWrite,
    'policy.sandbox.denyWrite': role.policy?.sandbox?.denyWrite,
  };
}

/** The role with {{org_root}} / {{home}} expanded in its policy path lists
 *  (policy.fileRead/fileWrite, policy.sandbox.allowWrite/denyWrite); the same
 *  object if none changed. Unknown placeholders stay verbatim, as above. */
export function expandRolePolicyPathVars(role: OrgRole, vars: PromptVars): OrgRole {
  const fields = Object.values(policyPathFields(role));
  if (!fields.some((xs) => xs?.some((x) => HAS_PLACEHOLDER.test(x)))) return role;
  const ex = <K extends string>(key: K, xs: string[] | undefined) =>
    xs ? { [key]: xs.map((x) => expandPromptVars(x, vars)) } : {};
  const policy = role.policy as NonNullable<OrgRole['policy']>;
  const sandbox = policy.sandbox;
  return {
    ...role,
    policy: {
      ...policy,
      ...ex('fileRead', policy.fileRead),
      ...ex('fileWrite', policy.fileWrite),
      ...(sandbox && {
        sandbox: {
          ...sandbox,
          ...ex('allowWrite', sandbox.allowWrite),
          ...ex('denyWrite', sandbox.denyWrite),
        },
      }),
    },
  };
}

/** The org with every role's policy path lists expanded; the same object if
 *  no role changed. */
export function expandOrgPolicyPathVars<D extends Pick<OrgDef, 'roles'>>(
  def: D,
  vars: PromptVars,
): D {
  const roles = def.roles.map((r) => expandRolePolicyPathVars(r, vars));
  return roles.every((r, i) => r === def.roles[i]) ? def : { ...def, roles };
}

/** `org validate` errors: one per unknown placeholder per role and field. */
export function unknownPromptVarErrors(def: Pick<OrgDef, 'roles'>): string[] {
  const known = PROMPT_VAR_NAMES.map((n) => `{{${n}}}`).join(', ');
  const errors: string[] = [];
  for (const role of def.roles ?? []) {
    const fields = { responsibilities: role.responsibilities, ...policyPathFields(role) };
    for (const [field, texts] of Object.entries(fields)) {
      const unknown = new Set<string>();
      for (const d of texts ?? []) {
        for (const m of d.matchAll(PLACEHOLDER)) if (!KNOWN.has(m[1])) unknown.add(m[0]);
      }
      for (const u of unknown)
        errors.push(`role "${role.id}": unknown placeholder ${u} in ${field} (known: ${known})`);
    }
  }
  return errors;
}
