// packages/@monomind/cli/src/orgrt/documents/writer-overlay.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.2): who stands where, and the policy overlay of each role.
 * Pure; nothing outside the writer files imports it yet. `writer-policy.ts` builds the authority
 * classification, the preflight and the runtime checks on top and is the file callers import.
 *
 * Model. When exactly one section declares non-empty `writes`, that section is the writing section:
 *  - its roles keep their own authority, with `fileWrite` cut down to the section's `writes` globs;
 *  - every other agent role (the root, a lead or member of another section) is made
 *    read-only by the overlay: `fileWrite: []`, `sandbox.mode "required"`, `sandbox.denyWrite` naming the
 *    workspace, its own write grants removed, git no higher than "read".
 * With no writing section (no `writes`, only empty ones, or sections off) there is no overlay.
 */
import type { RolePolicy } from '../types.js';
import { rootRoleId } from './routing.js';
import { sectionsSurface } from './surface.js';
import {
  allowReachesWorkspace,
  denyCoversWorkspace,
  fileScopeReachesWorkspace,
  scopeCovers,
  workspaceInfo,
} from './writer-paths.js';
import {
  readOnlyGitText,
  readOnlyGrantText,
  sandboxModeText,
  uncoveredScopeText,
  type WriterCode,
  type WriterFinding,
} from './writer-text.js';

export interface WriterRole {
  id: string;
  type?: string;
  reports_to?: string | null;
  kind?: string;
  runtime?: string;
  policy?: Partial<RolePolicy>;
  tool_providers?: { name: string; allow?: string[] }[];
}

export interface WriterDef {
  name?: string;
  runtime?: string;
  run_config?: Record<string, unknown>;
  sections?: unknown;
  roles: WriterRole[];
}

export interface WriterOptions {
  /** The org root, to compare relative sandbox entries with an absolute workspace. Without it they are undecidable. */
  orgRoot?: string;
  /** The runner roles use when neither the role nor the definition names one (the daemon reads MONOMIND_RUNTIME). */
  defaultRuntime?: string;
}

export type WriterStanding =
  | 'writing-section-lead'
  | 'writing-section-member'
  | 'other-section-lead'
  | 'other-section-member'
  | 'root'
  | 'endpoint';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
const uniq = (xs: string[]): string[] => [...new Set(xs)];
const isDefaultScope = (s: string[] | undefined): boolean =>
  s === undefined || (s.length === 1 && s[0] === '**');

interface SectionInfo {
  name: string;
  lead?: string;
  members: string[];
  writes: string[];
}

/** Sections as declared, read leniently (the definition checks report what is malformed). */
function sectionsOf(def: WriterDef): SectionInfo[] {
  if (!isObject(def.sections)) return [];
  return Object.entries(def.sections)
    .filter((e): e is [string, Record<string, unknown>] => isObject(e[1]))
    .map(([name, s]) => ({
      name,
      lead: typeof s.lead === 'string' ? s.lead : undefined,
      members: strs(s.members),
      writes: strs(s.writes),
    }));
}

export const writingSections = (def: WriterDef): SectionInfo[] =>
  sectionsSurface(def).enabled ? sectionsOf(def).filter((s) => s.writes.length > 0) : [];

/** Where a role stands: its section (if any), lead or member, and whether that section is the writing one. */
export function standingOf(
  def: WriterDef,
  roleId: string,
): { standing: WriterStanding; section?: string } {
  const role = def.roles.find((r) => r.id === roleId);
  if (role?.kind === 'endpoint') return { standing: 'endpoint' };
  const writing = writingSections(def);
  const only = writing.length === 1 ? writing[0].name : undefined;
  if (rootRoleId(def) === roleId) return { standing: 'root' };
  for (const s of sectionsOf(def)) {
    const isLead =
      s.lead === roleId ||
      (s.lead === undefined && s.members.length === 1 && s.members[0] === roleId);
    if (!isLead && !s.members.includes(roleId)) continue;
    const mine = s.name === only;
    return {
      standing:
        `${mine ? 'writing' : 'other'}-section-${isLead ? 'lead' : 'member'}` as WriterStanding,
      section: s.name,
    };
  }
  // validate refuses a non-root role outside every section; failing closed beats leaving one unrestricted.
  throw new Error(
    `role "${roleId}" is in no section, so it has no writer standing (validate refuses it)`,
  );
}

export interface WriterOverlay {
  role: string;
  standing: WriterStanding;
  section?: string;
  /** Replaces `policy.fileWrite`. */
  fileWrite: string[];
  /** Read-only roles only: replaces `policy.sandbox.mode`, `denyWrite` and (when the role had one) `allowWrite`. */
  sandbox?: { mode: 'required'; denyWrite: string[]; allowWrite?: string[] };
  /** Read-only roles only, and only when the role's own level is above "read". */
  git?: 'read';
}

export interface Plan {
  overlay?: WriterOverlay;
  notes: WriterFinding[];
}

function note(
  code: WriterCode,
  severity: 'error' | 'warning',
  path: string,
  message: string,
  role: string,
): WriterFinding {
  return { code, severity, path, message, roles: [role] };
}

/** The overlay of one role and the findings its own policy earns (a grant that conflicts with the rule). */
export function plan(def: WriterDef, roleId: string, opts: WriterOptions): Plan {
  const writing = writingSections(def);
  const role = def.roles.find((r) => r.id === roleId);
  if (writing.length !== 1 || !role || role.kind === 'endpoint') return { notes: [] };
  const { standing, section } = standingOf(def, roleId);
  const pol = role.policy ?? {};
  const notes: WriterFinding[] = [];

  if (standing === 'writing-section-lead' || standing === 'writing-section-member') {
    const writes = uniq(writing[0].writes);
    const own = pol.fileWrite;
    let fileWrite = writes;
    if (!isDefaultScope(own)) {
      const kept = uniq((own as string[]).filter((e) => writes.some((w) => scopeCovers(w, e))));
      const dropped = (own as string[]).filter((e) => !kept.includes(e));
      if (dropped.length > 0)
        notes.push(
          note(
            'writer-scope-uncovered',
            'error',
            `roles.${roleId}.policy.fileWrite`,
            uncoveredScopeText(roleId, dropped, writes),
            roleId,
          ),
        );
      fileWrite = kept;
    }
    return { overlay: { role: roleId, standing, section, fileWrite }, notes };
  }

  const ws = workspaceInfo(def, roleId);
  const sb = pol.sandbox ?? {};
  const denyWrite = uniq(sb.denyWrite ?? []);
  if (!denyWrite.some((d) => denyCoversWorkspace(d, ws, opts.orgRoot))) denyWrite.push(ws.entry);
  const sandbox: NonNullable<WriterOverlay['sandbox']> = { mode: 'required', denyWrite };
  if (sb.allowWrite !== undefined) {
    const keep = sb.allowWrite.filter((a) => !allowReachesWorkspace(a, ws, opts.orgRoot));
    const dropped = sb.allowWrite.filter((a) => !keep.includes(a));
    if (dropped.length > 0)
      notes.push(
        note(
          'writer-readonly-grant',
          'error',
          `roles.${roleId}.policy.sandbox.allowWrite`,
          readOnlyGrantText(roleId, 'sandbox.allowWrite', dropped),
          roleId,
        ),
      );
    sandbox.allowWrite = keep;
  }
  if (!isDefaultScope(pol.fileWrite)) {
    const reach = (pol.fileWrite as string[]).filter((e) =>
      fileScopeReachesWorkspace(e, ws, opts.orgRoot),
    );
    if (reach.length > 0)
      notes.push(
        note(
          'writer-readonly-grant',
          'error',
          `roles.${roleId}.policy.fileWrite`,
          readOnlyGrantText(roleId, 'fileWrite', reach),
          roleId,
        ),
      );
  }
  if (sb.mode === 'off')
    notes.push(
      note(
        'writer-sandbox-mode-overridden',
        'warning',
        `roles.${roleId}.policy.sandbox.mode`,
        sandboxModeText(roleId, 'off'),
        roleId,
      ),
    );
  const overlay: WriterOverlay = { role: roleId, standing, section, fileWrite: [], sandbox };
  if (pol.git === 'commit' || pol.git === 'push') {
    overlay.git = 'read';
    notes.push(
      note(
        'writer-readonly-git',
        'error',
        `roles.${roleId}.policy.git`,
        readOnlyGitText(roleId, pol.git),
        roleId,
      ),
    );
  }
  return { overlay, notes };
}

/** The policy overlay of one role, or undefined when no overlay applies (see the header). */
export function overlayFor(
  def: WriterDef,
  roleId: string,
  opts: WriterOptions = {},
): WriterOverlay | undefined {
  return plan(def, roleId, opts).overlay;
}

/** `policy` with the overlay applied; the same object when there is no overlay. Idempotent. */
export function applyWriterOverlay<P extends Partial<RolePolicy> | undefined>(
  policy: P,
  overlay: WriterOverlay | undefined,
): P | Partial<RolePolicy> {
  if (!overlay) return policy;
  const out: Partial<RolePolicy> = { ...(policy ?? {}), fileWrite: [...overlay.fileWrite] };
  if (overlay.git) out.git = overlay.git;
  if (overlay.sandbox) {
    const { mode, denyWrite, allowWrite } = overlay.sandbox;
    out.sandbox = {
      ...(policy?.sandbox ?? {}),
      mode,
      denyWrite: [...denyWrite],
      ...(allowWrite ? { allowWrite: [...allowWrite] } : {}),
    };
  }
  return out;
}
