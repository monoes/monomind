/**
 * S3: placeholders in role `responsibilities`, so org configs committed to a
 * repo don't have to embed the owner's absolute paths.
 *
 *   {{org_root}}  the org's project root (the daemon root, opts.orgRoot) —
 *                 NOT the role's cwd, which may be a worktree or scratch dir
 *   {{home}}      the home directory of the user running the org
 *
 * Expansion happens when the role prompt is built. Only `{{name}}` with a
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

/** `org validate` errors: one per unknown placeholder per role. */
export function unknownPromptVarErrors(def: Pick<OrgDef, 'roles'>): string[] {
  const known = PROMPT_VAR_NAMES.map((n) => `{{${n}}}`).join(', ');
  const errors: string[] = [];
  for (const role of def.roles ?? []) {
    const unknown = new Set<string>();
    for (const d of role.responsibilities ?? []) {
      for (const m of d.matchAll(PLACEHOLDER)) if (!KNOWN.has(m[1])) unknown.add(m[0]);
    }
    for (const u of unknown)
      errors.push(
        `role "${role.id}": unknown placeholder ${u} in responsibilities (known: ${known})`,
      );
  }
  return errors;
}
