// packages/@monomind/cli/src/orgrt/documents/writer-policy.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.2): the single-writer rules as pure functions. Nothing outside
 * the writer files imports this yet, so nothing in the runtime changes; P4.4 wires it (definition findings,
 * `effectiveRolePolicy`, the boundary check at role start). The overlay (who is read-only and how) is in
 * `writer-overlay.ts` and re-exported here.
 *
 * `writerAuthority` classifies what a role can still do to the workspace after its overlay; `writerPreflight`
 * counts those roles (a role of the writing section with file-write authority or an open Bash, any role with a
 * tool provider or an unclassified tool, any role on a runner this core cannot qualify) and refuses more than
 * one. What it guarantees and does not is 13.2.2: file tools and a qualified shell for non-writers; the writer's
 * own Bash is unconfined.
 */

import type { RolePolicy } from '../types.js';
import {
  applyWriterOverlay,
  overlayFor,
  plan,
  standingOf,
  type WriterDef,
  type WriterOptions,
  type WriterRole,
  type WriterStanding,
  writingSections,
} from './writer-overlay.js';
import {
  allowReachesWorkspace,
  denyCoversWorkspace,
  norm,
  pathInScope,
  type WorkspaceInfo,
  workspaceInfo,
} from './writer-paths.js';
import {
  boundaryUnqualifiedText,
  type MutationReason,
  multipleWritersText,
  noWriterText,
  refusalText,
  secondWriterSectionText,
  type WriterFinding,
  worktreePerRoleText,
} from './writer-text.js';

export type {
  WriterDef,
  WriterOptions,
  WriterOverlay,
  WriterRole,
  WriterStanding,
} from './writer-overlay.js';
export { applyWriterOverlay, overlayFor, standingOf } from './writer-overlay.js';
export type { MutationReason, WriterCode, WriterFinding } from './writer-text.js';

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
/** Tools with no effect on the workspace; `mcp__org__*` (daemon-mediated documents, notes, mail) is read-only too. */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'TodoWrite',
]);
const ORG_TOOL_NS = 'mcp__org__';

export interface WriterAuthority {
  role: string;
  standing: WriterStanding;
  section?: string;
  workspace: string;
  /** Can the role change the shared workspace, after the overlay. */
  mutates: boolean;
  reasons: MutationReason[];
  /** Workspace-relative globs or directories the role may write through file tools; empty when it may not. */
  scope: string[];
}

function mutationReasons(
  role: WriterRole,
  def: WriterDef,
  pol: Partial<RolePolicy>,
  ws: WorkspaceInfo,
  opts: WriterOptions,
): MutationReason[] {
  const reasons: MutationReason[] = [];
  const deny = pol.denyTools ?? [];
  const allowed = (t: string) =>
    !deny.includes(t) && (pol.allowTools === undefined || pol.allowTools.includes(t));
  const fw = pol.fileWrite ?? ['**'];
  const tools = FILE_TOOLS.filter(allowed);
  if (tools.length > 0 && fw.length > 0) reasons.push({ kind: 'file-tools', tools, scope: fw });
  const runtime = role.runtime ?? def.runtime ?? opts.defaultRuntime ?? 'claude';
  if (runtime !== 'claude') reasons.push({ kind: 'runner', runtime });
  else if (allowed('Bash')) {
    const sb = pol.sandbox ?? {};
    const causes: string[] = [];
    if (sb.mode !== 'required')
      causes.push(`sandbox.mode is ${JSON.stringify(sb.mode ?? 'auto')}, not "required"`);
    if (!(sb.denyWrite ?? []).some((d) => denyCoversWorkspace(d, ws, opts.orgRoot)))
      causes.push('sandbox.denyWrite does not name the workspace');
    if ((sb.allowWrite ?? []).some((a) => allowReachesWorkspace(a, ws, opts.orgRoot)))
      causes.push('sandbox.allowWrite reaches the workspace');
    if (pol.git === 'push') causes.push('git "push" runs without the sandbox');
    if (causes.length > 0) reasons.push({ kind: 'shell', causes });
  }
  const providers = (role.tool_providers ?? [])
    .filter((p) => p.allow === undefined || p.allow.length > 0)
    .map((p) => p.name);
  if (providers.length > 0) reasons.push({ kind: 'provider', providers });
  if (pol.allowTools) {
    const other = pol.allowTools.filter(
      (t) =>
        !FILE_TOOLS.includes(t) &&
        t !== 'Bash' &&
        !READ_ONLY_TOOLS.has(t) &&
        !t.startsWith(ORG_TOOL_NS),
    );
    if (other.length > 0) reasons.push({ kind: 'unclassified-tool', tools: other });
  }
  return reasons;
}

/** What a role can do to the shared workspace, after the overlay (or as authored when none applies). */
export function writerAuthority(
  def: WriterDef,
  roleId: string,
  opts: WriterOptions = {},
): WriterAuthority {
  const role = def.roles.find((r) => r.id === roleId);
  const { standing, section } = standingOf(def, roleId);
  const ws = workspaceInfo(def, roleId);
  if (!role || standing === 'endpoint')
    return {
      role: roleId,
      standing,
      section,
      workspace: ws.key,
      mutates: false,
      reasons: [],
      scope: [],
    };
  const pol = applyWriterOverlay(role.policy, overlayFor(def, roleId, opts)) ?? {};
  const reasons = mutationReasons(role, def, pol, ws, opts);
  const file = reasons.find((r) => r.kind === 'file-tools');
  return {
    role: roleId,
    standing,
    section,
    workspace: ws.key,
    mutates: reasons.length > 0,
    reasons,
    scope: file && file.kind === 'file-tools' ? [...file.scope] : [],
  };
}

export interface WriterPreflight {
  errors: string[];
  warnings: string[];
  findings: WriterFinding[];
  /** Roles that can change each workspace, by workspace key. */
  writers: Record<string, string[]>;
  authorities: WriterAuthority[];
}

/** The writer preflight (6.12). Empty when no section declares non-empty `writes`. */
export function writerPreflight(def: WriterDef, opts: WriterOptions = {}): WriterPreflight {
  const out: WriterPreflight = {
    errors: [],
    warnings: [],
    findings: [],
    writers: {},
    authorities: [],
  };
  const writing = writingSections(def);
  if (writing.length === 0) return out;
  const add = (f: WriterFinding) => out.findings.push(f);
  const allRoles = def.roles.map((r) => r.id);
  if (writing.length > 1)
    add({
      code: 'writes-second-section',
      severity: 'error',
      path: 'sections',
      message: secondWriterSectionText(writing.map((s) => s.name)),
      roles: [],
    });
  if (workspaceInfo(def).mode === 'worktree-per-role')
    add({
      code: 'writer-worktree-per-role',
      severity: 'error',
      path: 'run_config.workspace',
      message: worktreePerRoleText(),
      roles: [],
    });
  if (writing.length === 1) {
    for (const id of allRoles) out.findings.push(...plan(def, id, opts).notes);
    out.authorities = allRoles.map((id) => writerAuthority(def, id, opts));
    for (const a of out.authorities) if (a.mutates) (out.writers[a.workspace] ??= []).push(a.role);
    for (const [key, ids] of Object.entries(out.writers))
      if (ids.length > 1)
        add({
          code: 'writer-multiple',
          severity: 'error',
          path: 'roles',
          message: multipleWritersText(
            key,
            ids.map((role) => ({
              role,
              reasons: out.authorities.find((a) => a.role === role)?.reasons ?? [],
            })),
          ),
          roles: ids,
        });
    if (Object.keys(out.writers).length === 0)
      add({
        code: 'writer-none',
        severity: 'warning',
        path: `sections.${writing[0].name}.writes`,
        message: noWriterText(writing[0].name),
        roles: [],
      });
  }
  for (const f of out.findings)
    (f.severity === 'error' ? out.errors : out.warnings).push(f.message);
  return out;
}

export interface BuiltBoundary {
  /** `filesystem.denyWrite` the sandbox layer produced, canonical absolute paths. */
  denyWrite: string[];
  /** Directories the layer expanded into their children (`expandDenyWrite().mountPoints`): new entries in them stay writable. */
  mountPoints: string[];
}

const within = (container: string, target: string): boolean =>
  target === container || target.startsWith(container.endsWith('/') ? container : `${container}/`);

/**
 * The reduced probe of 6.12 and 13.2.2, as a pure decision over what the sandbox layer built: the boundary of a
 * read-only role qualifies only when a deny covers the canonical workspace and the workspace itself (or anything
 * inside it) was not expanded into its children, which leaves new entries writable. `workspace` and the lists are
 * canonical absolute paths; the caller (P4.4) holds the role's start on `ok: false` and never widens access.
 */
export function boundaryQualification(
  role: string,
  workspace: string,
  built: BuiltBoundary,
): { ok: true } | { ok: false; finding: WriterFinding } {
  const ws = norm(workspace);
  const fail = (why: string) => ({
    ok: false as const,
    finding: {
      code: 'writer-boundary-unqualified' as const,
      severity: 'error' as const,
      path: `roles.${role}`,
      message: boundaryUnqualifiedText(role, ws, why),
      roles: [role],
    },
  });
  const expanded = built.mountPoints.map(norm).find((m) => within(ws, m));
  if (expanded !== undefined)
    return fail(
      `the deny was expanded into the children of ${expanded}, so new entries there stay writable`,
    );
  if (!built.denyWrite.some((d) => within(norm(d), ws)))
    return fail('no deny-write covers the workspace');
  return { ok: true };
}

export interface WriteVerdict {
  /** False when no overlay applies to the role: this core says nothing. */
  applies: boolean;
  allowed: boolean;
  /** The text the role sees when refused. */
  refusal?: string;
}

/** May `roleId` write the workspace-relative `path` through file tools? (Who may write which path.) */
export function mayWrite(
  def: WriterDef,
  roleId: string,
  path: string,
  opts: WriterOptions = {},
): WriteVerdict {
  const ov = overlayFor(def, roleId, opts);
  if (!ov) return { applies: false, allowed: true };
  if (pathInScope(ov.fileWrite, path)) return { applies: true, allowed: true };
  const writes = writingSections(def)[0].writes;
  if (ov.standing.startsWith('writing-'))
    return {
      applies: true,
      allowed: false,
      refusal: refusalText('outside-writes', roleId, path, { section: ov.section, writes }),
    };
  const mutators = writerPreflight(def, opts)
    .authorities.filter((a) => a.mutates)
    .map((a) => a.role);
  const writer = mutators.length === 1 ? mutators[0] : undefined;
  return {
    applies: true,
    allowed: false,
    refusal: refusalText('read-only', roleId, path, { writes, writer }),
  };
}
