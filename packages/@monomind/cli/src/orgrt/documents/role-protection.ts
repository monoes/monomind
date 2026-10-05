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
 *    copy directories (R5).
 */
import { mkdirSync } from 'node:fs';
import type { OrgDef } from '../types.js';
import {
  ensureNativeSources,
  type NativeBind,
  nativeBinds,
  runnerRootFor,
} from './copy-inventory.js';
import { envelopeDirFor, loadEnvelopeKey } from './envelope.js';
import { ensureMailDirs, mailRootFor, otherMailDirs } from './mail-isolation.js';
import { sectionsSurface } from './surface.js';

export interface RoleProtection {
  denyReadDirs: string[];
  denyWriteDirs: string[];
  bestEffortDenyRead: string[];
  bestEffortReadOnly: string[];
  bestEffortBinds: NativeBind[];
}

export const NO_PROTECTION: RoleProtection = {
  denyReadDirs: [],
  denyWriteDirs: [],
  bestEffortDenyRead: [],
  bestEffortReadOnly: [],
  bestEffortBinds: [],
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
  const denyRead = [...otherMailDirs(def, orgDir, args.roleId), ...hiddenDirs];
  const denyWrite = [mailRootFor(orgDir), ...hiddenDirs];
  return {
    denyReadDirs: denyRead,
    denyWriteDirs: denyWrite,
    bestEffortDenyRead: denyRead,
    bestEffortReadOnly: denyWrite,
    bestEffortBinds: ensureNativeSources(
      nativeBinds(def, orgDir, args.roleId, args.runtime, args.home, args.env),
    ),
  };
}
