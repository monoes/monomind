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
 * A runtime without an entry here has no known inventory. In an eval org that is
 * a warning (the harness probes its fixture); outside the eval harness it is an
 * error, so no unprotected runner can run a sections org.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveRoleRuntime } from '../runner-specs.js';
import type { OrgDef } from '../types.js';
import type { Findings } from './definition-util.js';
import { sectionsSurface } from './surface.js';

/** Runtimes whose native copy locations are inventoried and protected. */
const INVENTORIED = new Set(['claude']);

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

/** The private mounts of one role: none unless the org is on the sections surface and the runtime is inventoried. */
export function nativeBinds(
  def: { sections?: unknown } | undefined,
  orgDir: string,
  role: string,
  runtime: string,
  home: string,
  env: NodeJS.ProcessEnv,
): NativeBind[] {
  if (!def || !sectionsSurface(def).enabled || !INVENTORIED.has(runtime)) return [];
  return claudeNativeDirs(home, env).map((dest) => ({
    src: join(privateRunnerRoot(orgDir, role), dest.slice(dest.lastIndexOf('/') + 1)),
    dest,
  }));
}

/** Creates each private source directory, for the destinations that exist. */
export function ensureNativeSources(binds: NativeBind[]): NativeBind[] {
  return binds.filter((b) => {
    if (!existsSync(b.dest)) return false;
    mkdirSync(b.src, { recursive: true });
    return true;
  });
}

/** Findings for roles whose runtime has no inventory entry. */
export function copyInventoryFindings(def: OrgDef): Findings {
  const f: Findings = { errors: [], warnings: [] };
  const evalMode =
    (def.run_config as { experimental?: string } | undefined)?.experimental === 'eval';
  for (const role of def.roles) {
    if ((role as { kind?: string }).kind === 'endpoint') continue;
    const runtime = effectiveRoleRuntime(role.runtime, def.runtime, role.provider?.kind);
    if (INVENTORIED.has(runtime)) continue;
    if (evalMode)
      f.warnings.push(
        `roles.${role.id}: runtime "${runtime}" has no copy-inventory entry, so its native copies are not protected from other roles; acceptable only for eval runs of a probed fixture`,
      );
    else
      f.errors.push(
        `roles.${role.id}: runtime "${runtime}" has no copy-inventory entry, so a sections org cannot use it outside the eval harness`,
      );
  }
  return f;
}
