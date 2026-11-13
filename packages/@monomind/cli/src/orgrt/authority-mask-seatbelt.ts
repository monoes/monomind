// packages/@monomind/cli/src/orgrt/authority-mask-seatbelt.ts
/**
 * The authority mask on macOS (#768): the same layout as the bubblewrap mask
 * in authority-mask.ts, written as a Seatbelt profile for `sandbox-exec`.
 *
 * Seatbelt has no mount namespace, so the layout is expressed as rules over
 * the host's own paths (last matching rule wins):
 *   - the authority directories (operator credentials, dashboard secret) and
 *     the dashboard token files are unreadable, whenever they were created;
 *   - the orgs dir, ~/.monomind, the operator-protected paths and the
 *     authority files are read-only, apart from the directories roles work in;
 *   - the org root, `.monomind` and the directories above what the operator
 *     runs cannot be renamed or removed.
 *
 * What it cannot do: bind a private directory over another one. A runtime that
 * names its own directory through an environment variable or HOME (every
 * runtime but Claude, runtime-isolation.ts) needs no bind: the other roles'
 * directories are unreadable here (GA row R5). Claude's native copies are
 * shared on macOS; the session audits `native-copies-unprotected` and
 * preflight warns.
 * The mask is a `['-p', profile]` argument list, run by `maskedCommand`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { protectableDepsRoot } from '../utils/optional-deps.js';
import { protectedClaudeBinary } from './claude-sdk.js';
import { dashboardCredentialPaths, HOME_DENY_WRITE } from './file-roots.js';
import {
  maskReadOnlyPaths,
  monomindMaskLayout,
  operatorMountPoints,
} from './operator-protected-paths.js';
import { ensureOrgWorkDirs, orgsMaskLayout } from './org-authority-files.js';
import { realPath } from './policy-paths.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** A path as an SBPL string literal. */
export function sbplString(p: string): string {
  if (/[\0\n\r]/.test(p)) throw new Error(`cannot put ${JSON.stringify(p)} in a sandbox profile`);
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const sub = (p: string) => `(subpath ${sbplString(p)})`;
const lit = (p: string) => `(literal ${sbplString(p)})`;

/** Whether `mask` is a Seatbelt profile (as opposed to bubblewrap arguments). */
export const isSeatbeltMask = (mask: string[] | undefined): boolean => mask?.[0] === '-p';

/** The mask with `rules` added at the end, where they win over what came before. */
export function seatbeltWith(mask: string[], rules: string[]): string[] {
  return ['-p', `${mask[1]}\n${rules.join('\n')}`, ...mask.slice(2)];
}

export const denyReadRules = (paths: string[]): string[] =>
  paths.map(realPath).map((p) => `(deny file-read* ${sub(p)})`);
export const denyWriteRules = (paths: string[]): string[] =>
  paths.map(realPath).map((p) => `(deny file-write* ${sub(p)})`);
/** Add after a deny that covers `paths`: the role's own directory inside it stays writable. */
export const allowWriteRules = (paths: string[]): string[] =>
  paths.map(realPath).map((p) => `(allow file-write* ${sub(p)})`);

/** The Seatbelt counterpart of `authorityMaskArgs`; same context. */
export function seatbeltMaskArgs(ctx: {
  home: string;
  env: NodeJS.ProcessEnv;
  roots: Array<string | undefined>;
  orgRoot?: string;
  cwd?: string;
  fileWrite?: string[];
  allowWrite?: string[];
  hidden: string[];
}): string[] {
  const deps = protectableDepsRoot(ctx.env, ctx.home);
  const mm = monomindMaskLayout(ctx.home, ctx.env);
  const roPaths = maskReadOnlyPaths({
    ...ctx,
    homeDenyWrite: HOME_DENY_WRITE,
  }).map(realPath);
  ensureOrgWorkDirs(ctx.orgRoot, ctx.fileWrite, ctx.cwd ?? ctx.orgRoot);
  const orgs = orgsMaskLayout(ctx.orgRoot, [ctx.home, ...ctx.hidden]);
  const claudeDirs = protectedClaudeBinary(ctx.env, ctx.home)?.dirs ?? [];
  const keepInPlace = [
    ...operatorMountPoints(ctx),
    ...claudeDirs,
    ...(ctx.orgRoot ? [ctx.orgRoot, join(ctx.orgRoot, '.monomind')] : []),
  ]
    .map(realPath)
    .filter((d) => existsSync(d));
  const rules = [
    '(version 1)',
    '(allow default)',
    // read-only trees, then the directories roles write in, then the files they hold
    ...mm.readOnly.map(realPath).map((p) => `(deny file-write* ${sub(p)})`),
    ...mm.writable.map(realPath).map((p) => `(allow file-write* ${sub(p)})`),
    ...orgs.readOnly.map((p) => `(deny file-write* ${sub(p)})`),
    ...orgs.writable.map((p) => `(allow file-write* ${sub(p)})`),
    ...orgs.files.map((p) => `(deny file-write* ${sub(p)})`),
    // what the operator's processes run or trust, and the guard-undoing config
    ...[...new Set([...roPaths, ...(deps ? [realPath(deps)] : [])])].map(
      (p) => `(deny file-write* ${sub(p)})`,
    ),
    // mount-point equivalent: the directory itself cannot be renamed or removed
    ...keepInPlace.map((p) => `(deny file-write-unlink ${lit(p)})`),
    // last, so no allow above can uncover them
    ...ctx.hidden
      .filter((d) => existsSync(d))
      .map((d) => `(deny file-read* file-write* ${sub(realPath(d))})`),
    ...dashboardCredentialPaths(ctx.roots).map((f) => `(deny file-read* ${lit(realPath(f))})`),
  ];
  return ['-p', rules.join('\n')];
}

let probed: { available: boolean; reason?: string } | undefined;

/** Whether `sandbox-exec` can apply a profile here. Not when this process is
 *  already inside a Seatbelt sandbox (they do not nest). Probed once. */
export function seatbeltAvailability(): {
  available: boolean;
  reason?: string;
} {
  if (probed) return probed;
  if (!existsSync(SANDBOX_EXEC))
    return (probed = { available: false, reason: `${SANDBOX_EXEC} not found` });
  const r = spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true'], {
    stdio: 'ignore',
    timeout: 5000,
  });
  return (probed =
    r.status === 0
      ? { available: true }
      : {
          available: false,
          reason: r.error
            ? `sandbox-exec failed (${r.error.message})`
            : `sandbox-exec cannot apply a profile (exit ${r.status}); it does not nest inside another sandbox`,
        });
}
