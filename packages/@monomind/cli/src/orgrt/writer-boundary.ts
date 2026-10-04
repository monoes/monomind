// packages/@monomind/cli/src/orgrt/writer-boundary.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.4): the reduced probe at role start. A read-only role of a
 * single-writer org runs its shell behind the OS sandbox with the workspace denied (the overlay). The sandbox
 * layer, though, can fall back to protecting only the workspace's existing children (sandbox-deny-write.ts),
 * which leaves new entries writable. This inspects what the layer actually produced for such a role and, when
 * no deny covers the real workspace, holds the role's start: it emits the audit event
 * `writer-boundary-unqualified` and throws a non-retryable error whose text names the cause. Access is never
 * widened to get past it. A role with no overlay, a full-access role, or a non-Claude runner (no OS sandbox
 * is built for those; the preflight counts such a role as a writer) is not checked here.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrgBus } from './bus.js';
import { boundaryQualification } from './documents/writer-policy.js';
import { roleOverlay } from './effective-role-policy.js';
import type { OrgDef, OrgRole } from './types.js';

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const inside = (container: string, p: string): boolean =>
  p !== container && p.startsWith(container.endsWith('/') ? container : `${container}/`);

/** Throws when the read-only role's sandbox boundary is not qualified; returns normally otherwise. */
export function assertWriterBoundary(args: {
  def: OrgDef | undefined;
  role: OrgRole;
  cwd: string;
  orgRoot?: string;
  bus: OrgBus;
  /** `claudeRestrictions` of the role's git enforcement, or undefined when none was built. */
  restrictions: { sandbox?: Record<string, unknown> } | undefined;
  claudeRuntime: boolean;
}): void {
  const { def, role, cwd, bus, restrictions } = args;
  if (!args.claudeRuntime) return;
  if (!roleOverlay(def, role.id, { orgRoot: args.orgRoot, workdir: cwd })?.sandbox) return;
  const workspace = real(cwd);
  const fs = restrictions?.sandbox?.filesystem as { denyWrite?: string[] } | undefined;
  const denyWrite = (fs?.denyWrite ?? []).map(real);
  // Denies inside the workspace (its .git, say) are normal. Only when none covers the workspace itself
  // and some lie inside it did the layer expand the workspace into its children.
  const covered = denyWrite.some((d) => d === workspace || inside(d, workspace));
  const expanded = !covered && denyWrite.some((d) => inside(workspace, d)) ? [workspace] : [];
  const verdict = boundaryQualification(role.id, workspace, { denyWrite, mountPoints: expanded });
  if (verdict.ok) return;
  bus.emit({
    type: 'audit',
    from: role.id,
    reason: 'writer-boundary-unqualified',
    msg: verdict.finding.message,
    data: { workspace, denyWrite },
  });
  throw Object.assign(new Error(verdict.finding.message), { fatal: true });
}
