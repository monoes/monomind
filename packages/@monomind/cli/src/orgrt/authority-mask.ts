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
 *   - the decision files in each org dir — gates, approvals, questions and
 *     the inbox — which a daemon or the next run reads back.
 *
 * Roles below `push` on the Claude runtime already run in the SDK's OS
 * sandbox, and role-sandbox.ts feeds it these paths. Everything else — a
 * `push` role, a role whose sandbox is off or unavailable, and every
 * non-Claude CLI runtime — is launched inside a minimal bubblewrap layer from
 * `authorityMaskArgs()`: the whole filesystem as it is, except that the two
 * directories above are replaced by empty tmpfs mounts (so files created
 * there later are hidden too), the dashboard token files read as empty, and
 * the decision files are read-only. No git, network or write restriction
 * beyond that, so a role behaves exactly as before.
 *
 * The decision files are defence in depth, not the barrier: a process that
 * can write a file's directory can rename the directory away and plant a new
 * one. The barriers are the daemon holding a running org's gates in memory
 * (decisions.ts's gatesFor) and signed inbox entries (inbox.ts).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { dashboardCredentialPaths, operatorDirOverride } from './file-roots.js';

/** Under $HOME: the dashboard's human-auth secret (ui/server.mjs). */
export const DASHBOARD_AUTH_DIR = join('.monomind', 'dashboard-auth');
/** Under $HOME: the org daemons' operator credentials (broker.ts). */
export const OPERATOR_DIR = join('.monomind', 'orgrt-operator');

/** Files in `<root>/.monomind/orgs/<org>/` that record a human's decisions. */
export const DECISION_FILES = ['gates.json', 'approvals.json', 'questions.json', 'inbox.jsonl'];

export function isDecisionFile(p: string): boolean {
  const orgs = dirname(dirname(p));
  return (
    DECISION_FILES.includes(basename(p)) &&
    basename(orgs) === 'orgs' &&
    basename(dirname(orgs)) === '.monomind'
  );
}

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

/** Existing decision files of every org under `orgRoot`. */
export function decisionFilePaths(orgRoot: string | undefined): string[] {
  if (!orgRoot) return [];
  const orgs = join(orgRoot, '.monomind', 'orgs');
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(orgs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const org of entries)
    for (const f of DECISION_FILES) {
      const p = join(orgs, org, f);
      if (existsSync(p)) out.push(p);
    }
  return out;
}

/** bubblewrap arguments (before `--`) for the mask; see the module doc. */
export function authorityMaskArgs(ctx: {
  home: string;
  env: NodeJS.ProcessEnv;
  roots: Array<string | undefined>;
  orgRoot?: string;
}): string[] {
  const args = ['--dev-bind', '/', '/'];
  for (const d of authorityDirs(ctx.home, ctx.env)) if (existsSync(d)) args.push('--tmpfs', d);
  for (const f of dashboardCredentialPaths(ctx.roots)) args.push('--ro-bind', '/dev/null', f);
  for (const f of decisionFilePaths(ctx.orgRoot)) args.push('--ro-bind', f, f);
  return args;
}

let probed: { available: boolean; reason?: string } | undefined;

/** Whether the mask can run here: Linux with a bwrap that actually starts
 *  (user namespaces can be disabled even when the binary is installed).
 *  Probed once per process. */
export function authorityMaskAvailability(platform: NodeJS.Platform = process.platform): {
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
    probed = { available: false, reason: `bwrap probe failed (${(err as Error).message})` };
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
  return mask?.length ? ['bwrap', [...mask, '--', bin, ...args]] : [bin, args];
}
