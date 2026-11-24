// packages/@monomind/cli/src/orgrt/authority-mask-win32.ts
/**
 * The authority mask on native Windows (#852): the read boundary of the
 * operator credentials, the dashboard secret, other roles' mail digests and
 * their native runner copies, without WSL2.
 *
 * Design: a restricted token with marker SIDs.
 *   - A role's whole process tree is started by a PowerShell launcher
 *     (authority-mask-win32-launcher.ts) under CreateRestrictedToken of the
 *     daemon's own token: every privilege dropped (no SeBackupPrivilege), the
 *     user, Everyone, Users, Authenticated Users, logon-session and, when
 *     present, Administrators SIDs as restricting SIDs, plus a MARKER SID
 *     that no real account has. Windows checks access twice for such a token;
 *     the second check sees the restricting SIDs only.
 *   - The protected paths carry an explicit DENY entry for the marker. The
 *     daemon's token does not hold the marker, so the daemon is unaffected;
 *     the role's token holds it as a restricting SID, so the second check
 *     matches the deny and refuses read, write, ACL change and take-ownership
 *     alike. The entry is inherited, so files created later are covered.
 *   - Two markers: one common to every role (authority dirs, dashboard token
 *     files, the launcher's own directory) and one per role id, for what only
 *     the other roles may not touch (mail digests, native runner copies, the
 *     read-only mail root, with an explicit allow for the role's own dir).
 *   - A kill-on-close job object ends the role's tree with the launcher.
 *
 * Why not the alternatives (no native addon, nothing to install):
 *   - icacls deny for the user: the daemon runs as the same user and would
 *     lock itself out; a deny for a marker needs a token that carries it.
 *     icacls also refuses unmapped SIDs, so the launcher sets ACLs with .NET.
 *   - AppContainer: denies the user's whole profile and the toolchains
 *     (node, git, the CLIs) unless every one is re-granted; too invasive.
 *   - Low integrity level: blocks writes to every medium-integrity object, the
 *     role's own work tree and temp included.
 *   - A separate local user: needs an administrator to create it.
 *
 * What it does NOT do (say so in docs): it is a file-access boundary against
 * the role's own process tree, not a boundary against a hostile same-user
 * process. A role can still open the daemon's process (same user, the
 * restricted second check passes on the user SID), use a same-user broker
 * (scheduled tasks, COM) to run something unrestricted, and read the daemon's
 * memory. The org layout (orgs dir read-only, authority files, mount-point
 * renames) of the bubblewrap and Seatbelt masks is NOT reproduced: only
 * confidentiality of the paths above, and write-protection of the launcher
 * and of the mail root. Per-role private native copy directories cannot be
 * bound (no bind mounts): the other roles' directories are unreadable, and
 * Claude's own are shared (audited `native-copies-unprotected`).
 * Where PowerShell cannot compile the launcher (Constrained Language Mode,
 * AppLocker, policy-forced execution policy) the probe says unavailable and the
 * org needs `run_config.host_isolation: "best-effort"`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WIN_LAUNCHER } from './authority-mask-win32-launcher.js';

export const WIN_MASK_FLAG = '--win-restricted';

/** Whether `mask` is the native-Windows mask (as opposed to bubblewrap or Seatbelt). */
export const isWinMask = (mask: string[] | undefined): boolean => mask?.[0] === WIN_MASK_FLAG;

// A well-formed domain SID under the NT non-unique authority whose sub-authorities
// spell "MMMM" (0x4D4D4D4D): no real account has it.
const MARKER_BASE = 'S-1-5-21-1297241933-1297241933-1297241933';
/** The marker every masked role carries. */
export const COMMON_MARKER = `${MARKER_BASE}-1`;
/** The marker of one role id. */
export function roleMarker(roleId: string): string {
  const n = createHash('sha256').update(roleId).digest().readUInt32BE(0) % 2_000_000_000;
  return `${MARKER_BASE}-${1000 + n}`;
}

export interface WinAclRule {
  path: string;
  sid: string;
  /** System.Security.AccessControl.FileSystemRights names. */
  rights: string;
  allow?: boolean;
}

interface WinSpec {
  markers: string[];
  deny: WinAclRule[];
}

const NO_WRITE = 'Write, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership';
export const denyAllRule = (path: string, sid: string): WinAclRule => ({
  path,
  sid,
  rights: 'FullControl',
});
export const denyWriteRule = (path: string, sid: string): WinAclRule => ({
  path,
  sid,
  rights: NO_WRITE,
});
/** Placed on a directory inside a write-denied tree: explicit entries come first. */
export const allowModifyRule = (path: string, sid: string): WinAclRule => ({
  path,
  sid,
  rights: 'Modify',
  allow: true,
});

const encode = (spec: WinSpec): string => Buffer.from(JSON.stringify(spec)).toString('base64');
const decode = (b64: string): WinSpec =>
  JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as WinSpec;

/** The launcher script, written once under `<home>/.monomind/win-launch` and made
 *  unwritable to roles by the first launch. The name carries the content hash,
 *  and the content is checked on every build of a mask. */
export function ensureLauncher(dir: string): string {
  const hash = createHash('sha256').update(WIN_LAUNCHER).digest('hex').slice(0, 16);
  const file = join(dir, `launcher-${hash}.ps1`);
  mkdirSync(dir, { recursive: true });
  const same = existsSync(file) && readFileSync(file, 'utf8') === WIN_LAUNCHER;
  if (!same) writeFileSync(file, WIN_LAUNCHER, 'utf8');
  return file;
}

/** The Windows counterpart of `authorityMaskArgs`: `[flag, spec, launcher]`.
 *  `hidden` are the authority directories, `files` the dashboard token files. */
export function winMaskArgs(ctx: {
  home: string;
  hidden: string[];
  files: string[];
  /** Test seam: where the launcher lives. */
  launcherDir?: string;
}): string[] {
  const dir = ctx.launcherDir ?? join(ctx.home, '.monomind', 'win-launch');
  const launcher = ensureLauncher(dir);
  const deny = [
    ...ctx.hidden.filter((d) => existsSync(d)).map((d) => denyAllRule(d, COMMON_MARKER)),
    ...ctx.files.filter((f) => existsSync(f)).map((f) => denyAllRule(f, COMMON_MARKER)),
    denyWriteRule(dir, COMMON_MARKER),
  ];
  return [WIN_MASK_FLAG, encode({ markers: [COMMON_MARKER], deny }), launcher];
}

/** The mask with the role's own marker and `rules` (made with `roleMarker`) added. */
export function winMaskWith(mask: string[], roleId: string, rules: WinAclRule[]): string[] {
  const spec = decode(mask[1]);
  const marker = roleMarker(roleId);
  const markers = spec.markers.includes(marker) ? spec.markers : [...spec.markers, marker];
  return [WIN_MASK_FLAG, encode({ markers, deny: [...spec.deny, ...rules] }), mask[2]];
}

/** Absolute, so a `powershell.exe` placed on PATH or in the cwd is never run. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const p = join(
    env.SystemRoot ?? env.windir ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return existsSync(p) ? p : 'powershell.exe';
}

/** `[command, args]` that runs `bin` inside the Windows mask. */
export function winMaskedCommand(mask: string[], bin: string, args: string[]): [string, string[]] {
  return [
    powershellPath(),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      mask[2],
      mask[1],
      bin,
      ...args,
    ],
  ];
}

let probed: { available: boolean; reason?: string } | undefined;

/** Whether the launcher works here: PowerShell 5.1 compiles it and a restricted
 *  token with a job object starts a program. Probed once per process. */
export function winMaskAvailability(platform: NodeJS.Platform = process.platform): {
  available: boolean;
  reason?: string;
} {
  if (platform !== 'win32')
    return {
      available: false,
      reason: `no restricted-token mask on ${platform}`,
    };
  if (probed) return probed;
  const dir = mkdtempSync(join(tmpdir(), 'mm-win-probe-'));
  try {
    const file = ensureLauncher(dir);
    const spec = encode({ markers: [COMMON_MARKER], deny: [] });
    const [cmd, argv] = winMaskedCommand([WIN_MASK_FLAG, spec, file], 'cmd.exe', [
      '/d',
      '/c',
      'exit',
      '0',
    ]);
    const r = spawnSync(cmd, argv, {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    if (r.status === 0) return (probed = { available: true });
    const why = r.error
      ? r.error.message
      : (r.stderr || r.stdout || '').trim().split('\n')[0]?.slice(0, 160) || `exit ${r.status}`;
    return (probed = {
      available: false,
      reason: `the PowerShell restricted-token launcher cannot run (${why}); run the org under WSL2 (Linux) instead`,
    });
  } catch (err) {
    return (probed = {
      available: false,
      reason: `the PowerShell restricted-token probe failed (${(err as Error).message}); run the org under WSL2 (Linux) instead`,
    });
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a temp dir left behind */
    }
  }
}
