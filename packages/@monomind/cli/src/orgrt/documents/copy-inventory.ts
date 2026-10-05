// packages/@monomind/cli/src/orgrt/documents/copy-inventory.ts
/**
 * GA row R5 (spec 9.3; 6.1 copy inventory): where a runner keeps native copies
 * of what its roles see (transcripts with tool results, subagent transcripts,
 * file backups, debug logs) and how a sections org keeps one role's copies from
 * another.
 *
 * Claude Code writes them under its config dir (`projects/`, `file-history/`,
 * `debug/`), shared by every role of a user. In a sections org each role's runner
 * is started with a private host directory bound over each of them (the authority
 * mask, exec-deny.ts `bestEffortBinds`): the role's own runner writes and resumes
 * its copies as always, and no other role's runner or tool can see them. The
 * private roots live in `<orgDir>/runner/<role>`, denied to every role.
 *
 * Every other runtime has an entry in the registry of runtime-isolation.ts: its
 * process is started with a private directory of its own (`config-env`: the CLI's
 * own variable; `private-home`: HOME and the XDG bases), under
 * `<orgDir>/runner/<role>/rt-<runtime>`, which only that role's process can see.
 * A `refused` runtime, or one outside the registry, is a warning in an eval org
 * (the harness probes its fixture) and an error outside the eval harness, so no
 * unprotected runner can run a sections org. An `unverified` entry is always a
 * warning: the strategy is generic, not probed.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveRoleRuntime } from '../runner-specs.js';
import type { OrgDef } from '../types.js';
import type { Findings } from './definition-util.js';
import {
  isolationEnv,
  runtimeIsolation,
  stageAuthFiles,
  usesPrivateDir,
} from './runtime-isolation.js';
import { sectionsSurface } from './surface.js';

export const runnerRootFor = (orgDir: string): string => join(orgDir, 'runner');

/** One role's private source directories. */
export const privateRunnerRoot = (orgDir: string, role: string): string =>
  join(runnerRootFor(orgDir), role.replace(/[^A-Za-z0-9._-]/g, '_'));

/** Claude Code's directories holding transcripts, file backups and debug logs. */
export function claudeNativeDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  const cfg = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return ['projects', 'file-history', 'debug'].map((d) => join(cfg, d));
}

export interface NativeBind {
  src: string;
  dest: string;
}

/** The private directory of a role's runner process, for a runtime that has one (`config-env`, `private-home`). */
export const runtimeDirFor = (orgDir: string, role: string, runtime: string): string =>
  join(privateRunnerRoot(orgDir, role), `rt-${runtime.replace(/[^A-Za-z0-9._-]/g, '_')}`);

/**
 * The private mounts of one role: none unless the org is on the sections surface.
 * Claude gets one private source per native directory, bound over it. A runtime
 * with a private directory of its own gets that directory bound over itself
 * (read-write), which keeps it writable inside the read-only runner root while the
 * other roles' directories are hidden.
 */
export function nativeBinds(
  def: { sections?: unknown } | undefined,
  orgDir: string,
  role: string,
  runtime: string,
  home: string,
  env: NodeJS.ProcessEnv,
): NativeBind[] {
  if (!def || !sectionsSurface(def).enabled) return [];
  if (runtime === 'claude')
    return claudeNativeDirs(home, env).map((dest) => ({
      src: join(privateRunnerRoot(orgDir, role), dest.slice(dest.lastIndexOf('/') + 1)),
      dest,
    }));
  if (!usesPrivateDir(runtimeIsolation(runtime, env))) return [];
  const own = runtimeDirFor(orgDir, role, runtime);
  return [{ src: own, dest: own }];
}

/** Creates each private source directory, for the destinations that exist (a private directory bound over itself is created). */
export function ensureNativeSources(binds: NativeBind[]): NativeBind[] {
  return binds.filter((b) => {
    if (b.src !== b.dest && !existsSync(b.dest)) return false;
    mkdirSync(b.src, { recursive: true, mode: 0o700 });
    return true;
  });
}

/**
 * The environment of one role's runner process and the staging behind it: the
 * private directory is created, the credentials the CLI needs are linked into it
 * (the real home is only read), and the variables that point the CLI at it are
 * returned. Empty for an org without sections and for runtimes without a private directory.
 */
export function runtimeIsolationEnv(
  def: { sections?: unknown } | undefined,
  orgDir: string,
  role: string,
  runtime: string,
  home: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  if (!def || !sectionsSurface(def).enabled) return {};
  const iso = runtimeIsolation(runtime, env);
  if (!usesPrivateDir(iso)) return {};
  const dir = runtimeDirFor(orgDir, role, runtime);
  stageAuthFiles(iso, dir, home);
  return isolationEnv(iso, dir, home);
}

/** Findings for roles whose runtime has no usable entry in the isolation registry. */
export function copyInventoryFindings(def: OrgDef, env: NodeJS.ProcessEnv = process.env): Findings {
  const f: Findings = { errors: [], warnings: [] };
  const evalMode =
    (def.run_config as { experimental?: string } | undefined)?.experimental === 'eval';
  for (const role of def.roles) {
    if ((role as { kind?: string }).kind === 'endpoint') continue;
    const runtime = effectiveRoleRuntime(role.runtime, def.runtime, role.provider?.kind);
    const iso = runtimeIsolation(runtime, env);
    if (iso && iso.strategy !== 'refused') {
      if (iso.verified === 'unverified')
        f.warnings.push(
          `roles.${role.id}: runtime "${runtime}" uses the generic "${iso.strategy}" isolation, not probed on a host that has the CLI${iso.note ? ` (${iso.note})` : ''}`,
        );
      continue;
    }
    const why = iso
      ? `is refused for sections orgs: ${iso.note}`
      : 'has no copy-inventory entry, so its native copies are not protected from other roles';
    if (evalMode)
      f.warnings.push(
        `roles.${role.id}: runtime "${runtime}" ${why}; acceptable only for eval runs of a probed fixture`,
      );
    else
      f.errors.push(
        `roles.${role.id}: runtime "${runtime}" ${iso ? why : 'has no copy-inventory entry, so a sections org cannot use it outside the eval harness'}`,
      );
  }
  return f;
}
