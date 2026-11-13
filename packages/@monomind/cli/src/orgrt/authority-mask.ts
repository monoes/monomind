// packages/@monomind/cli/src/orgrt/authority-mask.ts
/**
 * Human authority, kept out of every role — whatever its `policy.git` level
 * and whatever runtime runs it.
 *
 * Three things let a process act as the human who supervises an org:
 *   - the org daemons' operator credentials (`~/.monomind/orgrt-operator/`,
 *     broker.ts), which unlock approve / resolve-gate / answer on a daemon,
 *     and the inbox signing key kept beside them (inbox.ts);
 *   - the dashboard's human-auth secret (`~/.monomind/dashboard-auth/`), from
 *     which its login link and browser session cookie derive;
 *   - the authority files under `.monomind/orgs/` (org-authority-files.ts):
 *     the org definitions, which hold every role's own `policy`, and the
 *     files that record a human's decisions, the daemon's state and its
 *     control files (#498).
 *
 * Roles below `push` on the Claude runtime already run in the SDK's OS
 * sandbox, and role-sandbox.ts feeds it these paths. Everything else — a
 * `push` role, a role whose sandbox is off or unavailable, and every
 * non-Claude CLI runtime — is launched inside a minimal bubblewrap layer from
 * `authorityMaskArgs()`: the whole filesystem as it is, except that the two
 * directories above are replaced by empty tmpfs mounts (so files created
 * there later are hidden too), the dashboard token files read as empty, and
 * the orgs dir is read-only apart from the subdirectories roles work in —
 * so no org definition, decision or control file can be written, created or
 * renamed, and the org root and `.monomind` cannot be renamed away. No git,
 * network or write restriction beyond that.
 *
 * The SDK sandbox cannot express that layout (its denyWrite binds come after
 * its allowWrite binds, so a writable subdirectory of a denied one stays
 * read-only): there the existing authority files are read-only and the
 * directories above them are mount points that cannot be renamed, but a NEW
 * file can still be created in the orgs dir or an org dir. File tools are
 * refused every authority file by policy.ts on the Claude runtime. The
 * barriers for a running org are the daemon holding its gates in memory
 * (decisions.ts's gatesFor) and signed inbox entries (inbox.ts).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { protectableDepsRoot } from '../utils/optional-deps.js';
import {
  isSeatbeltMask,
  SANDBOX_EXEC,
  seatbeltAvailability,
  seatbeltMaskArgs,
} from './authority-mask-seatbelt.js';
import { protectedClaudeBinary } from './claude-sdk.js';
import { dashboardCredentialPaths, HOME_DENY_WRITE, operatorDirOverride } from './file-roots.js';
import {
  maskReadOnlyPaths,
  monomindMaskLayout,
  operatorMountPoints,
} from './operator-protected-paths.js';
import { ensureOrgWorkDirs, orgsMaskLayout } from './org-authority-files.js';
import { realPath } from './policy-paths.js';

/** Under $HOME: the dashboard's human-auth secret (ui/server.mjs). */
export const DASHBOARD_AUTH_DIR = join('.monomind', 'dashboard-auth');
/** Under $HOME: the org daemons' operator credentials (broker.ts). */
export const OPERATOR_DIR = join('.monomind', 'orgrt-operator');

export {
  authorityFilePaths,
  CONTROL_FILES,
  DECISION_FILES,
  GIT_GUARD_DIR,
  isAuthorityFile,
  ORG_STATE_FILES,
  RUN_STATE_FILES,
} from './org-authority-files.js';

/** The directories no role may read. */
export function authorityDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set(
      [join(home, OPERATOR_DIR), operatorDirOverride(env), join(home, DASHBOARD_AUTH_DIR)].filter(
        (d): d is string => !!d,
      ),
    ),
  ];
}

/** Create the authority dirs (owner-only) so they can be masked before
 *  anything is written into them — a mask over a directory also hides files
 *  created after the role started. */
export function ensureAuthorityDirs(home: string, env: NodeJS.ProcessEnv): void {
  for (const d of authorityDirs(home, env)) {
    try {
      mkdirSync(d, { recursive: true, mode: 0o700 });
    } catch {
      /* unmaskable, but nothing can be written there either */
    }
  }
}

/** bubblewrap arguments (before `--`) for the mask; see the module doc. */
export function authorityMaskArgs(ctx: {
  home: string;
  env: NodeJS.ProcessEnv;
  roots: Array<string | undefined>;
  orgRoot?: string;
  /** The role's cwd and `policy.fileWrite`, for the work dirs to create. */
  cwd?: string;
  fileWrite?: string[];
  /** The role's signed `policy.sandbox.allowWrite` (operator-protected-paths.ts). */
  allowWrite?: string[];
  /** Test seam: the platform to build the mask for. */
  platform?: NodeJS.Platform;
}): string[] {
  // macOS has no bubblewrap: the same layout as a Seatbelt profile (#768).
  if ((ctx.platform ?? process.platform) === 'darwin')
    return seatbeltMaskArgs({
      ...ctx,
      hidden: authorityDirs(ctx.home, ctx.env),
    });
  const args = ['--dev-bind', '/', '/'];
  // #527: the directories on the way to what the operator's processes run
  // (`~/.local`, `~/.local/share`, …) bound onto themselves, so none can be
  // renamed aside and a new toolchain planted in its place. First, so the
  // binds below nest inside these mount points instead of covering them.
  // #518's deps dir first, so ~/.monomind exists for the layout below.
  const deps = protectableDepsRoot(ctx.env, ctx.home);
  const mm = monomindMaskLayout(ctx.home, ctx.env);
  const roPaths = maskReadOnlyPaths({ ...ctx, homeDenyWrite: HOME_DENY_WRITE });
  // A directory bound read-only below is a mount point already, and must not
  // get a read-write bind at all (~/.monomind).
  const roBound = new Set([...mm.readOnly, ...roPaths].map(realPath));
  // #522: the directories above an operator-chosen Claude Code
  // (MONOMIND_CLAUDE_PATH, which the daemons run unsandboxed) join them; the
  // binary itself is one of the protected read-only paths. None inside
  // ~/.monomind: a read-only mount point already, which a writable bind
  // there would reopen.
  const mmRoots = mm.readOnly.map(realPath);
  const claudeDirs = protectedClaudeBinary(ctx.env, ctx.home)?.dirs ?? [];
  const anchors = [...new Set([...operatorMountPoints(ctx), ...claudeDirs].map(realPath))].filter(
    (d) => !roBound.has(d) && !mmRoots.some((r) => holds(r, d)),
  );
  for (const d of anchors) args.push('--bind', d, d);
  const afterAnchors = args.length;
  // #502 review: ~/.monomind read-only, only its role-writable entries bound
  // back — first, so a work tree below it (binds further down) still opens.
  for (const d of mm.readOnly.map(realPath)) args.push('--ro-bind', d, d);
  for (const d of mm.writable.map(realPath)) args.push('--bind', d, d);
  // #498: the mask binds only existing work dirs read-write, so create them
  // first (a `git worktree add … work/src` in a masked role needs `work/`).
  ensureOrgWorkDirs(ctx.orgRoot, ctx.fileWrite, ctx.cwd ?? ctx.orgRoot);
  // #498: the org root and its .monomind become mount points, so neither can
  // be renamed away and replaced by a tree with a forged org definition.
  if (ctx.orgRoot)
    for (const d of [ctx.orgRoot, join(ctx.orgRoot, '.monomind')].map(realPath))
      if (existsSync(d)) args.push('--bind', d, d);
  // #527 review round 2: an org root that holds ~/.monomind ($HOME itself)
  // was just bound read-write from the host, uncovering the layout above:
  // apply it again, deps included. The orgs layout below then opens the
  // org's work dirs inside it again (operator-protected-paths.ts leaves that
  // org's own orgs dir out of the ~/.monomind entries it protects).
  const orgRootReal = ctx.orgRoot ? realPath(ctx.orgRoot) : undefined;
  if (orgRootReal && mm.readOnly.some((d) => holds(orgRootReal, realPath(d)))) {
    for (const d of mm.readOnly.map(realPath)) args.push('--ro-bind', d, d);
    for (const d of mm.writable.map(realPath)) args.push('--bind', d, d);
    if (deps && existsSync(deps)) args.push('--ro-bind', realPath(deps), realPath(deps));
  }
  reanchor(args, anchors, afterAnchors);
  // The orgs dir read-only (no new org definition, runfile or decision file,
  // no rename), the dirs roles work in read-write again, then the authority
  // files those still hold read-only (org-authority-files.ts).
  const hidden = authorityDirs(ctx.home, ctx.env);
  const orgs = orgsMaskLayout(ctx.orgRoot, [ctx.home, ...hidden]);
  for (const d of orgs.readOnly) args.push('--ro-bind', d, d);
  for (const d of orgs.writable) args.push('--bind', d, d);
  for (const f of orgs.files) args.push('--ro-bind', f, f);
  // …and one inside a work dir the orgs layout just bound read-write.
  reanchor(args, anchors, afterAnchors);
  // #502 review: what the operator's own processes run or trust, and the
  // shell/git config that would undo the guard. #518's first-use deps dir
  // (utils/optional-deps.ts: code the unsandboxed daemons load) is one of
  // them — ~/.monomind is already a read-only mount point above, with only
  // the role-writable entries bound back, so deps is never writable; it is
  // bound read-only again here, after the org binds, in case one of those is
  // an ancestor. No read-write bind of ~/.monomind itself: that would let a
  // role plant new top-level entries again.
  for (const p of new Set([...roPaths, ...(deps ? [deps] : [])].map(realPath)))
    args.push('--ro-bind', p, p);
  // Last, so that no bind above can uncover them.
  for (const d of hidden) if (existsSync(d)) args.push('--tmpfs', d);
  for (const f of dashboardCredentialPaths(ctx.roots)) args.push('--ro-bind', '/dev/null', f);
  return args;
}

const holds = (t: string, d: string) => d === t || d.startsWith(t.endsWith(sep) ? t : t + sep);

/** Bind each mount-point anchor onto itself again when a read-write bind
 *  made after it (bwrap binds the host's tree, which has no such mount)
 *  hid it: the last bind holding the anchor is a `--bind` of an ancestor.
 *  Not when that last bind is read-only (nothing below it can be renamed),
 *  nor when a bind made since sits inside the anchor, which the new bind
 *  would hide in turn. Shallowest first, so nested anchors stay. */
function reanchor(args: string[], anchors: string[], from: number): void {
  const binds: Array<{ flag: string; target: string }> = [];
  for (let i = from; i < args.length; i++)
    if (args[i] === '--bind' || args[i] === '--ro-bind')
      binds.push({ flag: args[i], target: args[i + 2] });
  const anchorSet = new Set(anchors);
  const redo = anchors.filter((d) => {
    const last = [...binds].reverse().find((b) => holds(b.target, d));
    if (last?.flag !== '--bind' || last.target === d) return false;
    return !binds.some((b) => b.target !== d && holds(d, b.target) && !anchorSet.has(b.target));
  });
  for (const d of redo.sort((a, b) => a.length - b.length)) args.push('--bind', d, d);
}

let probed: { available: boolean; reason?: string } | undefined;

/** Whether the mask can run here: bubblewrap on Linux (user namespaces can be
 *  disabled even when the binary is installed), Seatbelt on macOS, nothing on
 *  Windows. Probed once per process. */
export function authorityMaskAvailability(platform: NodeJS.Platform = process.platform): {
  available: boolean;
  reason?: string;
} {
  if (platform === 'darwin') return seatbeltAvailability();
  if (platform === 'win32')
    return {
      available: false,
      reason: 'no mask for native Windows: run the org under WSL2 (Linux) instead',
    };
  return bubblewrapAvailability(platform);
}

/** Whether a bwrap that actually starts is here (Linux only). */
export function bubblewrapAvailability(platform: NodeJS.Platform = process.platform): {
  available: boolean;
  reason?: string;
} {
  if (platform !== 'linux') return { available: false, reason: `no bubblewrap on ${platform}` };
  if (probed) return probed;
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync('bwrap', ['--dev-bind', '/', '/', '--', 'true'], {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch (err) {
    probed = {
      available: false,
      reason: `bwrap probe failed (${(err as Error).message})`,
    };
    return probed;
  }
  probed =
    r.status === 0
      ? { available: true }
      : {
          available: false,
          reason: r.error
            ? `bwrap not found (${(r.error as NodeJS.ErrnoException).code ?? r.error.message})`
            : `bwrap failed to start (exit ${r.status})`,
        };
  return probed;
}

/** `[command, args]` to spawn: `bin` itself, or `bin` inside the mask. */
export function maskedCommand(
  mask: string[] | undefined,
  bin: string,
  args: string[],
): [string, string[]] {
  if (!mask?.length) return [bin, args];
  return isSeatbeltMask(mask)
    ? [SANDBOX_EXEC, [...mask, bin, ...args]]
    : ['bwrap', [...mask, '--', bin, ...args]];
}
