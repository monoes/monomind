// packages/@monomind/cli/src/orgrt/documents/role-protection.ts
/**
 * GA rows R2 to R5 (spec 9.3): everything a sections org withholds from one role's
 * runner, computed in one place so the session and the hardening probes use the
 * same function. For an org without sections, or without an org directory, every
 * list is empty and nothing is created.
 *
 *  - denyReadDirs / bestEffortDenyRead: other roles' mail digests (R3), the envelope
 *    key (R2) and the per-role private runner roots (R5), as file-tool and SDK-sandbox
 *    rules and, where bubblewrap works, authority-mask hiding.
 *  - denyWriteDirs / bestEffortReadOnly: the mail root (R4), the envelope key and the
 *    runner roots, so no role writes, overwrites, renames or deletes there.
 *  - bestEffortBinds: this role's private directories bound over the runner's native
 *    copy directories (R5); for a runtime with a private directory of its own, that
 *    directory bound over itself, with every other role's directory hidden instead of
 *    the whole runner root.
 *  - runtimeEnv: the variables that point a non-Claude runner at that directory.
 */
import { mkdirSync } from 'node:fs';
import type { OrgDef } from '../types.js';
import {
  ensureNativeSources,
  type NativeBind,
  nativeBinds,
  privateRunnerRoot,
  runnerRootFor,
  runtimeIsolationEnv,
} from './copy-inventory.js';
import { envelopeDirFor, loadEnvelopeKey } from './envelope.js';
import { ensureMailDirs, mailRootFor, otherMailDirs } from './mail-isolation.js';
import { runtimeIsolation, usesPrivateDir } from './runtime-isolation.js';
import { sectionsSurface } from './surface.js';

export interface RoleProtection {
  denyReadDirs: string[];
  denyWriteDirs: string[];
  bestEffortDenyRead: string[];
  bestEffortReadOnly: string[];
  bestEffortBinds: NativeBind[];
  runtimeEnv: Record<string, string>;
}

export const NO_PROTECTION: RoleProtection = {
  denyReadDirs: [],
  denyWriteDirs: [],
  bestEffortDenyRead: [],
  bestEffortReadOnly: [],
  bestEffortBinds: [],
  runtimeEnv: {},
};

export function sectionsRoleProtection(args: {
  def: (Pick<OrgDef, 'roles'> & { sections?: unknown }) | undefined;
  orgDir: string | undefined;
  roleId: string;
  runtime: string;
  home: string;
  env: NodeJS.ProcessEnv;
}): RoleProtection {
  const { def, orgDir } = args;
  if (!orgDir || !def || !sectionsSurface(def).enabled) return NO_PROTECTION;
  ensureMailDirs(def, orgDir);
  loadEnvelopeKey(orgDir);
  mkdirSync(runnerRootFor(orgDir), { recursive: true });
  const hiddenDirs = [envelopeDirFor(orgDir), runnerRootFor(orgDir)];
  const mailDenied = otherMailDirs(def, orgDir, args.roleId);
  const denyRead = [...mailDenied, ...hiddenDirs];
  const denyWrite = [mailRootFor(orgDir), ...hiddenDirs];
  // A runtime with a private directory of its own runs inside the runner root, so
  // the mask hides the other roles' directories, not the root itself.
  const ownDir = usesPrivateDir(runtimeIsolation(args.runtime, args.env));
  const maskHidden = ownDir
    ? [...mailDenied, envelopeDirFor(orgDir), ...otherRunnerDirs(def, orgDir, args.roleId)]
    : denyRead;
  return {
    denyReadDirs: denyRead,
    denyWriteDirs: denyWrite,
    bestEffortDenyRead: maskHidden,
    bestEffortReadOnly: denyWrite,
    bestEffortBinds: ensureNativeSources(
      nativeBinds(def, orgDir, args.roleId, args.runtime, args.home, args.env),
    ),
    runtimeEnv: runtimeIsolationEnv(def, orgDir, args.roleId, args.runtime, args.home, args.env),
  };
}

/** Creates every role's private runner directory and returns the other roles' directories. */
function otherRunnerDirs(def: Pick<OrgDef, 'roles'>, orgDir: string, roleId: string): string[] {
  const dirs: string[] = [];
  for (const r of def.roles) {
    if ((r as { kind?: string }).kind === 'endpoint') continue;
    const dir = privateRunnerRoot(orgDir, r.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (r.id !== roleId) dirs.push(dir);
  }
  return dirs;
}
