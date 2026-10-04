// packages/@monomind/cli/src/orgrt/effective-role-policy.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.4): the one place a role's effective policy is decided. Both the
 * policy engine (role-incarnation.ts) and the sandbox layer (session-run.ts) read the role's policy through
 * here, so the file tools, the OS sandbox's deny lists and its mount-point stubs all see the same overlay.
 *
 * `effectiveRolePolicy` returns `role.policy` itself (the same object) unless the org is on the sections
 * surface and exactly one section declares non-empty `writes`; sections-off orgs and surface-on orgs without
 * `writes` therefore get today's policy untouched. Otherwise it is the core's overlay (`overlayFor`) applied to
 * the role's own policy, with the relative workspace entry the core adds made canonical: the real path of the
 * role's workdir, which is what the sandbox compares and denies. It is a pure function of (definition, role,
 * workdir): applying it again gives the same result, and a resume rebuilds the same overlay.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { sectionsSurface } from './documents/surface.js';
import { norm, workspaceInfo } from './documents/writer-paths.js';
import { applyWriterOverlay, overlayFor, type WriterOverlay } from './documents/writer-policy.js';
import { writerView } from './documents/writer-view.js';
import type { OrgDef, OrgRole } from './types.js';

export interface PolicyContext {
  /** The project root the org runs from (relative sandbox entries resolve against it). */
  orgRoot?: string;
  /** The role's working directory: the shared workspace, or its own worktree. */
  workdir?: string;
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The overlay of one role, or undefined when none applies (see the header). The workspace entry is canonical. */
export function roleOverlay(
  def: OrgDef | undefined,
  roleId: string,
  ctx: PolicyContext = {},
): WriterOverlay | undefined {
  if (!def || !sectionsSurface(def).enabled) return undefined;
  const view = writerView(def);
  const ov = overlayFor(view, roleId, { orgRoot: ctx.orgRoot });
  if (!ov?.sandbox || ctx.workdir === undefined) return ov;
  const entry = norm(workspaceInfo(view, roleId).entry);
  const canon = real(ctx.workdir);
  const denyWrite = [...new Set(ov.sandbox.denyWrite.map((d) => (norm(d) === entry ? canon : d)))];
  return { ...ov, sandbox: { ...ov.sandbox, denyWrite } };
}

export function effectiveRolePolicy(
  def: OrgDef | undefined,
  role: OrgRole,
  ctx: PolicyContext = {},
): OrgRole['policy'] {
  const ov = roleOverlay(def, role.id, ctx);
  return ov ? (applyWriterOverlay(role.policy, ov) as OrgRole['policy']) : role.policy;
}

/** The role with its effective policy; the same object when the policy is unchanged. */
export function effectiveRole(
  def: OrgDef | undefined,
  role: OrgRole,
  ctx: PolicyContext = {},
): OrgRole {
  const policy = effectiveRolePolicy(def, role, ctx);
  return policy === role.policy ? role : { ...role, policy };
}
