/**
 * `monomind doctor --json` payload (v1), advertised as capability
 * `doctor-json` — doc/agent-exec-protocol.md §10.
 */

import type { CommandContext, CommandResult } from '../types.js';
import type { HealthCheck } from './doctor-env-checks.js';
import { resolveDoctorMode } from './doctor-mode.js';

/** A check result tagged with the component (`-c` name) that produced it. */
export type DoctorResult = HealthCheck & { component?: string };

/**
 * How each component's fix is applied. Components not listed only carry a
 * hint (`fix` text) for a person to follow. A result's own `fixSafety`
 * overrides its component's safety (e.g. a helpers warning `--fix` can't
 * apply is `manual`).
 *  - auto: local, repeatable, applied by `--fix`
 *  - confirm: installs software or runs network/sudo commands; the caller
 *    asks a person first, then passes `flag`
 */
const FIX_APPLY: Record<string, { safety: 'auto' | 'confirm'; flag: '--fix' | '--install' }> = {
  helpers: { safety: 'auto', flag: '--fix' },
  gitignore: { safety: 'auto', flag: '--fix' },
  appledouble: { safety: 'auto', flag: '--fix' },
  sidecars: { safety: 'auto', flag: '--fix' },
  'monoes-tools': { safety: 'confirm', flag: '--fix' },
  claude: { safety: 'confirm', flag: '--install' },
};

/** The `doctor --json` payload (v1). Advertised as capability `doctor-json`. */
export function doctorJsonPayload(ctx: CommandContext, result: CommandResult) {
  const data = (result.data ?? {}) as {
    results?: DoctorResult[];
    fixes?: { component: string; outcome: string }[];
    error?: string;
  };
  const results = (data.results ?? []).map((r) => {
    const apply = r.component ? FIX_APPLY[r.component] : undefined;
    const safety = r.fixSafety ?? apply?.safety ?? 'manual';
    return {
      component: r.component ?? null,
      name: r.name,
      status: r.status,
      message: r.message,
      fix: r.fix ?? null,
      fix_safety: r.fix ? safety : null,
      fix_flag: r.fix && safety !== 'manual' ? (apply?.flag ?? null) : null,
      skipped_reason: r.skippedReason ?? null,
    };
  });
  const count = (st: string) => results.filter((r) => r.status === st).length;
  const mode = resolveDoctorMode(ctx.flags);
  return {
    v: 1,
    cwd: ctx.cwd || process.cwd(),
    read_only: mode.readOnly,
    offline: mode.offline,
    success: result.success,
    error: data.error ?? null,
    summary: {
      passed: count('pass'),
      warnings: count('warn'),
      failed: count('fail'),
      info: count('info'),
      skipped: count('skipped'),
    },
    results,
    fixes: data.fixes ?? [],
  };
}
